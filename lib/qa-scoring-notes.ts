import { isTestHandoffSchoolId } from "@/lib/qa-handoff"

export const OVERALL_NOTE_TOPIC = "overall"
export const QUESTION_NOTE_PREFIX = "question:"
export type QaNoteStream = "internal" | "aisd"

export function isQaNoteStream(value: unknown): value is QaNoteStream {
  return value === "internal" || value === "aisd"
}

export function inferNoteStream(schoolId: string, comment?: { stream?: string | null }): QaNoteStream {
  if (isQaNoteStream(comment?.stream)) return comment.stream
  return isTestHandoffSchoolId(schoolId) ? "aisd" : "internal"
}

export function notesForStream(notes: QaScoringNotes, stream: QaNoteStream): QaScoringNotes {
  const threads: Record<string, QaScoringComment[]> = {}
  for (const [topic, comments] of Object.entries(notes.threads)) {
    const kept = comments.filter((comment) => inferNoteStream(notes.schoolId, comment) === stream)
    if (kept.length) threads[topic] = kept
  }
  return { ...notes, threads }
}

export function questionNoteTopic(roomId: string, questionId: string): string {
  return `${QUESTION_NOTE_PREFIX}${roomId}::${questionId}`
}

export function isQuestionNoteTopic(topic: string): boolean {
  return topic.startsWith(QUESTION_NOTE_PREFIX)
}

export function parseQuestionNoteTopic(topic: string): { roomId: string; questionId: string } | null {
  if (!isQuestionNoteTopic(topic)) return null
  const rest = topic.slice(QUESTION_NOTE_PREFIX.length)
  const index = rest.indexOf("::")
  if (index <= 0) return null
  return { roomId: rest.slice(0, index), questionId: rest.slice(index + 2) }
}

export function notesHaveComments(notes: QaScoringNotes): boolean {
  return Object.values(notes.threads).some((comments) => comments.some((comment) => comment.text.trim()))
}

export function questionCommentEntries(notes: QaScoringNotes): Array<{
  topic: string
  roomId: string
  questionId: string
  comments: QaScoringComment[]
}> {
  return Object.entries(notes.threads).flatMap(([topic, comments]) => {
    const parsed = parseQuestionNoteTopic(topic)
    if (!parsed || !comments.length) return []
    return [{ topic, roomId: parsed.roomId, questionId: parsed.questionId, comments }]
  })
}

const MENTION_PATTERN = /@[A-Za-z][A-Za-z0-9._-]*/g

function isMentionStart(text: string, index: number): boolean {
  if (index <= 0) return true
  return !/[A-Za-z0-9.]/.test(text[index - 1] ?? "")
}

export function extractMentions(text: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const re = new RegExp(MENTION_PATTERN.source, "g")
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (!isMentionStart(text, match.index)) continue
    const name = match[0].slice(1)
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    found.push(name)
  }
  return found
}

export function mentionKey(name: string): string {
  return name.trim().replace(/^@/, "").toLowerCase()
}

export type CommentTextPart = { type: "text" | "mention"; value: string }

export function commentTextParts(text: string): CommentTextPart[] {
  const parts: CommentTextPart[] = []
  const re = new RegExp(MENTION_PATTERN.source, "g")
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (!isMentionStart(text, match.index)) continue
    if (match.index > last) parts.push({ type: "text", value: text.slice(last, match.index) })
    parts.push({ type: "mention", value: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) })
  if (!parts.length) parts.push({ type: "text", value: text })
  return parts
}

export function topicLocationLabel(topic: string): string {
  if (topic === OVERALL_NOTE_TOPIC) return "Overall ESA"
  const parsed = parseQuestionNoteTopic(topic)
  if (parsed) return `${parsed.roomId} · ${parsed.questionId}`
  return topic
}

export interface QaMentionHit {
  schoolId: string
  topic: string
  location: string
  roomId?: string
  questionId?: string
  comment: QaScoringComment
  mentions: string[]
}

export function mentionHitsFromNotes(allNotes: QaScoringNotes[], stream?: QaNoteStream): QaMentionHit[] {
  const hits: QaMentionHit[] = []
  for (const notes of allNotes) {
    for (const [topic, comments] of Object.entries(notes.threads)) {
      const parsed = parseQuestionNoteTopic(topic)
      for (const comment of comments) {
        if (stream && inferNoteStream(notes.schoolId, comment) !== stream) continue
        const mentions = extractMentions(comment.text)
        if (!mentions.length) continue
        hits.push({
          schoolId: notes.schoolId,
          topic,
          location: topicLocationLabel(topic),
          roomId: parsed?.roomId,
          questionId: parsed?.questionId,
          comment,
          mentions,
        })
      }
    }
  }
  return hits.sort((a, b) => b.comment.createdAt.localeCompare(a.comment.createdAt))
}

export interface QaScoringComment {
  id: string
  author: string
  text: string
  createdAt: string
  stream?: QaNoteStream
}

export interface QaScoringNotes {
  schoolId: string
  threads: Record<string, QaScoringComment[]>
  author: string
  updatedAt: string | null
}

