import { NextResponse } from "next/server"
import { supabaseRestSelect, supabaseRestUpsert } from "@/lib/supabase-rest"
import type { DiscardedRoom } from "@/lib/qa-discard"

export const runtime = "nodejs"

interface DiscardRow {
  school_id: string
  room_id: string
  room_name: string | null
  space_type: string | null
  neighborhood: string | null
  discarded_by: string | null
  discarded_at: string | null
}

function toRecord(row: DiscardRow): DiscardedRoom {
  return {
    schoolId: row.school_id,
    roomId: row.room_id,
    roomName: row.room_name?.trim() || undefined,
    spaceType: row.space_type?.trim() || undefined,
    neighborhood: row.neighborhood?.trim() || undefined,
    discardedBy: row.discarded_by?.trim() || undefined,
    discardedAt: row.discarded_at ?? undefined,
  }
}

export async function GET() {
  try {
    const rows = await supabaseRestSelect<DiscardRow>(
      "esa_qa_discarded_rooms",
      "select=school_id,room_id,room_name,space_type,neighborhood,discarded_by,discarded_at",
    )
    return NextResponse.json({ discards: rows.map(toRecord) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load discarded rooms"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<DiscardedRoom>
    const schoolId = body.schoolId?.trim() ?? ""
    const roomId = body.roomId?.trim() ?? ""
    if (!schoolId || !roomId) {
      return NextResponse.json({ error: "schoolId and roomId are required" }, { status: 400 })
    }
    const discardedAt = body.discardedAt?.trim() || new Date().toISOString()
    const [saved] = await supabaseRestUpsert<DiscardRow>(
      "esa_qa_discarded_rooms",
      [
        {
          school_id: schoolId,
          room_id: roomId,
          room_name: body.roomName?.trim() ?? "",
          space_type: body.spaceType?.trim() ?? "",
          neighborhood: body.neighborhood?.trim() ?? "",
          discarded_by: body.discardedBy?.trim() ?? "",
          discarded_at: discardedAt,
        },
      ],
      "school_id,room_id",
    )
    return NextResponse.json({ discard: toRecord(saved!) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save discarded room"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
