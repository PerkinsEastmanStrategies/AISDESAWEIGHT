"use client"

import { useEffect, useState } from "react"
import { Check } from "lucide-react"
import { formatEditTimestamp, loadSavedEditorName } from "@/lib/qa-edits"

export interface PendingQuestionEdit {
  questionId: string
  question: string
  isMulti: boolean
  options: string[]
  previous: string[]
  selected: string[]
}

export function QaQuestionEditDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingQuestionEdit
  onCancel: () => void
  onConfirm: (input: { editor: string; reason: string; selected: string[] }) => void
}) {
  const [editor, setEditor] = useState(loadSavedEditorName())
  const [reason, setReason] = useState("")
  const [selected, setSelected] = useState<string[]>(pending.selected)
  const [error, setError] = useState("")
  const stampedAt = formatEditTimestamp(new Date().toISOString())

  useEffect(() => {
    setEditor(loadSavedEditorName())
    setReason("")
    setSelected(pending.selected)
    setError("")
  }, [pending])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel])

  function toggle(label: string) {
    setSelected((current) => {
      if (pending.isMulti) {
        return current.includes(label) ? current.filter((item) => item !== label) : [...current, label]
      }
      return [label]
    })
  }

  function confirm() {
    const name = editor.trim()
    const why = reason.trim()
    if (!name || !why) {
      setError("Enter who is making the edit and a reason for this question.")
      return
    }
    onConfirm({ editor: name, reason: why, selected })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-labelledby="qa-edit-title"
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">Edit this question</p>
        <h3 id="qa-edit-title" className="mt-2 text-base font-semibold leading-snug text-slate-900">
          {pending.question}
        </h3>
        <p className="mt-1 font-mono text-[11px] text-slate-400">{pending.questionId}</p>
        <p className="mt-3 text-xs text-slate-500">
          Timestamp {stampedAt}. This stays in the browser until ESA save is connected.
        </p>

        <div className="mt-4 space-y-2">
          {pending.options.map((label) => {
            const on = selected.includes(label)
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggle(label)}
                className={`relative flex w-full min-h-11 items-center rounded-xl border px-3 py-2 text-left text-sm ${
                  on
                    ? "border-blue-600 bg-blue-50 font-medium text-slate-900 ring-2 ring-blue-200/90"
                    : "border-slate-300 bg-white text-slate-900"
                }`}
              >
                {on ? <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-blue-700" aria-hidden /> : null}
                <span className={on ? "pr-5" : ""}>{label}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Who is making the edit</span>
            <input
              value={editor}
              onChange={(event) => setEditor(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-600/10"
              placeholder="Full name"
              autoComplete="name"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Reason for change</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-600/10"
              placeholder="Why this answer is being corrected"
            />
          </label>
        </div>
        {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Save this edit
          </button>
        </div>
      </div>
    </div>
  )
}
