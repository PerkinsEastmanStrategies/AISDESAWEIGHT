import { canonicalName } from "@/lib/normalize"
import type { ScoredRoom, ScoredUnit } from "@/lib/types"

export interface AnswerConsistencyRoom {
  roomId: string
  roomName: string
}

export interface AnswerConsistencyGroup {
  rooms: AnswerConsistencyRoom[]
  unanswered?: boolean
}

export interface AnswerConsistencyRow {
  questionId: string
  question: string
  same: boolean
  answeredCount: number
  roomCount: number
  groups: AnswerConsistencyGroup[]
}

function isItemSelected(unit: ScoredUnit): boolean {
  if (unit.score > 0) return true
  const label = unit.itemLabel?.trim()
  if (!label) return false
  const tokens = String(unit.answer ?? "")
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  return tokens.some((token) => token === label || canonicalName(token) === canonicalName(label))
}

function answerSignature(units: ScoredUnit[]): string | null {
  if (!units.length) return null
  const items = units.filter((unit) => Boolean(unit.itemLabel?.trim()))
  if (items.length) {
    const selected = items
      .filter(isItemSelected)
      .map((unit) => canonicalName(unit.itemLabel))
      .sort()
    return `multi:${selected.join("|")}`
  }
  const answer = units.find((unit) => unit.answer)?.answer?.trim() ?? ""
  return `single:${canonicalName(answer)}`
}

function unitsForQuestion(room: ScoredRoom, questionId: string): ScoredUnit[] {
  return room.units.filter((unit) => unit.questionId === questionId)
}

export function answerConsistency(rooms: ScoredRoom[]): AnswerConsistencyRow[] {
  const assessed = rooms.filter((room) => !room.markedAbsent)
  if (assessed.length < 2) return []

  const order: string[] = []
  const meta = new Map<string, string>()
  for (const room of assessed) {
    for (const unit of room.units) {
      if (!meta.has(unit.questionId)) {
        order.push(unit.questionId)
        meta.set(unit.questionId, unit.question)
      }
    }
  }

  return order.map((questionId) => {
    const bySignature = new Map<string, AnswerConsistencyRoom[]>()
    const unanswered: AnswerConsistencyRoom[] = []
    for (const room of assessed) {
      const signature = answerSignature(unitsForQuestion(room, questionId))
      const entry = { roomId: room.roomId, roomName: room.roomName }
      if (signature == null) {
        unanswered.push(entry)
        continue
      }
      const list = bySignature.get(signature) ?? []
      list.push(entry)
      bySignature.set(signature, list)
    }
    const groups: AnswerConsistencyGroup[] = [...bySignature.values()]
      .map((group) => ({
        rooms: group.sort((a, b) => a.roomName.localeCompare(b.roomName, undefined, { numeric: true })),
      }))
      .sort(
        (a, b) =>
          b.rooms.length - a.rooms.length ||
          a.rooms[0]!.roomName.localeCompare(b.rooms[0]!.roomName, undefined, { numeric: true }),
      )
    if (unanswered.length) {
      groups.push({
        unanswered: true,
        rooms: unanswered.sort((a, b) => a.roomName.localeCompare(b.roomName, undefined, { numeric: true })),
      })
    }
    return {
      questionId,
      question: meta.get(questionId) ?? questionId,
      same: unanswered.length === 0 && groups.length === 1,
      answeredCount: assessed.length - unanswered.length,
      roomCount: assessed.length,
      groups,
    }
  })
}
