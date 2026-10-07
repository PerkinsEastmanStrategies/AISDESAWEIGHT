import type { SchoolIndexEntry, SchoolLevel, SchoolSnapshot } from "@/lib/types"

export const HIDDEN_SCHOOL_IDS = new Set(["barton-hills", "casis", "ortega"])
export const WALKED_SINCE = "2026-09-17T00:00:00.000Z"
export const MIN_SCORED_UNITS = 100

export function optionLevel(school: SchoolIndexEntry): SchoolLevel {
  if (school.schoolLevel) return school.schoolLevel
  if (school.schoolClass === "MID") return "MS"
  if (school.schoolClass === "HIGH") return "HS"
  return "ES"
}

export function indexEntryFromSnapshot(snapshot: SchoolSnapshot): SchoolIndexEntry {
  return {
    schoolId: snapshot.schoolId,
    schoolName: snapshot.schoolName,
    campusId: snapshot.campusId,
    schoolClass: snapshot.schoolClass,
    schoolLevel: snapshot.schoolLevel,
    roomCount: snapshot.roomCount,
    scoredUnitCount: snapshot.scoredUnitCount,
    exportedAt: snapshot.exportedAt,
  }
}

export function mergeSchoolIndexes(
  fallback: SchoolIndexEntry[],
  live: SchoolIndexEntry[],
): SchoolIndexEntry[] {
  const byId = new Map<string, SchoolIndexEntry>()
  for (const school of fallback) byId.set(school.schoolId, school)
  for (const school of live) byId.set(school.schoolId, school)
  const levelOrder: Record<SchoolLevel, number> = { ES: 0, MS: 1, HS: 2 }
  return [...byId.values()]
    .filter((school) => !HIDDEN_SCHOOL_IDS.has(school.schoolId))
    .sort(
      (a, b) =>
        levelOrder[optionLevel(a)] - levelOrder[optionLevel(b)] ||
        a.schoolName.localeCompare(b.schoolName, undefined, { sensitivity: "base" }),
    )
}

export async function fetchSchoolCatalog(): Promise<SchoolIndexEntry[]> {
  const response = await fetch("/api/schools", { cache: "no-store" })
  const data = (await response.json()) as { schools?: SchoolIndexEntry[]; error?: string }
  if (!response.ok) throw new Error(data.error || "Could not load schools")
  return data.schools ?? []
}

export async function fetchSchoolSnapshot(schoolId: string): Promise<SchoolSnapshot> {
  const response = await fetch(`/api/schools/${encodeURIComponent(schoolId)}`, { cache: "no-store" })
  const data = (await response.json()) as { snapshot?: SchoolSnapshot; error?: string }
  if (!response.ok) throw new Error(data.error || `Could not load ${schoolId}`)
  if (!data.snapshot) throw new Error(`Could not load ${schoolId}`)
  return data.snapshot
}

export async function refreshWalkedSchools(): Promise<{
  added: string[]
  updated: string[]
  schools: SchoolIndexEntry[]
}> {
  const response = await fetch("/api/schools/refresh", { method: "POST", cache: "no-store" })
  const data = (await response.json()) as {
    added?: string[]
    updated?: string[]
    schools?: SchoolIndexEntry[]
    error?: string
  }
  if (!response.ok) throw new Error(data.error || "Could not refresh walked schools")
  return {
    added: data.added ?? [],
    updated: data.updated ?? [],
    schools: data.schools ?? [],
  }
}
