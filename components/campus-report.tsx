"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Printer } from "lucide-react"
import { AisdLogo } from "@/components/aisd-logo"
import { SCORE_FAIR, SCORE_GOOD, barTone, scoreTone } from "@/lib/format"
import {
  averageScorecard,
  displaySchoolName,
  formatPreparedDate,
  isHiddenReportLabel,
  levelAverageLabel,
  orderedFocusAreas,
  scoringCategories,
  shortFocus,
  spaceCategoryTree,
  spaceNodes,
  spaceTypeCategoryScore,
} from "@/lib/report"
import { fetchScoringNotes, observationLines } from "@/lib/qa-scoring-notes"
import type { SchoolIndexEntry, SchoolLevel, SchoolScorecard, ScoreNode } from "@/lib/types"

function polar(index: number, total: number, value: number, cx: number, cy: number, radius: number) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total
  const r = radius * Math.max(0, Math.min(1, value / 100))
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
}

function toPath(points: { x: number; y: number }[]): string {
  if (!points.length) return ""
  return `${points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ")} Z`
}

function scoreNumber(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "—"
  return String(Math.round(score))
}

function scoreCellClass(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "bg-slate-50 text-slate-400"
  if (score >= SCORE_GOOD) return "bg-emerald-100 text-emerald-800"
  if (score >= SCORE_FAIR) return "bg-amber-100 text-amber-900"
  return "bg-rose-100 text-rose-800"
}

function ScoreCell({ score, strong = false }: { score: number | null | undefined; strong?: boolean }) {
  return (
    <td className={`px-2 py-1.5 text-right tabular-nums ${strong ? "font-semibold" : ""} ${scoreCellClass(score)}`}>
      {scoreNumber(score)}
    </td>
  )
}

function ScoreLegend() {
  return (
    <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
      <span className="whitespace-nowrap rounded px-1.5 py-0.5 font-medium text-emerald-800 bg-emerald-100">
        Good {SCORE_GOOD}+
      </span>
      <span className="whitespace-nowrap rounded px-1.5 py-0.5 font-medium text-amber-900 bg-amber-100">
        Fair {SCORE_FAIR}–{SCORE_GOOD}
      </span>
      <span className="whitespace-nowrap rounded px-1.5 py-0.5 font-medium text-rose-800 bg-rose-100">
        Poor below {SCORE_FAIR}
      </span>
    </div>
  )
}

function ReportBar({
  label,
  score,
  average,
}: {
  label: string
  score: number | null
  average?: number | null
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3">
      <div>
        <p className="mb-1 text-[13px] font-medium text-slate-800">{label}</p>
        <div className="relative h-3 overflow-visible rounded-full bg-slate-200">
          {score != null ? (
            <div
              className={`h-3 rounded-full ${barTone(score)}`}
              style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
            />
          ) : null}
          {average != null ? (
            <span
              className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-slate-900"
              style={{ left: `${Math.max(0, Math.min(100, average))}%` }}
            />
          ) : null}
        </div>
      </div>
      <p className="text-right text-sm font-semibold tabular-nums text-slate-900">{scoreNumber(score)}</p>
    </div>
  )
}

