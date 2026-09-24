import {
  defaultFloorLevelId,
  floorsForRow,
  matchManifestRow,
  parseFloorPlanManifest,
  type FloorPlanLevelEntry,
} from "@/lib/floor-plan-manifest"
import {
  floorPlanSvgDataUrl,
  parsePlanRoomsFromSvg,
  parseSvgViewBox,
  sanitizeFloorPlanSvgXml,
  type FloorPlanViewBox,
  type ParsedPlanRoom,
} from "@/lib/floor-plan-parse"

export interface LoadedFloorLevel {
  id: string
  label: string
  filename: string
  viewBox: FloorPlanViewBox
  src: string
}

export interface LoadedFloorPlan {
  campusId: string
  defaultLevelId: string
  levels: LoadedFloorLevel[]
  rooms: ParsedPlanRoom[]
}

let manifestPromise: Promise<ReturnType<typeof parseFloorPlanManifest>> | null = null
const planCache = new Map<string, Promise<LoadedFloorPlan | null>>()

async function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch("/aisd-floor-plan-manifest.csv")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load floor plan manifest")
        return response.text()
      })
      .then(parseFloorPlanManifest)
      .catch(() => [])
  }
  return manifestPromise
}

async function fetchSvg(filename: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/floor-plan?file=${encodeURIComponent(filename)}`)
    if (!response.ok) return null
    return sanitizeFloorPlanSvgXml(await response.text())
  } catch {
    return null
  }
}

async function loadLevel(floor: FloorPlanLevelEntry): Promise<{
  level: LoadedFloorLevel
  rooms: ParsedPlanRoom[]
} | null> {
  const svg = await fetchSvg(floor.filename)
  if (!svg) return null
  const viewBox = parseSvgViewBox(svg)
  if (!viewBox) return null
  return {
    level: {
      id: floor.id,
      label: floor.shortLabel,
      filename: floor.filename,
      viewBox,
      src: floorPlanSvgDataUrl(svg),
    },
    rooms: parsePlanRoomsFromSvg(svg, floor.id),
  }
}

export async function loadFloorPlanForCampus(
  campusId: string,
  schoolName: string,
): Promise<LoadedFloorPlan | null> {
  const cacheKey = `${campusId}::${schoolName}`
  const cached = planCache.get(cacheKey)
  if (cached) return cached

  const pending = (async () => {
    const rows = await loadManifest()
    const row = matchManifestRow(rows, campusId, schoolName)
    if (!row) return null
    const floors = floorsForRow(row)
    if (!floors.length) return null

    const preferred = defaultFloorLevelId(floors)
    const loaded = await Promise.all(floors.map((floor) => loadLevel(floor)))
    const levels: LoadedFloorLevel[] = []
    const rooms: ParsedPlanRoom[] = []
    floors.forEach((floor, index) => {
      const result = loaded[index]
      if (!result) return
      levels.push(result.level)
      rooms.push(...result.rooms)
    })

    if (!levels.length) return null
    return {
      campusId,
      defaultLevelId: preferred && levels.some((level) => level.id === preferred) ? preferred : levels[0]!.id,
      levels,
      rooms,
    }
  })()

  planCache.set(cacheKey, pending)
  return pending
}
