import { NextResponse } from "next/server"
import { supabaseRestSelect, supabaseRestUpsert } from "@/lib/supabase-rest"
import {
  isTestAisdHandoff,
  normalizeHandoffStatus,
  type QaHandoff,
  type QaHandoffStatus,
} from "@/lib/qa-handoff"

export const runtime = "nodejs"

interface HandoffRow {
  school_id: string
  school_name: string
  moved_by: string
  moved_at: string
  status?: string | null
  decision_by?: string | null
  decision_at?: string | null
  decision_comments?: string | null
}

const FULL_SELECT =
  "select=school_id,school_name,moved_by,moved_at,status,decision_by,decision_at,decision_comments&order=moved_at.desc"
const BASIC_SELECT = "select=school_id,school_name,moved_by,moved_at&order=moved_at.desc"

function asStatus(value: string | null | undefined): QaHandoffStatus {
  return normalizeHandoffStatus(value)
}

function toHandoff(row: HandoffRow): QaHandoff {
  return {
    schoolId: row.school_id,
    schoolName: row.school_name,
    movedBy: row.moved_by,
    movedAt: row.moved_at,
    status: asStatus(row.status),
    decisionBy: row.decision_by?.trim() || undefined,
    decisionAt: row.decision_at ?? undefined,
    decisionComments: row.decision_comments?.trim() || undefined,
  }
}

async function loadHandoffRows(): Promise<HandoffRow[]> {
  try {
    return await supabaseRestSelect<HandoffRow>("esa_qa_handoffs", FULL_SELECT)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (!/status|decision_|schema cache|PGRST204/i.test(message)) throw error
    return await supabaseRestSelect<HandoffRow>("esa_qa_handoffs", BASIC_SELECT)
  }
}

export async function GET() {
  try {
    const rows = await loadHandoffRows()
    return NextResponse.json({
      handoffs: rows.map(toHandoff).filter((handoff) => !isTestAisdHandoff(handoff)),
    })
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
    const status = asStatus(body.status)
    const movedAt = body.movedAt?.trim() || new Date().toISOString()
    const decisionBy = body.decisionBy?.trim() ?? ""
    const decisionComments = body.decisionComments?.trim() ?? ""
    const decisionAt =
      body.decisionAt?.trim() ||
      (status === "aisd" ? null : new Date().toISOString())
    if ((status === "finalized" || status === "feedback") && !decisionBy) {
      return NextResponse.json(
        { error: "Enter who is moving this campus before saving." },
        { status: 400 },
      )
    }
    const payload = {
      school_id: schoolId,
      school_name: schoolName,
      moved_by: movedBy,
      moved_at: movedAt,
      status,
      decision_by: decisionBy,
      decision_at: decisionAt,
      decision_comments: decisionComments,
    }
    try {
      const [saved] = await supabaseRestUpsert<HandoffRow>("esa_qa_handoffs", [payload], "school_id")
      return NextResponse.json({ handoff: toHandoff(saved!) })
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!/status|decision_|schema cache|PGRST204/i.test(message) || status !== "aisd") {
        if (/status|decision_|schema cache|PGRST204/i.test(message)) {
          throw new Error(
            "Supabase is missing AISD decision columns. Run the latest supabase/qa-portal.sql (status, decision_by, decision_at, decision_comments), then try again.",
          )
        }
        throw error
      }
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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save AISD QA handoff"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
