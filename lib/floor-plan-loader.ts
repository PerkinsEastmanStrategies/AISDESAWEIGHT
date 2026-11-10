import {
  defaultFloorLevelId,
  floorsForRow,
  matchManifestRow,
  parseFloorPlanManifest,
  type FloorPlanLevelEntry,
  type FloorPlanManifestRow,
} from "@/lib/floor-plan-manifest"
import { prepareFloorPlanSvgForDisplay } from "@/lib/floor-plan-style"
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

let manifestPromise: Promise<FloorPlanManifestRow[]> | null = null
const planCache = new Map<string, Promise<LoadedFloorPlan | null>>()
const PLAN_PARSE_VERSION = "cafm-v7-clone-source"

async function loadBundledManifest(): Promise<FloorPlanManifestRow[]> {
  try {
    const response = await fetch("/aisd-floor-plan-manifest.csv")
    if (!response.ok) return []
    return parseFloorPlanManifest(await response.text())
  } catch {
    return []
  }
}

async function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch("/api/floor-plan-manifest", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load floor plan manifest")
        const payload = (await response.json()) as { rows?: FloorPlanManifestRow[] }
        if (Array.isArray(payload.rows) && payload.rows.length) return payload.rows
        throw new Error("Empty floor plan manifest")
      })
      .catch(() => loadBundledManifest())
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
  const rooms = parsePlanRoomsFromSvg(svg, floor.id)
  const displaySvg = prepareFloorPlanSvgForDisplay(svg)
  return {
    level: {
      id: floor.id,
      label: floor.shortLabel,
      filename: floor.filename,
      viewBox,
      src:
        typeof URL !== "undefined" && displaySvg.length > 400_000
          ? URL.createObjectURL(new Blob([displaySvg], { type: "image/svg+xml" }))
          : floorPlanSvgDataUrl(displaySvg),
    },
    rooms,
  }
}

export async function loadFloorPlanForCampus(
  campusId: string,
  schoolName: string,
): Promise<LoadedFloorPlan | null> {
  const cacheKey = `${campusId}::${schoolName}::${PLAN_PARSE_VERSION}`
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
