import { NextResponse } from "next/server"
import { supabaseRestSelect, supabaseRestUpsert } from "@/lib/supabase-rest"
import type { QaHandoff } from "@/lib/qa-handoff"

export const runtime = "nodejs"

interface HandoffRow {
  school_id: string
  school_name: string
  moved_by: string
  moved_at: string
}

function toHandoff(row: HandoffRow): QaHandoff {
  return {
    schoolId: row.school_id,
    schoolName: row.school_name,
    movedBy: row.moved_by,
    movedAt: row.moved_at,
  }
}

export async function GET() {
  try {
    const rows = await supabaseRestSelect<HandoffRow>(
      "esa_qa_handoffs",
      "select=school_id,school_name,moved_by,moved_at&order=moved_at.desc",
    )
    return NextResponse.json({ handoffs: rows.map(toHandoff) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load AISD QA handoffs"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<QaHandoff>
    const schoolId = body.schoolId?.trim() ?? ""
    const schoolName = body.schoolName?.trim() ?? ""
    const movedBy = body.movedBy?.trim() ?? ""
    if (!schoolId || !schoolName || !movedBy) {
      return NextResponse.json(
        { error: "schoolId, schoolName, and movedBy are required" },
        { status: 400 },
      )
    }
    const movedAt = body.movedAt?.trim() || new Date().toISOString()
    const [saved] = await supabaseRestUpsert<HandoffRow>(
      "esa_qa_handoffs",
      [
        {
          school_id: schoolId,
          school_name: schoolName,
          moved_by: movedBy,
          moved_at: movedAt,
        },
      ],
      "school_id",
    )
    return NextResponse.json({ handoff: toHandoff(saved!) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save AISD QA handoff"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