function Observations({
  title = "Observations",
  lines,
}: {
  title?: string
  lines: string[]
}) {
  const slots = [0, 1, 2].map((index) => lines[index]?.trim() || "")
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">{title}</p>
      <ol className="mt-3 space-y-2">
        {slots.map((line, index) => (
          <li key={index} className="flex gap-2 text-[13px] leading-snug text-slate-600">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[11px] font-bold text-amber-950">
              {index + 1}
            </span>
            <span>{line || "Observations will be written here"}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ReportFooter({ page, total, schoolName }: { page: number; total: number; schoolName: string }) {
  return (
    <div className="mt-auto flex items-end justify-between border-t border-slate-200 pt-3 text-[10px] text-slate-500">
      <p>Perkins Eastman · AISD ESA</p>
      <p className="truncate px-3 text-center">{schoolName}</p>
      <p>
        Page {page} of {total}
      </p>
    </div>
  )
}

function ReportPage({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    const inner = innerRef.current
    if (!frame || !inner) return

    const fit = () => {
      inner.style.setProperty("zoom", "1")
      inner.style.minHeight = "0px"
      const available = frame.clientHeight
      const needed = inner.scrollHeight
      if (available <= 0 || needed <= 0) return
      if (needed > available + 2) {
        inner.style.setProperty("zoom", String(available / needed))
        inner.style.minHeight = "0px"
      } else {
        inner.style.setProperty("zoom", "1")
        inner.style.minHeight = `${available}px`
      }
    }

    fit()
    const frameObserver = new ResizeObserver(fit)
    frameObserver.observe(frame)
    window.addEventListener("beforeprint", fit)
    inner.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", fit, { once: true })
    })
    return () => {
      frameObserver.disconnect()
      window.removeEventListener("beforeprint", fit)
    }
  }, [children])

  return (
    <section className="report-page mx-auto box-border h-[8.5in] w-[11in] max-w-full overflow-hidden bg-white p-8 shadow-sm ring-1 ring-slate-200 print:max-w-none print:shadow-none print:ring-0">
      <div ref={frameRef} className="h-full overflow-hidden">
        <div ref={innerRef} className="flex flex-col">
          {children}
        </div>
      </div>
    </section>
  )
}

function ReportSpider({
  campus,
  average,
  axes,
}: {
  campus: SchoolScorecard
  average: SchoolScorecard
  axes: string[]
}) {
  const size = 300
  const cx = size / 2
  const cy = size / 2
  const radius = 102
  if (!axes.length) {
    return <p className="py-10 text-center text-sm text-slate-500">No focus area scores yet.</p>
  }
  const campusPoints = axes.map((axis, index) =>
    polar(index, axes.length, campus.focusAreas.find((area) => area.label === axis)?.score ?? 0, cx, cy, radius),
  )
  const averagePoints = axes.map((axis, index) =>
    polar(index, axes.length, average.focusAreas.find((area) => area.label === axis)?.score ?? 0, cx, cy, radius),
  )
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-auto w-full max-w-[300px]" role="img">
      <title>Campus spider plot by scoring focus area</title>
      {[25, 50, 75, 100].map((ring) => {
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
        const label = polar(index, axes.length, 128, cx, cy, radius)
        const anchor = Math.abs(label.x - cx) < 10 ? "middle" : label.x > cx ? "start" : "end"
        return (
          <g key={axis}>
            <line x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#cbd5e1" strokeWidth="1" />
            <text
              x={label.x}
              y={label.y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fill="#334155"
              fontSize="10"
              fontWeight="600"
            >
              {shortFocus(axis)}
            </text>
          </g>
        )
      })}
      <path d={toPath(averagePoints)} fill="none" stroke="#1e3a8a" strokeWidth="2" strokeDasharray="6 5" />
      <path d={toPath(campusPoints)} fill="rgba(15, 118, 110, 0.28)" stroke="#0f766e" strokeWidth="2.5" />
      {campusPoints.map((point, index) => (
        <circle key={axes[index]} cx={point.x} cy={point.y} r="3.5" fill="#0f766e" />
      ))}
    </svg>
  )
}

function SpaceScoreCard({ space, categories }: { space: ScoreNode; categories: string[] }) {
  const tree = spaceCategoryTree(space)
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h5 className="min-w-0 truncate text-sm font-semibold text-slate-900">{space.label}</h5>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-sm font-bold tabular-nums ${scoreCellClass(space.score)}`}>
          {scoreNumber(space.score)}
        </span>
      </div>
      <div className="space-y-3">
        {categories.map((category) => {
          const node = tree.find((item) => item.label === category)
          const score = node?.score ?? spaceTypeCategoryScore(space, category)
          const subs = (node?.children ?? []).filter((sub) => !isHiddenReportLabel(sub.label))
          if (score == null && !subs.length) return null
          return (
            <div key={category}>
              <div className="grid grid-cols-[minmax(0,1fr)_1.6rem] items-center gap-2">
                <div>
                  <p className="text-[11px] font-medium text-slate-700">{category}</p>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    {score != null ? (
                      <div
                        className={`h-full rounded-full ${barTone(score)}`}
                        style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                      />
                    ) : null}
                  </div>
                </div>
                <span className={`text-right text-[11px] tabular-nums font-semibold ${scoreTone(score)}`}>
                  {scoreNumber(score)}
                </span>
              </div>
              {subs.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {subs.map((sub) => (
                    <span
                      key={sub.id}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] leading-tight ${scoreCellClass(sub.score)}`}
                    >
                      {sub.label} {scoreNumber(sub.score)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </article>
  )
}

