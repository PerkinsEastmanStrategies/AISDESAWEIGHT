import { namesMatch } from "@/lib/normalize"
import type { SchoolSnapshot, ScoredRoom } from "@/lib/types"

export interface DiscardedRoom {
  schoolId: string
  roomId: string
  roomName?: string
  spaceType?: string
  neighborhood?: string
  discardedBy?: string
  discardedAt?: string
}

const DISCARD_KEY = "qa-discarded-rooms"
const NEIGHBORHOOD_SURVEY_PREFIX = "__neighborhood-survey__:"

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function asDiscardedRoom(item: unknown): DiscardedRoom | null {
  if (!item || typeof item !== "object") return null
  const row = item as Partial<DiscardedRoom>
  if (typeof row.schoolId !== "string" || typeof row.roomId !== "string") return null
  if (!row.schoolId.trim() || !row.roomId.trim()) return null
  return {
    schoolId: row.schoolId.trim(),
    roomId: row.roomId.trim(),
    roomName: typeof row.roomName === "string" ? row.roomName : undefined,
    spaceType: typeof row.spaceType === "string" ? row.spaceType : undefined,
    neighborhood: typeof row.neighborhood === "string" ? row.neighborhood : undefined,
    discardedBy: typeof row.discardedBy === "string" ? row.discardedBy : undefined,
    discardedAt: typeof row.discardedAt === "string" ? row.discardedAt : undefined,
  }
}

export function loadDiscardedRooms(): DiscardedRoom[] {
  if (!canUseStorage()) return []
  try {
    const raw = window.localStorage.getItem(DISCARD_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(asDiscardedRoom).filter((item): item is DiscardedRoom => Boolean(item))
  } catch {
    return []
  }
}

export function saveDiscardedRooms(rows: DiscardedRoom[]): void {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(DISCARD_KEY, JSON.stringify(rows))
  } catch {
    /* ignore quota */
  }
}

export function mergeDiscardedRooms(rows: DiscardedRoom[][]): DiscardedRoom[] {
  const byKey = new Map<string, DiscardedRoom>()
  for (const list of rows) {
    for (const item of list) {
      const key = `${item.schoolId}::${item.roomId}`
      const current = byKey.get(key)
      if (!current) {
        byKey.set(key, item)
        continue
      }
      byKey.set(key, {
        ...current,
        ...item,
        roomName: item.roomName || current.roomName,
        spaceType: item.spaceType || current.spaceType,
        neighborhood: item.neighborhood || current.neighborhood,
        discardedBy: item.discardedBy || current.discardedBy,
        discardedAt: item.discardedAt || current.discardedAt,
      })
    }
  }
  return [...byKey.values()]
}

export function discardQaRoom(entry: DiscardedRoom | string, roomId?: string): DiscardedRoom[] {
  const nextEntry: DiscardedRoom =
    typeof entry === "string"
      ? { schoolId: entry, roomId: roomId ?? "" }
      : entry
  if (!nextEntry.schoolId.trim() || !nextEntry.roomId.trim()) return loadDiscardedRooms()
  const next = mergeDiscardedRooms([
    loadDiscardedRooms().filter(
      (item) => !(item.schoolId === nextEntry.schoolId && item.roomId === nextEntry.roomId),
    ),
    [nextEntry],
  ])
  saveDiscardedRooms(next)
  return next
}

function neighborhoodKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^neighborhood\s+/i, "")
    .toLowerCase()
}

function discardedNeighborhood(item: DiscardedRoom): string {
  if (item.roomId.startsWith(NEIGHBORHOOD_SURVEY_PREFIX)) {
    return neighborhoodKey(item.roomId.slice(NEIGHBORHOOD_SURVEY_PREFIX.length))
  }
  const named = /^(?:neighborhood\s+)?(\d+)$/i.exec((item.roomName ?? "").trim())
  if (named && namesMatch(item.spaceType ?? "Neighborhood", "Neighborhood")) {
    return neighborhoodKey(named[1])
  }
  return neighborhoodKey(item.neighborhood)
}

function roomMatchesDiscard(room: ScoredRoom, item: DiscardedRoom): boolean {
  if (room.roomId === item.roomId) return true
  const discardedName = (item.roomName ?? "").trim()
  if (discardedName && namesMatch(room.roomName, discardedName)) {
    if (!item.spaceType || namesMatch(room.spaceType, item.spaceType)) return true
  }
  const neighborhood = discardedNeighborhood(item)
  if (neighborhood && neighborhoodKey(room.neighborhood) === neighborhood) {
    if (room.roomId.startsWith(NEIGHBORHOOD_SURVEY_PREFIX)) return true
    if (namesMatch(room.spaceType, "Neighborhood") || namesMatch(room.roomName, `Neighborhood ${neighborhood}`)) {
      return true
    }
  }
  return false
}

export function omitDiscardedRooms(
  snapshot: SchoolSnapshot,
  discarded: DiscardedRoom[],
): SchoolSnapshot {
  const forSchool = discarded.filter((item) => item.schoolId === snapshot.schoolId)
  if (!forSchool.length) return snapshot
  const rooms = snapshot.rooms.filter((room) => !forSchool.some((item) => roomMatchesDiscard(room, item)))
  if (rooms.length === snapshot.rooms.length) return snapshot
  return {
    ...snapshot,
    rooms,
    roomCount: rooms.length,
    scoredUnitCount: rooms.reduce((total, room) => total + room.units.length, 0),
  }
}
