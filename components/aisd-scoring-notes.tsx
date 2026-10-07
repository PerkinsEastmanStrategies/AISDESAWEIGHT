"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { StickyNote } from "lucide-react"
import { ScoreBadge } from "@/components/score-badge"
import { formatEditTimestamp, loadSavedEditorName, saveEditorName } from "@/lib/qa-edits"
import {
  OVERALL_NOTE_TOPIC,
  addScoringCommentLive,
  emptyScoringNotes,
  fetchScoringNotes,
  type QaScoringComment,
  type QaScoringNotes,
} from "@/lib/qa-scoring-notes"
import { isHiddenReportLabel } from "@/lib/report"
import type { ScoreNode } from "@/lib/types"

function CommentList({ comments }: { comments: QaScoringComment[] }) {
  if (!comments.length) {
    return <p className="text-xs text-slate-500">No comments yet. Add the first one below.</p>
  }
  return (
    <ul className="space-y-2">
      {comments.map((comment) => (
        <li key={comment.id} className="rounded-xl border border-amber-100 bg-white px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-sm font-semibold text-slate-900">{comment.author}</p>
            <p className="text-[11px] text-slate-400">{formatEditTimestamp(comment.createdAt)}</p>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{comment.text}</p>
        </li>
      ))}
    </ul>
  )
}

export function AisdScoringNotes({
  schoolId,
  overallScore,
  focusAreas,
}: {
  schoolId: string
  overallScore: number | null
  focusAreas: ScoreNode[]
}) {
  const scoringFocusAreas = useMemo(
    () => focusAreas.filter((area) => !isHiddenReportLabel(area.label)),
    [focusAreas],
  )
  const [notes, setNotes] = useState<QaScoringNotes>(emptyScoringNotes(schoolId))
  const [author, setAuthor] = useState(loadSavedEditorName())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [savingTopic, setSavingTopic] = useState<string | null>(null)
  const savingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setNotes(emptyScoringNotes(schoolId))
    setAuthor(loadSavedEditorName())
    setDrafts({})
    setError(null)
    setSavingTopic(null)
    savingRef.current = false

    async function load(background = false) {
      try {
        const loaded = await fetchScoringNotes(schoolId)
        if (cancelled || savingRef.current) return
        setNotes(loaded)
        if (loaded.author && !loadSavedEditorName()) setAuthor(loaded.author)
        if (!background) setError(null)
      } catch (caught) {
        if (!cancelled && !background) {
          setError(caught instanceof Error ? caught.message : "Could not load scoring notes")
        }
      }
    }

    void load()
    const timer = window.setInterval(() => {
      void load(true)
    }, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [schoolId])

  async function addComment(topic: string) {
    const name = author.trim()
    const text = (drafts[topic] ?? "").trim()
    if (!name) {
      setError("Enter your name so others can see who wrote the comment.")
      return
    }
    if (!text) {
      setError("Write a comment before saving.")
      return
    }
    saveEditorName(name)
    savingRef.current = true
    setSavingTopic(topic)
    setError(null)
    try {
      const saved = await addScoringCommentLive({ schoolId, topic, author: name, text })
      setNotes(saved)
      setDrafts((current) => ({ ...current, [topic]: "" }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save scoring notes")
    } finally {
      savingRef.current = false
      setSavingTopic(null)
    }
  }

  const topics = [
    { id: OVERALL_NOTE_TOPIC, label: "Notes about the overall ESA", score: overallScore },
    ...scoringFocusAreas.map((area) => ({ id: area.label, label: area.label, score: area.score })),
  ]

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex items-start gap-2">
        <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
        <div>
          <h4 className="text-sm font-semibold text-slate-900">AISD scoring notes</h4>
          <p className="mt-0.5 text-xs text-slate-600">
            Anyone on AISD QA can add a comment. Existing comments stay visible, including other
            reviewers. These also fill Observations 1–3 on the report.
          </p>
        </div>
      </div>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Your name
        </span>
        <input
          type="text"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          placeholder="Full name"
          className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-600/10"
        />
      </label>

      <div className="mt-4 space-y-4">
        {topics.map((topic) => (
          <section key={topic.id} className="rounded-xl border border-amber-100 bg-amber-50/40 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h5 className="text-xs font-semibold text-slate-600">{topic.label}</h5>
              <ScoreBadge score={topic.score} />
            </div>
            <CommentList comments={notes.threads[topic.id] ?? []} />
            <textarea
              value={drafts[topic.id] ?? ""}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [topic.id]: event.target.value }))
              }
              rows={2}
              placeholder="Add a comment"
              className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-600/10"
            />
            <button
              type="button"
              onClick={() => void addComment(topic.id)}
              disabled={savingTopic === topic.id}
              className="mt-2 inline-flex items-center justify-center rounded-xl bg-amber-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:bg-amber-300"
            >
              {savingTopic === topic.id ? "Saving…" : "Add comment"}
            </button>
          </section>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
    </div>
  )
}
