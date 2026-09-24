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
      if (filename) floors[id] = filename
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

export function matchManifestRow(
  rows: FloorPlanManifestRow[],
  campusId: string,
  schoolName: string,
): FloorPlanManifestRow | undefined {
  const sourceId = sourceCampusId(campusId)
  const byCampus = rows.find((row) => row.campusId && row.campusId === sourceId)
  if (byCampus) return byCampus

  const wanted = normalizeName(schoolName)
  return rows.find((row) => {
    const names = [row.schoolName, row.updatedName].filter(Boolean).map((name) => normalizeName(name!))
    return names.some((name) => name === wanted || wanted.includes(name) || name.includes(wanted))
  })
}

export function floorsForRow(row: FloorPlanManifestRow): FloorPlanLevelEntry[] {
  return FLOOR_LEVELS.flatMap((level) => {
    const filename = row.floors[level.id]?.trim()
    if (!filename) return []
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
