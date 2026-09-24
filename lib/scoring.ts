import { canonicalName } from "@/lib/normalize"
import { unitsForScoring } from "@/lib/non-scoring"
import type { WeightResolver } from "@/lib/weights"
import type { SchoolScorecard, SchoolSnapshot, ScoreNode, ScoredRoom, ScoredUnit } from "@/lib/types"

function weightedAverage(items: { score: number; weight: number }[]): number | null {
  const valid = items.filter((item) => item.weight > 0 && Number.isFinite(item.score))
  if (!valid.length) return null
  const total = valid.reduce((sum, item) => sum + item.weight, 0)
  if (total <= 0) return null
  return valid.reduce((sum, item) => sum + item.score * item.weight, 0) / total
}

function average(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

interface RoomResult {
  room: ScoredRoom
  overall: number | null
  categories: Map<string, number>
  subcategories: Map<string, { category: string; subcategory: string; score: number }>
  questions: Map<string, { questionId: string; question: string; category: string; subcategory: string; score: number }>
}

function scoreRoom(room: ScoredRoom, weights: WeightResolver): RoomResult {
  if (room.markedAbsent) {
    return {
      room,
      overall: 0,
      categories: new Map(),
      subcategories: new Map(),
      questions: new Map(),
    }
  }

  const units = unitsForScoring(
    room.units.map((unit) => ({
      ...unit,
      weight: weights.question(unit.questionId, unit.category, unit.question),
    })),
  )
  const unitCounts = new Map<string, number>()
  for (const unit of units) {
    unitCounts.set(unit.questionId, (unitCounts.get(unit.questionId) ?? 0) + 1)
  }

  const subMap = new Map<string, { category: string; subcategory: string; items: ScoredUnit[]; weight: number }>()
  for (const unit of units) {
    const key = `${canonicalName(unit.category)}::${canonicalName(unit.subcategory)}`
    const existing = subMap.get(key)
    if (existing) {
      existing.items.push(unit)
    } else {
      subMap.set(key, {
        category: unit.category,
        subcategory: unit.subcategory,
        items: [unit],
        weight: weights.subcategory(
          unit.category,
          unit.subcategory,
          room.focusAreaLabel,
          room.spaceType,
        ),
      })
    }
  }

  const subcategoryScores = new Map<string, { category: string; subcategory: string; score: number }>()
  for (const [key, group] of subMap) {
    const score = weightedAverage(
      group.items.map((item) => ({
        score: item.score,
        weight:
          weights.question(item.questionId, item.category) /
          (unitCounts.get(item.questionId) ?? 1),
      })),
    )
    if (score == null) continue
    subcategoryScores.set(key, {
      category: group.category,
      subcategory: group.subcategory,
      score: score * 100,
    })
  }

  const catMap = new Map<string, { category: string; items: { score: number; weight: number }[] }>()
  for (const [key, sub] of subcategoryScores) {
    const group = subMap.get(key)
    if (!group || group.weight <= 0) continue
    const catKey = canonicalName(sub.category)
    const existing = catMap.get(catKey)
    const item = { score: sub.score / 100, weight: group.weight }
    if (existing) existing.items.push(item)
    else catMap.set(catKey, { category: sub.category, items: [item] })
  }

  const categories = new Map<string, number>()
  const categoryItems: { score: number; weight: number }[] = []
  for (const [, group] of catMap) {
    const score = weightedAverage(group.items)
    const weight = weights.category(group.category, room.focusAreaLabel, room.spaceType)
    if (score == null || weight <= 0) continue
    const percent = score * 100
    categories.set(group.category, percent)
    categoryItems.push({ score: percent / 100, weight })
  }

  const overall = weightedAverage(categoryItems)

  return {
    room,
    overall: overall == null ? null : overall * 100,
    categories,
    subcategories: subcategoryScores,
    questions: new Map(),
  }
}

/** Drop not-present placeholders when that space type was actually surveyed. */
function omitAbsentPlaceholders(rooms: ScoredRoom[]): ScoredRoom[] {
  const assessedTypes = new Set(
    rooms
      .filter((room) => !room.markedAbsent)
      .map((room) => `${room.surveyType}::${room.spaceType}`),
  )
  return rooms.filter((room) => {
    if (!room.markedAbsent) return true
    return !assessedTypes.has(`${room.surveyType}::${room.spaceType}`)
  })
}

function withDelta(node: ScoreNode, baselineNodes?: ScoreNode[]): ScoreNode {
  const baseline = baselineNodes?.find((item) => item.id === node.id)
  return {
    ...node,
    baseline: baseline?.score ?? null,
    children: node.children?.map((child) => withDelta(child, baseline?.children)),
  }
}

function buildTree(
  rooms: RoomResult[],
  weights: WeightResolver,
): { overall: number | null; existingOnly: number | null; categories: ScoreNode[]; focusAreas: ScoreNode[] } {
  const scored = rooms.filter((room) => room.overall != null)
  const existing = scored.filter((room) => !room.room.markedAbsent)

  const byFocus = new Map<string, RoomResult[]>()
  for (const room of scored) {
    const list = byFocus.get(room.room.focusAreaLabel) ?? []
    list.push(room)
    byFocus.set(room.room.focusAreaLabel, list)
  }

  const focusAreaScores: { score: number; weight: number }[] = []
  const existingFocusScores: { score: number; weight: number }[] = []
  const focusAreas: ScoreNode[] = []

  const focusNames = [...byFocus.keys()].sort((a, b) => a.localeCompare(b))
  for (const focusArea of focusNames) {
    const focusRooms = byFocus.get(focusArea) ?? []
    const bySpace = new Map<string, RoomResult[]>()
    for (const room of focusRooms) {
      const list = bySpace.get(room.room.spaceType) ?? []
      list.push(room)
      bySpace.set(room.room.spaceType, list)
    }

    const spaceNodes: ScoreNode[] = []
    const spaceScores: { score: number; weight: number }[] = []
    const existingSpaceScores: { score: number; weight: number }[] = []

    for (const spaceType of [...bySpace.keys()].sort((a, b) => a.localeCompare(b))) {
      const spaceRooms = bySpace.get(spaceType) ?? []
      const spaceAvg = average(spaceRooms.map((room) => room.overall as number))
      const existingAvg = average(
        spaceRooms.filter((room) => !room.room.markedAbsent).map((room) => room.overall as number),
      )
      const spaceWeight = weights.space(focusArea, spaceType)
      if (spaceAvg != null && spaceWeight > 0) spaceScores.push({ score: spaceAvg, weight: spaceWeight })
      if (existingAvg != null && spaceWeight > 0) existingSpaceScores.push({ score: existingAvg, weight: spaceWeight })

      const existingRooms = spaceRooms.filter((room) => !room.room.markedAbsent)
      const scoredSpaceRooms = existingRooms.filter((room) => room.overall != null)
      const roomNodes: ScoreNode[] = existingRooms
        .slice()
        .sort((a, b) => a.room.roomName.localeCompare(b.room.roomName, undefined, { numeric: true }))
        .map((room) => {
          const bits = [
            room.room.neighborhood?.trim() || null,
            room.room.gradeType || null,
            room.overall != null ? "complete" : null,
            existingRooms.length > 0 ? `${Math.round(100 / existingRooms.length)}% each` : null,
          ].filter(Boolean)
          return {
            id: `${focusArea}::${spaceType}::${room.room.roomId}`,
            kind: "room" as const,
            label: room.room.roomName,
            score: room.overall,
            baseline: null,
            weight: 1,
            countLabel: bits.join(" · ") || undefined,
            children: categoryNodesForRooms([room], weights),
          }
        })

      if (existingRooms.length > 0) {
        spaceNodes.push({
          id: `${focusArea}::${spaceType}`,
          kind: "group",
          label: spaceType,
          score: existingAvg,
          baseline: null,
          weight: spaceWeight,
          scoredCount: scoredSpaceRooms.length,
          totalCount: existingRooms.length,
          countLabel: `${scoredSpaceRooms.length} of ${existingRooms.length} room${existingRooms.length === 1 ? "" : "s"}`,
          children: roomNodes,
        })
      }
    }

    const focusScore = weightedAverage(spaceScores)
    const existingFocus = weightedAverage(existingSpaceScores)
    const focusWeight = weights.focus(focusArea)
    if (focusScore != null && focusWeight > 0) focusAreaScores.push({ score: focusScore, weight: focusWeight })
    if (existingFocus != null && focusWeight > 0) existingFocusScores.push({ score: existingFocus, weight: focusWeight })

    if (!spaceNodes.length) continue

    const existingFocusRooms = focusRooms.filter((room) => !room.room.markedAbsent)
    const scoredFocusRooms = existingFocusRooms.filter((room) => room.overall != null)
    focusAreas.push({
      id: focusArea,
      kind: "group",
      label: focusArea,
      score: existingFocus ?? focusScore,
      baseline: null,
      weight: focusWeight,
      scoredCount: scoredFocusRooms.length,
      totalCount: existingFocusRooms.length,
      countLabel: `${scoredFocusRooms.length} of ${existingFocusRooms.length} space${existingFocusRooms.length === 1 ? "" : "s"} scored`,
      children: spaceNodes,
    })
  }

  return {
    overall: weightedAverage(focusAreaScores),
    existingOnly: weightedAverage(existingFocusScores) ?? average(existing.map((room) => room.overall as number)),
    categories: categoryNodesForRooms(scored.filter((room) => !room.room.markedAbsent), weights),
    focusAreas,
  }
}

function categoryNodesForRooms(rooms: RoomResult[], weights: WeightResolver): ScoreNode[] {
  const context = rooms.length === 1 ? rooms[0]?.room : null
  const catScores = new Map<string, number[]>()
  const catLabels = new Map<string, string>()
  const subScores = new Map<string, { category: string; subcategory: string; scores: number[] }>()
  const questionScores = new Map<
    string,
    {
      questionId: string
      unitId: string
      question: string
      itemLabel?: string | null
      answer?: string | null
      category: string
      subcategory: string
      scores: number[]
      weight: number
    }
  >()

  for (const room of rooms) {
    for (const [category, score] of room.categories) {
      const key = canonicalName(category)
      catLabels.set(key, category)
      const list = catScores.get(key) ?? []
      list.push(score)
      catScores.set(key, list)
    }
    for (const sub of room.subcategories.values()) {
      const key = `${canonicalName(sub.category)}::${canonicalName(sub.subcategory)}`
      const existing = subScores.get(key)
      if (existing) existing.scores.push(sub.score)
      else subScores.set(key, { category: sub.category, subcategory: sub.subcategory, scores: [sub.score] })
    }
    for (const unit of unitsForScoring(
      room.room.units.map((unit) => ({
        ...unit,
        weight: weights.question(unit.questionId, unit.category, unit.question),
      })),
    )) {
      const weight = unit.weight ?? weights.question(unit.questionId, unit.category, unit.question)
      if (weight <= 0) continue
      const key = unit.unitId || unit.questionId
      const bucket = questionScores.get(key)
      if (bucket) {
        bucket.scores.push(unit.score * 100)
        if (rooms.length > 1) bucket.answer = null
      } else {
        questionScores.set(key, {
          questionId: unit.questionId,
          unitId: unit.unitId,
          question: unit.question,
          itemLabel: unit.itemLabel,
          answer: rooms.length === 1 ? unit.answer : null,
          category: unit.category,
          subcategory: unit.subcategory,
          scores: [unit.score * 100],
          weight,
        })
      }
    }
  }

  return [...catScores.entries()]
    .map(([catKey, scores]) => {
      const category = catLabels.get(catKey) ?? catKey
      const children = [...subScores.values()]
        .filter((sub) => canonicalName(sub.category) === catKey)
        .map((sub) => {
          const questionRows = [...questionScores.values()]
            .filter(
              (q) =>
                canonicalName(q.category) === catKey &&
                canonicalName(q.subcategory) === canonicalName(sub.subcategory),
            )
          const unitsPerQuestion = new Map<string, number>()
          for (const q of questionRows) {
            unitsPerQuestion.set(q.questionId, (unitsPerQuestion.get(q.questionId) ?? 0) + 1)
          }
          const questions = questionRows
            .map((q) => ({
              id: `${category}::${sub.subcategory}::${q.unitId}`,
              kind: "question" as const,
              label: q.question,
              score: average(q.scores),
              baseline: null,
              weight: q.weight / Math.max(1, unitsPerQuestion.get(q.questionId) ?? 1),
              questionId: q.questionId,
              itemLabel: q.itemLabel,
              answer: q.answer,
            }))
            .filter((q) => q.weight > 0)
            .sort(
              (a, b) =>
                (a.questionId ?? "").localeCompare(b.questionId ?? "") ||
                (a.itemLabel ?? "").localeCompare(b.itemLabel ?? ""),
            )

          return {
            id: `${category}::${sub.subcategory}`,
            kind: "group" as const,
            label: sub.subcategory,
            score: average(sub.scores),
            baseline: null,
            weight: weights.subcategory(
              sub.category,
              sub.subcategory,
              context?.focusAreaLabel,
              context?.spaceType,
            ),
            children: questions,
          }
        })
        .sort((a, b) => a.label.localeCompare(b.label))

      return {
        id: category,
        kind: "group" as const,
        label: category,
        score: average(scores),
        baseline: null,
        weight: weights.category(category, context?.focusAreaLabel, context?.spaceType),
        children,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function scoreSchool(
  snapshot: SchoolSnapshot,
  weights: WeightResolver,
  baseline?: WeightResolver,
): SchoolScorecard {
  const snapshotRooms = omitAbsentPlaceholders(snapshot.rooms)
  const rooms = snapshotRooms.map((room) => scoreRoom(room, weights))
  const tree = buildTree(rooms, weights)
  const baselineTree = baseline
    ? buildTree(
        snapshotRooms.map((room) => scoreRoom(room, baseline)),
        baseline,
      )
    : null

  return {
    schoolId: snapshot.schoolId,
    schoolName: snapshot.schoolName,
    campusId: snapshot.campusId,
    overall: tree.overall,
    overallBaseline: baselineTree?.overall ?? null,
    existingOnly: tree.existingOnly,
    existingOnlyBaseline: baselineTree?.existingOnly ?? null,
    scoredRoomCount: snapshotRooms.filter((room) => room.units.length > 0).length,
    absentCount: snapshotRooms.filter((room) => room.markedAbsent).length,
    categories: tree.categories.map((node) => withDelta(node, baselineTree?.categories)),
    focusAreas: tree.focusAreas.map((node) => withDelta(node, baselineTree?.focusAreas)),
    rooms: rooms
      .filter((room) => !room.room.markedAbsent)
      .map((room) => ({
        roomId: room.room.roomId,
        roomName: room.room.roomName,
        spaceType: room.room.spaceType,
        neighborhood: room.room.neighborhood,
        score: room.overall,
      })),
  }
}
