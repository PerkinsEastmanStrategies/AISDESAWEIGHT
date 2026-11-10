import { testCampusCloneForSchool } from "@aisd/shared"

/** Live Google Sheet used by the ESA assessment tool. */
export const DEFAULT_FLOOR_PLAN_MANIFEST_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTGFUvsaGfYsp9TK7ZjHT8_ZHaUq4xqxiPSedQC9XeGpmY5QCS2rkcyGuZJm517sB4RWRsNqhmxFaW_/pub?output=csv"

export const FLOOR_LEVELS = [
  { id: "basement", column: "Basement", shortLabel: "B", fullLabel: "Basement" },
  { id: "floor-1", column: "Floor 1", shortLabel: "L1", fullLabel: "Floor 1" },
  { id: "floor-2", column: "Floor 2", shortLabel: "L2", fullLabel: "Floor 2" },
  { id: "floor-3", column: "Floor 3", shortLabel: "L3", fullLabel: "Floor 3" },
  { id: "floor-4", column: "Floor 4", shortLabel: "L4", fullLabel: "Floor 4" },
  { id: "floor-5", column: "Floor 5", shortLabel: "L5", fullLabel: "Floor 5" },
  { id: "floor-6", column: "Floor 6", shortLabel: "L6", fullLabel: "Floor 6" },
  { id: "floor-7", column: "Floor 7", shortLabel: "L7", fullLabel: "Floor 7" },
  { id: "floor-8", column: "Floor 8", shortLabel: "L8", fullLabel: "Floor 8" },
  { id: "floor-9", column: "Floor 9", shortLabel: "L9", fullLabel: "Floor 9" },
  {
    id: "athletics-building",
    column: "Athletics Building",
    shortLabel: "Ath",
    fullLabel: "Athletics Building",
  },
  { id: "mezzanine", column: "Mezzanine", shortLabel: "M", fullLabel: "Mezzanine" },
] as const

export type FloorLevelId = (typeof FLOOR_LEVELS)[number]["id"]

export const PREFERRED_DEFAULT_FLOOR_LEVEL_ID: FloorLevelId = "floor-1"

export interface FloorPlanLevelEntry {
  id: FloorLevelId
  shortLabel: string
  fullLabel: string
  filename: string
}

export interface FloorPlanManifestRow {
  schoolName: string
  campusId: string
  updatedName?: string
  floors: Partial<Record<FloorLevelId, string>>
}

export type FloorPlanManifestDbRow = {
  campus_id: string
  school_name: string
  school_class: string | null
  floor_level_id: string
  floor_label: string
  filename: string
  mobile_filename: string | null
}

const FLOOR_LEVEL_ID_ALIASES: Record<string, FloorLevelId> = {
  athletics: "athletics-building",
}

export function isFloorPlanSvgFilename(filename: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 .()_+#-]*\.svg$/i.test(filename.trim())
}

function parseCsvRecords(csvText: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let current = ""
  let inQuotes = false
  const text = csvText.replace(/^\uFEFF/, "")

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === ",") {
      row.push(current)
      current = ""
      continue
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++
      row.push(current)
      current = ""
      if (row.some((cell) => cell.trim())) rows.push(row.map((cell) => cell.trim()))
      row = []
      continue
    }
    current += char
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current)
    if (row.some((cell) => cell.trim())) rows.push(row.map((cell) => cell.trim()))
  }

  return rows
}

export function parseFloorPlanManifest(csvText: string): FloorPlanManifestRow[] {
  const records = parseCsvRecords(csvText)
  if (records.length < 2) return []

  const headers = records[0].map((header) => header.trim())
  const schoolNameIndex = headers.indexOf("school_name")
  if (schoolNameIndex === -1) return []

  const campusIdIndex = headers.indexOf("campus_id")
  const updatedNameIndex = headers.indexOf("UpdatedName")
  const floorColumnIndexes = FLOOR_LEVELS.map((level) => ({
    id: level.id,
    index: headers.indexOf(level.column),
  }))

  const rows: FloorPlanManifestRow[] = []
  for (const cells of records.slice(1)) {
    const schoolName = cells[schoolNameIndex]?.trim()
    if (!schoolName || /^note:/i.test(schoolName)) continue

    const floors: Partial<Record<FloorLevelId, string>> = {}
    for (const { id, index } of floorColumnIndexes) {
      if (index === -1) continue
      const filename = cells[index]?.trim()
      if (filename && isFloorPlanSvgFilename(filename)) floors[id] = filename
    }

    rows.push({
      schoolName,
      campusId: campusIdIndex === -1 ? "" : cells[campusIdIndex]?.trim() ?? "",
      updatedName: updatedNameIndex === -1 ? undefined : cells[updatedNameIndex]?.trim() || undefined,
      floors,
    })
  }

  return rows
}

export function sourceCampusId(campusId: string): string {
  return campusId.replace(/-(PILOT(?:-\d+)?(?:-MERGE)?|TEST)$/i, "")
}

function normalizeName(value: string): string {
  return value.toUpperCase().replace(/\s+/g, " ").trim()
}

function coreSchoolName(value: string): string {
  return normalizeName(value).replace(/\s+(ELEMENTARY|MIDDLE|HIGH|ECHS|ES|MS|HS|ALT)$/i, "")
}

