import { NextResponse } from "next/server"
import {
  supabaseRestDelete,
  supabaseRestInsert,
  supabaseRestSelect,
  supabaseRestUpsert,
} from "@/lib/supabase-rest"
import {
  isAisdQueue,
  isTestAisdHandoff,
  isTestHandoffSchoolId,
  normalizeHandoffStatus,
  toTestHandoffSchoolId,
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

async function retainTestHandoffCopies(rows: HandoffRow[]): Promise<HandoffRow[]> {
  const occupying = rows.filter((row) => {
    if (isTestHandoffSchoolId(row.school_id)) return false
    const handoff = toHandoff(row)
    return isTestAisdHandoff(handoff) && isAisdQueue(handoff)
  })
  if (!occupying.length) return rows
  const existingIds = new Set(rows.map((row) => row.school_id))
  for (const row of occupying) {
    const testId = toTestHandoffSchoolId(row.school_id)
    if (!existingIds.has(testId)) {
      try {
        await supabaseRestInsert("esa_qa_handoffs", [
          {
            school_id: testId,
            school_name: row.school_name,
            moved_by: row.moved_by,
            moved_at: row.moved_at,
            status: row.status ?? "aisd",
            decision_by: row.decision_by ?? "",
            decision_at: row.decision_at ?? null,
            decision_comments: row.decision_comments ?? "",
          },
        ])
      } catch {
        await supabaseRestInsert("esa_qa_handoffs", [
          {
            school_id: testId,
            school_name: row.school_name,
            moved_by: row.moved_by,
            moved_at: row.moved_at,
          },
        ])
      }
      existingIds.add(testId)
    }
    await supabaseRestDelete("esa_qa_handoffs", `school_id=eq.${encodeURIComponent(row.school_id)}`)
  }
  return loadHandoffRows()
}

export async function GET() {
  try {
    const rows = await retainTestHandoffCopies(await loadHandoffRows())
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
