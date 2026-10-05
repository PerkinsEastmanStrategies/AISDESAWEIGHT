"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Building2, ClipboardCheck, FileText, GitCompare, LayoutGrid, RotateCcw } from "lucide-react"
import { AisdLogo } from "@/components/aisd-logo"
import { CampusReport } from "@/components/campus-report"
import { CategorySpider } from "@/components/category-spider"
import { AisdHandoffBanner, QaHandoffPanel } from "@/components/qa-handoff-panel"
import { SchoolPanel } from "@/components/school-panel"
import { SchoolQaPanel } from "@/components/school-qa-panel"
import { OVERALL_SLICE, SchoolScoreBubbles } from "@/components/school-score-bubbles"
import { ScoreBadge, DeltaChip } from "@/components/score-badge"
import { WeightEditor } from "@/components/weight-editor"
import { isObservational } from "@/lib/normalize"
import {
  discardQaRoom,
  loadDiscardedRooms,
  omitDiscardedRooms,
  type DiscardedRoom,
} from "@/lib/qa-discard"
import {
  handoffForSchool,
  loadQaHandoffs,
  upsertQaHandoff,
  type QaHandoff,
} from "@/lib/qa-handoff"
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

type Workstream = "internal" | "aisd" | "report" | "explorer"
type QaPane = "campus" | "all"

