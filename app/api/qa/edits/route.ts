import { NextResponse } from "next/server"
import {
  inFilter,
  schoolIdLookups,
  supabaseRestInsert,
  supabaseRestPatch,
  supabaseRestSelect,
  supabaseRestUpsert,
} from "@/lib/supabase-rest"
import type { QaEditRecord } from "@/lib/qa-edits"

export const runtime = "nodejs"

interface QaEditRow {
  school_id: string
  room_id: string
  question_id: string
  selected: unknown
  previous: unknown
  editor: string
  reason: string
  edited_at: string
}

interface SessionRow {
  id: string
  school_id: string
}

interface RoomRow {
  survey_session_id: string
  room_id: string
  room_number: string | null
  school_room_number: string | null
}

interface ResponseRow {
  survey_session_id: string
  room_id: string
  question_id: string
}

interface RevisionRow {
  revision_number: number
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === "string" && value.trim()) return [value]
  return []
}

function toRecord(row: QaEditRow): QaEditRecord {
  return {
    schoolId: row.school_id,
    roomId: row.room_id,
    questionId: row.question_id,
    selected: asStringArray(row.selected),
    previous: asStringArray(row.previous),
    editor: row.editor,
    reason: row.reason,
    editedAt: row.edited_at,
  }
}

function roomAliases(roomId: string, roomName: string): string[] {
  const aliases = new Set<string>()
  for (const value of [roomId, roomName]) {
    const trimmed = value.trim()
    if (!trimmed) continue
    aliases.add(trimmed)
    aliases.add(trimmed.replace(/\s+/g, ""))
    aliases.add(trimmed.replace(/_/g, " "))
    const parent = trimmed.replace(/\.\d+[A-Z]?$/i, "")
    if (parent && parent !== trimmed) aliases.add(parent)
  }
  return [...aliases].filter(Boolean)
}

function roomMatches(row: RoomRow, aliases: Set<string>): boolean {
  return [row.room_id, row.room_number, row.school_room_number].some((value) => {
    const trimmed = value?.trim()
    return Boolean(trimmed && aliases.has(trimmed))
  })
}

function responseValue(selected: string[]): string | string[] {
  if (selected.length <= 1) return selected[0] ?? ""
  return selected
}

async function writeLiveEsaAnswer(input: {
  schoolId: string
  roomId: string
  roomName: string
  questionId: string
  selected: string[]
  editor: string
}) {
  const schoolIds = schoolIdLookups(input.schoolId)
  let sessions: SessionRow[] = []
  for (const id of schoolIds) {
    sessions = await supabaseRestSelect<SessionRow>(
      "esa_survey_sessions",
      `school_id=eq.${encodeURIComponent(id)}&select=id,school_id`,
    )
    if (sessions.length) break
  }
  if (!sessions.length) {
    throw new Error(`No ESA survey session found for ${input.schoolId}.`)
  }

  const sessionIds = sessions.map((session) => session.id)
  const aliases = new Set(roomAliases(input.roomId, input.roomName))
  const rooms = (
    await supabaseRestSelect<RoomRow>(
      "esa_survey_rooms",
      `${inFilter("survey_session_id", sessionIds)}&select=survey_session_id,room_id,room_number,school_room_number`,
    )
  ).filter((row) => roomMatches(row, aliases))
  if (!rooms.length) {
    throw new Error(`Could not match room ${input.roomId} in ESA.`)
  }

  const roomIds = [...new Set(rooms.map((row) => row.room_id))]
  const responses = await supabaseRestSelect<ResponseRow>(
    "esa_question_responses",
    `${inFilter("survey_session_id", sessionIds)}&${inFilter("room_id", roomIds)}&question_id=eq.${encodeURIComponent(input.questionId)}&select=survey_session_id,room_id,question_id`,
  )
  const target =
    responses[0] ??
    ({
      survey_session_id: rooms[0]!.survey_session_id,
      room_id: rooms[0]!.room_id,
      question_id: input.questionId,
    } satisfies ResponseRow)

  const stamped = new Date().toISOString()
  if (responses[0]) {
    await supabaseRestPatch(
      "esa_question_responses",
      `survey_session_id=eq.${encodeURIComponent(target.survey_session_id)}&room_id=eq.${encodeURIComponent(target.room_id)}&question_id=eq.${encodeURIComponent(input.questionId)}`,
      { value: responseValue(input.selected), client_updated_at: stamped },
    )
  } else {
    await supabaseRestUpsert(
      "esa_question_responses",
      [
        {
          survey_session_id: target.survey_session_id,
          room_id: target.room_id,
          question_id: input.questionId,
          value: responseValue(input.selected),
          client_updated_at: stamped,
        },
      ],
      "survey_session_id,room_id,question_id",
    )
  }

  const revisions = await supabaseRestSelect<RevisionRow>(
    "esa_response_revisions",
    `survey_session_id=eq.${encodeURIComponent(target.survey_session_id)}&room_id=eq.${encodeURIComponent(target.room_id)}&question_id=eq.${encodeURIComponent(input.questionId)}&select=revision_number&order=revision_number.desc&limit=1`,
  )
  await supabaseRestInsert("esa_response_revisions", [
    {
      survey_session_id: target.survey_session_id,
      room_id: target.room_id,
      question_id: input.questionId,
      revision_number: (revisions[0]?.revision_number ?? 0) + 1,
      value: responseValue(input.selected),
      changed_by: input.editor,
      changed_at: stamped,
    },
  ])
}

export async function GET(request: Request) {
  try {
    const schoolId = new URL(request.url).searchParams.get("schoolId")?.trim() ?? ""
    if (!schoolId) {
      return NextResponse.json({ error: "schoolId is required" }, { status: 400 })
    }
    const rows = await supabaseRestSelect<QaEditRow>(
      "esa_qa_edits",
      `school_id=eq.${encodeURIComponent(schoolId)}&select=school_id,room_id,question_id,selected,previous,editor,reason,edited_at`,
    )
    return NextResponse.json({ edits: rows.map(toRecord) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load QA edits"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<QaEditRecord> & { roomName?: string }
    const schoolId = body.schoolId?.trim() ?? ""
    const roomId = body.roomId?.trim() ?? ""
    const questionId = body.questionId?.trim() ?? ""
    const editor = body.editor?.trim() ?? ""
    const reason = body.reason?.trim() ?? ""
    const selected = Array.isArray(body.selected) ? body.selected.map(String) : []
    const previous = Array.isArray(body.previous) ? body.previous.map(String) : []
    if (!schoolId || !roomId || !questionId || !editor || !reason) {
      return NextResponse.json(
        { error: "schoolId, roomId, questionId, editor, and reason are required" },
        { status: 400 },
      )
    }

    const editedAt = body.editedAt?.trim() || new Date().toISOString()
    await writeLiveEsaAnswer({
      schoolId,
      roomId,
      roomName: body.roomName?.trim() || roomId,
      questionId,
      selected,
      editor,
    })

    const [saved] = await supabaseRestUpsert<QaEditRow>(
      "esa_qa_edits",
      [
        {
          school_id: schoolId,
          room_id: roomId,
          question_id: questionId,
          selected,
          previous,
          editor,
          reason,
          edited_at: editedAt,
        },
      ],
      "school_id,room_id,question_id",
    )
    return NextResponse.json({ edit: toRecord(saved!) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save QA edit"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
