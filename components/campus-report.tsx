"use client"

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Printer } from "lucide-react"
import { AisdLogo } from "@/components/aisd-logo"
import { SCORE_FAIR, SCORE_GOOD } from "@/lib/format"
import {
  REPORT_PALETTES,
  hexToRgba,
  loadReportPaletteId,
  saveReportPaletteId,
  scoreBandColors,
  scoreBandHex,
  type ReportPalette,
  type ReportPaletteId,
} from "@/lib/report-palette"
import {
  averageScorecard,
  campusObservationSlots,
  categorySubcategories,
  displaySchoolName,
  expectedSpacesFromRows,
  focusObservationSlots,
  focusSpaceTableRows,
  formatPreparedDate,
  isHiddenReportLabel,
  levelAverageLabel,
  orderedFocusAreas,
  reportDisplayLabel,
  scoringCategories,
  shortFocus,
  spaceCategoryTree,
  spaceTypeCategoryScore,
} from "@/lib/report"
import type { SchoolIndexEntry, SchoolLevel, SchoolScorecard, ScoreNode } from "@/lib/types"

const OBS_STORAGE_PREFIX = "esa-report-observations:v2:"

type ObservationEdits = {
  lines: [string, string, string]
  edited: [boolean, boolean, boolean]
}

function padObservationSlots(lines: string[]): [string, string, string] {
  return [lines[0]?.trim() ?? "", lines[1]?.trim() ?? "", lines[2]?.trim() ?? ""]
}

function loadObservationEdits(storageKey: string): ObservationEdits | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(`${OBS_STORAGE_PREFIX}${storageKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ObservationEdits> | unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const record = parsed as Partial<ObservationEdits>
    if (!Array.isArray(record.lines) || !Array.isArray(record.edited)) return null
    return {
      lines: padObservationSlots(record.lines.map((item) => String(item ?? ""))),
      edited: [Boolean(record.edited[0]), Boolean(record.edited[1]), Boolean(record.edited[2])],
    }
  } catch {
    return null
  }
}

function saveObservationEdits(storageKey: string, edits: ObservationEdits): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(`${OBS_STORAGE_PREFIX}${storageKey}`, JSON.stringify(edits))
  } catch {
    /* ignore quota */
  }
}

const ReportPaletteContext = createContext<ReportPalette>(REPORT_PALETTES.good)

function useReportPalette() {
  return useContext(ReportPaletteContext)
}

function scoreNumber(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "—"
  return String(Math.round(score))
}

function ScoreCell({
  score,
  strong = false,
  blank = false,
}: {
  score: number | null | undefined
  strong?: boolean
  blank?: boolean
}) {
  if (blank) {
    return <td className="border border-slate-200 bg-white px-2 py-2" />
  }
  const palette = useReportPalette()
  const colors = scoreBandColors(score, palette)
  return (
    <td
      className={`border-2 border-white px-2 py-2 text-center tabular-nums ${strong ? "font-semibold" : ""}`}
      style={{ backgroundColor: colors.bg, color: colors.fg }}
    >
      {scoreNumber(score)}
    </td>
  )
}

function ScoreChip({
  score,
  className = "",
}: {
  score: number | null | undefined
  className?: string
}) {
  const palette = useReportPalette()
  const colors = scoreBandColors(score, palette)
  return (
    <span className={className} style={{ backgroundColor: colors.bg, color: colors.fg }}>
      {scoreNumber(score)}
    </span>
  )
}

function ScoreText({
  score,
  className = "",
}: {
  score: number | null | undefined
  className?: string
}) {
  const palette = useReportPalette()
  return (
    <span className={className} style={{ color: scoreBandHex(score, palette) }}>
      {scoreNumber(score)}
    </span>
  )
}

function ScoreLegend() {
  const palette = useReportPalette()
  const good = scoreBandColors(SCORE_GOOD, palette)
  const fair = scoreBandColors(SCORE_FAIR, palette)
  const poor = scoreBandColors(SCORE_FAIR - 1, palette)
  return (
    <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
      <span
        className="whitespace-nowrap rounded px-1.5 py-0.5 font-medium"
        style={{ backgroundColor: good.bg, color: good.fg }}
      >
        Good {SCORE_GOOD}+
      </span>
      <span
        className="whitespace-nowrap rounded px-1.5 py-0.5 font-medium"
        style={{ backgroundColor: fair.bg, color: fair.fg }}
      >
        Fair {SCORE_FAIR}–{SCORE_GOOD}
      </span>
      <span
        className="whitespace-nowrap rounded px-1.5 py-0.5 font-medium"
        style={{ backgroundColor: poor.bg, color: poor.fg }}
      >
        Poor below {SCORE_FAIR}
      </span>
    </div>
  )
}

function AverageTickLegend({ label = "Grade-type average" }: { label?: string }) {
  const palette = useReportPalette()
  return (
    <div className="flex shrink-0 items-center gap-2 text-[11px] leading-none text-slate-500">
      <span
        className="inline-block h-3.5 w-[3px] rounded-full"
        style={{ backgroundColor: palette.navy }}
        aria-hidden
      />
      <span>{label}</span>
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
  const palette = useReportPalette()
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3">
      <div>
        <p className="mb-1 text-[13px] font-medium text-slate-800">{label}</p>
        <div className="relative h-3 overflow-visible rounded-full bg-slate-200">
          {score != null ? (
            <div
              className="h-3 rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, score))}%`,
                backgroundColor: scoreBandHex(score, palette),
              }}
            />
          ) : null}
          {average != null ? (
            <span
              className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full"
              style={{ left: `${Math.max(0, Math.min(100, average))}%`, backgroundColor: palette.navy }}
              title="Grade-type average"
              aria-label="Grade-type average"
            />
          ) : null}
        </div>
      </div>
      <p className="text-right text-sm font-semibold tabular-nums text-slate-900">{scoreNumber(score)}</p>
    </div>
  )
}

