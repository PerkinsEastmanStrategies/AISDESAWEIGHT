"use client"

import { formatEditTimestamp } from "@/lib/qa-edits"
import type { QaScoringComment } from "@/lib/qa-scoring-notes"

export function ScoringNoteThread({
  title,
  comments,
  draft,
  onDraftChange,
  onAdd,
  saving = false,
  placeholder = "Add a comment",
}: {
  title?: string
  comments: QaScoringComment[]
  draft: string
  onDraftChange: (value: string) => void
  onAdd: () => void
  saving?: boolean
  placeholder?: string
}) {
  return (
    <div>
      {title ? <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p> : null}
      {comments.length ? (
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
      ) : (
        <p className="text-xs text-slate-500">No comments yet. Add the first one below.</p>
      )}
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        rows={2}
        placeholder={placeholder}
        className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-600/10"
      />
      <button
        type="button"
        onClick={onAdd}
        disabled={saving}
        className="mt-2 inline-flex items-center justify-center rounded-xl bg-amber-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:bg-amber-300"
      >
        {saving ? "Saving…" : "Add comment"}
      </button>
    </div>
  )
}
