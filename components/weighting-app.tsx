"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AtSign, BadgeCheck, Building2, ClipboardCheck, FileText, GitCompare, LayoutGrid, MessageSquare, RefreshCw, RotateCcw } from "lucide-react"
import { AisdLogo } from "@/components/aisd-logo"
import { CampusReport } from "@/components/campus-report"
import { SchoolCompareRadial } from "@/components/school-compare-radial"
import { AisdDecisionPanel } from "@/components/aisd-decision-panel"
import { AisdFeedbackPanel } from "@/components/aisd-feedback-panel"
import { AisdHandoffBanner, QaHandoffPanel } from "@/components/qa-handoff-panel"
import { SchoolPanel } from "@/components/school-panel"
import { AisdQaPanel } from "@/components/aisd-qa-panel"
import { QaMentionsPanel } from "@/components/qa-mentions-panel"
import { SchoolQaPanel } from "@/components/school-qa-panel"
import { OVERALL_SLICE, SchoolScoreBubbles } from "@/components/school-score-bubbles"
import { ScoreBadge, DeltaChip } from "@/components/score-badge"
import { WeightEditor } from "@/components/weight-editor"
import {
  discardQaRoom,
  loadDiscardedRooms,
  omitDiscardedRooms,
  type DiscardedRoom,
} from "@/lib/qa-discard"
import {
  aisdQueueEntries,
  baseSchoolIdFromHandoff,
  formatHandoffTimestamp,
  handoffForSchool,
  isAisdQueue,
  isFinalizedHandoff,
  isFeedbackHandoff,
  isInternalQueue,
  isTestAisdHandoff,
  isTestHandoffSchoolId,
  toTestHandoffSchoolId,
  withHandoffSchoolName,
  type QaHandoff,
} from "@/lib/qa-handoff"
import { fetchQaHandoffs, saveQaHandoffLive } from "@/lib/qa-live"
import { fetchSchoolCatalog, fetchSchoolSnapshot, refreshWalkedSchools } from "@/lib/school-catalog"
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

type Workstream = "internal" | "aisd" | "feedback" | "finalized" | "report" | "explorer"
type QaPane = "campus" | "all" | "mentions"