function CategoryBreakdownCard({
  category,
  average,
}: {
  category: ScoreNode
  average?: number | null
}) {
  const subs = categorySubcategories(category)
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-2.5">
      <ReportBar label={category.label} score={category.score} average={average} />
      {subs.length ? (
        <ul className="mt-2 divide-y divide-slate-100">
          {subs.map((sub) => (
            <li key={sub.id} className="flex items-center justify-between gap-3 py-1">
              <span className="text-[12px] leading-snug text-slate-600">{reportDisplayLabel(sub.label)}</span>
              <ScoreChip
                score={sub.score}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-slate-400">No scored items in this category yet</p>
      )}
    </article>
  )
}

function renderObservationMarkup(text: string): ReactNode {
  if (!text.trim()) return null
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    const match = /^\*\*([^*]+)\*\*$/.exec(part)
    if (match) {
      return (
        <strong key={index} className="font-semibold text-slate-800">
          {match[1]}
        </strong>
      )
    }
    return <span key={index}>{part}</span>
  })
}

function Observations({
  title = "Observations",
  storageKey,
  preset,
}: {
  title?: string
  storageKey: string
  preset: string[]
}) {
  const auto = padObservationSlots(preset)
  const [edits, setEdits] = useState<ObservationEdits>(
    () => loadObservationEdits(storageKey) ?? { lines: auto, edited: [false, false, false] },
  )
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  useEffect(() => {
    setEdits(loadObservationEdits(storageKey) ?? { lines: auto, edited: [false, false, false] })
    setEditingIndex(null)
  }, [storageKey])

  const lines: [string, string, string] = [
    edits.edited[0] ? edits.lines[0] : auto[0],
    edits.edited[1] ? edits.lines[1] : auto[1],
    edits.edited[2] ? edits.lines[2] : auto[2],
  ]

  function update(index: number, value: string) {
    setEdits((current) => {
      const next: ObservationEdits = {
        lines: [current.edited[0] ? current.lines[0] : auto[0], current.edited[1] ? current.lines[1] : auto[1], current.edited[2] ? current.lines[2] : auto[2]],
        edited: [...current.edited] as [boolean, boolean, boolean],
      }
      next.lines[index] = value
      next.edited[index] = true
      saveObservationEdits(storageKey, next)
      return next
    })
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</p>
        <p className="text-[10px] text-slate-400 print:hidden">Auto-filled from scores. Click a line to edit; saved on this browser.</p>
      </div>
      <ol className="mt-2 space-y-1.5">
        {lines.map((line, index) => (
          <li key={index} className="flex gap-2 text-lg leading-snug text-slate-600">
            <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[13px] font-bold text-slate-700">
              {index + 1}
            </span>
            {editingIndex === index ? (
              <>
                <textarea
                  autoFocus
                  value={line}
                  onChange={(event) => update(index, event.target.value)}
                  onBlur={() => setEditingIndex(null)}
                  rows={2}
                  placeholder="Observations will be written here"
                  className="min-h-[2.75rem] w-full resize-none rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-lg leading-snug text-slate-700 outline-none print:hidden"
                />
                <p className="hidden min-h-[2.75rem] w-full px-1.5 py-1 text-lg leading-snug text-slate-700 print:block">
                  {renderObservationMarkup(line)}
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditingIndex(index)}
                className="min-h-[2.75rem] w-full rounded-lg px-1.5 py-1 text-left text-lg leading-snug text-slate-700 print:cursor-default"
              >
                {line.trim() ? (
                  renderObservationMarkup(line)
                ) : (
                  <span className="text-slate-400 print:hidden">Observations will be written here</span>
                )}
              </button>
            )}
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

const ReportFitContext = createContext<{
  zoom: number
  report: (id: string, ratio: number) => void
}>({ zoom: 1, report: () => {} })

function ReportFitProvider({ children }: { children: ReactNode }) {
  const [ratios, setRatios] = useState<Record<string, number>>({})
  const zoom = useMemo(() => {
    const values = Object.values(ratios)
    if (!values.length) return 1
    return Math.min(1, ...values)
  }, [ratios])
  const report = useCallback((id: string, ratio: number) => {
    const next = Math.round(Math.min(1, Math.max(0.5, ratio)) * 1000) / 1000
    setRatios((current) => (current[id] === next ? current : { ...current, [id]: next }))
  }, [])
  return <ReportFitContext.Provider value={{ zoom, report }}>{children}</ReportFitContext.Provider>
}

function ReportPage({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const { zoom, report } = useContext(ReportFitContext)

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
      report(id, needed > available + 2 ? available / needed : 1)
      inner.style.setProperty("zoom", String(zoom))
      inner.style.minHeight = `${available / zoom}px`
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
  }, [children, id, report, zoom])

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

function SpaceScoreCard({ space, categories }: { space: ScoreNode; categories: string[] }) {
  const palette = useReportPalette()
  const tree = spaceCategoryTree(space)
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h5 className="min-w-0 truncate text-sm font-semibold text-slate-900">{space.label}</h5>
        <ScoreChip
          score={space.score}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-sm font-bold tabular-nums"
        />
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
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(0, Math.min(100, score))}%`,
                          backgroundColor: scoreBandHex(score, palette),
                        }}
                      />
                    ) : null}
                  </div>
                </div>
                <ScoreText score={score} className="text-right text-[11px] font-semibold tabular-nums" />
              </div>
              {subs.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {subs.map((sub) => {
                    const colors = scoreBandColors(sub.score, palette)
                    return (
                      <span
                        key={sub.id}
                        className="rounded-md px-1.5 py-0.5 text-[10px] leading-tight"
                        style={{ backgroundColor: colors.bg, color: colors.fg }}
                      >
                        {reportDisplayLabel(sub.label)} {scoreNumber(sub.score)}
                      </span>
                    )
                  })}
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
  spaceTypeRows = [],
}: {
  card: SchoolScorecard
  fleet: SchoolScorecard[]
  school: SchoolIndexEntry
  schoolLevel: SchoolLevel
  axisOrder: string[]
  spaceTypeRows?: Array<{ focusArea: string; spaceType: string }>
}) {
  const averageLabel = levelAverageLabel(schoolLevel)
  const average = averageScorecard(fleet, averageLabel, schoolLevel)
  const name = displaySchoolName(card.schoolName)
  const focuses = orderedFocusAreas(card, axisOrder)
  const categories = scoringCategories(card)
  const totalPages = 2 + focuses.length
  const prepared = formatPreparedDate()
  const scoresAsOf = formatPreparedDate(school.exportedAt)
  const [paletteId, setPaletteId] = useState<ReportPaletteId>(loadReportPaletteId)
  const palette = REPORT_PALETTES[paletteId]
  const expectedSpaces = useMemo(() => expectedSpacesFromRows(spaceTypeRows), [spaceTypeRows])
  const overviewObservations = campusObservationSlots(card, fleet, schoolLevel, expectedSpaces)

  function selectPalette(id: ReportPaletteId) {
    setPaletteId(id)
    saveReportPaletteId(id)
  }

  return (
    <ReportPaletteContext.Provider value={palette}>
    <ReportFitProvider>
    <div className="report-print-root space-y-4 print:space-y-0">
      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
        <div className="inline-flex items-center rounded-full bg-white p-0.5 text-xs font-semibold shadow-sm ring-1 ring-slate-200">
          {(["good", "worst"] as const).map((id) => {
            const option = REPORT_PALETTES[id]
            const selected = paletteId === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectPalette(id)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
                style={
                  selected
                    ? { backgroundColor: option.navy, color: "#ffffff" }
                    : { backgroundColor: "transparent", color: option.navy }
                }
              >
                <span className="flex items-center gap-0.5" aria-hidden>
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: option.navy }} />
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: option.blue }} />
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: option.accent }} />
                </span>
                {option.label}
              </button>
            )
          })}
        </div>
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
          <div className="flex items-center bg-white px-6 py-2.5">
            <AisdLogo className="h-10 w-auto" />
          </div>
          <div className="h-1" style={{ backgroundColor: palette.accent }} />
          <div className="px-6 py-3.5 text-white" style={{ backgroundColor: palette.navy }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: palette.blue }}>
              Educational Suitability Assessment Report
            </p>
            <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight">{name}</h2>
                <p className="mt-1 text-sm" style={{ color: hexToRgba("#ffffff", 0.78) }}>
                  [Address]
                </p>
                <p className="mt-1 text-xs" style={{ color: hexToRgba("#ffffff", 0.62) }}>
                  Scores as of {scoresAsOf || prepared} · Prepared {prepared} · Perkins Eastman · AISD ESA
                </p>
              </div>
              <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-white shadow-inner">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">ESA</p>
                <ScoreText score={card.existingOnly} className="text-3xl font-bold leading-none tabular-nums" />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[minmax(13.5rem,15.5rem)_minmax(0,1fr)] gap-3">
          <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Educational Suitability</p>
            <ScoreText score={card.existingOnly} className="mt-2 block text-4xl font-bold tabular-nums" />
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              ESA measures how well campus spaces support teaching and learning. It scores the existing campus from the on-site walk.
            </p>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              This score is paired with FCI and Space Sufficiency to create a comprehensive view of the building&apos;s needs.
            </p>
          </div>
          <Observations storageKey={`${card.schoolId}:overview`} preset={overviewObservations} />
        </div>

        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-900">ESA focus areas at a glance</h4>
            <AverageTickLegend />
          </div>
          <div className="space-y-2">
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: palette.navy }}>
                Educational Suitability Assessment
              </p>
              <h3 className="text-xl font-semibold text-slate-900">{name}</h3>
            </div>
          </div>
          <p className="text-xs font-semibold text-slate-500">ESA OVERVIEW · Campus {card.campusId.replace(/-PILOT-\d+$/i, "")}</p>
        </div>
        <div className="mt-4 grid min-h-0 flex-1 grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] items-stretch gap-5">
          <div className="flex min-h-0 flex-col">
            <h4 className="text-sm font-semibold text-slate-900">Campus vs grade-type average</h4>
            <table className="mt-2 w-full table-fixed border-collapse text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="w-[58%] border border-slate-200 px-2 py-1.5 text-left font-semibold">Focus area</th>
                  <th className="border border-slate-200 px-2 py-1.5 text-center font-semibold">Campus</th>
                  <th className="border border-slate-200 px-2 py-1.5 text-center font-semibold">Avg</th>
                </tr>
              </thead>
              <tbody>
                {focuses.map((area) => (
                  <tr key={area.id}>
                    <td className="border border-slate-200 px-2 py-1.5 leading-snug text-slate-800">{area.label}</td>
                    <ScoreCell score={area.score} strong />
                    <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums text-slate-500">
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
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">Campus-wide categories</h4>
              <AverageTickLegend />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {card.categories
                .filter((node) => !isHiddenReportLabel(node.label))
                .sort((a, b) => categories.indexOf(a.label) - categories.indexOf(b.label))
                .map((node) => (
                  <CategoryBreakdownCard
                    key={node.id}
                    category={node}
                    average={average.categories.find((item) => item.label === node.label)?.score}
                  />
                ))}
            </div>
          </div>
        </div>
        <ReportFooter page={2} total={totalPages} schoolName={name} />
      </ReportPage>

      {focuses.map((focus, index) => {
        const spaceRows = focusSpaceTableRows(focus, card, fleet, expectedSpaces)
        const scoredSpaces = spaceRows.filter((row) => !row.missing && row.space)
        const hasMissingSpaces = spaceRows.some((row) => row.missing)
        return (
          <ReportPage key={focus.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <AisdLogo className="h-10 w-auto" />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: palette.navy }}>
                    Scoring focus area
                  </p>
                  <h3 className="text-xl font-semibold text-slate-900">{focus.label}</h3>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Focus score</p>
                <ScoreText score={focus.score} className="text-4xl font-bold tabular-nums" />
              </div>
            </div>

            <div className="mt-5">
              <Observations
                storageKey={`${card.schoolId}:${focus.label}`}
                preset={focusObservationSlots(focus, card, fleet, schoolLevel, expectedSpaces)}
              />
            </div>

            <div className="mt-5">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <h4 className="text-sm font-semibold text-slate-900">Space types</h4>
                <ScoreLegend />
              </div>
              <table className="w-full table-fixed border-collapse text-[12px]">
                <thead>
                  <tr className="bg-slate-50 text-[10px] text-slate-500">
                    <th className="w-[22%] border border-slate-200 px-2 py-1.5 text-left font-semibold uppercase tracking-wide">
                      Space type
                    </th>
                    {categories.map((category) => (
                      <th
                        key={category}
                        className="border border-slate-200 px-1.5 py-1.5 text-center font-semibold leading-tight"
                      >
                        {category}
                      </th>
                    ))}
                    <th className="border border-slate-200 px-1.5 py-1.5 text-center font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {spaceRows.map((row) => (
                    <tr key={row.space?.id ?? `missing:${row.label}`}>
                      <td
                        className={`border border-slate-200 px-2 py-1.5 ${
                          row.missing ? "italic text-slate-400" : "text-slate-800"
                        }`}
                      >
                        {row.label}
                      </td>
                      {categories.map((category) => (
                        <ScoreCell
                          key={category}
                          blank={row.missing}
                          score={row.space ? spaceTypeCategoryScore(row.space, category) : null}
                        />
                      ))}
                      <ScoreCell blank={row.missing} score={row.space?.score} strong />
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMissingSpaces ? (
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
                  Missing space types are accounted for in the Space Sufficiency calculation.
                </p>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {scoredSpaces.map((row) => (
                <SpaceScoreCard key={`${row.space!.id}-detail`} space={row.space!} categories={categories} />
              ))}
            </div>
            <ReportFooter page={3 + index} total={totalPages} schoolName={name} />
          </ReportPage>
        )
      })}
    </div>
    </ReportFitProvider>
    </ReportPaletteContext.Provider>
  )
}
