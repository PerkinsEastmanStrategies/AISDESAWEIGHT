import { NextResponse } from "next/server"
import { discoverWalkedSchools, exportWalkedSchool, shouldExportSchool, snapshotMeetsMinimum } from "@/lib/esa-walked-schools"
import { loadMergedSchoolIndex, saveSnapshot } from "@/lib/school-snapshot-store"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST() {
  try {
    const current = await loadMergedSchoolIndex()
    const currentById = new Map(current.map((school) => [school.schoolId, school]))
    const walked = await discoverWalkedSchools()
    const added: string[] = []
    const updated: string[] = []

    for (const school of walked) {
      const existing = currentById.get(school.schoolId)
      if (!shouldExportSchool(school, existing)) continue
      const snapshot = await exportWalkedSchool(school)
      if (!existing && !snapshotMeetsMinimum(snapshot)) continue
      await saveSnapshot(snapshot)
      if (existing) updated.push(snapshot.schoolName)
      else added.push(snapshot.schoolName)
      currentById.set(snapshot.schoolId, {
        schoolId: snapshot.schoolId,
        schoolName: snapshot.schoolName,
        campusId: snapshot.campusId,
        schoolClass: snapshot.schoolClass,
        schoolLevel: snapshot.schoolLevel,
        roomCount: snapshot.roomCount,
        scoredUnitCount: snapshot.scoredUnitCount,
        exportedAt: snapshot.exportedAt,
      })
    }

    const schools = await loadMergedSchoolIndex()
    return NextResponse.json({ added, updated, schools })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not refresh walked schools"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
