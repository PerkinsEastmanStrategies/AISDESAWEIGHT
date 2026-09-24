"use client"

import { useEffect, useMemo, useState } from "react"
import { RotateCcw } from "lucide-react"
import { CategorySpider } from "@/components/category-spider"
import { SchoolPanel } from "@/components/school-panel"
import { ScoreBadge, DeltaChip } from "@/components/score-badge"
import { WeightEditor } from "@/components/weight-editor"
import { scoreSchool } from "@/lib/scoring"
import {
  alignSnapshotToWeights,
  createWeightResolver,
  EMPTY_OVERRIDES,
  emptyOverrides,
  filterWeightsForLevel,
  overrideCount,
} from "@/lib/weights"
import type {
  CategorySchemeId,
  SchoolIndexEntry,
  SchoolLevel,
  SchoolSnapshot,
  WeightFile,
  WeightOverrides,
} from "@/lib/types"

const SCHEMES: { id: CategorySchemeId; label: string }[] = [
  { id: "original", label: "Original Categories" },
  { id: "revised", label: "Revised Categories" },
]

const LEVELS: { id: SchoolLevel; label: string }[] = [
  { id: "ES", label: "Elementary" },
  { id: "MS", label: "Middle" },
  { id: "HS", label: "High" },
]

function optionLevel(school: SchoolIndexEntry): SchoolLevel {
  if (school.schoolLevel) return school.schoolLevel
  if (school.schoolClass === "MID") return "MS"
  if (school.schoolClass === "HIGH") return "HS"
  return "ES"
}

function emptyOverrideMap(): Record<CategorySchemeId, Record<SchoolLevel, WeightOverrides>> {
  return {
    original: { ES: emptyOverrides(), MS: emptyOverrides(), HS: emptyOverrides() },
    revised: { ES: emptyOverrides(), MS: emptyOverrides(), HS: emptyOverrides() },
  }
}

