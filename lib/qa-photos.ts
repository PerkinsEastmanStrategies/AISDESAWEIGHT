export interface QaPhoto {
  path: string
  url: string
  campusId: string
  schoolId: string
  surveyType: string
  roomId: string
  kind: "prewalk" | "question"
  questionId: string | null
  photoId: string | null
}

const QUESTION_ID_PATTERN = /^[A-Z]{1,5}-\d{3}/i
const GENERAL_QUESTION_IDS = new Set(["_", "general", "prewalk"])

export function sanitizePhotoSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "unknown"
  )
}

export function isImageObjectName(name: string): boolean {
  return /\.jpe?g$/i.test(name)
}

export function isQuestionPhotoId(questionId: string | null | undefined): boolean {
  const id = String(questionId ?? "").trim()
  if (!id || GENERAL_QUESTION_IDS.has(id.toLowerCase())) return false
  return QUESTION_ID_PATTERN.test(id)
}

export function photoUrlsFromValue(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value]
  const urls: string[] = []
  for (const item of values) {
    const url = String(item ?? "").trim()
    if (!url || url.startsWith("data:")) continue
    if (!urls.includes(url)) urls.push(url)
  }
  return urls
}

export function storagePathFromPublicUrl(url: string, bucket: string): string | null {
  const trimmed = url.trim()
  if (!trimmed.startsWith("http")) return null
  const markers = [
    `/object/public/${encodeURIComponent(bucket)}/`,
    `/object/public/${bucket}/`,
  ]
  for (const marker of markers) {
    const index = trimmed.indexOf(marker)
    if (index < 0) continue
    try {
      return decodeURIComponent(trimmed.slice(index + marker.length))
    } catch {
      return trimmed.slice(index + marker.length)
    }
  }
  return null
}

export function parseSurveyPhotoPath(path: string, publicUrl: string): QaPhoto | null {
  const trimmed = path.trim().replace(/^\/+/, "")
  if (!isImageObjectName(trimmed)) return null
  const segments = trimmed.split("/").filter(Boolean)
  if (segments.length < 4) return null

  const [campusId, schoolId, surveyType, fourth] = segments

  if (segments.length >= 6 && segments[4] === "prewalk") {
    const roomId = fourth
    const photoId = segments.length >= 7 ? segments[6].replace(/\.jpe?g$/i, "") : null
    if (!roomId) return null
    return {
      path: trimmed,
      url: publicUrl,
      campusId,
      schoolId,
      surveyType,
      roomId,
      kind: "prewalk",
      questionId: null,
      photoId,
    }
  }

  if (fourth === "prewalk") {
    return {
      path: trimmed,
      url: publicUrl,
      campusId,
      schoolId,
      surveyType,
      roomId: "",
      kind: "prewalk",
      questionId: null,
      photoId: segments[5]?.replace(/\.jpe?g$/i, "") ?? null,
    }
  }

  if (segments.length < 5) return null
  const roomId = fourth

  if (segments.length >= 6) {
    const questionId = segments[4]
    const photoId = segments[5].replace(/\.jpe?g$/i, "")
    if (!roomId || !questionId || !photoId) return null
    if (!isQuestionPhotoId(questionId)) {
      return {
        path: trimmed,
        url: publicUrl,
        campusId,
        schoolId,
        surveyType,
        roomId,
        kind: "prewalk",
        questionId: null,
        photoId,
      }
    }
    return {
      path: trimmed,
      url: publicUrl,
      campusId,
      schoolId,
      surveyType,
      roomId,
      kind: "question",
      questionId,
      photoId,
    }
  }

  const questionId = segments.slice(4).join("/").replace(/\.jpe?g$/i, "")
  if (!roomId || !questionId) return null
  if (!isQuestionPhotoId(questionId)) {
    return {
      path: trimmed,
      url: publicUrl,
      campusId,
      schoolId,
      surveyType,
      roomId,
      kind: "prewalk",
      questionId: null,
      photoId: null,
    }
  }
  return {
    path: trimmed,
    url: publicUrl,
    campusId,
    schoolId,
    surveyType,
    roomId,
    kind: "question",
    questionId,
    photoId: null,
  }
}

export function linkedPhotoFromUrl(input: {
  url: string
  questionId?: string | null
  roomId?: string
  bucket: string
}): QaPhoto | null {
  const url = input.url.trim()
  if (!url) return null
  const path = storagePathFromPublicUrl(url, input.bucket) ?? url
  const parsed = path !== url ? parseSurveyPhotoPath(path, url) : null
  const questionId = isQuestionPhotoId(input.questionId) ? input.questionId!.trim() : null
  if (questionId) {
    return {
      path: parsed?.path ?? path,
      url,
      campusId: parsed?.campusId ?? "",
      schoolId: parsed?.schoolId ?? "",
      surveyType: parsed?.surveyType ?? "",
      roomId: parsed?.roomId || input.roomId || "",
      kind: "question",
      questionId,
      photoId: parsed?.photoId ?? null,
    }
  }
  return {
    path: parsed?.path ?? path,
    url,
    campusId: parsed?.campusId ?? "",
    schoolId: parsed?.schoolId ?? "",
    surveyType: parsed?.surveyType ?? "",
    roomId: parsed?.roomId || input.roomId || "",
    kind: "prewalk",
    questionId: null,
    photoId: parsed?.photoId ?? null,
  }
}

export function roomFolderAliases(...values: Array<string | null | undefined>): string[] {
  const aliases = new Set<string>()
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    aliases.add(trimmed)
    aliases.add(sanitizePhotoSegment(trimmed))
    aliases.add(trimmed.replace(/\s+/g, ""))
    aliases.add(trimmed.replace(/_/g, " "))
  }
  return [...aliases].filter(Boolean)
}

export function roomsShareIdentity(
  row: { room_id: string; room_number: string | null; school_room_number: string | null },
  aliases: Set<string>,
): boolean {
  return [row.room_id, row.room_number, row.school_room_number].some((value) => {
    const trimmed = value?.trim()
    if (!trimmed) return false
    return aliases.has(trimmed) || aliases.has(sanitizePhotoSegment(trimmed))
  })
}
