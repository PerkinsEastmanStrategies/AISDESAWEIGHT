import { isObservational, namesMatch } from "@/lib/normalize"
import type { SchoolLevel, SchoolScorecard, ScoreNode } from "@/lib/types"

export const REPORT_CATEGORY_ORDER = [
  "Infrastructure",
  "Amenities",
  "Occupant Experience",
  "Function",
  "Size",
  "Wrap Around Services",
]

export const REPORT_SUBCATEGORY_ORDER = [
  "Utilities and Technology",
  "Flooring and Surface Finishes",
  "Display and Presentation",
  "Storage",
  "Furniture and Equipment",
  "Aesthetics",
  "Occupant Comfort",
  "Safety and Supervision",
  "Layout and Flexibility",
  "Adjacency and Access",
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

export function categorySubcategories(category: ScoreNode): ScoreNode[] {
  return [...(category.children ?? [])]
    .filter((child) => child.kind !== "question" && !isHiddenReportLabel(child.label))
    .sort((a, b) => {
      const ai = REPORT_SUBCATEGORY_ORDER.indexOf(a.label)
      const bi = REPORT_SUBCATEGORY_ORDER.indexOf(b.label)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.label.localeCompare(b.label)
    })
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

const REPORT_DISPLAY_LABELS: Record<string, string> = {
  "Safety and Supervision": "Supervision",
  "Safety & Supervision": "Supervision",
}

/** Report-only display names. Scoring still uses the source labels. */
export function reportDisplayLabel(label: string): string {
  return REPORT_DISPLAY_LABELS[label] ?? label
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

export function gradeBandLabel(schoolLevel: SchoolLevel): string {
  if (schoolLevel === "MS") return "middle schools"
  if (schoolLevel === "HS") return "high schools"
  return "elementary schools"
}

export function expectedSpacesFromRows(
  rows: Array<{ focusArea: string; spaceType: string }>,
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const row of rows) {
    const list = map[row.focusArea] ?? []
    if (!list.some((name) => namesMatch(name, row.spaceType))) list.push(row.spaceType)
    map[row.focusArea] = list
  }
  return map
}

function spacesForFocus(catalog: Record<string, string[]>, focusLabel: string): string[] {
  if (catalog[focusLabel]?.length) return catalog[focusLabel]
  const match = Object.keys(catalog).find((label) => namesMatch(label, focusLabel))
  return match ? catalog[match] : []
}

function joinList(items: string[]): string {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`
}

function bold(value: string | number): string {
  return `**${value}**`
}

function formatNameList(names: string[], limit = 8): string {
  if (names.length <= limit) return joinList(names)
  return `${joinList(names.slice(0, limit))}, and ${names.length - limit} other${names.length - limit === 1 ? "" : "s"}`
}

function ordinal(value: number): string {
  const remainder = value % 100
  if (remainder >= 11 && remainder <= 13) return `${value}th`
  switch (value % 10) {
    case 1:
      return `${value}st`
    case 2:
      return `${value}nd`
    case 3:
      return `${value}rd`
    default:
      return `${value}th`
  }
}

function quartileLabel(quartile: 1 | 2 | 3 | 4): string {
  if (quartile === 1) return "the top quartile"
  if (quartile === 2) return "the second quartile"
  if (quartile === 3) return "the third quartile"
  return "the bottom quartile"
}

export function scoreQuartile(
  score: number | null | undefined,
  peerScores: Array<number | null | undefined>,
): { quartile: 1 | 2 | 3 | 4; rank: number; of: number } | null {
  const campus = roundScore(score)
  if (campus == null) return null
  const scores = peerScores
    .map((value) => roundScore(value))
    .filter((value): value is number => value != null)
    .sort((a, b) => b - a)
  if (!scores.length) return null
  const rank = scores.filter((value) => value > campus).length + 1
  const percentileFromTop = (rank - 1) / scores.length
  const quartile: 1 | 2 | 3 | 4 =
    percentileFromTop < 0.25 ? 1 : percentileFromTop < 0.5 ? 2 : percentileFromTop < 0.75 ? 3 : 4
  return { quartile, rank, of: scores.length }
}

function uniquePeerScores(
  card: SchoolScorecard,
  fleet: SchoolScorecard[],
  scoreOf: (item: SchoolScorecard) => number | null | undefined,
): number[] {
  const byId = new Map<string, number>()
  for (const item of [card, ...fleet]) {
    const score = scoreOf(item)
    if (score == null || Number.isNaN(score)) continue
    byId.set(item.schoolId, score)
  }
  return [...byId.values()]
}

function vsAveragePhrase(score: number | null | undefined, average: number | null | undefined): string | null {
  const campus = roundScore(score)
  const avg = roundScore(average)
  if (campus == null || avg == null) return null
  const delta = campus - avg
  if (delta >= 5) return `${bold(`${delta} points above`)} the grade-band average of ${bold(avg)}`
  if (delta <= -5) return `${bold(`${Math.abs(delta)} points below`)} the grade-band average of ${bold(avg)}`
  if (delta > 0) return `${bold("slightly above")} the grade-band average of ${bold(avg)}`
  if (delta < 0) return `${bold("slightly below")} the grade-band average of ${bold(avg)}`
  return `${bold("in line with")} the grade-band average of ${bold(avg)}`
}

function missingSpaceNames(scored: ScoreNode[], expected: string[]): string[] {
  const scoredNames = scored.filter((space) => space.score != null).map((space) => space.label)
  return expected.filter((name) => !scoredNames.some((scoredName) => namesMatch(scoredName, name)))
}

function spaceHighLowSentence(
  scored: Array<{ label: string; score: number; focus?: string }>,
  missing: string[] | null,
  emptyScored: string,
): string {
  const missingSentence =
    missing == null
      ? ""
      : missing.length
        ? `${formatNameList(missing.map(bold))} ${missing.length === 1 ? "was" : "were"} not assessed.`
        : "No expected space types were missing from this assessment."
  if (!scored.length) {
    return `${emptyScored}${missingSentence ? ` ${missingSentence}` : ""}`
  }
  const rounded = scored.map((item) => ({
    ...item,
    score: Math.round(item.score),
  }))
  const max = Math.max(...rounded.map((item) => item.score))
  const min = Math.min(...rounded.map((item) => item.score))
  const high = rounded.filter((item) => item.score === max)
  const low = rounded.filter((item) => item.score === min)
  const labelOf = (item: (typeof rounded)[number]) =>
    item.focus ? `${item.label} in ${shortFocus(item.focus)}` : item.label
  if (high.length === rounded.length) {
    return rounded.length === 1
      ? `${bold(labelOf(rounded[0]))} is the only scored space type, at ${bold(max)}.${missingSentence ? ` ${missingSentence}` : ""}`
      : `All scored space types are tied at ${bold(max)}.${missingSentence ? ` ${missingSentence}` : ""}`
  }
  return `${formatNameList(high.map((item) => bold(labelOf(item))))} scored the highest at ${bold(max)}, and ${formatNameList(low.map((item) => bold(labelOf(item))))} scored the lowest at ${bold(min)}.${missingSentence ? ` ${missingSentence}` : ""}`
}

function categorySentence(nodes: ScoreNode[], empty: string): string {
  const scored = nodes
    .filter((node) => !isHiddenReportLabel(node.label) && node.score != null)
    .slice()
    .sort((a, b) => {
      const ai = REPORT_CATEGORY_ORDER.indexOf(a.label)
      const bi = REPORT_CATEGORY_ORDER.indexOf(b.label)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.label.localeCompare(b.label)
    })
    .map((node) => ({ label: reportDisplayLabel(node.label), score: Math.round(node.score as number) }))
  if (!scored.length) return empty
  const max = Math.max(...scored.map((item) => item.score))
  const min = Math.min(...scored.map((item) => item.score))
  const high = scored.filter((item) => item.score === max)
  const low = scored.filter((item) => item.score === min)
  const rest = scored.filter((item) => item.score !== max && item.score !== min)
  if (high.length === scored.length) {
    return scored.length === 1
      ? `${bold(scored[0].label)} scored ${bold(scored[0].score)}.`
      : `${joinList(scored.map((item) => bold(item.label)))} are grouped tightly, each scoring ${bold(max)}.`
  }
  const lead = `${joinList(high.map((item) => bold(item.label)))} ${high.length === 1 ? "is" : "are"} the strongest ${high.length === 1 ? "category" : "categories"} at ${bold(max)}, and ${joinList(low.map((item) => bold(item.label)))} ${low.length === 1 ? "is" : "are"} the weakest at ${bold(min)}.`
  if (!rest.length) return lead
  return `${lead} ${joinList(rest.map((item) => `${bold(item.label)} scored ${bold(item.score)}`))}.`
}

export function focusSpaceTableRows(
  focus: ScoreNode,
  card: SchoolScorecard,
  fleet: SchoolScorecard[],
  expectedSpaces: Record<string, string[]>,
): Array<{ label: string; space: ScoreNode | null; missing: boolean }> {
  const spaces = spaceNodes(focus)
  const expected = inferredSpacesForFocus(focus, card, fleet, expectedSpaces)
  const names = expected.length ? [...expected] : spaces.map((space) => space.label)
  for (const space of spaces) {
    if (!names.some((name) => namesMatch(name, space.label))) names.push(space.label)
  }
  const used = new Set<string>()
  return names.map((name) => {
    const space = spaces.find((item) => namesMatch(item.label, name) && !used.has(item.id)) ?? null
    if (space) used.add(space.id)
    const missing = space == null || space.score == null
    return { label: space?.label ?? name, space, missing }
  })
}

function inferredSpacesForFocus(
  focus: ScoreNode,
  card: SchoolScorecard,
  fleet: SchoolScorecard[],
  catalog: Record<string, string[]>,
): string[] {
  const listed = spacesForFocus(catalog, focus.label)
  if (listed.length) return listed
  const names: string[] = []
  for (const school of [card, ...fleet]) {
    const match = school.focusAreas.find((area) => namesMatch(area.label, focus.label))
    for (const space of match ? spaceNodes(match) : []) {
      if (!names.some((name) => namesMatch(name, space.label))) names.push(space.label)
    }
  }
  return names
}

export function campusObservationSlots(
  card: SchoolScorecard,
  fleet: SchoolScorecard[],
  schoolLevel: SchoolLevel,
  expectedSpaces: Record<string, string[]>,
): [string, string, string] {
  const name = displaySchoolName(card.schoolName)
  const band = gradeBandLabel(schoolLevel)
  const peers = uniquePeerScores(card, fleet, (item) => item.existingOnly)
  const standing = scoreQuartile(card.existingOnly, peers)
  const average = averageNumbers(peers)
  const vs = vsAveragePhrase(card.existingOnly, average)
  const score = roundScore(card.existingOnly)

  let first = `${name} does not yet have a campus ESA score, so it cannot be placed in a grade-band quartile among walked ${band}.`
  if (score != null && standing && standing.of <= 1) {
    first = `${name}'s ESA score is ${bold(score)}. It is currently the only walked ${band.replace(/s$/, "")} with a campus score, so a grade-band quartile is not available yet.`
  } else if (score != null && standing) {
    first = `Compared with other walked ${band}, ${name}'s ESA score of ${bold(score)} places it in ${bold(quartileLabel(standing.quartile))} (${bold(`${ordinal(standing.rank)} of ${standing.of}`)})`
    first += vs ? `, ${vs}.` : "."
  }

  const scoredSpaces = card.focusAreas.flatMap((focus) =>
    spaceNodes(focus)
      .filter((space) => space.score != null)
      .map((space) => ({ label: space.label, score: space.score as number, focus: focus.label })),
  )
  const expected = Object.values(expectedSpaces).flat()
  const uniqueExpected = expected.filter(
    (name, index) => expected.findIndex((item) => namesMatch(item, name)) === index,
  )
  const missing = uniqueExpected.length
    ? uniqueExpected.filter((name) => !scoredSpaces.some((space) => namesMatch(space.label, name)))
    : null
  const second = spaceHighLowSentence(
    scoredSpaces,
    missing,
    "No space types have been scored yet.",
  )

  const third = categorySentence(
    card.categories,
    "Campus-wide category scores are not available yet.",
  )

  return [first, second, third]
}

export function focusObservationSlots(
  focus: ScoreNode,
  card: SchoolScorecard,
  fleet: SchoolScorecard[],
  schoolLevel: SchoolLevel,
  expectedSpaces: Record<string, string[]>,
): [string, string, string] {
  const name = displaySchoolName(card.schoolName)
  const band = gradeBandLabel(schoolLevel)
  const focusName = focus.label
  const peers = uniquePeerScores(
    card,
    fleet,
    (item) => item.focusAreas.find((area) => namesMatch(area.label, focusName))?.score,
  )
  const standing = scoreQuartile(focus.score, peers)
  const average = averageNumbers(peers)
  const vs = vsAveragePhrase(focus.score, average)
  const score = roundScore(focus.score)

  let first = `${name} does not yet have a ${focusName} score, so it cannot be placed in a grade-band quartile among walked ${band} for this focus area.`
  if (score != null && standing && standing.of <= 1) {
    first = `${name}'s ${focusName} score is ${bold(score)}. It is currently the only walked ${band.replace(/s$/, "")} with a score in this focus area, so a grade-band quartile is not available yet.`
  } else if (score != null && standing) {
    first = `Compared with other walked ${band}, ${name}'s ${focusName} score of ${bold(score)} places it in ${bold(quartileLabel(standing.quartile))} (${bold(`${ordinal(standing.rank)} of ${standing.of}`)})`
    first += vs ? `, ${vs}.` : "."
  }

  const spaces = spaceNodes(focus)
  const scoredSpaces = spaces
    .filter((space) => space.score != null)
    .map((space) => ({ label: space.label, score: space.score as number }))
  const expected = inferredSpacesForFocus(focus, card, fleet, expectedSpaces)
  const missing = expected.length ? missingSpaceNames(spaces, expected) : null
  const second = spaceHighLowSentence(
    scoredSpaces,
    missing,
    "No space types have been scored in this focus area yet.",
  )
  const third = categorySentence(
    focusCategoryTree(focus),
    "Category scores are not available for this focus area yet.",
  )

  return [first, second, third]
}
