"use client"

import { useEffect, useState } from "react"
import { CommentText } from "@/components/comment-text"
import { formatEditTimestamp } from "@/lib/qa-edits"
import { formatHandoffTimestamp, type QaHandoff } from "@/lib/qa-handoff"
import {
  OVERALL_NOTE_TOPIC,
  emptyScoringNotes,
  fetchScoringNotes,
  isQuestionNoteTopic,
  notesForStream,
  parseQuestionNoteTopic,
  type QaScoringComment,
  type QaScoringNotes,
} from "@/lib/qa-scoring-notes"
import type { SchoolSnapshot } from "@/lib/types"

function CommentBlock({ comments }: { comments: QaScoringComment[] }) {
  return (
    <ul className="space-y-2">
      {comments.map((comment) => (
        <li key={comment.id} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-semibold text-slate-900">{comment.author}</p>
            <p className="text-[11px] text-slate-400">{formatEditTimestamp(comment.createdAt)}</p>
          </div>
          <p className="mt-1">
            <CommentText text={comment.text} />
          </p>
        </li>
      ))}
    </ul>
  )
}

export function AisdFeedbackPanel({
  schoolName,
  schoolId,
  snapshot,
  handoff,
}: {
  schoolName: string
  schoolId: string
  snapshot?: SchoolSnapshot
  handoff?: QaHandoff
}) {
  const [notes, setNotes] = useState<QaScoringNotes>(emptyScoringNotes(schoolId))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setNotes(emptyScoringNotes(schoolId))
    fetchScoringNotes(schoolId)
      .then((loaded) => {
        if (cancelled) return
        setNotes(notesForStream(loaded, "aisd"))
        setError(null)
      })
      .catch((caught) => {
        if (cancelled) return
        setError(caught instanceof Error ? caught.message : "Could not load AISD comments")
      })
    return () => {
      cancelled = true
    }
  }, [schoolId])

  const threads = notes.threads
  const overall = threads[OVERALL_NOTE_TOPIC] ?? []
  const questionEntries = Object.entries(threads).filter(([topic]) => isQuestionNoteTopic(topic))
  const focusEntries = Object.entries(threads).filter(
    ([topic, comments]) => topic !== OVERALL_NOTE_TOPIC && !isQuestionNoteTopic(topic) && comments.length,
  )

  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{schoolName}</h3>
          <p className="text-xs text-slate-500">
            Moved to Feedback
            {handoff?.decisionBy ? ` by ${handoff.decisionBy}` : ""}
            {handoff?.decisionAt ? ` · ${formatHandoffTimestamp(handoff.decisionAt)}` : ""}
          </p>
        </div>
        {notes.updatedAt ? (
          <p className="text-[11px] text-slate-400">Updated {formatEditTimestamp(notes.updatedAt)}</p>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

      {handoff?.decisionComments ? (
        <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-900">Move notes</h4>
          <p className="mt-1 text-sm text-slate-800">{handoff.decisionComments}</p>
        </section>
      ) : null}

      <section className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">General notes</h4>
        {overall.length ? (
          <div className="mt-2">
            <p className="mb-1 text-sm font-medium text-slate-700">Overall ESA</p>
            <CommentBlock comments={overall} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No overall notes.</p>
        )}
        {focusEntries.map(([label, comments]) => (
          <div key={label} className="mt-3">
            <p className="mb-1 text-sm font-medium text-slate-700">{label}</p>
            <CommentBlock comments={comments} />
          </div>
        ))}
      </section>

      <section className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question comments</h4>
        {questionEntries.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No question-level comments.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {questionEntries.map(([topic, comments]) => {
              const parsed = parseQuestionNoteTopic(topic)
              const room = parsed
                ? snapshot?.rooms.find((item) => item.roomId === parsed.roomId)
                : undefined
              const unit = parsed
                ? room?.units.find((item) => item.questionId === parsed.questionId)
                : undefined
              return (
                <li key={topic} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {room?.roomName ?? parsed?.roomId ?? "Room"}
                    {room?.spaceType ? ` · ${room.spaceType}` : ""}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-700">
                    {unit?.question ?? parsed?.questionId ?? topic}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-400">{parsed?.questionId}</p>
                  <div className="mt-2">
                    <CommentBlock comments={comments} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </article>
  )
}
