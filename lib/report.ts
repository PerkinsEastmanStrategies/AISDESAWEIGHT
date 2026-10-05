import { isObservational } from "@/lib/normalize"
import type { SchoolLevel, SchoolScorecard, ScoreNode } from "@/lib/types"

export const REPORT_CATEGORY_ORDER = [
  "Infrastructure",
  "Amenities",
  "Occupant Experience",
  "Function",
  "Size",
  "Wrap Around Services",
]

export function isHiddenReportLabel(label: string | null | undefined): boolean {
  const text = String(label ?? "").trim()
  if (!text) return true
  if (isObservational(text)) return true
  return /general\s*campus/i.test(text)
}

export const FOCUS_SHORT: Record<string, string> = {
  "Arrival Experience and Campus Organization": "Arrival & Campus Org",
  "Arrival Experience and Campus Support": "Arrival & Campus Support",
  "Wrap Around Services": "Wrap Around Services",
  "Shared Studios": "Shared Studios",
  "Outdoor Elements": "Outdoor",
  Outdoor: "Outdoor",
  "Special Education": "Special Education",
  "Special education": "Special Education",
}

export function averageNumbers(values: Array<number | null | undefined>): number | null {
  const scores = values.filter((value): value is number => value != null && !Number.isNaN(value))
  if (!scores.length) return null
  return scores.reduce((sum, value) => sum + value, 0) / scores.length
}

export function scoringCategories(card: SchoolScorecard): string[] {
  const labels = card.categories.map((node) => node.label).filter((label) => !isHiddenReportLabel(label))
  return [...labels].sort((a, b) => {
    const ai = REPORT_CATEGORY_ORDER.indexOf(a)
    const bi = REPORT_CATEGORY_ORDER.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })
}

export function shortFocus(label: string): string {
  return FOCUS_SHORT[label] ?? label
}

export function categoryScore(node: ScoreNode | null | undefined, category: string): number | null {
  const match = node?.children?.find((child) => child.label === category)
  return match?.score ?? null
}

export function spaceTypeCategoryScore(space: ScoreNode, category: string): number | null {
  const rooms = (space.children ?? []).filter((child) => child.kind === "room")
  return averageNumbers(rooms.map((room) => categoryScore(room, category)))
}

export function focusCategoryTree(focus: ScoreNode): ScoreNode[] {
  return categoryTreeFromRooms(roomsUnder(focus), focus.label)
}

function roomsUnder(node: ScoreNode): ScoreNode[] {
  const children = node.children ?? []
  const directRooms = children.filter((child) => child.kind === "room")
  if (directRooms.length) return directRooms
  return children.flatMap((child) => (child.children ?? []).filter((grandchild) => grandchild.kind === "room"))
}

