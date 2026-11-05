import { NextResponse } from "next/server"
import { campusIdLookups, inFilter, supabaseRestSelect } from "@/lib/supabase-rest"

export const runtime = "nodejs"

interface RoomScheduleRow {
  campus_id: string | null
  cafm_id: string | null
  name: string | null
  neighborhood: string | null
}

function campusKeys(campusId: string): string[] {
  const ids = campusIdLookups(campusId)
  const extra: string[] = []
  for (const id of ids) {
    if (/^\d+$/.test(id)) {
      extra.push(String(Number.parseInt(id, 10)))
      extra.push(id.padStart(3, "0"))
    }
  }
  return [...new Set([...ids, ...extra].filter(Boolean))]
}

export async function GET(request: Request) {
  try {
    const campusId = new URL(request.url).searchParams.get("campusId")?.trim() ?? ""
    if (!campusId) {
      return NextResponse.json({ error: "campusId is required" }, { status: 400 })
    }
    const rows = await supabaseRestSelect<RoomScheduleRow>(
      "roomschedule",
      `${inFilter("campus_id", campusKeys(campusId))}&select=campus_id,cafm_id,name,neighborhood`,
    )
    return NextResponse.json({
      rooms: rows
        .map((row) => ({
          cafmId: row.cafm_id?.trim() ?? "",
          name: row.name?.trim() ?? "",
          neighborhood: row.neighborhood?.trim() ?? "",
        }))
        .filter((row) => row.neighborhood && (row.cafmId || row.name)),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load room schedule"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ rooms: [], error: message }, { status })
  }
}
