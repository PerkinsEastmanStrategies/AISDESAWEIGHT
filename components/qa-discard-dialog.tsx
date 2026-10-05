"use client"

import { useEffect, useState } from "react"
import { TriangleAlert } from "lucide-react"

export function QaDiscardDialog({
  roomName,
  schoolName,
  onCancel,
  onConfirm,
}: {
  roomName: string
  schoolName: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState("")
  const [understood, setUnderstood] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameMatches = typed.trim().toLowerCase() === roomName.trim().toLowerCase()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = previous
    }
  }, [onCancel])

  function confirm() {
    if (!understood) {
      setError("Check the box to confirm you understand this fully removes the room.")
      return
    }
    if (!nameMatches) {
      setError(`Type ${roomName} exactly to confirm.`)
      return
    }
    onConfirm()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qa-discard-title"
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-rose-200 sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <TriangleAlert className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700">
              Cannot be undone
            </p>
            <h3 id="qa-discard-title" className="mt-1 text-lg font-semibold text-slate-900">
              Discard room {roomName}?
            </h3>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-700">
          This <span className="font-semibold text-rose-800">fully removes</span> this room from {schoolName}.
          It will disappear from Internal QA, AISD QA, All schools, reports, and Weighting Explorer. The rest
          of the campus survey stays.
        </p>
        <p className="mt-2 text-sm font-medium text-slate-900">
          Be sure. There is no restore from this screen.
        </p>
        <label className="mt-4 flex items-start gap-3 rounded-xl bg-rose-50 px-3 py-3 text-sm text-slate-800 ring-1 ring-rose-100">
          <input
            type="checkbox"
            checked={understood}
            onChange={(event) => {
              setUnderstood(event.target.checked)
              setError(null)
            }}
            className="mt-0.5 h-4 w-4 rounded border-rose-300 text-rose-700 focus:ring-rose-600"
          />
          <span>
            I understand this <span className="font-semibold">fully removes</span> room {roomName} from this
            lab.
          </span>
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Type the room name to confirm
          </span>
          <input
            type="text"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value)
              setError(null)
            }}
            placeholder={roomName}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-600/10"
          />
        </label>
        {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Keep room
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!understood || !nameMatches}
            className="rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-rose-200"
          >
            Discard room
          </button>
        </div>
      </div>
    </div>
  )
}
