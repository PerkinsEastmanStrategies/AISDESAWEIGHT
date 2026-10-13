export type QaHandoffStatus = "aisd" | "finalized" | "feedback" | "returned"

export interface QaHandoff {
  schoolId: string
  schoolName: string
  movedBy: string
  movedAt: string
  status: QaHandoffStatus
  decisionBy?: string
  decisionAt?: string
  decisionComments?: string
}

export function normalizeHandoffStatus(value: string | null | undefined): QaHandoffStatus {
  if (value === "finalized") return "finalized"
  if (value === "feedback" || value === "returned") return "feedback"
  return "aisd"
}

export function handoffStatus(handoff: QaHandoff | undefined): QaHandoffStatus | null {
  if (!handoff) return null
  return normalizeHandoffStatus(handoff.status)
}

export function isAisdQueue(handoff: QaHandoff | undefined): boolean {
  return handoffStatus(handoff) === "aisd"
}

export function isFinalizedHandoff(handoff: QaHandoff | undefined): boolean {
  return handoffStatus(handoff) === "finalized"
}

export function isReturnedHandoff(handoff: QaHandoff | undefined): boolean {
  return handoffStatus(handoff) === "feedback"
}

export function isFeedbackHandoff(handoff: QaHandoff | undefined): boolean {
  return handoffStatus(handoff) === "feedback"
}

export const TEST_HANDOFF_SCHOOL_SUFFIX = "--test"

export function isTestHandoffSchoolId(schoolId: string): boolean {
  return schoolId.endsWith(TEST_HANDOFF_SCHOOL_SUFFIX)
}

export function baseSchoolIdFromHandoff(schoolId: string): string {
  return isTestHandoffSchoolId(schoolId)
    ? schoolId.slice(0, -TEST_HANDOFF_SCHOOL_SUFFIX.length)
    : schoolId
}

export function toTestHandoffSchoolId(schoolId: string): string {
  return `${baseSchoolIdFromHandoff(schoolId)}${TEST_HANDOFF_SCHOOL_SUFFIX}`
}

export function isTestAisdHandoff(handoff: QaHandoff | undefined): boolean {
  if (!handoff) return false
  if (isTestHandoffSchoolId(handoff.schoolId)) return true
  if (handoff.movedBy.trim() === "TEST bulk move") return true
  return /--\s*TEST$/i.test(handoff.schoolName.trim())
}

/** Real Internal campuses stay in Internal until a real AISD approve. TEST copies use --test ids. */
export function isInternalQueue(handoff: QaHandoff | undefined): boolean {
  if (!handoff) return true
  if (isFeedbackHandoff(handoff)) return true
  if (isTestHandoffSchoolId(handoff.schoolId)) return false
  return isTestAisdHandoff(handoff) && isAisdQueue(handoff)
}

export function aisdQueueEntries<T extends { schoolId: string; schoolName: string }>(
  catalog: T[],
  handoffs: QaHandoff[],
): T[] {
  const byBase = new Map(catalog.map((school) => [school.schoolId, school]))
  const rows: T[] = []
  for (const handoff of handoffs) {
    if (!isAisdQueue(handoff)) continue
    const school = byBase.get(baseSchoolIdFromHandoff(handoff.schoolId))
    if (!school) continue
    rows.push({
      ...school,
      schoolId: handoff.schoolId,
      schoolName: handoff.schoolName.trim() || school.schoolName,
    })
  }
  return rows.sort((a, b) =>
    a.schoolName.localeCompare(b.schoolName, undefined, { sensitivity: "base" }),
  )
}

const HANDOFF_KEY = "qa-aisd-handoffs"

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

export function loadQaHandoffs(): QaHandoff[] {
  if (!canUseStorage()) return []
  try {
    const raw = window.localStorage.getItem(HANDOFF_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as QaHandoff[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item) =>
          item &&
          typeof item.schoolId === "string" &&
          typeof item.movedBy === "string" &&
          typeof item.movedAt === "string",
      )
      .map((item) => ({
        ...item,
        status: normalizeHandoffStatus(item.status),
      }))
  } catch {
    return []
  }
}

export function saveQaHandoffs(handoffs: QaHandoff[]): void {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(handoffs))
  } catch {
    /* ignore quota */
  }
}

export function upsertQaHandoff(handoff: QaHandoff): QaHandoff[] {
  const next = [...loadQaHandoffs().filter((item) => item.schoolId !== handoff.schoolId), handoff]
  saveQaHandoffs(next)
  return next
}

export function handoffForSchool(handoffs: QaHandoff[], schoolId: string): QaHandoff | undefined {
  return handoffs.find((item) => item.schoolId === schoolId)
}

export const AISD_TEST_NAME_SUFFIX = " -- TEST"

export function withAisdTestSuffix(schoolName: string): string {
  const trimmed = schoolName.trim()
  if (/--\s*TEST$/i.test(trimmed)) return trimmed
  return `${trimmed}${AISD_TEST_NAME_SUFFIX}`
}

/** Prefer the handoff label so AISD QA can show a suffix without renaming the snapshot. */
export function withHandoffSchoolName<T extends { schoolId: string; schoolName: string }>(
  items: T[],
  handoffs: QaHandoff[],
): T[] {
  return items.map((item) => {
    const stored = handoffForSchool(handoffs, item.schoolId)?.schoolName?.trim()
    if (!stored || stored === item.schoolName) return item
    return { ...item, schoolName: stored }
  })
}

export function formatHandoffTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}