const WORKSTREAMS: { id: Workstream; label: string; icon: typeof ClipboardCheck }[] = [
  { id: "internal", label: "Internal QA", icon: ClipboardCheck },
  { id: "aisd", label: "AISD QA", icon: Building2 },
  { id: "feedback", label: "Feedback", icon: MessageSquare },
  { id: "finalized", label: "Finalized", icon: BadgeCheck },
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

function useSchoolSnapshots(requestKey: string, epoch: number) {
  "use no memo"
  const [snapshots, setSnapshots] = useState<Record<string, SchoolSnapshot>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const snapshotsRef = useRef(snapshots)
  snapshotsRef.current = snapshots

  useEffect(() => {
    if (epoch === 0) return
    setSnapshots({})
    snapshotsRef.current = {}
  }, [epoch])

  useEffect(() => {
    const ids = requestKey ? requestKey.split("|").filter(Boolean) : []
    let cancelled = false
    async function load() {
      const missing = ids.filter((id) => !snapshotsRef.current[id])
      if (!missing.length) return
      setLoadError(null)
      try {
        const loaded = await Promise.all(
          missing.map(async (id) => [id, await fetchSchoolSnapshot(id)] as const),
        )
        if (cancelled) return
        setSnapshots((current) => {
          const next = { ...current }
          for (const [id, snapshot] of loaded) next[id] = snapshot
          snapshotsRef.current = next
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
  }, [requestKey, epoch])

  return { snapshots, loadError, setLoadError }
}

function workstreamCopy(view: Workstream, qaPane: QaPane): string {
  if (view === "report") {
    return "Campus assessment report with overall scores, observations, and focus-area space type detail"
  }
  if (view === "explorer") {
    return "Weighting Explorer: compare walked schools and watch scores move as weights change"
  }
  if (view === "feedback") {
    return "Campuses AISD moved here so overall notes, focus-area notes, and question comments can be reviewed"
  }
  if (view === "finalized") {
    return qaPane === "all"
      ? "Campuses AISD accepted and moved to the finalized list"
      : "Read-only snapshot of a campus AISD marked as looking good"
  }
  if (view === "aisd") {
    if (qaPane === "mentions") {
      return "AISD QA comments tagged with @name, filterable by person"
    }
    return qaPane === "all"
      ? "AISD QA overview of campuses that Internal QA has approved and moved forward"
      : "AISD review of campuses handed off from Internal QA"
  }
  if (qaPane === "mentions") {
    return "Internal QA comments tagged with @name for the selected grade band, filterable by person"
  }
  return qaPane === "all"
    ? "Internal QA overview of every walked campus, before a campus is moved to AISD review"
    : "Internal QA one campus down to the question, with room pictures and a floor plan"
}

export function WeightingApp({ schoolOptions }: { schoolOptions: SchoolIndexEntry[] }) {
  const [schemeId, setSchemeId] = useState<CategorySchemeId>("revised")
  const [schoolLevel, setSchoolLevel] = useState<SchoolLevel>("ES")
  const [view, setView] = useState<Workstream>("internal")
  const [qaPane, setQaPane] = useState<QaPane>("campus")
  const [sliceId, setSliceId] = useState(OVERALL_SLICE)
  const [explorerIds, setExplorerIds] = useState(["", "", "", ""])
  const [qaSchoolId, setQaSchoolId] = useState("")
  const [aisdSchoolId, setAisdSchoolId] = useState("")
  const [finalizedSchoolId, setFinalizedSchoolId] = useState("")
  const [feedbackSchoolId, setFeedbackSchoolId] = useState("")
  const [qaRoomId, setQaRoomId] = useState<string | null>(null)
  const [reportSchoolId, setReportSchoolId] = useState("")
  const [handoffs, setHandoffs] = useState<QaHandoff[]>([])
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState(schoolOptions)
  const [snapshotEpoch, setSnapshotEpoch] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)
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
    setDiscardedRooms(loadDiscardedRooms())
    fetchQaHandoffs()
      .then((rows) => {
        setHandoffs(rows)
        setHandoffError(null)
      })
      .catch((error) => {
        setHandoffError(error instanceof Error ? error.message : "Could not load AISD QA handoffs")
      })
    fetchSchoolCatalog()
      .then(setCatalog)
      .catch(() => {
        /* keep the bundled school list if live catalog is unavailable */
      })
  }, [])

  useEffect(() => {
    if (view !== "aisd" && view !== "internal" && qaPane === "mentions") setQaPane("campus")
  }, [view, qaPane])

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
    () => catalog.filter((school) => optionLevel(school) === schoolLevel),
    [catalog, schoolLevel],
  )
  const aisdOptions = useMemo(
    () => aisdQueueEntries(levelOptions, handoffs),
    [levelOptions, handoffs],
  )
  const finalizedOptions = useMemo(
    () => levelOptions.filter((school) => isFinalizedHandoff(handoffForSchool(handoffs, school.schoolId))),
    [levelOptions, handoffs],
  )
  const feedbackOptions = useMemo(
    () => levelOptions.filter((school) => isFeedbackHandoff(handoffForSchool(handoffs, school.schoolId))),
    [levelOptions, handoffs],
  )
  const internalOptions = useMemo(
    () =>
      levelOptions.filter((school) => isInternalQueue(handoffForSchool(handoffs, school.schoolId))),
    [levelOptions, handoffs],
  )
  const qaOptions =
    view === "aisd" ? aisdOptions : view === "finalized" ? finalizedOptions : internalOptions
  const activeQaSchoolId =
    view === "aisd" ? aisdSchoolId : view === "finalized" ? finalizedSchoolId : qaSchoolId
  const showingQaCampus = (view === "internal" || view === "aisd" || view === "finalized") && qaPane === "campus"
  const showingQaAll = (view === "internal" || view === "aisd" || view === "finalized") && qaPane === "all"
  const showingQaMentions = (view === "aisd" || view === "internal") && qaPane === "mentions"
  const showingFleet = showingQaAll || view === "report"
  const snapshotKey = showingFleet
    ? (view === "aisd"
        ? aisdOptions
        : view === "finalized"
          ? finalizedOptions
          : view === "internal"
            ? internalOptions
            : levelOptions
      )
        .map((school) => school.schoolId)
        .join("|")
    : showingQaCampus
      ? activeQaSchoolId
      : view === "feedback"
        ? feedbackSchoolId
        : view === "explorer"
          ? levelOptions.map((school) => school.schoolId).join("|")
          : ""
  const { snapshots, loadError, setLoadError } = useSchoolSnapshots(snapshotKey, snapshotEpoch)

  async function refreshSchools() {
    setRefreshing(true)
    setRefreshNote(null)
    setLoadError(null)
    try {
      const result = await refreshWalkedSchools()
      setCatalog(result.schools)
      setSnapshotEpoch((value) => value + 1)
      if (result.added.length || result.updated.length) {
        const bits = []
        if (result.added.length) bits.push(`added ${result.added.join(", ")}`)
        if (result.updated.length) bits.push(`updated ${result.updated.join(", ")}`)
        setRefreshNote(`Refreshed from ESA: ${bits.join("; ")}.`)
      } else {
        setRefreshNote("No new or updated walked schools since the last refresh.")
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not refresh walked schools")
    } finally {
      setRefreshing(false)
    }
  }

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

  const explorerCards = useMemo(() => {
    if (view !== "explorer" || !resolver || !baseline || !levelWeights) return []
    return levelOptions
      .map((option) => snapshots[option.schoolId])
      .filter((school): school is SchoolSnapshot => Boolean(school))
      .map((school) => scoreSchool(prepareSnapshot(school), resolver, baseline))
  }, [view, resolver, baseline, levelWeights, levelOptions, snapshots, discardedRooms])
  const explorerSelected = useMemo(
    () =>
      explorerIds
        .map((id) => explorerCards.find((card) => card.schoolId === id) ?? null)
        .filter((card): card is NonNullable<typeof card> => Boolean(card)),
    [explorerIds, explorerCards],
  )
  const explorerPending =
    view === "explorer" &&
    (!levelWeights || levelOptions.some((school) => !snapshots[school.schoolId]))
  const focusAreaOrder = useMemo(
    () => [...new Set(levelWeights?.focusAreas.map((row) => row.focusArea) ?? [])],
    [levelWeights],
  )
  const fleetSource =
    view === "aisd" ? aisdOptions : view === "finalized" ? finalizedOptions : view === "internal" ? internalOptions : levelOptions
  const fleetCards = useMemo(() => {
    if (!showingFleet || !resolver || !levelWeights) return []
    const scored = fleetSource
      .map((option) => {
        const snapshot = snapshots[option.schoolId]
        if (!snapshot) return null
        return scoreSchool(
          prepareSnapshot({ ...snapshot, schoolId: option.schoolId, schoolName: option.schoolName }),
          resolver,
        )
      })
      .filter((card): card is NonNullable<typeof card> => Boolean(card))
    return view === "aisd" || view === "finalized" ? withHandoffSchoolName(scored, handoffs) : scored
  }, [showingFleet, resolver, levelWeights, fleetSource, snapshots, discardedRooms, view, handoffs])
  const qaAligned = useMemo(() => {
    if (!showingQaCampus || !levelWeights) return null
    const snapshot = snapshots[activeQaSchoolId]
    if (!snapshot) return null
    return prepareSnapshot(snapshot)
  }, [showingQaCampus, levelWeights, snapshots, activeQaSchoolId, discardedRooms])
  const qaCard = useMemo(() => {
    if (!qaAligned || !resolver || !baseline) return null
    const scored = scoreSchool(qaAligned, resolver, baseline)
    const option = qaOptions.find((school) => school.schoolId === activeQaSchoolId)
    if (!option) return scored
    return { ...scored, schoolId: option.schoolId, schoolName: option.schoolName }
  }, [qaAligned, resolver, baseline, qaOptions, activeQaSchoolId])
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
    setExplorerIds(["", "", "", ""])
    setQaSchoolId("")
    setAisdSchoolId("")
    setFinalizedSchoolId("")
    setFeedbackSchoolId("")
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
    else if (view === "finalized") setFinalizedSchoolId(schoolId)
    else setQaSchoolId(schoolId)
    setQaRoomId(null)
    setQaPane("campus")
  }

  function openMentionSchool(schoolId: string) {
    const base = baseSchoolIdFromHandoff(schoolId)
    const school =
      catalog.find((item) => item.schoolId === schoolId) ??
      catalog.find((item) => item.schoolId === base)
    if (school) setSchoolLevel(optionLevel(school))
    if (view === "aisd") {
      setAisdSchoolId(schoolId)
    } else {
      setQaSchoolId(base)
    }
    setQaRoomId(null)
    setQaPane("campus")
  }

  function rememberHandoff(saved: QaHandoff) {
    setHandoffs((current) => [...current.filter((item) => item.schoolId !== saved.schoolId), saved])
  }

  async function moveToAisdQa(movedBy: string) {
    const school = levelOptions.find((item) => item.schoolId === qaSchoolId)
    if (!school) return
    const current = handoffForSchool(handoffs, school.schoolId)
    if (current && isTestAisdHandoff(current) && !isTestHandoffSchoolId(current.schoolId)) {
      const kept = await saveQaHandoffLive({
        ...current,
        schoolId: toTestHandoffSchoolId(school.schoolId),
        status: "aisd",
      })
      rememberHandoff(kept)
    }
    const saved = await saveQaHandoffLive({
      schoolId: school.schoolId,
      schoolName: school.schoolName,
      movedBy,
      movedAt: new Date().toISOString(),
      status: "aisd",
      decisionBy: "",
      decisionAt: "",
      decisionComments: "",
    })
    rememberHandoff({ ...saved, movedBy: saved.movedBy || movedBy })
    setAisdSchoolId(school.schoolId)
    setView("aisd")
    setQaPane("campus")
  }

  async function finalizeSchool(schoolId: string, decidedBy: string) {
    const school = levelOptions.find((item) => item.schoolId === schoolId)
    const current = handoffForSchool(handoffs, schoolId)
    if (!school || !current) return
    const saved = await saveQaHandoffLive({
      ...current,
      schoolId: school.schoolId,
      schoolName: school.schoolName,
      movedBy: current.movedBy,
      movedAt: current.movedAt,
      status: "finalized",
      decisionBy: decidedBy,
      decisionAt: new Date().toISOString(),
      decisionComments: "",
    })
    rememberHandoff(saved)
    setFinalizedSchoolId(school.schoolId)
    setView("finalized")
    setQaPane("campus")
  }

  async function finalizeAisdSchool(decidedBy: string) {
    await finalizeSchool(aisdSchoolId, decidedBy)
  }

  async function finalizeReturnedSchool(decidedBy: string) {
    await finalizeSchool(qaSchoolId, decidedBy)
  }

  async function moveAisdSchoolToFeedback(decidedBy: string) {
    const school = levelOptions.find((item) => item.schoolId === aisdSchoolId)
    const current = handoffForSchool(handoffs, aisdSchoolId)
    if (!school || !current) return
    const saved = await saveQaHandoffLive({
      ...current,
      schoolId: school.schoolId,
      schoolName: school.schoolName,
      movedBy: current.movedBy,
      movedAt: current.movedAt,
      status: "feedback",
      decisionBy: decidedBy,
      decisionAt: new Date().toISOString(),
      decisionComments: "",
    })
    rememberHandoff(saved)
    setFeedbackSchoolId(school.schoolId)
    setQaSchoolId(school.schoolId)
    setView("internal")
    setQaPane("campus")
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
                      if (option.id === "report") setSchemeId("revised")
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
              ? explorerSelected.map((card) => (
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
            {view === "internal" || view === "aisd" ? (
              <button
                type="button"
                onClick={() => void refreshSchools()}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                <RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />
                {refreshing ? "Refreshing…" : "Refresh walked schools"}
              </button>
            ) : null}
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
          {view === "internal" || view === "aisd" || view === "finalized" ? (
            <div className="min-w-[240px] flex-1">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                {view === "aisd" ? "AISD QA" : view === "finalized" ? "Finalized" : "Internal QA"}
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
                {view === "aisd" || view === "internal" ? (
                  <button
                    type="button"
                    onClick={() => setQaPane("mentions")}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                      qaPane === "mentions" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <AtSign size={14} />
                    Mentions
                  </button>
                ) : null}
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
              const inLevel = catalog.filter((school) => optionLevel(school) === level.id)
              const count =
                view === "aisd"
                  ? aisdQueueEntries(inLevel, handoffs).length
                  : view === "finalized"
                    ? inLevel.filter((school) => isFinalizedHandoff(handoffForSchool(handoffs, school.schoolId))).length
                    : view === "feedback"
                      ? inLevel.filter((school) => isFeedbackHandoff(handoffForSchool(handoffs, school.schoolId))).length
                      : view === "internal"
                        ? inLevel.filter((school) =>
                            isInternalQueue(handoffForSchool(handoffs, school.schoolId)),
                          ).length
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
          showingQaCampus || showingQaAll || showingQaMentions || view === "report" || view === "feedback"
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
                  ? "Revised grouping and the attached starting weights, including MS/HS focus-area weights and outdoor question weights. Inventory and observational items have no points unless the sheet assigns them."
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
              {refreshNote ? <p className="text-sm text-slate-600">{refreshNote}</p> : null}
              {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
              {view === "aisd" && aisdOptions.length === 0 ? (
                <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
                  <p className="text-sm font-medium text-slate-900">No campuses in AISD QA yet</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Internal QA has to review a campus and use Move to AISD QA before it appears here.
                  </p>
                </div>
              ) : view === "finalized" && finalizedOptions.length === 0 ? (
                <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
                  <p className="text-sm font-medium text-slate-900">No finalized campuses yet</p>
                  <p className="mt-1 text-sm text-slate-500">
                    AISD QA uses Looks good, move to finalized after a campus review is accepted.
                  </p>
                </div>
              ) : (
                <>
                  <SchoolScoreBubbles
                    cards={fleetCards}
                    sliceId={sliceId.startsWith("category:") ? OVERALL_SLICE : sliceId}
                    focusAreas={focusAreaOrder}
                    onSliceChange={setSliceId}
                    onOpenSchool={openQaCampus}
                    loading={fleetPending}
                    levelLabel={LEVELS.find((level) => level.id === schoolLevel)?.label ?? "Schools"}
                    openHint={
                      view === "aisd"
                        ? "Click to open in AISD QA"
                        : view === "finalized"
                          ? "Click to open a finalized campus"
                          : "Click to open in Internal QA"
                    }
                    emptyMessage={
                      view === "aisd"
                        ? "No scored AISD QA campuses for this filter."
                        : view === "finalized"
                          ? "No scored finalized campuses for this filter."
                          : "No scored campuses for this filter."
                    }
                  />
                  <SchoolCompareRadial
                    key={`${view}-${schoolLevel}`}
                    options={fleetSource}
                    cards={fleetCards}
                    axisOrder={focusAreaOrder}
                    loading={fleetPending}
                  />
                </>
              )}
            </>
          ) : showingQaMentions ? (
            <QaMentionsPanel
              catalog={catalog}
              handoffs={handoffs}
              stream={view === "aisd" ? "aisd" : "internal"}
              schoolLevel={schoolLevel}
              onOpenSchool={openMentionSchool}
            />
          ) : showingQaCampus ? (
            <div className="space-y-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
                <SchoolSelect
                  label={
                    view === "aisd"
                      ? "School in AISD QA"
                      : view === "finalized"
                        ? "Finalized school"
                        : "School to review"
                  }
                  value={activeQaSchoolId}
                  options={qaOptions.map((school) =>
                    view === "internal" && isFeedbackHandoff(handoffForSchool(handoffs, school.schoolId))
                      ? { ...school, schoolName: `RETURNED ${school.schoolName}` }
                      : school,
                  )}
                  hiddenIds={[]}
                  onChange={(id) => {
                    if (view === "aisd") setAisdSchoolId(id)
                    else if (view === "finalized") setFinalizedSchoolId(id)
                    else setQaSchoolId(id)
                    setQaRoomId(null)
                  }}
                />
                {view === "aisd" && aisdOptions.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No campuses have been moved from Internal QA yet.
                  </p>
                ) : null}
                {view === "finalized" && finalizedOptions.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No campuses have been moved to Finalized yet.
                  </p>
                ) : null}
              </div>
              {refreshNote ? <p className="text-sm text-slate-600">{refreshNote}</p> : null}
              {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
              {handoffError ? <p className="text-sm text-red-600">{handoffError}</p> : null}
              {activeQaSchoolId && !qaCard ? <p className="text-sm text-slate-500">Loading campus…</p> : null}
              {view === "aisd" && qaCard && activeHandoff ? <AisdHandoffBanner handoff={activeHandoff} /> : null}
              {qaCard && qaAligned && (view === "aisd" || view === "finalized") ? (
                <AisdQaPanel
                  key={`${view}-${qaCard.schoolId}`}
                  card={
                    activeHandoff?.schoolName
                      ? { ...qaCard, schoolName: activeHandoff.schoolName }
                      : qaCard
                  }
                  snapshot={qaAligned}
                  resolver={resolver ?? undefined}
                  baseline={baseline ?? undefined}
                />
              ) : null}
              {view === "aisd" && qaCard ? (
                <AisdDecisionPanel
                  schoolName={activeHandoff?.schoolName ?? qaCard.schoolName}
                  onFinalize={finalizeAisdSchool}
                  onMoveToFeedback={moveAisdSchoolToFeedback}
                />
              ) : null}
              {view === "finalized" && qaCard && activeHandoff ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950">
                  Finalized
                  {activeHandoff.decisionBy ? ` by ${activeHandoff.decisionBy}` : ""}
                  {activeHandoff.decisionAt ? ` on ${formatHandoffTimestamp(activeHandoff.decisionAt)}` : ""}.
                </div>
              ) : null}
              {qaCard && qaAligned && view === "internal" ? (
                <SchoolQaPanel
                  card={
                    isFeedbackHandoff(activeHandoff)
                      ? { ...qaCard, schoolName: `RETURNED ${qaCard.schoolName}` }
                      : qaCard
                  }
                  snapshot={qaAligned}
                  selectedRoomId={qaRoomId}
                  onSelectRoom={setQaRoomId}
                  allowDiscard
                  onDiscardRoom={discardActiveRoom}
                  allowScoringNotes
                  resolver={resolver ?? undefined}
                  baseline={baseline ?? undefined}
                />
              ) : null}
              {view === "internal" && qaCard ? (
                <QaHandoffPanel
                  schoolName={qaCard.schoolName}
                  existing={activeHandoff}
                  onSubmit={moveToAisdQa}
                  onFinalizeReturned={finalizeReturnedSchool}
                />
              ) : null}
            </div>
          ) : view === "feedback" ? (
            <div className="space-y-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
                <SchoolSelect
                  label="School in Feedback"
                  value={feedbackSchoolId}
                  options={feedbackOptions}
                  hiddenIds={[]}
                  onChange={setFeedbackSchoolId}
                />
                {feedbackOptions.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No campuses have been moved from AISD QA to Feedback yet.
                  </p>
                ) : null}
              </div>
              {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
              {handoffError ? <p className="text-sm text-red-600">{handoffError}</p> : null}
              {feedbackSchoolId && !snapshots[feedbackSchoolId] ? (
                <p className="text-sm text-slate-500">Loading campus comments…</p>
              ) : null}
              {feedbackSchoolId ? (
                <AisdFeedbackPanel
                  schoolId={feedbackSchoolId}
                  schoolName={
                    feedbackOptions.find((school) => school.schoolId === feedbackSchoolId)?.schoolName ??
                    feedbackSchoolId
                  }
                  snapshot={snapshots[feedbackSchoolId]}
                  handoff={handoffForSchool(handoffs, feedbackSchoolId)}
                />
              ) : feedbackOptions.length ? (
                <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
                  Pick a school to see the AISD notes that were moved here.
                </p>
              ) : null}
            </div>
          ) : view === "report" ? (
            <div className="space-y-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5 print:hidden">
                <SchoolSelect
                  label="School to report"
                  value={reportSchoolId}
                  options={levelOptions}
                  hiddenIds={[]}
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
            <div className="space-y-4">
              {levelOptions.length === 0 ? (
                <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
                  No walked {LEVELS.find((level) => level.id === schoolLevel)?.label.toLowerCase()} schools
                  in this export yet.
                </p>
              ) : (
                <SchoolCompareRadial
                  key={`explorer-${schoolLevel}`}
                  options={levelOptions}
                  cards={explorerCards}
                  axisOrder={focusAreaOrder}
                  loading={explorerPending}
                  selectedIds={explorerIds}
                  onSelectionChange={setExplorerIds}
                />
              )}
              {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
              {explorerSelected.length > 0 ? (
                <div className={`grid min-w-0 gap-4 ${explorerSelected.length > 1 ? "xl:grid-cols-2" : ""}`}>
                  {explorerSelected.map((card) => (
                    <SchoolPanel key={`${schemeId}-${card.schoolId}`} card={card} />
                  ))}
                </div>
              ) : null}
            </div>
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
  hiddenIds,
  onChange,
}: {
  label: string
  value: string
  options: SchoolIndexEntry[]
  hiddenIds: string[]
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
          <option
            key={school.schoolId}
            value={school.schoolId}
            disabled={hiddenIds.includes(school.schoolId)}
          >
            {school.schoolName}
          </option>
        ))}
      </select>
    </label>
  )
}
