import { NextResponse } from "next/server"
import {
  isImageObjectName,
  linkedPhotoFromUrl,
  parseSurveyPhotoPath,
  photoUrlsFromValue,
  roomFolderAliases,
  roomsShareIdentity,
  sanitizePhotoSegment,
  type QaPhoto,
} from "@/lib/qa-photos"
import {
  campusIdLookups,
  inFilter,
  schoolIdLookups,
  supabaseRestSelect,
} from "@/lib/supabase-rest"

export const runtime = "nodejs"

const DEFAULT_PHOTOS_BUCKET = "ESA Pictures"
const MAX_PHOTOS = 250
const MAX_DEPTH = 8

function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured")
  return url.replace(/\/$/, "")
}

function photosBucket(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_PHOTOS_BUCKET?.trim() || DEFAULT_PHOTOS_BUCKET
}

function supabaseKey(): string {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!key) {
    throw new Error("Add SUPABASE_SERVICE_ROLE_KEY to .env.local to list room photos")
  }
  return key
}

function publicUrl(path: string): string {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `${supabaseUrl()}/storage/v1/object/public/${encodeURIComponent(photosBucket())}/${encodedPath}`
}

interface StorageListEntry {
  name: string
  id: string | null
  metadata?: Record<string, unknown> | null
}

interface SessionRow {
  id: string
}

interface RoomRow {
  survey_session_id: string
  room_id: string
  room_number: string | null
  school_room_number: string | null
  general_photos?: string[] | null
}

interface ResponseRow {
  survey_session_id: string
  room_id: string
  question_id: string
  comment: string | null
  photos?: unknown
}