export function CampusReport({
  card,
  fleet,
  school,
  schoolLevel,
  axisOrder,
}: {
  card: SchoolScorecard
  fleet: SchoolScorecard[]
  school: SchoolIndexEntry
  schoolLevel: SchoolLevel
  axisOrder: string[]
}) {
  const averageLabel = levelAverageLabel(schoolLevel)
  const average = averageScorecard(fleet, averageLabel, schoolLevel)
  const name = displaySchoolName(card.schoolName)
  const focuses = orderedFocusAreas(card, axisOrder)
  const axes = focuses.map((area) => area.label)
  const categories = scoringCategories(card)
  const totalPages = 2 + focuses.length
  const prepared = formatPreparedDate()
  const scoresAsOf = formatPreparedDate(school.exportedAt)
  const [observationItems, setObservationItems] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    fetchScoringNotes(card.schoolId)
      .then((notes) => {
        if (!cancelled) {
          setObservationItems(
            observationLines(
              notes,
              orderedFocusAreas(card, axisOrder).map((area) => area.label),
            ),
          )
        }
      })
      .catch(() => {
        if (!cancelled) setObservationItems([])
      })
    return () => {
      cancelled = true
    }
  }, [axisOrder, card])

  return (
    <div className="report-print-root space-y-4 print:space-y-0">
      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
        >
          <Printer size={14} />
          Print / save PDF
        </button>
      </div>

      <ReportPage>
        <div className="overflow-hidden rounded-2xl">
          <div className="flex items-center bg-white px-6 py-3">
            <AisdLogo className="h-12 w-auto" />
          </div>
          <div className="h-1 bg-[#c4a35a]" />
          <div className="bg-[#0f4c5c] px-6 py-5 text-white">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-100">Campus Assessment Report</p>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight">{name}</h2>
                <p className="mt-1 text-sm text-teal-100">
                  Campus ID {card.campusId.replace(/-PILOT-\d+$/i, "")}
                  {card.campusId.includes("PILOT") ? " · Pilot" : ""} ·{" "}
                  {schoolLevel === "ES" ? "Elementary" : schoolLevel === "MS" ? "Middle" : "High"}
                </p>
                <p className="mt-1 text-xs text-teal-200">
                  Scores as of {scoresAsOf || prepared} · Prepared {prepared} · Perkins Eastman · AISD ESA
                </p>
              </div>
              <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white shadow-inner">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">ESA</p>
                <p className={`text-4xl font-bold tabular-nums leading-none ${scoreTone(card.existingOnly)}`}>
                  {scoreNumber(card.existingOnly)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-[200px_minmax(0,1fr)] gap-4">
          <div className="rounded-2xl bg-slate-50 px-4 py-4 ring-1 ring-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Educational Suitability</p>
            <p className={`mt-2 text-4xl font-bold tabular-nums ${scoreTone(card.existingOnly)}`}>
              {scoreNumber(card.existingOnly)}
            </p>
            <p className="mt-1 text-sm text-slate-500">Weighted campus score from field ESA</p>
          </div>
          <Observations lines={observationItems} />
        </div>

        <div className="mt-8">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">ESA focus areas at a glance</h3>
            <p className="text-[11px] text-slate-500">{averageLabel} (navy marker)</p>
          </div>
          <div className="space-y-3">
            {focuses.map((area) => (
              <ReportBar
                key={area.id}
                label={shortFocus(area.label)}
                score={area.score}
                average={average.focusAreas.find((item) => item.label === area.label)?.score}
              />
            ))}
          </div>
        </div>
        <ReportFooter page={1} total={totalPages} schoolName={name} />
      </ReportPage>

      <ReportPage>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <AisdLogo className="h-10 w-auto" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-800">Educational Suitability Assessment</p>
              <h3 className="text-xl font-semibold text-slate-900">{name}</h3>
            </div>
          </div>
          <p className="text-xs font-semibold text-slate-500">ESA OVERVIEW · Campus {card.campusId.replace(/-PILOT-\d+$/i, "")}</p>
        </div>
        <div className="mt-5 flex flex-nowrap items-start justify-center gap-x-12">
          <div className="w-[19rem] shrink-0">
            <h4 className="text-sm font-semibold text-slate-900">Campus spider plot by scoring focus area</h4>
            <p className="text-xs text-slate-500">
              Teal fill = {name} · Dashed navy = {averageLabel}
            </p>
            <ReportSpider campus={card} average={average} axes={axes} />
          </div>
          <div className="shrink-0">
            <h4 className="text-base font-semibold text-slate-900">Campus vs grade-type average</h4>
            <p className="mt-1 text-xs text-slate-500">Campus score compared with {averageLabel}</p>
            <table className="mt-3 w-max max-w-full text-[14px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-6 font-semibold">Focus area</th>
                  <th className="w-16 pb-2 pl-3 text-right font-semibold">Campus</th>
                  <th className="w-14 pb-2 pl-3 text-right font-semibold">Avg</th>
                </tr>
              </thead>
              <tbody>
                {focuses.map((area) => (
                  <tr key={area.id} className="border-b border-slate-100">
                    <td className="whitespace-nowrap py-1.5 pr-6 leading-snug text-slate-800">{area.label}</td>
                    <ScoreCell score={area.score} strong />
                    <td className="py-1.5 pl-3 text-right tabular-nums text-slate-500">
                      {scoreNumber(average.focusAreas.find((item) => item.label === area.label)?.score)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3">
              <ScoreLegend />
            </div>
          </div>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex items-end justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-900">Campus-wide categories</h4>
            <p className="text-[11px] text-slate-500">{averageLabel} (navy marker)</p>
          </div>
          <p className="mb-2 text-xs text-slate-500">Original scoring categories, aggregated across every scored space</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2">
            {card.categories
              .filter((node) => !isHiddenReportLabel(node.label))
              .map((node) => (
                <ReportBar
                  key={node.id}
                  label={node.label}
                  score={node.score}
                  average={average.categories.find((item) => item.label === node.label)?.score}
                />
              ))}
          </div>
        </div>
        <ReportFooter page={2} total={totalPages} schoolName={name} />
      </ReportPage>

      {focuses.map((focus, index) => {
        const spaces = spaceNodes(focus)
        return (
          <ReportPage key={focus.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <AisdLogo className="h-10 w-auto" />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-800">
                    Scoring focus area
                  </p>
                  <h3 className="text-xl font-semibold text-slate-900">{focus.label}</h3>
                  <p className="text-sm text-slate-500">
                    {focus.weight > 0 ? `Weight ${focus.weight}` : "Focus area"} · {spaces.length} space type
                    {spaces.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Focus score</p>
                <p className={`text-4xl font-bold tabular-nums ${scoreTone(focus.score)}`}>{scoreNumber(focus.score)}</p>
              </div>
            </div>

            <div className="mt-5">
              <Observations lines={observationItems} />
            </div>

            <div className="mt-5">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <h4 className="text-sm font-semibold text-slate-900">Space types</h4>
                <ScoreLegend />
              </div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] text-slate-500">
                    <th className="px-2 py-1.5 font-semibold uppercase tracking-wide">Space type</th>
                    {categories.map((category) => (
                      <th key={category} className="px-1 py-1.5 text-right font-semibold leading-tight">
                        {category}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {spaces.map((space) => (
                    <tr key={space.id} className="border-b border-slate-100">
                      <td className="px-2 py-1 text-slate-800">{space.label}</td>
                      {categories.map((category) => (
                        <ScoreCell key={category} score={spaceTypeCategoryScore(space, category)} />
                      ))}
                      <ScoreCell score={space.score} strong />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {spaces.map((space) => (
                <SpaceScoreCard key={`${space.id}-detail`} space={space} categories={categories} />
              ))}
            </div>
            <ReportFooter page={3 + index} total={totalPages} schoolName={name} />
          </ReportPage>
        )
      })}
    </div>
  )
}
