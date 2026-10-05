"use client"

import { useEffect, useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { loadSavedEditorName, saveEditorName } from "@/lib/qa-edits"
import {
  formatHandoffTimestamp,
  type QaHandoff,
} from "@/lib/qa-handoff"

export function QaHandoffPanel({
  schoolName,
  existing,
  onSubmit,
}: {
  schoolName: string
  existing?: QaHandoff
  onSubmit: (movedBy: string) => void
}) {
  const [movedBy, setMovedBy] = useState("")
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMovedBy(existing?.movedBy || loadSavedEditorName())
    setApproved(false)
    setError(null)
  }, [existing?.movedBy, schoolName])

  if (existing) {
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

  function submit() {
    const name = movedBy.trim()
    if (!approved) {
      setError("Confirm that you have reviewed and approve this campus before moving it.")
      return
    }
    if (!name) {
      setError("Enter the name of the person moving this campus to AISD review.")
      return
    }
    saveEditorName(name)
    onSubmit(name)
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <h3 className="text-sm font-semibold text-slate-900">Finalize Internal QA</h3>
      <p className="mt-1 text-sm text-slate-500">
        Moving {schoolName} to AISD QA is a deliberate handoff. Confirm the review is complete and record
        who is sending it forward.
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
      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Moved to AISD review by
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
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        className="mt-4 inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
      >
        Move to AISD QA
      </button>
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
