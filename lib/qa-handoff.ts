export interface QaHandoff {
  schoolId: string
  schoolName: string
  movedBy: string
  movedAt: string
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
    return parsed.filter(
      (item) =>
        item &&
        typeof item.schoolId === "string" &&
        typeof item.movedBy === "string" &&
        typeof item.movedAt === "string",
    )
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

export function formatHandoffTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}
