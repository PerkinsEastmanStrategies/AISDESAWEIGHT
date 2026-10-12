import {
  getRoomSurveyRubric,
  isMultiSelectQuestionType,
  responseRequiresUnableToAssessNote,
  scoreForScoreId,
  type SurveyType,
} from "@aisd/shared"
import type { QaEditRecord } from "@/lib/qa-edits"
import type { QaHandoff } from "@/lib/qa-handoff"
import type { ScoredRoom, ScoredUnit } from "@/lib/types"

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string })
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`)
  }
  return data
}

export async function fetchQaEdits(schoolId: string): Promise<QaEditRecord[]> {
  const response = await fetch(`/api/qa/edits?schoolId=${encodeURIComponent(schoolId)}`, {
    cache: "no-store",
  })
  const data = await readJson<{ edits: QaEditRecord[] }>(response)
  return data.edits ?? []
}

export async function saveQaEditLive(edit: QaEditRecord, roomName?: string): Promise<QaEditRecord> {
  const response = await fetch("/api/qa/edits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...edit, roomName }),
  })
  const data = await readJson<{ edit: QaEditRecord }>(response)
  return data.edit
}

export async function fetchQaHandoffs(): Promise<QaHandoff[]> {
  const response = await fetch("/api/qa/handoffs", { cache: "no-store" })
  const data = await readJson<{ handoffs: QaHandoff[] }>(response)
  return data.handoffs ?? []
}

export async function saveQaHandoffLive(handoff: QaHandoff): Promise<QaHandoff> {
  const response = await fetch("/api/qa/handoffs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(handoff),
  })
  const data = await readJson<{ handoff: QaHandoff }>(response)
  return data.handoff
}

export function applyEditsToRooms(
  rooms: ScoredRoom[],
  edits: QaEditRecord[],
  schoolClass?: string,
): ScoredRoom[] {
  if (!edits.length) return rooms
  const byRoom = new Map<string, QaEditRecord[]>()
  for (const edit of edits) {
    const list = byRoom.get(edit.roomId) ?? []
    list.push(edit)
    byRoom.set(edit.roomId, list)
  }
  return rooms.map((room) => {
    const roomEdits = byRoom.get(room.roomId)
    if (!roomEdits?.length) return room
    return {
      ...room,
      units: applyEditsToUnits(room, roomEdits, schoolClass),
    }
  })
}

function classForRubric(schoolClass?: string): string | undefined {
  if (!schoolClass) return undefined
  if (schoolClass === "ES") return "ELEM"
  if (schoolClass === "MS") return "MID"
  if (schoolClass === "HS") return "HIGH"
  return schoolClass
}

function editValue(edit: QaEditRecord): string | string[] {
  const selected = edit.selected.map((value) => value.trim()).filter(Boolean)
  if (selected.length <= 1) return selected[0] ?? ""
  return selected
}

function rubricForRoom(room: ScoredRoom, schoolClass?: string) {
  const klass = classForRubric(schoolClass)
  return (
    getRoomSurveyRubric(room.surveyType as SurveyType, room.spaceType, room.gradeType, klass) ??
    getRoomSurveyRubric(room.surveyType as SurveyType, room.spaceType, undefined, klass)
  )
}

function applyEditsToUnits(
  room: ScoredRoom,
  edits: QaEditRecord[],
  schoolClass?: string,
): ScoredUnit[] {
  const byQuestion = new Map(edits.map((edit) => [edit.questionId, edit]))
  const rubric = rubricForRoom(room, schoolClass)
  const questionById = new Map(rubric?.questions.map((question) => [question.questionId, question]) ?? [])

  return room.units.map((unit) => {
    const edit = byQuestion.get(unit.questionId)
    if (!edit) return unit
    const answer = edit.selected.map((value) => value.trim()).filter(Boolean).join(", ")
    const question = questionById.get(unit.questionId)
    if (!question || !rubric) return { ...unit, answer }

    const response = { value: editValue(edit) }
    const next = scoreForScoreId(unit.unitId, question, response, rubric.options)
    if (next != null) return { ...unit, answer, score: next }
    if (
      isMultiSelectQuestionType(question.questionType) &&
      !responseRequiresUnableToAssessNote(response.value)
    ) {
      return { ...unit, answer, score: 0 }
    }
    return { ...unit, answer, score: Number.NaN }
  })
}
