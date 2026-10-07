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

export function applyEditsToRooms(rooms: ScoredRoom[], edits: QaEditRecord[]): ScoredRoom[] {
  if (!edits.length) return rooms
  const byKey = new Map(edits.map((edit) => [`${edit.roomId}::${edit.questionId}`, edit]))
  return rooms.map((room) => ({
    ...room,
    units: room.units.map((unit) => applyEditToUnit(unit, byKey.get(`${room.roomId}::${unit.questionId}`))),
  }))
}

function applyEditToUnit(unit: ScoredUnit, edit: QaEditRecord | undefined): ScoredUnit {
  if (!edit) return unit
  return { ...unit, answer: edit.selected.join(", ") }
}
