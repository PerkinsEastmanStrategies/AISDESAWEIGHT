"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { formatWeightShare } from "@/lib/format"
import { MAX_WEIGHT } from "@/lib/weights"

export type WeightLevel = "focus" | "space" | "category" | "subcategory" | "question"

export const WEIGHT_LEVELS: Record<
  WeightLevel,
  { name: string; card: string; changed: string; accent: string; border: string; chip: string }
> = {
  focus: {
    name: "Focus area",
    card: "bg-blue-50 ring-1 ring-blue-200/80",
    changed: "bg-blue-100 ring-1 ring-blue-300",
    accent: "accent-blue-600",
    border: "border-blue-200",
    chip: "bg-blue-600",
  },
  space: {
    name: "Space type",
    card: "bg-teal-50 ring-1 ring-teal-200/80",
    changed: "bg-teal-100 ring-1 ring-teal-300",
    accent: "accent-teal-600",
    border: "border-teal-200",
    chip: "bg-teal-600",
  },
  category: {
    name: "Category",
    card: "bg-violet-50 ring-1 ring-violet-200/80",
    changed: "bg-violet-100 ring-1 ring-violet-300",
    accent: "accent-violet-600",
    border: "border-violet-200",
    chip: "bg-violet-600",
  },
  subcategory: {
    name: "Subcategory",
    card: "bg-amber-50 ring-1 ring-amber-200/80",
    changed: "bg-amber-100 ring-1 ring-amber-300",
    accent: "accent-amber-500",
    border: "border-amber-200",
    chip: "bg-amber-500",
  },
  question: {
    name: "Question",
    card: "bg-rose-50 ring-1 ring-rose-200/80",
    changed: "bg-rose-100 ring-1 ring-rose-300",
    accent: "accent-rose-500",
    border: "border-rose-200",
    chip: "bg-rose-500",
  },
}

export interface WeightHoverDetails {
  questionId: string
  question: string
  path: string[]
  weight: number
  share: string | null
  defaultWeight: number
}

function QuestionHoverCard({
  details,
  anchor,
}: {
  details: WeightHoverDetails
  anchor: DOMRect
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: anchor.top, left: anchor.right + 10 })

  useLayoutEffect(() => {
    const node = cardRef.current
    if (!node) return
    const width = node.offsetWidth
    const height = node.offsetHeight
    const pad = 8
    let left = anchor.right + 10
    if (left + width > window.innerWidth - pad) left = Math.max(pad, anchor.left - width - 10)
    let top = anchor.top
    if (top + height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - height - pad)
    }
    setPos({ top, left })
  }, [anchor])

  const changed = details.weight !== details.defaultWeight

  return (
    <div
      ref={cardRef}
      role="tooltip"
      style={{ top: pos.top, left: pos.left }}
      className="pointer-events-none fixed z-50 w-80 rounded-xl bg-white p-3.5 text-left shadow-xl ring-1 ring-slate-200"
    >
      <p className="font-mono text-[11px] font-semibold text-rose-600">{details.questionId}</p>
      <p className="mt-1.5 text-sm leading-snug text-slate-900">{details.question}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{details.path.join(" → ")}</p>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
        <span>
          Weight {details.weight}
          {details.share ? ` · ${details.share} of this subcategory` : ""}
        </span>
        {changed && <span className="font-medium text-rose-600">was {details.defaultWeight}</span>}
      </div>
    </div>
  )
}

export function WeightSlider({
  label,
  value,
  defaultValue,
  onChange,
  disabled = false,
  siblingTotal,
  detail,
  level = "focus",
  hoverDetails,
}: {
  label: string
  value: number
  defaultValue: number
  onChange: (value: number) => void
  disabled?: boolean
  siblingTotal?: number
  detail?: string
  level?: WeightLevel
  hoverDetails?: WeightHoverDetails
}) {
  const changed = value !== defaultValue
  const share = siblingTotal != null ? formatWeightShare(value, siblingTotal) : null
  const tone = WEIGHT_LEVELS[level]
  const cardRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  function showPopup() {
    if (!hoverDetails) return
    setAnchor(cardRef.current?.getBoundingClientRect() ?? null)
  }

  return (
    <div
      ref={cardRef}
      className={`rounded-xl px-3 py-2.5 ${changed ? tone.changed : tone.card}`}
      onMouseEnter={showPopup}
      onMouseLeave={() => setAnchor(null)}
      onFocus={showPopup}
      onBlur={() => setAnchor(null)}
    >
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {tone.name}
          </div>
          <div className="truncate text-sm font-medium text-slate-800">{label}</div>
          {detail && <div className="truncate text-[11px] text-slate-500">{detail}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {share && <span className="text-[11px] font-medium text-slate-500">{share}</span>}
          <input
            type="number"
            min={0}
            max={MAX_WEIGHT}
            step={1}
            disabled={disabled}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="w-14 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-right text-sm tabular-nums text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
          />
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={MAX_WEIGHT}
        step={1}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`h-1.5 w-full cursor-pointer disabled:opacity-40 ${tone.accent}`}
      />
      {anchor &&
        hoverDetails &&
        typeof document !== "undefined" &&
        createPortal(<QuestionHoverCard details={hoverDetails} anchor={anchor} />, document.body)}
    </div>
  )
}
