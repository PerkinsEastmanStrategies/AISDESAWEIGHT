import { NextResponse } from "next/server"

export const runtime = "nodejs"

const DEFAULT_PHOTOS_BUCKET = "ESA Pictures"
const MAX_PHOTOS = 80
const MAX_DEPTH = 6

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

function sanitize(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "unknown"
  )
}

function publicUrl(path: string): string {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `${supabaseUrl()}/storage/v1/object/public/${encodeURIComponent(photosBucket())}/${encodedPath}`
}

function sourceCampusId(campusId: string): string {
  return campusId.replace(/-(PILOT(?:-\d+)?(?:-MERGE)?|TEST)$/i, "")
}

function roomAliases(roomId: string, roomName: string): string[] {
  const values = [roomId, roomName]
  const aliases = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    aliases.add(trimmed)
    aliases.add(sanitize(trimmed))
    aliases.add(trimmed.replace(/\s+/g, ""))
    const parent = trimmed.replace(/\.\d+[A-Z]?$/i, "")
    if (parent && parent !== trimmed) {
      aliases.add(parent)
      aliases.add(sanitize(parent))
    }
  }
  return [...aliases].filter(Boolean)
}

interface StorageListEntry {
  name: string
  id: string | null
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

async function walkJpegs(prefix: string, results: string[], depth: number): Promise<void> {
  if (results.length >= MAX_PHOTOS || depth > MAX_DEPTH) return
  const entries = await listPrefix(prefix)
  for (const entry of entries) {
    if (results.length >= MAX_PHOTOS) break
    const childPath = `${prefix}${entry.name}`
    const isFolder = entry.id === null
    if (!isFolder && entry.name.toLowerCase().endsWith(".jpg")) {
      results.push(childPath)
      continue
    }
    if (isFolder) await walkJpegs(`${childPath}/`, results, depth + 1)
  }
}

function parsePhoto(path: string) {
  const segments = path.replace(/^\/+/, "").split("/").filter(Boolean)
  if (segments.length < 5 || !path.toLowerCase().endsWith(".jpg")) return null
  const [campusId, schoolId, surveyType, roomId, ...rest] = segments
  const last = rest[rest.length - 1]?.replace(/\.jpg$/i, "") ?? ""
  const isPrewalk = rest[0] === "prewalk"
  return {
    path,
    url: publicUrl(path),
    campusId,
    schoolId,
    surveyType,
    roomId,
    kind: isPrewalk ? "prewalk" : "question",
    questionId: isPrewalk ? null : rest[0]?.replace(/\.jpg$/i, "") ?? null,
    photoId: rest.length > 1 ? last : null,
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

    const prefixes = [{ campusId, schoolId }]
    const sourceId = sourceCampusId(campusId)
    if (sourceId !== campusId) prefixes.push({ campusId: sourceId, schoolId })

    const aliases = roomAliases(roomId, roomName)
    const seen = new Set<string>()
    const photos = []

    for (const prefix of prefixes) {
      const root = `${sanitize(prefix.campusId)}/${sanitize(prefix.schoolId)}/`
      const surveyFolders = await listPrefix(root)
      for (const survey of surveyFolders) {
        if (survey.id !== null) continue
        for (const alias of aliases) {
          const roomPrefix = `${root}${survey.name}/${sanitize(alias)}/`
          const paths: string[] = []
          await walkJpegs(roomPrefix, paths, 0)
          for (const path of paths) {
            if (seen.has(path)) continue
            const parsed = parsePhoto(path)
            if (!parsed) continue
            seen.add(path)
            photos.push(parsed)
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
