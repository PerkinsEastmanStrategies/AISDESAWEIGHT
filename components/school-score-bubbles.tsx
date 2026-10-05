"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { formatScore, formatScoreExact, SCORE_FAIR, SCORE_GOOD } from "@/lib/format"
import type { SchoolScorecard, ScoreNode } from "@/lib/types"

export const OVERALL_SLICE = "existing"

const SHORT_LABELS: Record<string, string> = {
  "Arrival Experience and Campus Organization": "Arrival & Campus Org",
  "Arrival Experience and Campus Support": "Arrival & Campus Support",
  "Athletics and Wellness": "Athletics & Wellness",
  "Special Education": "Special Education",
  "Wrap Around Services": "Wrap Around",
  "Shared Studios": "Shared Studios",
  "Occupant Experience": "Occupant Exp.",
}

function shortLabel(label: string) {
  return SHORT_LABELS[label] ?? label
}

function nodeByLabel(nodes: ScoreNode[], label: string) {
  return nodes.find((node) => node.label === label) ?? null
}

export function schoolSlice(card: SchoolScorecard, sliceId: string): { score: number | null; count: number } {
  if (sliceId === OVERALL_SLICE) {
    return { score: card.existingOnly, count: card.scoredRoomCount }
  }
  if (sliceId.startsWith("focus:")) {
    const node = nodeByLabel(card.focusAreas, sliceId.slice(6))
    return { score: node?.score ?? null, count: node?.scoredCount ?? 0 }
  }
  if (sliceId.startsWith("category:")) {
    const node = nodeByLabel(card.categories, sliceId.slice(9))
    return { score: node?.score ?? null, count: node?.scoredCount ?? card.scoredRoomCount }
  }
  return { score: null, count: 0 }
}

function bubbleFill(score: number | null) {
  if (score == null) return { fill: "#cbd5e1", stroke: "#94a3b8" }
  if (score >= SCORE_GOOD) return { fill: "#059669", stroke: "#047857" }
  if (score >= SCORE_FAIR) return { fill: "#d97706", stroke: "#b45309" }
  return { fill: "#e11d48", stroke: "#be123c" }
}

