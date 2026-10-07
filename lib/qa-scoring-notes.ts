export const OVERALL_NOTE_TOPIC = "overall"

export interface QaScoringComment {
  id: string
  author: string
  text: string
  createdAt: string
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
  return {
    id: typeof value.id === "string" && value.id ? value.id : `legacy-${text.slice(0, 24)}`,
    author: value.author.trim() || fallbackAuthor || "Previous note",
    text,
    createdAt:
      typeof value.createdAt === "string" && value.createdAt
        ? value.createdAt
        : fallbackAt || new Date().toISOString(),
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
    .filter(([label, comments]) => !used.has(label) && formatThread(comments))
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
  const response = await fetch(`/api/qa/scoring-notes?schoolId=${encodeURIComponent(schoolId)}`, {
    cache: "no-store",
  })
  const data = await readJson<{ notes: QaScoringNotes }>(response)
  return data.notes ?? emptyScoringNotes(schoolId)
}

export async function addScoringCommentLive(input: {
  schoolId: string
  topic: string
  author: string
  text: string
}): Promise<QaScoringNotes> {
  const response = await fetch("/api/qa/scoring-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const data = await readJson<{ notes: QaScoringNotes }>(response)
  return data.notes
}
