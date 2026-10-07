import { NextResponse } from "next/server"
import { loadSnapshot } from "@/lib/school-snapshot-store"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ schoolId: string }> | { schoolId: string } },
) {
  try {
    const params = await Promise.resolve(context.params)
    const schoolId = decodeURIComponent(params.schoolId ?? "").trim()
    if (!schoolId) {
      return NextResponse.json({ error: "schoolId is required" }, { status: 400 })
    }
    const snapshot = await loadSnapshot(schoolId)
    if (!snapshot) {
      return NextResponse.json({ error: `No snapshot for ${schoolId}` }, { status: 404 })
    }
    return NextResponse.json({ snapshot })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load school"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