export function emptyScoringNotes(schoolId = ""): QaScoringNotes {
  return { schoolId, threads: {}, author: "", updatedAt: null }
}

function isComment(value: unknown): value is QaScoringComment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.text === "string" && typeof item.author === "string"
}

function commentFromUnknown(
  value: unknown,
  fallbackAuthor: string,
  fallbackAt: string | null,
): QaScoringComment | null {
  if (!isComment(value)) return null
  const text = value.text.trim()
  if (!text) return null
  const item = value as QaScoringComment
  return {
    id: typeof item.id === "string" && item.id ? item.id : `legacy-${text.slice(0, 24)}`,
    author: item.author.trim() || fallbackAuthor || "Previous note",
    text,
    createdAt:
      typeof item.createdAt === "string" && item.createdAt
        ? item.createdAt
        : fallbackAt || new Date().toISOString(),
    stream: isQaNoteStream(item.stream) ? item.stream : undefined,
  }
}

function commentsFromUnknown(
  value: unknown,
  fallbackAuthor: string,
  fallbackAt: string | null,
): QaScoringComment[] {
  if (typeof value === "string") {
    const text = value.trim()
    if (!text) return []
    return [
      {
        id: `legacy-${text.slice(0, 24)}`,
        author: fallbackAuthor || "Previous note",
        text,
        createdAt: fallbackAt || new Date().toISOString(),
      },
    ]
  }
  if (!Array.isArray(value)) return []
  return value
    .map((item) => commentFromUnknown(item, fallbackAuthor, fallbackAt))
    .filter((item): item is QaScoringComment => Boolean(item))
}

export function parseScoringNotes(row: {
  school_id?: string
  schoolId?: string
  overall?: string | null
  categories?: unknown
  author?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}): QaScoringNotes {
  const schoolId = row.school_id ?? row.schoolId ?? ""
  const author = row.author?.trim() ?? ""
  const updatedAt = row.updated_at ?? row.updatedAt ?? null
  const threads: Record<string, QaScoringComment[]> = {}
  const raw = row.categories
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) && "_comments" in raw
      ? (raw as { _comments: unknown })._comments
      : raw

  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (key === "_comments") continue
      const comments = commentsFromUnknown(value, author, updatedAt)
      if (comments.length) threads[key] = comments
    }
  }

  if (!threads[OVERALL_NOTE_TOPIC]?.length && row.overall?.trim()) {
    threads[OVERALL_NOTE_TOPIC] = commentsFromUnknown(row.overall, author, updatedAt)
  }

  return { schoolId, threads, author, updatedAt }
}

export function serializeScoringNotes(notes: QaScoringNotes): {
  overall: string
  categories: Record<string, QaScoringComment[]>
} {
  return {
    overall: threadText(notes.threads[OVERALL_NOTE_TOPIC] ?? []),
    categories: notes.threads,
  }
}

export function threadText(comments: QaScoringComment[]): string {
  return comments
    .map((comment) => comment.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

function formatThread(comments: QaScoringComment[] | undefined): string {
  return (comments ?? [])
    .map((comment) => {
      const text = comment.text.trim()
      if (!text) return ""
      const author = comment.author.trim()
      return author ? `${author}: ${text}` : text
    })
    .filter(Boolean)
    .join(" ")
}

export function observationLines(notes: QaScoringNotes, categoryOrder: string[] = []): string[] {
  const used = new Set<string>([OVERALL_NOTE_TOPIC, ...categoryOrder])
  const leftover = Object.entries(notes.threads)
    .filter(
      ([label, comments]) =>
        !used.has(label) && !isQuestionNoteTopic(label) && formatThread(comments),
    )
    .map(([, comments]) => formatThread(comments))
  return [
    formatThread(notes.threads[OVERALL_NOTE_TOPIC]),
    ...categoryOrder.map((label) => formatThread(notes.threads[label])),
    ...leftover,
  ].filter(Boolean)
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string })
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`)
  }
  return data
}

export async function fetchScoringNotes(schoolId: string): Promise<QaScoringNotes> {
  if (!schoolId.trim()) return emptyScoringNotes()
  const response = await fetch(`/api/qa/scoring-notes?schoolId=${encodeURIComponent(schoolId)}`, {
    cache: "no-store",
  })
  const data = await readJson<{ notes: QaScoringNotes }>(response)
  return data.notes ?? emptyScoringNotes(schoolId)
}

export async function fetchAllScoringNotes(): Promise<QaScoringNotes[]> {
  const response = await fetch("/api/qa/scoring-notes", {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  })
  const data = await readJson<{ notes: QaScoringNotes[] }>(response)
  return data.notes ?? []
}

export async function addScoringCommentLive(input: {
  schoolId: string
  topic: string
  author: string
  text: string
  stream: QaNoteStream
}): Promise<QaScoringNotes> {
  const response = await fetch("/api/qa/scoring-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const data = await readJson<{ notes: QaScoringNotes }>(response)
  return data.notes
}