async function listPrefix(prefix: string): Promise<StorageListEntry[]> {
  const key = supabaseKey()
  const response = await fetch(
    `${supabaseUrl()}/storage/v1/object/list/${encodeURIComponent(photosBucket())}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      }),
    },
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(detail || `Supabase list failed (${response.status})`)
  }
  return (await response.json()) as StorageListEntry[]
}

async function walkImages(prefix: string, results: string[], depth: number): Promise<void> {
  if (results.length >= MAX_PHOTOS || depth > MAX_DEPTH) return
  const entries = await listPrefix(prefix)
  for (const entry of entries) {
    if (results.length >= MAX_PHOTOS) break
    const childPath = `${prefix}${entry.name}`
    if (isImageObjectName(entry.name)) {
      results.push(childPath)
      continue
    }
    const isFolder = entry.id === null || entry.metadata == null
    if (isFolder) await walkImages(`${childPath}/`, results, depth + 1)
  }
}

function addPhoto(photos: QaPhoto[], seen: Set<string>, photo: QaPhoto | null): void {
  if (!photo) return
  const keys = [photo.url, photo.path].filter(Boolean)
  if (keys.some((key) => seen.has(key))) return
  for (const key of keys) seen.add(key)
  photos.push(photo)
}

async function loadLinkedPhotos(schoolId: string, roomId: string, roomName: string): Promise<{
  photos: QaPhoto[]
  folderNames: string[]
}> {
  const empty = { photos: [] as QaPhoto[], folderNames: roomFolderAliases(roomId, roomName) }
  const schoolIds = schoolIdLookups(schoolId)
  let sessions: SessionRow[] = []
  for (const id of schoolIds) {
    sessions = await supabaseRestSelect<SessionRow>(
      "esa_survey_sessions",
      `school_id=eq.${encodeURIComponent(id)}&select=id`,
    )
    if (sessions.length) break
  }
  if (!sessions.length) return empty

  const aliases = new Set(roomFolderAliases(roomId, roomName))
  const sessionIds = sessions.map((session) => session.id)
  let rooms: RoomRow[] = []
  try {
    rooms = (
      await supabaseRestSelect<RoomRow>(
        "esa_survey_rooms",
        `${inFilter("survey_session_id", sessionIds)}&select=survey_session_id,room_id,room_number,school_room_number,general_photos`,
      )
    ).filter((row) => roomsShareIdentity(row, aliases))
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (!/general_photos|schema cache|PGRST204/i.test(message)) throw error
    rooms = (
      await supabaseRestSelect<RoomRow>(
        "esa_survey_rooms",
        `${inFilter("survey_session_id", sessionIds)}&select=survey_session_id,room_id,room_number,school_room_number`,
      )
    ).filter((row) => roomsShareIdentity(row, aliases))
  }
  if (!rooms.length) return empty

  const matchedRoomIds = [...new Set(rooms.map((row) => row.room_id))]
  let responses: ResponseRow[] = []
  try {
    responses = await supabaseRestSelect<ResponseRow>(
      "esa_question_responses",
      `${inFilter("survey_session_id", sessionIds)}&${inFilter("room_id", matchedRoomIds)}&select=survey_session_id,room_id,question_id,comment,photos`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (!/photos|schema cache|PGRST204/i.test(message)) throw error
    responses = await supabaseRestSelect<ResponseRow>(
      "esa_question_responses",
      `${inFilter("survey_session_id", sessionIds)}&${inFilter("room_id", matchedRoomIds)}&select=survey_session_id,room_id,question_id,comment`,
    )
  }

  const photosByKey = new Map<string, QaPhoto[]>()
  const commentCount = new Map<string, number>()
  for (const row of responses) {
    const key = `${row.survey_session_id}::${row.room_id}`
    if (row.comment?.trim()) commentCount.set(key, (commentCount.get(key) ?? 0) + 1)
    for (const url of photoUrlsFromValue(row.photos)) {
      const photo = linkedPhotoFromUrl({
        url,
        questionId: row.question_id,
        roomId: row.room_id,
        bucket: photosBucket(),
      })
      if (!photo) continue
      const list = photosByKey.get(key) ?? []
      list.push(photo)
      photosByKey.set(key, list)
    }
  }

  function score(room: RoomRow) {
    const key = `${room.survey_session_id}::${room.room_id}`
    return (
      (photosByKey.get(key)?.length ?? 0) * 10 +
      photoUrlsFromValue(room.general_photos).length * 8 +
      (commentCount.get(key) ?? 0)
    )
  }

  const bestRoom = rooms.reduce((best, room) => (score(room) > score(best) ? room : best), rooms[0]!)
  const bestKey = `${bestRoom.survey_session_id}::${bestRoom.room_id}`
  const photos: QaPhoto[] = []
  const seen = new Set<string>()
  for (const photo of photosByKey.get(bestKey) ?? []) addPhoto(photos, seen, photo)
  for (const url of photoUrlsFromValue(bestRoom.general_photos)) {
    addPhoto(
      photos,
      seen,
      linkedPhotoFromUrl({
        url,
        questionId: null,
        roomId: bestRoom.room_id,
        bucket: photosBucket(),
      }),
    )
  }

  return {
    photos,
    folderNames: roomFolderAliases(
      roomId,
      roomName,
      bestRoom.room_id,
      bestRoom.room_number,
      bestRoom.school_room_number,
    ),
  }
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const campusId = params.get("campusId")?.trim() ?? ""
    const schoolId = params.get("schoolId")?.trim() ?? ""
    const roomId = params.get("roomId")?.trim() ?? ""
    const roomName = params.get("roomName")?.trim() ?? ""
    if (!campusId || !schoolId || !roomId) {
      return NextResponse.json({ error: "campusId, schoolId, and roomId are required" }, { status: 400 })
    }

    let linked: { photos: QaPhoto[]; folderNames: string[] }
    try {
      linked = await loadLinkedPhotos(schoolId, roomId, roomName)
    } catch {
      linked = { photos: [], folderNames: roomFolderAliases(roomId, roomName) }
    }
    const photos = [...linked.photos]
    const seen = new Set(photos.flatMap((photo) => [photo.url, photo.path].filter(Boolean)))
    const prefixes = []
    const seenPrefix = new Set<string>()
    for (const nextCampus of campusIdLookups(campusId)) {
      for (const nextSchool of schoolIdLookups(schoolId)) {
        const key = `${nextCampus}::${nextSchool}`
        if (seenPrefix.has(key)) continue
        seenPrefix.add(key)
        prefixes.push({ campusId: nextCampus, schoolId: nextSchool })
      }
    }

    const aliases = linked.folderNames
    for (const prefix of prefixes) {
      const root = `${sanitizePhotoSegment(prefix.campusId)}/${sanitizePhotoSegment(prefix.schoolId)}/`
      const surveyFolders = await listPrefix(root)
      for (const survey of surveyFolders) {
        if (survey.id !== null && survey.metadata != null) continue
        if (isImageObjectName(survey.name)) continue
        for (const alias of aliases) {
          const roomPrefix = `${root}${survey.name}/${sanitizePhotoSegment(alias)}/`
          const paths: string[] = []
          await walkImages(roomPrefix, paths, 0)
          for (const path of paths) {
            const parsed = parseSurveyPhotoPath(path, publicUrl(path))
            if (!parsed) continue
            addPhoto(photos, seen, parsed)
          }
        }
      }
    }

    return NextResponse.json({ roomId, photos })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load photos"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
