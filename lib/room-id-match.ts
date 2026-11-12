/** Match CAFM plan labels (107, ADMIN1) to surveyed room ids (B107, A137). */

export function normalizeRoomId(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "")
}

const LETTER_PREFIX = /^([A-Z])(\d{2,4}(?:\.\d+)?[A-Z]?)$/
const BARE_NUMBER = /^(\d{2,4}(?:\.\d+)?[A-Z]?)$/
const ADMIN_LABEL = /^ADMIN(\d+)?$/
const ANCILLARY_SUFFIX = /^(.*?)(RR|COM|STO|CLO|WKRM)$/

export function roomMatchKeys(value: string): string[] {
  const collapsed = normalizeRoomId(value)
  if (!collapsed || collapsed.startsWith("__")) return []
  const keys = new Set<string>([collapsed, collapsed.replace(/-/g, "")])
  if (/^\d+$/.test(collapsed)) keys.add(String(Number.parseInt(collapsed, 10)))
  const parent = collapsed.replace(/\.\d+[A-Z]?$/i, "")
  if (parent && parent !== collapsed) {
    keys.add(parent)
    keys.add(parent.replace(/-/g, ""))
  }
  return [...keys].filter(Boolean)
}

function addNumberCores(token: string, cores: Set<string>) {
  if (!token || cores.has(token)) return
  cores.add(token)
  const trimmed = token.replace(/^0+(?=\d)/, "")
  if (trimmed && trimmed !== token) addNumberCores(trimmed, cores)
  const trailing = /^(\d{2,4}(?:\.\d+)?)([A-Z])$/.exec(token)
  if (trailing?.[1]) addNumberCores(trailing[1], cores)
  if (/^\d{4}$/.test(token)) cores.add(token.slice(1))
  if (/^\d{4}[A-Z]$/.test(token)) {
    cores.add(token.slice(1))
    addNumberCores(token.slice(1, 4), cores)
  }
}

/** Cores shared by B107/107, B243B/243, and A1101/101. Leaves ADMIN1 and 107RR alone. */
export function roomNumberCores(value: string): string[] {
  const collapsed = normalizeRoomId(value)
  if (!collapsed || collapsed.startsWith("__")) return []
  const cores = new Set<string>()
  const prefixed = LETTER_PREFIX.exec(collapsed)
  if (prefixed?.[2]) addNumberCores(prefixed[2], cores)
  if (BARE_NUMBER.test(collapsed)) addNumberCores(collapsed, cores)
  return [...cores]
}

export function roomNumberCore(value: string): string | null {
  return roomNumberCores(value)[0] ?? null
}

function isBarePlanId(value: string): boolean {
  return BARE_NUMBER.test(normalizeRoomId(value))
}

export function neighborhoodLookupKeys(value: string): string[] {
  const keys = new Set(roomMatchKeys(value))
  for (const core of roomNumberCores(value)) keys.add(core)
  const collapsed = normalizeRoomId(value)
  const ancillary = ANCILLARY_SUFFIX.exec(collapsed)
  if (ancillary?.[1] && ancillary[1] !== collapsed) {
    for (const key of neighborhoodLookupKeys(ancillary[1])) keys.add(key)
  }
  return [...keys].filter(Boolean)
}

function isAssessedRoom<T extends { roomId: string }>(room: T): boolean {
  return Boolean(room.roomId) && !room.roomId.startsWith("__")
}

function isAdminAssessedRoom(room: { spaceType?: string; roomName?: string }): boolean {
  const space = room.spaceType ?? ""
  return /\badmin(?:istration)?\b/i.test(space) || /\badmin office\b/i.test(space)
}

function adminLabelIndex(value: string): number | null {
  const match = ADMIN_LABEL.exec(normalizeRoomId(value))
  if (!match) return null
  const n = match[1] ? Number.parseInt(match[1], 10) : 1
  return Number.isFinite(n) && n > 0 ? n : 1
}

function uniqueByCore<T extends { roomId: string; roomName: string }>(rooms: T[]): Map<string, T> {
  const buckets = new Map<string, T[]>()
  for (const room of rooms) {
    const cores = new Set([...roomNumberCores(room.roomId), ...roomNumberCores(room.roomName)])
    for (const core of cores) {
      const list = buckets.get(core) ?? []
      if (!list.some((item) => item.roomId === room.roomId)) list.push(room)
      buckets.set(core, list)
    }
  }
  const unique = new Map<string, T>()
  for (const [core, list] of buckets) {
    if (list.length === 1) unique.set(core, list[0]!)
  }
  return unique
}