function categoryTreeFromRooms(rooms: ScoreNode[], rootLabel: string): ScoreNode[] {
  const catScores = new Map<string, number[]>()
  const subScores = new Map<string, { category: string; subcategory: string; scores: number[] }>()
  for (const room of rooms) {
    for (const category of room.children ?? []) {
      if (isHiddenReportLabel(category.label)) continue
      const list = catScores.get(category.label) ?? []
      if (category.score != null) list.push(category.score)
      catScores.set(category.label, list)
      for (const sub of category.children ?? []) {
        if (isHiddenReportLabel(sub.label) || sub.score == null) continue
        const key = `${category.label}::${sub.label}`
        const existing = subScores.get(key)
        if (existing) existing.scores.push(sub.score)
        else subScores.set(key, { category: category.label, subcategory: sub.label, scores: [sub.score] })
      }
    }
  }
  return [...catScores.entries()]
    .map(([label, scores]) => ({
      id: `${rootLabel}::${label}`,
      kind: "group" as const,
      label,
      score: averageNumbers(scores),
      baseline: null,
      weight: 0,
      children: [...subScores.values()]
        .filter((sub) => sub.category === label)
        .map((sub) => ({
          id: `${rootLabel}::${label}::${sub.subcategory}`,
          kind: "group" as const,
          label: sub.subcategory,
          score: averageNumbers(sub.scores),
          baseline: null,
          weight: 0,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => {
      const ai = REPORT_CATEGORY_ORDER.indexOf(a.label)
      const bi = REPORT_CATEGORY_ORDER.indexOf(b.label)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.label.localeCompare(b.label)
    })
}

export function averageScorecard(cards: SchoolScorecard[], label: string, schoolLevel: SchoolLevel): SchoolScorecard {
  const focusLabels = [...new Set(cards.flatMap((card) => card.focusAreas.map((area) => area.label)))]
  const categoryLabels = [...new Set(cards.flatMap((card) => card.categories.map((area) => area.label)))]
  return {
    schoolId: `__average-${schoolLevel}`,
    schoolName: label,
    campusId: "",
    overall: averageNumbers(cards.map((card) => card.overall)),
    overallBaseline: null,
    existingOnly: averageNumbers(cards.map((card) => card.existingOnly)),
    existingOnlyBaseline: null,
    scoredRoomCount: 0,
    absentCount: 0,
    categories: categoryLabels.map((name) => ({
      id: `avg-cat-${name}`,
      kind: "group",
      label: name,
      score: averageNumbers(cards.map((card) => card.categories.find((node) => node.label === name)?.score)),
      baseline: null,
      weight: 0,
    })),
    focusAreas: focusLabels.map((name) => ({
      id: `avg-focus-${name}`,
      kind: "group",
      label: name,
      score: averageNumbers(cards.map((card) => card.focusAreas.find((node) => node.label === name)?.score)),
      baseline: null,
      weight: 0,
    })),
    rooms: [],
  }
}

export function levelAverageLabel(schoolLevel: SchoolLevel): string {
  if (schoolLevel === "MS") return "Middle school average"
  if (schoolLevel === "HS") return "High school average"
  return "Elementary average"
}

export function formatPreparedDate(value: string | Date = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

export function displaySchoolName(name: string): string {
  return name.replace(/\s*\(Pilot #\d+\)\s*/i, "").trim()
}

export function orderedFocusAreas(card: SchoolScorecard, axisOrder: string[]): ScoreNode[] {
  return [...card.focusAreas].sort((a, b) => {
    const ai = axisOrder.indexOf(a.label)
    const bi = axisOrder.indexOf(b.label)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.label.localeCompare(b.label)
  })
}

export function spaceNodes(focus: ScoreNode): ScoreNode[] {
  return (focus.children ?? []).filter((child) => child.kind !== "room")
}

export function spaceCategoryTree(space: ScoreNode): ScoreNode[] {
  return categoryTreeFromRooms(roomsUnder(space), space.label)
}

function roundScore(score: number | null | undefined): number | null {
  if (score == null || Number.isNaN(score)) return null
  return Math.round(score)
}

function vsAverage(score: number | null, average: number | null): string {
  const campus = roundScore(score)
  const avg = roundScore(average)
  if (campus == null) return "does not yet have a score"
  if (avg == null) return `scores ${campus}`
  const delta = campus - avg
  if (delta >= 5) return `scores ${campus}, ${delta} points above the ${avg} grade-type average`
  if (delta <= -5) return `scores ${campus}, ${Math.abs(delta)} points below the ${avg} grade-type average`
  if (delta > 0) return `scores ${campus}, slightly above the ${avg} grade-type average`
  if (delta < 0) return `scores ${campus}, slightly below the ${avg} grade-type average`
  return `scores ${campus}, in line with the ${avg} grade-type average`
}

function rankedByScore(nodes: ScoreNode[]): ScoreNode[] {
  return nodes.filter((node) => node.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

export interface ReportTakeaway {
  n: number
  text: string
}

export function campusTakeaways(
  card: SchoolScorecard,
  average: SchoolScorecard,
  axisOrder: string[],
): ReportTakeaway[] {
  const focuses = orderedFocusAreas(card, axisOrder)
  const rankedFocus = rankedByScore(focuses)
  const high = rankedFocus[0]
  const low = rankedFocus[rankedFocus.length - 1]
  const spaces = focuses.flatMap((focus) => spaceNodes(focus).map((space) => ({ focus: focus.label, space })))
  const rankedSpaces = spaces
    .filter((item) => item.space.score != null)
    .sort((a, b) => (a.space.score ?? 0) - (b.space.score ?? 0))
  const weakestSpace = rankedSpaces[0]
  const cats = card.categories.filter((node) => !isHiddenReportLabel(node.label) && node.score != null)
  const rankedCats = rankedByScore(cats)
  const highCat = rankedCats[0]
  const lowCat = rankedCats[rankedCats.length - 1]
  const name = displaySchoolName(card.schoolName)

  const lines = [
    `Campus ESA ${vsAverage(card.existingOnly, average.existingOnly)} among walked schools at this grade level.`,
    high
      ? `${shortFocus(high.label)} is the strongest scoring focus area at ${roundScore(high.score)}.`
      : `${name} does not yet have scored focus areas.`,
    low && low !== high
      ? `${shortFocus(low.label)} is the lowest scoring focus area at ${roundScore(low.score)}.`
      : "Focus area scores are tightly grouped across the campus.",
    weakestSpace
      ? `${weakestSpace.space.label} in ${shortFocus(weakestSpace.focus)} is the lowest space type at ${roundScore(weakestSpace.space.score)}.`
      : "Space type scores are not available yet.",
    highCat && lowCat
      ? `Campus-wide, ${highCat.label} leads at ${roundScore(highCat.score)} while ${lowCat.label} is the weakest category at ${roundScore(lowCat.score)}.`
      : "Category scores will appear once rooms are scored.",
  ]
  return lines.slice(0, 5).map((text, index) => ({ n: index + 1, text }))
}

export function focusTakeaways(focus: ScoreNode, averageFocus: ScoreNode | null): ReportTakeaway[] {
  const spaces = rankedByScore(spaceNodes(focus))
  const highSpace = spaces[0]
  const lowSpace = spaces[spaces.length - 1]
  const categories = rankedByScore(focusCategoryTree(focus))
  const highCat = categories[0]
  const lowCat = categories[categories.length - 1]
  const subs = categories.flatMap((category) =>
    (category.children ?? []).map((sub) => ({ category: category.label, sub })),
  )
  const rankedSubs = subs
    .filter((item) => item.sub.score != null)
    .sort((a, b) => (a.sub.score ?? 0) - (b.sub.score ?? 0))
  const weakSub = rankedSubs[0]

  const lines = [
    `${shortFocus(focus.label)} ${vsAverage(focus.score, averageFocus?.score ?? null)}.`,
    highSpace
      ? `${highSpace.label} is the strongest space type at ${roundScore(highSpace.score)}.`
      : "No assessed space types are available in this focus area.",
    lowSpace && lowSpace !== highSpace
      ? `${lowSpace.label} is the lowest space type at ${roundScore(lowSpace.score)}.`
      : `${spaceNodes(focus).length} space type${spaceNodes(focus).length === 1 ? " is" : "s are"} scored in this focus area.`,
    lowCat
      ? `${lowCat.label} is the weakest category at ${roundScore(lowCat.score)}.`
      : "Category scores are not available for this focus area.",
    weakSub
      ? `${weakSub.sub.label} (${weakSub.category}) is the lowest subcategory at ${roundScore(weakSub.sub.score)}.`
      : highCat
        ? `${highCat.label} is the strongest category at ${roundScore(highCat.score)}.`
        : "Subcategory scores are not available for this focus area.",
  ]
  return lines.slice(0, 5).map((text, index) => ({ n: index + 1, text }))
}
