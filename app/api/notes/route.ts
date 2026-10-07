import { NextResponse } from "next/server"

export const runtime = "nodejs"

function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured")
  return url.replace(/\/$/, "")
}

function supabaseKey(): string {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!key) {
    throw new Error("Add SUPABASE_SERVICE_ROLE_KEY to .env.local to load notes")
  }
  return key
}

function schoolIdLookups(schoolId: string): string[] {
  const ids = [schoolId]
  const withoutTest = schoolId.replace(/-test$/i, "")
  if (withoutTest !== schoolId) ids.push(withoutTest)
  const withoutPilot = withoutTest.replace(/-pilot-\d+$/i, "")
  if (withoutPilot !== withoutTest) ids.push(withoutPilot)
  return [...new Set(ids.filter(Boolean))]
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
  const candidates = [row.room_id, row.room_number, row.school_room_number]
  return candidates.some((value) => {
    const trimmed = value?.trim()
    return Boolean(trimmed && aliases.has(trimmed))
  })
}

function inFilter(column: string, values: string[]): string {
  return `${column}=in.(${values.map((value) => encodeURIComponent(value)).join(",")})`
}

async function restSelectAll<T>(table: string, query: string): Promise<T[]> {
  const key = supabaseKey()
  const pageSize = 1000
  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(
      `${supabaseUrl()}/rest/v1/${table}?${query}&limit=${pageSize}&offset=${offset}`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
    )
    const text = await response.text()
    if (!response.ok) throw new Error(`${table} ${response.status}: ${text.slice(0, 400)}`)
    const page = JSON.parse(text) as T[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
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
  pre_walk_note1: string | null
  pre_walk_note2: string | null
}

interface ResponseRow {
  survey_session_id: string
  room_id: string
  question_id: string
  comment: string | null
}

interface MappingRow {
  room_id: string
  note1: string | null
  note2: string | null
}

function cleanNote(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const schoolId = params.get("schoolId")?.trim() ?? ""
    const roomId = params.get("roomId")?.trim() ?? ""
    const roomName = params.get("roomName")?.trim() ?? ""
    if (!schoolId || !roomId) {
      return NextResponse.json({ error: "schoolId and roomId are required" }, { status: 400 })
    }

    const schoolIds = schoolIdLookups(schoolId)
    let sessions: SessionRow[] = []
    for (const id of schoolIds) {
      sessions = await restSelectAll<SessionRow>(
        "esa_survey_sessions",
        `school_id=eq.${encodeURIComponent(id)}&select=id,school_id`,
      )
      if (sessions.length) break
    }
    if (!sessions.length) {
      return NextResponse.json({ roomId, roomNotes: [], comments: {} })
    }

    const sessionIds = sessions.map((session) => session.id)
    const aliases = new Set(roomAliases(roomId, roomName))
    const rooms = (
      await restSelectAll<RoomRow>(
        "esa_survey_rooms",
        `${inFilter("survey_session_id", sessionIds)}&select=survey_session_id,room_id,room_number,school_room_number,pre_walk_note1,pre_walk_note2`,
      )
    ).filter((row) => roomMatches(row, aliases))

    if (!rooms.length) {
      return NextResponse.json({ roomId, roomNotes: [], comments: {} })
    }

    const matchedRoomIds = [...new Set(rooms.map((row) => row.room_id))]
    const responses = await restSelectAll<ResponseRow>(
      "esa_question_responses",
      `${inFilter("survey_session_id", sessionIds)}&${inFilter("room_id", matchedRoomIds)}&select=survey_session_id,room_id,question_id,comment`,
    )

    const commentsByKey = new Map<string, Record<string, string>>()
    for (const row of responses) {
      const comment = cleanNote(row.comment)
      if (!comment) continue
      const key = `${row.survey_session_id}::${row.room_id}`
      const list = commentsByKey.get(key) ?? {}
      list[row.question_id] = comment
      commentsByKey.set(key, list)
    }

    function noteScore(room: RoomRow, comments: Record<string, string>) {
      return (
        Object.keys(comments).length * 10 +
        (cleanNote(room.pre_walk_note1) ? 1 : 0) +
        (cleanNote(room.pre_walk_note2) ? 1 : 0)
      )
    }

    const firstRoom = rooms[0]!
    let bestRoom = firstRoom
    let bestComments = commentsByKey.get(`${firstRoom.survey_session_id}::${firstRoom.room_id}`) ?? {}
    let bestScore = noteScore(firstRoom, bestComments)
    for (const room of rooms.slice(1)) {
      const comments = commentsByKey.get(`${room.survey_session_id}::${room.room_id}`) ?? {}
      const score = noteScore(room, comments)
      if (score > bestScore) {
        bestRoom = room
        bestComments = comments
        bestScore = score
      }
    }

    const roomNotes = [cleanNote(bestRoom.pre_walk_note1), cleanNote(bestRoom.pre_walk_note2)].filter(
      (note): note is string => Boolean(note),
    )

    if (!roomNotes.length) {
      const mappings = await restSelectAll<MappingRow>(
        "esa_prewalk_mappings",
        `${inFilter("school_id", schoolIds)}&${inFilter("room_id", matchedRoomIds)}&select=room_id,note1,note2`,
      )
      for (const mapping of mappings) {
        for (const note of [cleanNote(mapping.note1), cleanNote(mapping.note2)]) {
          if (note && !roomNotes.includes(note)) roomNotes.push(note)
        }
      }
    }

    return NextResponse.json({
      roomId: bestRoom.room_id,
      roomNotes,
      comments: bestComments,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load notes"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
