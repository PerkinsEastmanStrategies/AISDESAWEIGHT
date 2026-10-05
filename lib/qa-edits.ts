export interface QaEditRecord {
  schoolId: string
  roomId: string
  questionId: string
  selected: string[]
  previous: string[]
  editor: string
  reason: string
  editedAt: string
}

const EDITS_KEY = "qa-pending-edits"
const EDITOR_KEY = "qa-editor-name"

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

export function loadSavedEditorName(): string {
  if (!canUseStorage()) return ""
  try {
    return window.localStorage.getItem(EDITOR_KEY)?.trim() ?? ""
  } catch {
    return ""
  }
}

export function saveEditorName(name: string): void {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(EDITOR_KEY, name.trim())
  } catch {
    /* ignore quota */
  }
}

export function loadQaEdits(): QaEditRecord[] {
  if (!canUseStorage()) return []
  try {
    const raw = window.localStorage.getItem(EDITS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as QaEditRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveQaEdits(edits: QaEditRecord[]): void {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(EDITS_KEY, JSON.stringify(edits))
  } catch {
    /* ignore quota */
  }
}

export function upsertQaEdit(edit: QaEditRecord): QaEditRecord[] {
  const edits = loadQaEdits().filter(
    (item) =>
      !(item.schoolId === edit.schoolId && item.roomId === edit.roomId && item.questionId === edit.questionId),
  )
  const next = [...edits, edit]
  saveQaEdits(next)
  return next
}

export function editsForRoom(edits: QaEditRecord[], schoolId: string, roomId: string): QaEditRecord[] {
  return edits.filter((item) => item.schoolId === schoolId && item.roomId === roomId)
}

export function formatEditTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}