function initials(name: string) {
  const cleaned = name
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(elementary|middle|high|school|es|ms|hs|echs|sywl|pilot)\b/gi, " ")
    .replace(/[#\d]+/g, " ")
    .trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (!words.length) return name.slice(0, 2).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}

function displayName(name: string) {
  return name
    .replace(/\s+Elementary\s+\(Pilot #2\)/i, " Pilot 2")
    .replace(/\s+\(Pilot #2\)/i, " Pilot 2")
    .replace(/\s+Elementary School$/i, "")
    .replace(/\s+Elementary$/i, "")
}

type Placed = {
  id: string
  name: string
  score: number
  count: number
  x: number
  y: number
  r: number
}

function radiusForCount(count: number, minCount: number, maxCount: number, width: number) {
  const t = maxCount <= minCount ? 0.55 : (count - minCount) / (maxCount - minCount)
  const minR = width < 700 ? 11 : 12
  const maxR = width < 700 ? 14 : 17
  return minR + Math.max(0, Math.min(1, t)) * (maxR - minR)
}

function bubbleLabel(name: string, r: number) {
  const short = displayName(name)
    .replace(/\s+(ES|MS|HS|ECHS)$/i, "")
    .replace(/\s+Pilot 2$/i, " P2")
  if (r >= 14 && short.length <= 6) return short
  return initials(name)
}

const AXIS_PAD_X = 56
const AXIS_PAD_Y = 36

function scoreToX(score: number, width: number) {
  const inner = Math.max(160, width - AXIS_PAD_X * 2)
  return AXIS_PAD_X + (Math.max(0, Math.min(100, score)) / 100) * inner
}

function layoutBeeswarm(
  items: { id: string; name: string; score: number; count: number }[],
  width: number,
  height: number,
): Placed[] {
  const mid = height / 2
  const minCount = Math.min(...items.map((item) => item.count), 1)
  const maxCount = Math.max(...items.map((item) => item.count), 1)
  const ordered = [...items].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
  const nodes: Placed[] = []

  for (const item of ordered) {
    const r = radiusForCount(item.count, minCount, maxCount, width)
    const x = scoreToX(item.score, width)
    const gap = 4
    let y = mid
    const maxOffset = Math.max(40, height / 2 - AXIS_PAD_Y - r)
    for (let step = 0; step <= Math.ceil(maxOffset / 3); step++) {
      const offsets = step === 0 ? [0] : [step * 3, -step * 3]
      const fit = offsets.find((offset) => {
        const candidate = mid + offset
        return nodes.every((node) => Math.hypot(node.x - x, node.y - candidate) >= node.r + r + gap)
      })
      if (fit != null) {
        y = mid + fit
        break
      }
    }
    y = Math.max(AXIS_PAD_Y + r, Math.min(height - AXIS_PAD_Y - r, y))
    nodes.push({ ...item, r, x, y })
  }

  if (!nodes.length) return nodes
  const top = Math.min(...nodes.map((node) => node.y - node.r))
  const bottom = Math.max(...nodes.map((node) => node.y + node.r))
  const shift = mid - (top + bottom) / 2
  for (const node of nodes) {
    node.y = Math.max(AXIS_PAD_Y + node.r, Math.min(height - AXIS_PAD_Y - node.r, node.y + shift))
  }
  return nodes
}

export function SchoolScoreBubbles({
  cards,
  sliceId,
  focusAreas,
  scoringCategories,
  onSliceChange,
  onOpenSchool,
  loading,
  levelLabel,
  openHint = "Click to open campus review",
  emptyMessage = "No scored campuses for this filter.",
}: {
  cards: SchoolScorecard[]
  sliceId: string
  focusAreas: string[]
  scoringCategories: string[]
  onSliceChange: (id: string) => void
  onOpenSchool?: (schoolId: string) => void
  loading?: boolean
  levelLabel: string
  openHint?: string
  emptyMessage?: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const width = size?.width ?? 0
  const height = size?.height ?? 0

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const sync = () =>
      setSize({
        width: Math.max(1, el.clientWidth),
        height: Math.max(1, el.clientHeight),
      })
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const rows = useMemo(
    () =>
      cards
        .map((card) => {
          const slice = schoolSlice(card, sliceId)
          return {
            id: card.schoolId,
            name: card.schoolName,
            score: slice.score,
            count: slice.count,
          }
        })
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    [cards, sliceId],
  )

  const scored = rows.filter((row): row is typeof row & { score: number } => row.score != null)
  const placed = useMemo(
    () => (scored.length && width >= 80 && height >= 80 ? layoutBeeswarm(scored, width, height) : []),
    [scored, width, height],
  )
  const hover = placed.find((node) => node.id === hovered) ?? null
  const mean = scored.length ? scored.reduce((sum, row) => sum + row.score, 0) / scored.length : null
  const meanX = mean == null ? null : scoreToX(mean, width)
  const missing = rows.length - scored.length
  const activeFocus = sliceId.startsWith("focus:") ? sliceId.slice(6) : null
  const activeCategory = sliceId.startsWith("category:") ? sliceId.slice(9) : null
  const sliceTitle =
    sliceId === OVERALL_SLICE
      ? "existing spaces"
      : shortLabel(activeFocus ?? activeCategory ?? "selected category")

  return (
    <div className="flex h-[calc(100dvh-176px)] min-h-[640px] flex-col space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">How walked schools score</h2>
          <p className="text-sm text-slate-500">
            {levelLabel} · {scored.length} of {rows.length} campuses on {sliceTitle}
            {mean != null ? ` · mean ${formatScore(mean)}` : ""}
            {missing ? ` · ${missing} not assessed here` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> 80%+
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-600" /> 55–80%
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-600" /> below 55%
          </span>
          <span>Size = assessed spaces</span>
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Survey category
        </span>
        <div className="flex flex-wrap gap-1.5">
          <SliceChip active={sliceId === OVERALL_SLICE} onClick={() => onSliceChange(OVERALL_SLICE)}>
            Existing spaces
          </SliceChip>
          {focusAreas.map((label) => (
            <SliceChip
              key={`focus:${label}`}
              active={sliceId === `focus:${label}`}
              onClick={() => onSliceChange(`focus:${label}`)}
            >
              {shortLabel(label)}
            </SliceChip>
          ))}
        </div>
        {scoringCategories.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {scoringCategories.map((label) => (
              <SliceChip
                key={`category:${label}`}
                active={sliceId === `category:${label}`}
                onClick={() => onSliceChange(`category:${label}`)}
                muted
              >
                {shortLabel(label)}
              </SliceChip>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_260px] xl:grid-rows-[minmax(0,1fr)]">
        <div ref={wrapRef} className="relative h-full min-h-[280px] overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
          {(!size || (loading && !placed.length)) ? (
            <p className="absolute inset-0 grid place-items-center text-sm text-slate-500">Loading campuses…</p>
          ) : !placed.length ? (
            <p className="absolute inset-0 grid place-items-center text-sm text-slate-500">
              {emptyMessage}
            </p>
          ) : (
            <>
              <svg
                viewBox={`0 0 ${width} ${height}`}
                className="absolute inset-0 h-full w-full"
                preserveAspectRatio="none"
                aria-hidden
              >
                <rect x="0" y="0" width={scoreToX(SCORE_FAIR, width)} height={height} fill="rgba(244, 63, 94, 0.06)" />
                <rect
                  x={scoreToX(SCORE_FAIR, width)}
                  y="0"
                  width={scoreToX(SCORE_GOOD, width) - scoreToX(SCORE_FAIR, width)}
                  height={height}
                  fill="rgba(245, 158, 11, 0.08)"
                />
                <rect
                  x={scoreToX(SCORE_GOOD, width)}
                  y="0"
                  width={width - scoreToX(SCORE_GOOD, width)}
                  height={height}
                  fill="rgba(16, 185, 129, 0.08)"
                />
                <line
                  x1={scoreToX(0, width)}
                  y1={height / 2}
                  x2={scoreToX(100, width)}
                  y2={height / 2}
                  stroke="#94a3b8"
                  strokeWidth="1"
                />
                {[0, 25, 55, 80, 100].map((tick) => {
                  const x = scoreToX(tick, width)
                  return (
                    <g key={tick}>
                      <line x1={x} y1={18} x2={x} y2={height - 28} stroke="#cbd5e1" strokeDasharray="3 5" />
                      <text x={x} y={height - 10} textAnchor="middle" className="fill-slate-400" fontSize="12">
                        {tick}%
                      </text>
                    </g>
                  )
                })}
                {meanX != null ? (
                  <line
                    x1={meanX}
                    y1={16}
                    x2={meanX}
                    y2={height - 28}
                    stroke="#0f172a"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                  />
                ) : null}
              </svg>
              {placed.map((node) => {
                const color = bubbleFill(node.score)
                const active = node.id === hovered
                const sizePx = Math.round(node.r * 2)
                return (
                  <button
                    key={node.id}
                    type="button"
                    title={`${node.name} ${Math.round(node.score)}%`}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered((current) => (current === node.id ? null : current))}
                    onClick={() => onOpenSchool?.(node.id)}
                    className="absolute z-[1] flex items-center justify-center rounded-full font-bold text-white shadow-sm ring-2 ring-white"
                    style={{
                      left: node.x,
                      top: node.y,
                      width: sizePx,
                      height: sizePx,
                      marginLeft: -sizePx / 2,
                      marginTop: -sizePx / 2,
                      background: color.fill,
                      fontSize: sizePx >= 28 ? 9 : 8,
                      opacity: hovered && !active ? 0.45 : 1,
                      outline: active ? "3px solid #0f172a" : undefined,
                    }}
                  >
                    {bubbleLabel(node.name, node.r)}
                  </button>
                )
              })}
            </>
          )}
          {hover ? (
            <div
              className="pointer-events-none absolute z-10 w-52 rounded-xl bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200"
              style={{
                left: Math.min(width - 220, Math.max(8, hover.x - 100)),
                top: Math.max(8, hover.y - hover.r - 72),
              }}
            >
              <p className="font-semibold text-slate-900">{hover.name}</p>
              <p className="tabular-nums text-slate-600">
                {formatScoreExact(hover.score)} · {hover.count} space{hover.count === 1 ? "" : "s"}
              </p>
              {onOpenSchool ? <p className="mt-0.5 text-[11px] text-slate-400">{openHint}</p> : null}
            </div>
          ) : null}
        </div>

        <ol className="min-h-0 space-y-1 overflow-auto pr-1 text-[15px] xl:h-full">
          {rows.map((row, index) => (
            <li key={row.id}>
              <button
                type="button"
                onMouseEnter={() => setHovered(row.id)}
                onMouseLeave={() => setHovered((current) => (current === row.id ? null : current))}
                onClick={() => onOpenSchool?.(row.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-slate-50 ${
                  hovered === row.id ? "bg-slate-50 ring-1 ring-slate-200" : ""
                }`}
              >
                <span className="min-w-0 truncate">
                  <span className="mr-1.5 tabular-nums text-[11px] text-slate-400">{index + 1}</span>
                  {displayName(row.name)}
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-slate-800">{formatScore(row.score)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function SliceChip({
  active,
  onClick,
  children,
  muted = false,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  muted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
        active
          ? "bg-slate-900 text-white"
          : muted
            ? "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  )
}
