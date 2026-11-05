import { readFile } from "node:fs/promises"
import path from "node:path"
import staticIndex from "@/data/school-index.json"
import { indexEntryFromSnapshot, mergeSchoolIndexes } from "@/lib/school-catalog"
import { exportWalkedSchool, shouldExportSchool, walkedSchoolById } from "@/lib/esa-walked-schools"
import { baseSchoolIdFromHandoff } from "@/lib/qa-handoff"
import { supabaseRestSelect, supabaseRestUpsert } from "@/lib/supabase-rest"
import type { SchoolIndexEntry, SchoolSnapshot } from "@/lib/types"

const TABLE = "esa_qa_school_snapshots"

interface SnapshotRow {
  school_id: string
  school_name: string
  campus_id: string
  school_class: string
  school_level: string
  room_count: number
  scored_unit_count: number
  exported_at: string
  snapshot?: SchoolSnapshot
}

function rowToIndex(row: SnapshotRow): SchoolIndexEntry {
  return {
    schoolId: row.school_id,
    schoolName: row.school_name,
    campusId: row.campus_id,
    schoolClass: row.school_class,
    schoolLevel: row.school_level as SchoolIndexEntry["schoolLevel"],
    roomCount: row.room_count,
    scoredUnitCount: row.scored_unit_count,
    exportedAt: row.exported_at,
  }
}

export function staticSchoolIndex(): SchoolIndexEntry[] {
  return staticIndex as SchoolIndexEntry[]
}

export async function readStaticSnapshot(schoolId: string): Promise<SchoolSnapshot | null> {
  try {
    const file = path.join(process.cwd(), "public", "schools", `${schoolId}.json`)
    return JSON.parse(await readFile(file, "utf8")) as SchoolSnapshot
  } catch {
    return null
  }
}

export async function loadLiveSchoolIndex(): Promise<SchoolIndexEntry[]> {
  try {
    const rows = await supabaseRestSelect<SnapshotRow>(
      TABLE,
      "select=school_id,school_name,campus_id,school_class,school_level,room_count,scored_unit_count,exported_at",
    )
    return rows.map(rowToIndex)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("esa_qa_school_snapshots")) return []
    throw error
  }
}

export async function loadMergedSchoolIndex(): Promise<SchoolIndexEntry[]> {
  const live = await loadLiveSchoolIndex()
  return mergeSchoolIndexes(staticSchoolIndex(), live)
}

async function refreshSnapshotIfStale(
  schoolId: string,
  stored: SchoolSnapshot | null,
): Promise<SchoolSnapshot | null> {
  try {
    const walked = await walkedSchoolById(schoolId)
    if (!walked) return stored
    if (!shouldExportSchool(walked, stored ? indexEntryFromSnapshot(stored) : undefined)) {
      return stored
    }
    const snapshot = await exportWalkedSchool(walked)
    if (!snapshot.rooms.length) return stored
    await saveSnapshot(snapshot)
    return snapshot
  } catch {
    return stored
  }
}

export async function loadSnapshot(schoolId: string): Promise<SchoolSnapshot | null> {
  const ids = [...new Set([schoolId, baseSchoolIdFromHandoff(schoolId)])]
  for (const id of ids) {
    let stored: SchoolSnapshot | null = null
    try {
      const rows = await supabaseRestSelect<SnapshotRow>(
        TABLE,
        `school_id=eq.${encodeURIComponent(id)}&select=snapshot&limit=1`,
      )
      stored = rows[0]?.snapshot ?? null
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("esa_qa_school_snapshots")) throw error
    }
    if (!stored) stored = await readStaticSnapshot(id)
    const snapshot = await refreshSnapshotIfStale(id, stored)
    if (snapshot) return snapshot
  }
  return null
}

export async function saveSnapshot(snapshot: SchoolSnapshot): Promise<void> {
  await supabaseRestUpsert(
    TABLE,
    [
      {
        school_id: snapshot.schoolId,
        school_name: snapshot.schoolName,
        campus_id: snapshot.campusId,
        school_class: snapshot.schoolClass,
        school_level: snapshot.schoolLevel,
        room_count: snapshot.roomCount,
        scored_unit_count: snapshot.scoredUnitCount,
        exported_at: snapshot.exportedAt,
        snapshot,
        updated_at: new Date().toISOString(),
      },
    ],
    "school_id",
  )
}

export function savedIndexEntry(snapshot: SchoolSnapshot): SchoolIndexEntry {
  return indexEntryFromSnapshot(snapshot)
}