const WORKSTREAMS: { id: Workstream; label: string; icon: typeof ClipboardCheck }[] = [
  { id: "internal", label: "Internal QA", icon: ClipboardCheck },
  { id: "aisd", label: "AISD QA", icon: Building2 },
  { id: "report", label: "Report", icon: FileText },
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

function useSchoolSnapshots(requestKey: string) {
  "use no memo"
  const [snapshots, setSnapshots] = useState<Record<string, SchoolSnapshot>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const snapshotsRef = useRef(snapshots)
  snapshotsRef.current = snapshots

  useEffect(() => {
    const ids = requestKey ? requestKey.split("|") : []
    let cancelled = false
    async function load() {
      const missing = ids.filter((id) => !snapshotsRef.current[id])
      if (!missing.length) return
      setLoadError(null)
      try {
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
  }, [requestKey])

  return { snapshots, loadError, setLoadError }
}

function workstreamCopy(view: Workstream, qaPane: QaPane): string {
  if (view === "report") {
    return "Campus assessment report with overall scores, observations, and focus-area space type detail"
  }
  if (view === "explorer") {
    return "Weighting Explorer: compare walked schools and watch scores move as weights change"
  }
  if (view === "aisd") {
    return qaPane === "all"
      ? "AISD QA overview of campuses that Internal QA has approved and moved forward"
      : "AISD review of campuses handed off from Internal QA"
  }
  return qaPane === "all"
    ? "Internal QA overview of every walked campus, before a campus is moved to AISD review"
    : "Internal QA one campus down to the question, with room pictures and a floor plan"
}

export function WeightingApp({ schoolOptions }: { schoolOptions: SchoolIndexEntry[] }) {
  const [schemeId, setSchemeId] = useState<CategorySchemeId>("original")
  const [schoolLevel, setSchoolLevel] = useState<SchoolLevel>("ES")
  const [view, setView] = useState<Workstream>("internal")
  const [qaPane, setQaPane] = useState<QaPane>("campus")
  const [sliceId, setSliceId] = useState(OVERALL_SLICE)
  const [leftId, setLeftId] = useState("")
  const [rightId, setRightId] = useState("")
  const [qaSchoolId, setQaSchoolId] = useState("")
  const [aisdSchoolId, setAisdSchoolId] = useState("")
  const [qaRoomId, setQaRoomId] = useState<string | null>(null)
  const [reportSchoolId, setReportSchoolId] = useState("")
  const [handoffs, setHandoffs] = useState<QaHandoff[]>([])
  const [discardedRooms, setDiscardedRooms] = useState<DiscardedRoom[]>([])
  const [weightFiles, setWeightFiles] = useState<Partial<Record<CategorySchemeId, WeightFile>>>({})
  const [overridesByScheme, setOverridesByScheme] = useState(emptyOverrideMap)
  const overrides = overridesByScheme[schemeId][schoolLevel]
  const setOverrides = (next: WeightOverrides) => {
    setOverridesByScheme((current) => ({
      ...current,
      [schemeId]: { ...current[schemeId], [schoolLevel]: next },
    }))
  }

  useEffect(() => {
    setHandoffs(loadQaHandoffs())
    setDiscardedRooms(loadDiscardedRooms())
  }, [])

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
  const aisdOptions = useMemo(
    () => levelOptions.filter((school) => handoffForSchool(handoffs, school.schoolId)),
    [levelOptions, handoffs],
  )
  const qaOptions = view === "aisd" ? aisdOptions : levelOptions
  const activeQaSchoolId = view === "aisd" ? aisdSchoolId : qaSchoolId
  const showingQaCampus = (view === "internal" || view === "aisd") && qaPane === "campus"
  const showingQaAll = (view === "internal" || view === "aisd") && qaPane === "all"
  const showingFleet = showingQaAll || view === "report"
  const snapshotKey = showingFleet
    ? (view === "aisd" ? aisdOptions : levelOptions).map((school) => school.schoolId).join("|")
    : showingQaCampus
      ? activeQaSchoolId
      : [leftId, rightId].filter(Boolean).join("|")
  const { snapshots, loadError, setLoadError } = useSchoolSnapshots(snapshotKey)

  function prepareSnapshot(snapshot: SchoolSnapshot) {
    const kept = omitDiscardedRooms(snapshot, discardedRooms)
    return levelWeights ? alignSnapshotToWeights(kept, levelWeights) : kept
  }

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
  }, [schemeId, weightFiles, setLoadError])

  const selectedSchools = useMemo(
    () => {
      if (!levelWeights) return []
      return [leftId, rightId]
        .map((id) => snapshots[id])
        .filter((school): school is SchoolSnapshot => Boolean(school))
        .map((school) => prepareSnapshot(school))
    },
    [leftId, rightId, snapshots, levelWeights, discardedRooms],
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
  const fleetSource = view === "aisd" ? aisdOptions : levelOptions
  const fleetCards = useMemo(() => {
    if (!showingFleet || !resolver || !levelWeights) return []
    return fleetSource
      .map((option) => snapshots[option.schoolId])
      .filter((school): school is SchoolSnapshot => Boolean(school))
      .map((school) => scoreSchool(prepareSnapshot(school), resolver))
  }, [showingFleet, resolver, levelWeights, fleetSource, snapshots, discardedRooms])
  const scoringCategories = useMemo(() => {
    const seen = new Map<string, string>()
    for (const card of fleetCards) {
      for (const category of card.categories) {
        if (isObservational(category.label)) continue
        seen.set(category.label, category.label)
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [fleetCards])
  const qaAligned = useMemo(() => {
    if (!showingQaCampus || !levelWeights) return null
    const snapshot = snapshots[activeQaSchoolId]
    if (!snapshot) return null
    return prepareSnapshot(snapshot)
  }, [showingQaCampus, levelWeights, snapshots, activeQaSchoolId, discardedRooms])
  const qaCard = useMemo(() => {
    if (!qaAligned || !resolver || !baseline) return null
    return scoreSchool(qaAligned, resolver, baseline)
  }, [qaAligned, resolver, baseline])
  const reportCard = useMemo(() => {
    if (view !== "report" || !resolver || !levelWeights) return null
    const snapshot = snapshots[reportSchoolId]
    if (!snapshot) return null
    return scoreSchool(prepareSnapshot(snapshot), resolver)
  }, [view, resolver, levelWeights, snapshots, reportSchoolId, discardedRooms])
  const reportSchool = levelOptions.find((school) => school.schoolId === reportSchoolId) ?? null
  const fleetPending = showingFleet && fleetSource.some((school) => !snapshots[school.schoolId])
  const activeHandoff = handoffForSchool(handoffs, activeQaSchoolId)

  function selectLevel(next: SchoolLevel) {
    if (next === schoolLevel) return
    setSchoolLevel(next)
    setSliceId(OVERALL_SLICE)
    setLeftId("")
    setRightId("")
    setQaSchoolId("")
    setAisdSchoolId("")
    setQaRoomId(null)
    setReportSchoolId("")
    setLoadError(null)
  }

  function selectScheme(next: CategorySchemeId) {
    if (next === schemeId) return
    setSchemeId(next)
    setSliceId(OVERALL_SLICE)
  }

  function openQaCampus(schoolId: string) {
    if (view === "aisd") setAisdSchoolId(schoolId)
    else setQaSchoolId(schoolId)
    setQaRoomId(null)
    setQaPane("campus")
  }

  function moveToAisdQa(movedBy: string) {
    const school = levelOptions.find((item) => item.schoolId === qaSchoolId)
    if (!school) return
    setHandoffs(
      upsertQaHandoff({
        schoolId: school.schoolId,
        schoolName: school.schoolName,
        movedBy,
        movedAt: new Date().toISOString(),
      }),
    )
  }

  function discardActiveRoom(roomId: string) {
    if (!qaSchoolId) return
    setDiscardedRooms(discardQaRoom(qaSchoolId, roomId))
    if (qaRoomId === roomId) setQaRoomId(null)
  }

  useEffect(() => {
    if (view !== "report" || reportSchoolId) return
    const preferred =
      levelOptions.find((school) => school.schoolId === "casis-pilot-2") ?? levelOptions[0]
    if (preferred) setReportSchoolId(preferred.schoolId)
  }, [view, reportSchoolId, levelOptions])

  const showWeights = view === "explorer"

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="app-banner sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <AisdLogo className="h-10 w-auto sm:h-11" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
                AISD ESA
              </p>
              <h1 className="text-xl font-semibold tracking-tight">QA portal</h1>
              <p className="text-sm text-slate-500">{workstreamCopy(view, qaPane)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-slate-100 p-1">
              {WORKSTREAMS.map((option) => {
                const Icon = option.icon
                const active = view === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setView(option.id)
                      setQaRoomId(null)
                      if (option.id === "report") setSchemeId("original")
                    }}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                      active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <Icon size={14} />
                    {option.label}
                  </button>
                )
              })}
            </div>
            {view === "explorer"
              ? cards.map((card) => (
                  <div
                    key={card.schoolId}
                    className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 ring-1 ring-slate-200"
                  >
                    <span className="text-xs font-medium text-slate-500">{card.schoolName}</span>
                    <ScoreBadge score={card.existingOnly} />
                    <DeltaChip current={card.existingOnly} baseline={card.existingOnlyBaseline} />
                  </div>
                ))
              : null}
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
          {view === "internal" || view === "aisd" ? (
            <div className="min-w-[240px] flex-1">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                {view === "aisd" ? "AISD QA" : "Internal QA"}
              </span>
              <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setQaPane("campus")}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    qaPane === "campus" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <ClipboardCheck size={14} />
                  Campus review
                </button>
                <button
                  type="button"
                  onClick={() => setQaPane("all")}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    qaPane === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <LayoutGrid size={14} />
                  All schools
                </button>
              </div>
            </div>
          ) : null}
          <ToggleGroup
            label="Category set"
            value={schemeId}
            options={SCHEMES}
            onChange={selectScheme}
          />
          <ToggleGroup
            label="School level"
            value={schoolLevel}
            options={LEVELS.map((level) => {
              const inLevel = schoolOptions.filter((school) => optionLevel(school) === level.id)
              const count =
                view === "aisd"
                  ? inLevel.filter((school) => handoffForSchool(handoffs, school.schoolId)).length
                  : inLevel.length
              return {
                id: level.id,
                label: `${level.label} ${count}`,
              }
            })}
            onChange={selectLevel}
          />
          <button
            type="button"
            onClick={() => setView("explorer")}
            className={`mb-0.5 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ring-1 transition ${
              view === "explorer"
                ? "bg-slate-900 text-white ring-slate-900"
                : "bg-white text-slate-500 ring-slate-200 hover:text-slate-800"
            }`}
          >
            <GitCompare size={14} />
            Weighting Explorer
          </button>
        </div>
      </header>

      <main
        className={`mx-auto max-w-[1600px] gap-4 px-4 py-4 ${
          showingQaCampus || showingQaAll || view === "report"
            ? "block"
            : `grid grid-cols-1 ${showingQaAll ? "lg:grid-cols-[340px_minmax(0,1fr)]" : "lg:grid-cols-[420px_minmax(0,1fr)]"}`
        }`}
      >
        {showWeights ? (
        <aside className="lg:sticky lg:top-[168px] lg:h-[calc(100dvh-184px)]">
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
        ) : null}

        <div className="min-w-0 space-y-4">
          {showingQaAll ? (
            <>
              {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
              {view === "aisd" && aisdOptions.length === 0 ? (
                <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
                  <p className="text-sm font-medium text-slate-900">No campuses in AISD QA yet</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Internal QA has to review a campus and use Move to AISD QA before it appears here.
                  </p>
                </div>
              ) : (
                <SchoolScoreBubbles
                  cards={fleetCards}
                  sliceId={sliceId}
                  focusAreas={focusAreaOrder}
                  scoringCategories={scoringCategories}
                  onSliceChange={setSliceId}
                  onOpenSchool={openQaCampus}
                  loading={fleetPending}
                  levelLabel={LEVELS.find((level) => level.id === schoolLevel)?.label ?? "Schools"}
                  openHint={
                    view === "aisd" ? "Click to open in AISD QA" : "Click to open in Internal QA"
                  }
                  emptyMessage={
                    view === "aisd"
                      ? "No scored AISD QA campuses for this filter."
                      : "No scored campuses for this filter."
                  }
                />
              )}
            </>
          ) : showingQaCampus ? (
            <div className="space-y-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
                <SchoolSelect
                  label={view === "aisd" ? "School in AISD QA" : "School to review"}
                  value={activeQaSchoolId}
                  options={qaOptions.map((school) =>
                    view === "internal" && handoffForSchool(handoffs, school.schoolId)
                      ? { ...school, schoolName: `${school.schoolName} · AISD QA` }
                      : school,
                  )}
                  hiddenId=""
                  onChange={(id) => {
                    if (view === "aisd") setAisdSchoolId(id)
                    else setQaSchoolId(id)
                    setQaRoomId(null)
                  }}
                />
                {view === "aisd" && aisdOptions.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No campuses have been moved from Internal QA yet.
                  </p>
                ) : null}
              </div>
              {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
              {activeQaSchoolId && !qaCard ? <p className="text-sm text-slate-500">Loading campus…</p> : null}
              {view === "aisd" && qaCard && activeHandoff ? <AisdHandoffBanner handoff={activeHandoff} /> : null}
              {qaCard && qaAligned ? (
                <SchoolQaPanel
                  card={qaCard}
                  snapshot={qaAligned}
                  selectedRoomId={qaRoomId}
                  onSelectRoom={setQaRoomId}
                  allowDiscard={view === "internal"}
                  onDiscardRoom={view === "internal" ? discardActiveRoom : undefined}
                />
              ) : null}
              {view === "internal" && qaCard ? (
                <QaHandoffPanel
                  schoolName={qaCard.schoolName}
                  existing={activeHandoff}
                  onSubmit={moveToAisdQa}
                />
              ) : null}
            </div>
          ) : view === "report" ? (
            <div className="space-y-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5 print:hidden">
                <SchoolSelect
                  label="School to report"
                  value={reportSchoolId}
                  options={levelOptions}
                  hiddenId=""
                  onChange={setReportSchoolId}
                />
                <p className="mt-2 text-xs text-slate-500">
                  Uses Original Categories for now (Infrastructure, Amenities, Occupant Experience, Function).
                </p>
              </div>
              {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
              {reportSchoolId && !reportCard ? <p className="text-sm text-slate-500">Loading campus report…</p> : null}
              {reportCard && reportSchool ? (
                <CampusReport
                  card={reportCard}
                  fleet={fleetCards}
                  school={reportSchool}
                  schoolLevel={schoolLevel}
                  axisOrder={focusAreaOrder}
                />
              ) : null}
            </div>
          ) : (
            <>
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
            </>
          )}
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