function planIdsOf(planRoom: { id: string; name?: string | null }): string[] {
  return [planRoom.id, planRoom.name ?? ""].map(normalizeRoomId).filter(Boolean)
}

function exactScoredMatch<T extends { roomId: string; roomName: string }>(
  planIds: string[],
  assessed: T[],
): T | undefined {
  return assessed.find((room) =>
    [room.roomId, room.roomName].map(normalizeRoomId).some((id) => planIds.includes(id)),
  )
}

function aliasedScoredMatch<T extends { roomId: string; roomName: string }>(
  planIds: string[],
  assessed: T[],
): T | undefined {
  const planKeys = new Set(planIds.flatMap(roomMatchKeys))
  return assessed.find((room) =>
    [room.roomId, room.roomName].flatMap(roomMatchKeys).some((key) => planKeys.has(key)),
  )
}

function uniqueCoreMatch<T extends { roomId: string; roomName: string }>(
  planIds: string[],
  assessed: T[],
): T | undefined {
  const uniqueCores = uniqueByCore(assessed)
  for (const id of planIds) {
    if (!isBarePlanId(id)) continue
    const cores = roomNumberCores(id).sort((a, b) => b.length - a.length)
    for (const core of cores) {
      const hit = uniqueCores.get(core)
      if (hit) return hit
    }
  }
  return undefined
}

function adminLabelMatch<T extends { roomId: string; roomName: string; spaceType?: string }>(
  planIds: string[],
  assessed: T[],
): T | undefined {
  const adminRooms = assessed
    .filter(isAdminAssessedRoom)
    .sort((a, b) => a.roomId.localeCompare(b.roomId, undefined, { numeric: true }))
  const adminAlreadyLabeled = adminRooms.some((room) =>
    [room.roomId, room.roomName].some((value) => ADMIN_LABEL.test(normalizeRoomId(value))),
  )
  if (adminAlreadyLabeled) return undefined
  for (const id of planIds) {
    const index = adminLabelIndex(id)
    if (index == null) continue
    const hit = adminRooms[index - 1]
    if (hit) return hit
  }
  return undefined
}

/**
 * Assign each plan polygon to at most one walked room, and each walked room to
 * at most one polygon. Exact IDs win so A143 does not also paint a different
 * building's 143 on the same floor plate.
 */
export function matchPlanRoomsToScored<T extends { roomId: string; roomName: string; spaceType?: string }>(
  planRooms: Array<{ id: string; name?: string | null }>,
  rooms: T[],
): Map<string, T> {
  const assessed = rooms.filter(isAssessedRoom)
  const claimed = new Set<string>()
  const result = new Map<string, T>()

  const take = (planId: string, room: T | undefined) => {
    if (!room || claimed.has(room.roomId) || result.has(planId)) return
    claimed.add(room.roomId)
    result.set(planId, room)
  }

  const remaining = () => assessed.filter((room) => !claimed.has(room.roomId))

  for (const planRoom of planRooms) take(planRoom.id, exactScoredMatch(planIdsOf(planRoom), remaining()))
  for (const planRoom of planRooms) take(planRoom.id, aliasedScoredMatch(planIdsOf(planRoom), remaining()))
  for (const planRoom of planRooms) take(planRoom.id, uniqueCoreMatch(planIdsOf(planRoom), remaining()))
  for (const planRoom of planRooms) take(planRoom.id, adminLabelMatch(planIdsOf(planRoom), remaining()))
  return result
}

export function matchScoredRoom<T extends { roomId: string; roomName: string; spaceType?: string }>(
  planRoom: { id: string; name?: string | null },
  rooms: T[],
): T | undefined {
  return matchPlanRoomsToScored([planRoom], rooms).get(planRoom.id)
}

/** Register schedule ids so unprefixed plan labels can resolve uniquely. */
export function registerNeighborhoodKeys(
  map: Map<string, string>,
  owners: Map<string, string>,
  sourceId: string,
  neighborhood: string,
  rawKeys: string[],
) {
  for (const key of rawKeys) {
    const owner = owners.get(key)
    if (owner === undefined) {
      owners.set(key, sourceId)
      map.set(key, neighborhood)
      continue
    }
    if (owner === sourceId) continue
    const existing = map.get(key)
    if (existing && existing !== neighborhood) {
      map.delete(key)
      owners.set(key, "")
    }
  }
}
