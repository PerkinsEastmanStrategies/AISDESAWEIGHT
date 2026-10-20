"use client"

import { useEffect, useMemo, useState } from "react"
import { AtSign } from "lucide-react"
import { CommentText } from "@/components/comment-text"
import { formatEditTimestamp } from "@/lib/qa-edits"
import { baseSchoolIdFromHandoff, type QaHandoff } from "@/lib/qa-handoff"
import {
  fetchAllScoringNotes,
  mentionHitsFromNotes,
  mentionKey,
  type QaMentionHit,
  type QaNoteStream,
} from "@/lib/qa-scoring-notes"
import { optionLevel } from "@/lib/school-catalog"
import type { SchoolIndexEntry, SchoolLevel } from "@/lib/types"

function mentionLevels(stream: QaNoteStream, schoolLevel: SchoolLevel): SchoolLevel[] {
  if (stream === "internal" && schoolLevel !== "ES") return ["MS", "HS"]
  return [schoolLevel]
}

export function QaMentionsPanel({
  catalog,
  handoffs,
  stream,
  schoolLevel,
  onOpenSchool,
}: {
  catalog: SchoolIndexEntry[]
  handoffs: QaHandoff[]
  stream: QaNoteStream
  schoolLevel: SchoolLevel
  onOpenSchool: (schoolId: string) => void
}) {
  const [hits, setHits] = useState<QaMentionHit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load(background = false) {
      try {
        const notes = await fetchAllScoringNotes()
        if (cancelled) return
        setHits(mentionHitsFromNotes(notes, stream))
        if (!background) setError(null)
      } catch (caught) {
        if (!cancelled && !background) {
          setError(caught instanceof Error ? caught.message : "Could not load tagged comments")
        }
      } finally {
        if (!cancelled && !background) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [stream])

  const levelHits = useMemo(() => {
    if (stream !== "internal") return hits
    const allowed = new Set(mentionLevels(stream, schoolLevel))
    return hits.filter((hit) => {
      const base = baseSchoolIdFromHandoff(hit.schoolId)
      const school =
        catalog.find((item) => item.schoolId === hit.schoolId) ??
        catalog.find((item) => item.schoolId === base)
      if (!school) return false
      return allowed.has(optionLevel(school))
    })
  }, [catalog, hits, schoolLevel, stream])

  const names = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const hit of levelHits) {
      for (const name of hit.mentions) {
        const key = mentionKey(name)
        if (!byKey.has(key)) byKey.set(key, name)
      }
    }
    return [...byKey.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
      .map(([key, label]) => ({ key, label }))
  }, [levelHits])

  const visible = useMemo(() => {
    if (!filter) return levelHits
    return levelHits.filter((hit) => hit.mentions.some((name) => mentionKey(name) === filter))
  }, [levelHits, filter])

  function schoolName(schoolId: string) {
    const handoff = handoffs.find((item) => item.schoolId === schoolId)
    if (handoff?.schoolName.trim()) return handoff.schoolName
    const base = baseSchoolIdFromHandoff(schoolId)
    return (
      catalog.find((school) => school.schoolId === schoolId)?.schoolName ??
      catalog.find((school) => school.schoolId === base)?.schoolName ??
      schoolId
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start gap-2">
          <AtSign className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Tagged comments</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {stream === "aisd"
                ? "Comments tagged with @name in AISD QA only. Filter by tagged person."
                : schoolLevel === "ES"
                  ? "Elementary Internal QA tags only. Filter by tagged person."
                  : "Middle and high school Internal QA tags. Filter by tagged person."}
            </p>
          </div>
        </div>
        {names.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFilter("")}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                !filter
                  ? "bg-amber-800 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              All ({levelHits.length})
            </button>
            {names.map((name) => {
              const count = levelHits.filter((hit) =>
                hit.mentions.some((mention) => mentionKey(mention) === name.key),
              ).length
              return (
                <button
                  key={name.key}
                  type="button"
                  onClick={() => setFilter(name.key)}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                    filter === name.key
                      ? "bg-amber-800 text-white"
                      : "bg-amber-50 text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
                  }`}
                >
                  @{name.label} ({count})
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-500">Loading tagged comments…</p> : null}
      {!loading && !visible.length ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-sm font-medium text-slate-900">No tagged comments yet</p>
          <p className="mt-1 text-sm text-slate-500">
            {stream === "internal" && schoolLevel === "ES"
              ? "No elementary Internal QA tags yet. Type @name in a note on an elementary campus."
              : stream === "internal"
                ? "No middle or high school Internal QA tags yet. Type @name in a note on those campuses."
                : "Type @name in a question or campus note, then it will show up here."}
          </p>
        </div>
      ) : null}

      {visible.length ? (
        <ul className="space-y-3">
          {visible.map((hit) => (
            <li key={`${hit.schoolId}-${hit.topic}-${hit.comment.id}`}>
              <button
                type="button"
                onClick={() => onOpenSchool(hit.schoolId)}
                className="w-full rounded-2xl border border-amber-100 bg-white p-4 text-left shadow-sm hover:bg-amber-50/50"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-slate-900">{schoolName(hit.schoolId)}</p>
                  <p className="text-[11px] text-slate-400">{formatEditTimestamp(hit.comment.createdAt)}</p>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{hit.location}</p>
                <p className="mt-2 text-xs font-semibold text-slate-500">{hit.comment.author}</p>
                <p className="mt-1">
                  <CommentText text={hit.comment.text} />
                </p>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
