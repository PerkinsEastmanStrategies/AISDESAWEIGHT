"use client"

import { useEffect, useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { loadSavedEditorName, saveEditorName } from "@/lib/qa-edits"
import {
  formatHandoffTimestamp,
  isFeedbackHandoff,
  type QaHandoff,
} from "@/lib/qa-handoff"

export function QaHandoffPanel({
  schoolName,
  existing,
  onSubmit,
  onFinalizeReturned,
}: {
  schoolName: string
  existing?: QaHandoff
  onSubmit: (movedBy: string) => void | Promise<void>
  onFinalizeReturned?: (movedBy: string) => void | Promise<void>
}) {
  const [movedBy, setMovedBy] = useState("")
  const [approved, setApproved] = useState(false)
  const [addressed, setAddressed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<"aisd" | "finalized" | null>(null)

  useEffect(() => {
    setMovedBy(existing?.movedBy || loadSavedEditorName())
    setApproved(false)
    setAddressed(false)
    setError(null)
    setSaving(null)
  }, [existing?.movedBy, schoolName])

  if (existing?.status === "aisd") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          <div>
            <p className="text-sm font-semibold text-emerald-950">Moved to AISD QA</p>
            <p className="mt-1 text-sm text-emerald-900/80">
              {schoolName} was approved and sent to AISD review by{" "}
              <span className="font-medium">{existing.movedBy}</span> on{" "}
              {formatHandoffTimestamp(existing.movedAt)}.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const returned = isFeedbackHandoff(existing)

  async function submitAisd() {
    const name = movedBy.trim()
    if (!approved) {
      setError("Confirm that you have reviewed and approve this campus before moving it.")
      return
    }
    if (!name) {
      setError("Enter who is moving this campus to AISD QA.")
      return
    }
    saveEditorName(name)
    setSaving("aisd")
    setError(null)
    try {
      await onSubmit(name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not move this campus to AISD QA.")
      setSaving(null)
    }
  }

  async function submitFinalized() {
    const name = movedBy.trim()
    if (!addressed) {
      setError("Confirm that you have addressed all AISD comments before moving to Finalized.")
      return
    }
    if (!name) {
      setError("Enter who is moving this campus to Finalized.")
      return
    }
    if (!onFinalizeReturned) return
    saveEditorName(name)
    setSaving("finalized")
    setError(null)
    try {
      await onFinalizeReturned(name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not move this campus to Finalized.")
      setSaving(null)
    }
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      {returned ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3">
          <p className="text-sm font-semibold text-amber-950">Returned from AISD QA</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-amber-950/90">
            {existing?.decisionComments || "AISD sent this campus to Feedback. Address the comments, then finalize or send it back to AISD QA."}
          </p>
          <p className="mt-1 text-xs text-amber-900/70">
            {existing?.decisionBy ? `${existing.decisionBy} · ` : ""}
            {existing?.decisionAt ? formatHandoffTimestamp(existing.decisionAt) : ""}
          </p>
        </div>
      ) : null}
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Your name
        </span>
        <input
          type="text"
          value={movedBy}
          onChange={(event) => {
            setMovedBy(event.target.value)
            setError(null)
          }}
          placeholder="Full name"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
        />
      </label>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {returned && onFinalizeReturned ? (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
          <h3 className="text-sm font-semibold text-emerald-950">Move to Finalized</h3>
          <label className="mt-3 flex items-start gap-3 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={addressed}
              onChange={(event) => {
                setAddressed(event.target.checked)
                setError(null)
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
            />
            <span>I have addressed all AISD comments.</span>
          </label>
          <button
            type="button"
            onClick={() => void submitFinalized()}
            disabled={saving !== null}
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400"
          >
            {saving === "finalized"
              ? "Saving…"
              : "Moved to Finalized, I have addressed all AISD comments"}
          </button>
        </div>
      ) : null}

      <div className={returned ? "mt-5" : "mt-4"}>
        <h3 className="text-sm font-semibold text-slate-900">
          {returned ? "Send back to AISD QA" : "Finalize Internal QA"}
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          {returned
            ? `If more AISD review is needed, move ${schoolName} back to AISD QA.`
            : `Moving ${schoolName} to AISD QA is a deliberate handoff. Confirm the review is complete and record who is sending it forward.`}
        </p>
        <label className="mt-4 flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) => {
              setApproved(event.target.checked)
              setError(null)
            }}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
          />
          <span>
            I have reviewed this campus and <span className="font-semibold">approve</span> moving it to AISD
            review.
          </span>
        </label>
        <button
          type="button"
          onClick={() => void submitAisd()}
          disabled={saving !== null}
          className="mt-4 inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
        >
          {saving === "aisd" ? "Saving…" : "Move to AISD QA"}
        </button>
      </div>
    </div>
  )
}

export function AisdHandoffBanner({ handoff }: { handoff: QaHandoff }) {
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-950">
      Received from Internal QA · moved by <span className="font-semibold">{handoff.movedBy}</span> on{" "}
      {formatHandoffTimestamp(handoff.movedAt)}.
    </div>
  )
}
