"use client"

import { formatScore } from "@/lib/format"
import type { SchoolScorecard } from "@/lib/types"

const SERIES = [
  { stroke: "#2563eb", fill: "rgba(37, 99, 235, 0.28)" },
  { stroke: "#0f766e", fill: "rgba(15, 118, 110, 0.22)" },
] as const

const SHORT_LABELS: Record<string, string> = {
  "Arrival Experience and Campus Organization": "Arrival & Campus Org",
  "Arrival Experience and Campus Support": "Arrival & Campus Support",
  "Athletics and Wellness": "Athletics & Wellness",
  "Special Education": "Special Education",
  "Wrap Around Services": "Wrap Around",
  "Shared Studios": "Shared Studios",
}

function polar(index: number, total: number, value: number, cx: number, cy: number, radius: number) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total
  const r = radius * Math.max(0, Math.min(1, value / 100))
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  }
}

function labelLines(text: string, max = 16): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (current && next.length > max) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

function toPath(points: { x: number; y: number }[]): string {
  if (!points.length) return ""
  return `${points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ")} Z`
}

function scoreForAxis(card: SchoolScorecard, axis: string): number | null {
  return card.focusAreas.find((area) => area.label === axis)?.score ?? null
}

export function CategorySpider({
  cards,
  axisOrder = [],
  embedded = false,
}: {
  cards: SchoolScorecard[]
  axisOrder?: string[]
  embedded?: boolean
}) {
  const seen = new Map<string, string>()
  for (const label of axisOrder) seen.set(label, label)
  for (const card of cards) {
    for (const area of card.focusAreas) seen.set(area.label, area.label)
  }
  const axes = [...seen.values()].sort((a, b) => {
    const ai = axisOrder.indexOf(a)
    const bi = axisOrder.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })

  const shell = embedded
    ? "min-h-[280px]"
    : "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5"

  if (!cards.length) {
    return (
      <div className={`flex items-center justify-center px-6 py-16 text-center text-sm text-slate-500 ${shell}`}>
        Select two schools to compare focus area scores.
      </div>
    )
  }

  if (!axes.length) {
    return (
      <div className={`flex items-center justify-center px-6 py-16 text-center text-sm text-slate-500 ${shell}`}>
        No scored focus areas yet for the selected schools.
      </div>
    )
  }

  const size = 720
  const cx = size / 2
  const cy = size / 2
  const radius = 258
  const rings = [25, 50, 75, 100]

  return (
    <div className={embedded ? "pt-2" : "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5"}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Focus area comparison</h2>
          <p className="text-xs text-slate-500">Campus scores by scoring focus area.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {cards.map((card, index) => (
            <div key={card.schoolId} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: SERIES[index % SERIES.length].stroke }}
              />
              <span className="font-medium text-slate-700">{card.schoolName}</span>
              <span className="tabular-nums text-slate-500">{formatScore(card.existingOnly)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid items-center gap-6 xl:grid-cols-[minmax(0,1fr)_200px]">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="mx-auto h-auto w-full max-w-[min(100%,72vh)]"
          role="img"
        >
          <title>Spider plot of scoring focus area scores</title>
          {rings.map((ring) => {
            const points = axes.map((_, index) => polar(index, axes.length, ring, cx, cy, radius))
            return (
              <polygon
                key={ring}
                points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="1"
              />
            )
          })}
          {axes.map((axis, index) => {
            const end = polar(index, axes.length, 100, cx, cy, radius)
            const label = polar(index, axes.length, 118, cx, cy, radius)
            const anchor =
              Math.abs(label.x - cx) < 12 ? "middle" : label.x > cx ? "start" : "end"
            const display = SHORT_LABELS[axis] ?? axis
            return (
              <g key={axis}>
                <line x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#cbd5e1" strokeWidth="1" />
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fill="#475569"
                  fontSize="13"
                  fontWeight="600"
                >
                  {labelLines(display).map((line, lineIndex, lines) => (
                    <tspan
                      key={line}
                      x={label.x}
                      dy={lineIndex === 0 ? (lines.length > 1 ? "-0.55em" : "0") : "1.15em"}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            )
          })}
          {cards.map((card, seriesIndex) => {
            const style = SERIES[seriesIndex % SERIES.length]
            const points = axes.map((axis, index) =>
              polar(index, axes.length, scoreForAxis(card, axis) ?? 0, cx, cy, radius),
            )
            return (
              <g key={card.schoolId}>
                <path d={toPath(points)} fill={style.fill} stroke={style.stroke} strokeWidth="3" />
                {points.map((point, index) => {
                  const score = scoreForAxis(card, axes[index])
                  return (
                    <circle
                      key={`${card.schoolId}-${axes[index]}`}
                      cx={point.x}
                      cy={point.y}
                      r="4.5"
                      fill={style.stroke}
                    >
                      <title>
                        {card.schoolName}: {axes[index]} {formatScore(score)}
                      </title>
                    </circle>
                  )
                })}
              </g>
            )
          })}
        </svg>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:grid-cols-1">
          {axes.map((axis) => (
            <div key={axis}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {SHORT_LABELS[axis] ?? axis}
              </dt>
              <dd className="mt-1 space-y-1">
                {cards.map((card, index) => {
                  const score = scoreForAxis(card, axis)
                  return (
                    <div key={card.schoolId} className="flex items-center justify-between gap-3">
                      <span className="truncate text-slate-600" style={{ color: SERIES[index % SERIES.length].stroke }}>
                        {card.schoolName.replace(/ Elementary.*$/, "").replace(/ ES$/, "")}
                      </span>
                      <span className="tabular-nums font-semibold text-slate-800">{formatScore(score)}</span>
                    </div>
                  )
                })}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
