import type { SchoolSnapshot } from "@/lib/types"

export interface DiscardedRoom {
  schoolId: string
  roomId: string
}

const DISCARD_KEY = "qa-discarded-rooms"

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

export function loadDiscardedRooms(): DiscardedRoom[] {
  if (!canUseStorage()) return []
  try {
    const raw = window.localStorage.getItem(DISCARD_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is DiscardedRoom =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as DiscardedRoom).schoolId === "string" &&
        typeof (item as DiscardedRoom).roomId === "string" &&
        (item as DiscardedRoom).schoolId.trim().length > 0 &&
        (item as DiscardedRoom).roomId.trim().length > 0,
    )
  } catch {
    return []
  }
}

export function discardQaRoom(schoolId: string, roomId: string): DiscardedRoom[] {
  const next = loadDiscardedRooms().filter(
    (item) => !(item.schoolId === schoolId && item.roomId === roomId),
  )
  next.push({ schoolId, roomId })
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(DISCARD_KEY, JSON.stringify(next))
    } catch {
      /* ignore quota */
    }
  }
  return next
}

export function omitDiscardedRooms(
  snapshot: SchoolSnapshot,
  discarded: DiscardedRoom[],
): SchoolSnapshot {
  const dropped = new Set(
    discarded.filter((item) => item.schoolId === snapshot.schoolId).map((item) => item.roomId),
  )
  if (!dropped.size) return snapshot
  const rooms = snapshot.rooms.filter((room) => !dropped.has(room.roomId))
  return {
    ...snapshot,
    rooms,
    roomCount: rooms.length,
    scoredUnitCount: rooms.reduce((total, room) => total + room.units.length, 0),
  }
}