export function WeightingApp({ schoolOptions }: { schoolOptions: SchoolIndexEntry[] }) {
  const [schemeId, setSchemeId] = useState<CategorySchemeId>("original")
  const [schoolLevel, setSchoolLevel] = useState<SchoolLevel>("ES")
  const [leftId, setLeftId] = useState("")
  const [rightId, setRightId] = useState("")
  const [snapshots, setSnapshots] = useState<Record<string, SchoolSnapshot>>({})
  const [weightFiles, setWeightFiles] = useState<Partial<Record<CategorySchemeId, WeightFile>>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [overridesByScheme, setOverridesByScheme] = useState(emptyOverrideMap)
  const overrides = overridesByScheme[schemeId][schoolLevel]
  const setOverrides = (next: WeightOverrides) => {
    setOverridesByScheme((current) => ({
      ...current,
      [schemeId]: { ...current[schemeId], [schoolLevel]: next },
    }))
  }

  const activeWeights = weightFiles[schemeId] ?? null
  const levelWeights = useMemo(
    () => (activeWeights ? filterWeightsForLevel(activeWeights, schoolLevel) : null),
    [activeWeights, schoolLevel],
  )
  const resolver = useMemo(
    () => (levelWeights ? createWeightResolver(levelWeights, overrides) : null),
    [levelWeights, overrides],
  )
  const baseline = useMemo(
    () => (levelWeights ? createWeightResolver(levelWeights, EMPTY_OVERRIDES) : null),
    [levelWeights],
  )
  const changed = overrideCount(overrides)
  const levelOptions = useMemo(
    () => schoolOptions.filter((school) => optionLevel(school) === schoolLevel),
    [schoolOptions, schoolLevel],
  )

  useEffect(() => {
    if (weightFiles[schemeId]) return
    let cancelled = false
    async function loadWeights() {
      try {
        const response = await fetch(`/weights/${schemeId}.json`)
        if (!response.ok) throw new Error(`Could not load ${schemeId} weights`)
        const file = (await response.json()) as WeightFile
        if (cancelled) return
        setWeightFiles((current) => ({ ...current, [schemeId]: file }))
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Could not load weights")
      }
    }
    void loadWeights()
    return () => {
      cancelled = true
    }
  }, [schemeId, weightFiles])

  useEffect(() => {
    const ids = [leftId, rightId].filter(Boolean)
    let cancelled = false
    async function load() {
      setLoadError(null)
      try {
        const missing = ids.filter((id) => !snapshots[id])
        if (!missing.length) return
        const loaded = await Promise.all(
          missing.map(async (id) => {
            const response = await fetch(`/schools/${id}.json`)
            if (!response.ok) throw new Error(`Could not load ${id}`)
            return [id, (await response.json()) as SchoolSnapshot] as const
          }),
        )
        if (cancelled) return
        setSnapshots((current) => {
          const next = { ...current }
          for (const [id, snapshot] of loaded) next[id] = snapshot
          return next
        })
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Could not load school data")
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [leftId, rightId, snapshots])

  const selectedSchools = useMemo(
    () => {
      if (!levelWeights) return []
      return [leftId, rightId]
        .map((id) => snapshots[id])
        .filter((school): school is SchoolSnapshot => Boolean(school))
        .map((school) => alignSnapshotToWeights(school, levelWeights))
    },
    [leftId, rightId, snapshots, levelWeights],
  )

  const cards = useMemo(
    () =>
      resolver && baseline
        ? selectedSchools.map((school) => scoreSchool(school, resolver, baseline))
        : [],
    [selectedSchools, resolver, baseline],
  )

  const pending =
    !levelWeights || [leftId, rightId].filter(Boolean).some((id) => !snapshots[id])
  const focusAreaOrder = useMemo(
    () => [...new Set(levelWeights?.focusAreas.map((row) => row.focusArea) ?? [])],
    [levelWeights],
  )

  function selectLevel(next: SchoolLevel) {
    if (next === schoolLevel) return
    setSchoolLevel(next)
    setLeftId("")
    setRightId("")
    setLoadError(null)
  }

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
              AISD ESA
            </p>
            <h1 className="text-xl font-semibold tracking-tight">Live weighting lab</h1>
            <p className="text-sm text-slate-500">
              Compare recently walked schools and watch scores move as weights change
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {cards.map((card) => (
              <div
                key={card.schoolId}
                className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 ring-1 ring-slate-200"
              >
                <span className="text-xs font-medium text-slate-500">{card.schoolName}</span>
                <ScoreBadge score={card.existingOnly} />
                <DeltaChip current={card.existingOnly} baseline={card.existingOnlyBaseline} />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setOverrides(emptyOverrides())}
              disabled={changed === 0}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <RotateCcw size={14} />
              Reset {changed > 0 ? `(${changed})` : ""}
            </button>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-end gap-3 px-4 pb-3">
          <ToggleGroup
            label="Category set"
            value={schemeId}
            options={SCHEMES}
            onChange={setSchemeId}
          />
          <ToggleGroup
            label="School level"
            value={schoolLevel}
            options={LEVELS.map((level) => ({
              id: level.id,
              label: `${level.label} ${schoolOptions.filter((school) => optionLevel(school) === level.id).length}`,
            }))}
            onChange={selectLevel}
          />
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-[148px] lg:h-[calc(100dvh-164px)]">
          <div className="flex h-full min-h-[420px] flex-col rounded-2xl bg-slate-50 p-4 shadow-sm ring-1 ring-slate-200">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-slate-900">
                {SCHEMES.find((scheme) => scheme.id === schemeId)?.label} ·{" "}
                {LEVELS.find((level) => level.id === schoolLevel)?.label} weights
              </h2>
              <p className="text-xs text-slate-500">
                {schemeId === "revised"
                  ? "Revised grouping adds Wrap Around Services and Shared Studios, moves Kitchen under Arrival, and uses the attached starting weights. Inventory and observational items have no points."
                  : "Original grouping and starting weights. Occupant Comfort and Safety & Supervision start at 12. Inventory and observational items have no points."}
              </p>
            </div>
            {levelWeights && resolver ? (
              <WeightEditor
                key={`${schemeId}-${schoolLevel}`}
                weights={levelWeights}
                overrides={overrides}
                resolver={resolver}
                onChange={setOverrides}
              />
            ) : (
              <p className="text-sm text-slate-500">Loading weights…</p>
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <SchoolSelect
                label="School A"
                value={leftId}
                options={levelOptions}
                hiddenId={rightId}
                onChange={setLeftId}
              />
              <SchoolSelect
                label="School B"
                value={rightId}
                options={levelOptions}
                hiddenId={leftId}
                onChange={setRightId}
              />
            </div>
            {levelOptions.length === 0 ? (
              <p className="text-sm text-slate-500">
                No walked {LEVELS.find((level) => level.id === schoolLevel)?.label.toLowerCase()} schools
                in this export yet.
              </p>
            ) : null}
            {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
            {pending ? <p className="text-sm text-slate-500">Loading…</p> : null}
            <CategorySpider cards={cards} axisOrder={focusAreaOrder} embedded />
          </div>

          {cards.length > 0 ? (
            <div className={`grid min-w-0 gap-4 ${cards.length > 1 ? "xl:grid-cols-2" : ""}`}>
              {cards.map((card) => (
                <SchoolPanel key={`${schemeId}-${card.schoolId}`} card={card} />
              ))}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}

function ToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="min-w-[240px] flex-1">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-slate-100 p-1">
        {options.map((option) => {
          const active = value === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SchoolSelect({
  label,
  value,
  options,
  hiddenId,
  onChange,
}: {
  label: string
  value: string
  options: SchoolIndexEntry[]
  hiddenId: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-900 outline-none ring-blue-600/0 transition focus:border-blue-300 focus:bg-white focus:ring-4"
      >
        <option value="">Select a school</option>
        {options.map((school) => (
          <option key={school.schoolId} value={school.schoolId} disabled={school.schoolId === hiddenId}>
            {school.schoolName}
          </option>
        ))}
      </select>
    </label>
  )
}
