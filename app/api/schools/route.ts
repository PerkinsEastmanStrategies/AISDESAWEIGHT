import { NextResponse } from "next/server"
import { loadMergedSchoolIndex } from "@/lib/school-snapshot-store"

export const runtime = "nodejs"

export async function GET() {
  try {
    const schools = await loadMergedSchoolIndex()
    return NextResponse.json({ schools })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load schools"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
