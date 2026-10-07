import { NextResponse } from "next/server"
import { supabaseRestSelect, supabaseRestUpsert } from "@/lib/supabase-rest"
import {
  emptyScoringNotes,
  parseScoringNotes,
  serializeScoringNotes,
  type QaScoringComment,
  type QaScoringNotes,
} from "@/lib/qa-scoring-notes"

export const runtime = "nodejs"

interface NotesRow {
  school_id: string
  overall: string
  categories: unknown
  author: string
  updated_at: string
}

function toNotes(row: NotesRow): QaScoringNotes {
  return parseScoringNotes(row)
}

export async function GET(request: Request) {
  try {
    const schoolId = new URL(request.url).searchParams.get("schoolId")?.trim() ?? ""
    if (!schoolId) {
      return NextResponse.json({ error: "schoolId is required" }, { status: 400 })
    }
    const rows = await supabaseRestSelect<NotesRow>(
      "esa_qa_scoring_notes",
      `school_id=eq.${encodeURIComponent(schoolId)}&select=school_id,overall,categories,author,updated_at&limit=1`,
    )
    return NextResponse.json({ notes: rows[0] ? toNotes(rows[0]) : emptyScoringNotes(schoolId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load scoring notes"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      schoolId?: string
      author?: string
      topic?: string
      text?: string
    }
    const schoolId = body.schoolId?.trim() ?? ""
    const author = body.author?.trim() ?? ""
    const topic = body.topic?.trim() ?? ""
    const text = body.text?.trim() ?? ""
    if (!schoolId) {
      return NextResponse.json({ error: "schoolId is required" }, { status: 400 })
    }
    if (!author) {
      return NextResponse.json({ error: "Enter your name before adding a comment." }, { status: 400 })
    }
    if (!topic) {
      return NextResponse.json({ error: "A scoring topic is required." }, { status: 400 })
    }
    if (!text) {
      return NextResponse.json({ error: "Write a comment before saving." }, { status: 400 })
    }

    const existing = await supabaseRestSelect<NotesRow>(
      "esa_qa_scoring_notes",
      `school_id=eq.${encodeURIComponent(schoolId)}&select=school_id,overall,categories,author,updated_at&limit=1`,
    )
    const current = existing[0] ? toNotes(existing[0]) : emptyScoringNotes(schoolId)
    const createdAt = new Date().toISOString()
    const comment: QaScoringComment = {
      id: crypto.randomUUID(),
      author,
      text,
      createdAt,
    }
    const notes: QaScoringNotes = {
      schoolId,
      author,
      updatedAt: createdAt,
      threads: {
        ...current.threads,
        [topic]: [...(current.threads[topic] ?? []), comment],
      },
    }
    const payload = serializeScoringNotes(notes)
    const [saved] = await supabaseRestUpsert<NotesRow>(
      "esa_qa_scoring_notes",
      [
        {
          school_id: schoolId,
          overall: payload.overall,
          categories: payload.categories,
          author,
          updated_at: createdAt,
        },
      ],
      "school_id",
    )
    return NextResponse.json({ notes: saved ? toNotes(saved) : notes })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save scoring notes"
    const status = message.includes("not configured") || message.includes("Add SUPABASE") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
