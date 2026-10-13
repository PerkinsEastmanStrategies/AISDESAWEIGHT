"use client"

import { useState } from "react"
import { CheckCircle2, MessageSquare } from "lucide-react"
import { loadSavedEditorName, saveEditorName } from "@/lib/qa-edits"

export function AisdDecisionPanel({
  schoolName,
  onFinalize,
  onMoveToFeedback,
}: {
  schoolName: string
  onFinalize: (decidedBy: string) => void | Promise<void>
  onMoveToFeedback: (decidedBy: string) => void | Promise<void>
}) {
  const [mode, setMode] = useState<"idle" | "finalize" | "feedback">("idle")
  const [name, setName] = useState(loadSavedEditorName())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    const decidedBy = name.trim()
    if (!decidedBy) {
      setError("Enter who is moving this campus.")
      return
    }
    saveEditorName(decidedBy)
    setSaving(true)
    setError(null)
    try {
      if (mode === "finalize") await onFinalize(decidedBy)
      else await onMoveToFeedback(decidedBy)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this decision.")
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h3 className="text-sm font-semibold text-slate-900">Move this campus</h3>
      <p className="mt-1 text-sm text-slate-500">
        Record who is moving {schoolName} out of AISD QA. Finalized means the snapshot is accepted.
        Feedback holds AISD comments for follow-up.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            setMode("finalize")
            setError(null)
          }}
          className={`rounded-2xl border px-4 py-3 text-left transition ${
            mode === "finalize"
              ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200"
              : "border-slate-200 bg-slate-50 hover:bg-white"
          }`}
        >
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-900">
            <CheckCircle2 size={16} />
            Looks good, move to finalized
          </span>
          <span className="mt-1 block text-xs text-slate-600">
            The campus leaves AISD QA and appears on the Finalized tab.
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("feedback")
            setError(null)
          }}
          className={`rounded-2xl border px-4 py-3 text-left transition ${
            mode === "feedback"
              ? "border-amber-400 bg-amber-50 ring-2 ring-amber-200"
              : "border-slate-200 bg-slate-50 hover:bg-white"
          }`}
        >
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-amber-950">
            <MessageSquare size={16} />
            Move to Feedback
          </span>
          <span className="mt-1 block text-xs text-slate-600">
            The campus leaves AISD QA and appears on the Feedback tab with its notes.
          </span>
        </button>
      </div>
      {mode !== "idle" ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Who is moving this campus
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Full name"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
            />
          </label>
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-400 ${
              mode === "finalize" ? "bg-emerald-700 hover:bg-emerald-800" : "bg-amber-800 hover:bg-amber-900"
            }`}
          >
            {saving
              ? "Saving…"
              : mode === "finalize"
                ? "Move to Finalized"
                : "Move to Feedback"}
          </button>
        </div>
      ) : null}
    </div>
  )
}