export function matchManifestRow(
  rows: FloorPlanManifestRow[],
  campusId: string,
  schoolName: string,
): FloorPlanManifestRow | undefined {
  const clone = testCampusCloneForSchool({ campusId, name: schoolName, id: "" })
  const sourceId = sourceCampusId(clone?.sourceCampusId || campusId)
  const byCampus = rows.find((row) => row.campusId && row.campusId === sourceId)
  if (byCampus) return byCampus

  const namesToTry = [schoolName, clone?.sourceName, clone?.displayName].filter(Boolean) as string[]
  for (const name of namesToTry) {
    const wanted = normalizeName(name)
    const wantedCore = coreSchoolName(name)
    const match = rows.find((row) => {
      const names = [row.schoolName, row.updatedName].filter(Boolean).map((rowName) => normalizeName(rowName!))
      if (names.includes(wanted)) return true
      return names.map(coreSchoolName).includes(wantedCore)
    })
    if (match) return match
  }
}

function normalizeFloorLevelId(raw: string): FloorLevelId | null {
  const id = raw.trim()
  if (!id) return null
  const aliased = FLOOR_LEVEL_ID_ALIASES[id] ?? id
  return FLOOR_LEVELS.some((level) => level.id === aliased) ? (aliased as FloorLevelId) : null
}

export function supabaseRowsToManifest(rows: FloorPlanManifestDbRow[]): FloorPlanManifestRow[] {
  const byKey = new Map<string, FloorPlanManifestRow>()
  for (const row of rows) {
    const campusId = row.campus_id?.trim() ?? ""
    const schoolName = row.school_name?.trim() ?? ""
    if (!campusId && !schoolName) continue
    const levelId = normalizeFloorLevelId(row.floor_level_id ?? "")
    const filename = row.filename?.trim() || row.mobile_filename?.trim() || ""
    if (!levelId || !filename || !isFloorPlanSvgFilename(filename)) continue
    const key = campusId || normalizeName(schoolName)
    let existing = byKey.get(key)
    if (!existing) {
      existing = { schoolName, campusId, floors: {} }
      byKey.set(key, existing)
    }
    existing.floors[levelId] = filename
  }
  return [...byKey.values()]
}

function overlayLocalSvgFloors(
  sheetRows: FloorPlanManifestRow[],
  localRows: FloorPlanManifestRow[],
): FloorPlanManifestRow[] {
  if (!localRows.length) return sheetRows
  if (!sheetRows.length) return localRows
  const merged = sheetRows.map((row) => ({ ...row, floors: { ...row.floors } }))
  for (const localRow of localRows) {
    const match = matchManifestRow(merged, localRow.campusId, localRow.updatedName || localRow.schoolName)
    if (!match) {
      if (FLOOR_LEVELS.some((level) => isFloorPlanSvgFilename(localRow.floors[level.id] ?? ""))) {
        merged.push({ ...localRow, floors: { ...localRow.floors } })
      }
      continue
    }
    for (const level of FLOOR_LEVELS) {
      const filename = localRow.floors[level.id]?.trim() ?? ""
      if (!isFloorPlanSvgFilename(filename)) continue
      const current = match.floors[level.id]?.trim() ?? ""
      if (!isFloorPlanSvgFilename(current)) match.floors[level.id] = filename
    }
  }
  return merged
}

function mergeSheetWithSupabase(
  sheetRows: FloorPlanManifestRow[],
  supabaseRows: FloorPlanManifestRow[],
): FloorPlanManifestRow[] {
  if (!supabaseRows.length) return sheetRows
  const merged = sheetRows.map((row) => ({ ...row, floors: { ...row.floors } }))
  for (const supabaseRow of supabaseRows) {
    const match = matchManifestRow(merged, supabaseRow.campusId, supabaseRow.schoolName)
    if (match) {
      match.floors = { ...match.floors, ...supabaseRow.floors }
      if (!match.campusId && supabaseRow.campusId) match.campusId = supabaseRow.campusId
    } else {
      merged.push(supabaseRow)
    }
  }
  return merged
}

/** Same merge order as the ESA assessment tool: live sheet, local CSV gaps, then converter table. */
export function mergeLiveFloorPlanManifest(
  sheetRows: FloorPlanManifestRow[],
  localRows: FloorPlanManifestRow[],
  supabaseRows: FloorPlanManifestRow[],
): FloorPlanManifestRow[] {
  const sheet = sheetRows.length ? overlayLocalSvgFloors(sheetRows, localRows) : localRows
  return mergeSheetWithSupabase(sheet, supabaseRows)
}

export function floorsForRow(row: FloorPlanManifestRow): FloorPlanLevelEntry[] {
  return FLOOR_LEVELS.flatMap((level) => {
    const filename = row.floors[level.id]?.trim()
    if (!filename || !isFloorPlanSvgFilename(filename)) return []
    return [
      {
        id: level.id,
        shortLabel: level.shortLabel,
        fullLabel: level.fullLabel,
        filename,
      },
    ]
  })
}

export function defaultFloorLevelId(floors: FloorPlanLevelEntry[]): FloorLevelId | null {
  if (floors.some((floor) => floor.id === PREFERRED_DEFAULT_FLOOR_LEVEL_ID)) {
    return PREFERRED_DEFAULT_FLOOR_LEVEL_ID
  }
  return floors[0]?.id ?? null
}
