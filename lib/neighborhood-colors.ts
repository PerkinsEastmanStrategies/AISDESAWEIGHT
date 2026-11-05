const NEIGHBORHOOD_PALETTE: Record<string, string> = {
  "1": "#CCEDAF",
  "2": "#40AEAB",
  "3": "#5E8EDD",
  "4": "#7E48C6",
  "5": "#B397E2",
  "6": "#F6BDBB",
  "7": "#FDE156",
  "8": "#E0822D",
  "9": "#9D37E2",
  "10": "#B352AB",
  "11": "#4AF8BF",
  "12": "#8D29F7",
  "13": "#EA5913",
  "14": "#363475",
  "15": "#10A36C",
  "16": "#9C2776",
  "17": "#F1F400",
  "18": "#581793",
  "19": "#597F41",
  "20": "#AD0B32",
}

function neighborhoodPaletteKey(raw: string): string {
  const key = raw.trim().toUpperCase()
  if (/^\d+$/.test(key)) return key
  const letterIndex = key.charCodeAt(0) - "A".charCodeAt(0) + 1
  if (letterIndex >= 1 && letterIndex <= 20 && key.length === 1) return String(letterIndex)
  return key
}

export function neighborhoodFillColor(neighborhood: string | null | undefined): string | null {
  if (!neighborhood) return null
  const key = neighborhoodPaletteKey(neighborhood)
  if (!key) return null
  if (NEIGHBORHOOD_PALETTE[key]) return NEIGHBORHOOD_PALETTE[key]
  const hue = [...key].reduce((acc, ch) => acc + ch.charCodeAt(0) * 17, 0) % 360
  return `hsl(${hue} 65% 48%)`
}

export function neighborhoodLegendColors(neighborhoods: Iterable<string>): { id: string; color: string }[] {
  const ids = [...new Set([...neighborhoods].map((item) => item.trim().toUpperCase()).filter(Boolean))]
  ids.sort((a, b) => {
    const aNum = Number(a)
    const bNum = Number(b)
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum
    return a.localeCompare(b, undefined, { numeric: true })
  })
  return ids.map((id) => ({
    id,
    color: neighborhoodFillColor(id) ?? "#94a3b8",
  }))
}

export function roomNeighborhoodKeys(value: string): string[] {
  const id = value.trim()
  if (!id) return []
  const upper = id.toUpperCase()
  const collapsed = upper.replace(/\s+/g, "")
  const alnum = upper.replace(/[^A-Z0-9]/g, "")
  const keys = new Set<string>([id, upper])
  if (collapsed) keys.add(collapsed)
  if (alnum) keys.add(alnum)
  if (/^\d+$/.test(collapsed)) keys.add(String(Number.parseInt(collapsed, 10)))
  const parent = collapsed.replace(/\.\d+[A-Z]?$/i, "")
  if (parent && parent !== collapsed) {
    keys.add(parent)
    keys.add(parent.replace(/[^A-Z0-9]/g, ""))
  }
  return [...keys].filter(Boolean)
}

export function buildNeighborhoodLookup(
  rooms: Array<{ cafmId?: string; name?: string; neighborhood?: string }>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const room of rooms) {
    const neighborhood = room.neighborhood?.trim()
    if (!neighborhood) continue
    for (const key of [...roomNeighborhoodKeys(room.cafmId ?? ""), ...roomNeighborhoodKeys(room.name ?? "")]) {
      if (!map.has(key)) map.set(key, neighborhood)
    }
  }
  return map
}

export function neighborhoodForPlanRoom(
  room: { id: string; name?: string | null },
  lookup: Map<string, string>,
  fallback?: string | null,
): string | undefined {
  for (const key of [...roomNeighborhoodKeys(room.id), ...roomNeighborhoodKeys(room.name ?? "")]) {
    const hit = lookup.get(key)
    if (hit) return hit
  }
  const trimmed = fallback?.trim()
  return trimmed || undefined
}

export async function fetchCampusNeighborhoods(campusId: string): Promise<Map<string, string>> {
  const response = await fetch(`/api/room-schedule?campusId=${encodeURIComponent(campusId)}`, {
    cache: "no-store",
  })
  const data = (await response.json()) as {
    rooms?: Array<{ cafmId?: string; name?: string; neighborhood?: string }>
  }
  return buildNeighborhoodLookup(data.rooms ?? [])
}

export function colorWithAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex =
      color.length === 4
        ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
        : color
    const r = Number.parseInt(hex.slice(1, 3), 16)
    const g = Number.parseInt(hex.slice(3, 5), 16)
    const b = Number.parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return color
}
