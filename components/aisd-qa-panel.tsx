"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react"
import {
  PhotoLightbox,
  PhotoThumbs,
  generalPhotoSpaceLabel,
  partitionRoomPhotos,
  useRoomPhotos,
} from "@/components/room-photos"
import { FloorPlanPanel } from "@/components/floor-plan-panel"
import { RoomQuestionReview } from "@/components/room-question-review"
import { ScoreBadge, ScoreBar, DeltaChip, BigScore } from "@/components/score-badge"
import { ScoringNoteThread } from "@/components/scoring-note-thread"
import { useRoomNotes } from "@/components/use-room-notes"
import { useScoringNotes } from "@/components/use-scoring-notes"
import { isHiddenReportLabel } from "@/lib/report"
import { editsForRoom, type QaEditRecord } from "@/lib/qa-edits"
import { baseSchoolIdFromHandoff } from "@/lib/qa-handoff"
import { applyEditsToRooms, fetchQaEdits } from "@/lib/qa-live"
import { OVERALL_NOTE_TOPIC, questionNoteTopic } from "@/lib/qa-scoring-notes"
import { scoreSchool } from "@/lib/scoring"
import type { WeightResolver } from "@/lib/weights"
import type { SchoolScorecard, SchoolSnapshot, ScoreNode } from "@/lib/types"

type Drill =
  | { level: "campus" }
  | { level: "space"; focus: string; space: string }
  | { level: "room"; focus: string; space: string; roomId: string }
  | { level: "questions"; focus: string; space: string; roomId: string }

function findNode(nodes: ScoreNode[], label: string): ScoreNode | null {
  return nodes.find((node) => node.label === label) ?? null
}

function findRoomNode(nodes: ScoreNode[], roomId: string): ScoreNode | null {
  for (const node of nodes) {
    if (node.kind === "room" && node.roomId === roomId) return node
    if (node.children?.length) {
      const found = findRoomNode(node.children, roomId)
      if (found) return found
    }
  }
  return null
}

function findRoomPath(focusAreas: ScoreNode[], roomId: string): { focus: string; space: string } | null {
  for (const focus of focusAreas) {
    for (const space of focus.children ?? []) {
      const room = (space.children ?? []).find((child) => child.kind === "room" && child.roomId === roomId)
      if (room) return { focus: focus.label, space: space.label }
    }
  }
  return null
}

function Crumb({
  label,
  onClick,
  current = false,
}: {
  label: string
  onClick?: () => void
  current?: boolean
}) {
  if (current || !onClick) {
    return <span className="font-semibold text-slate-900">{label}</span>
  }
  return (
    <button type="button" onClick={onClick} className="text-slate-500 hover:text-blue-700">
      {label}
    </button>
  )
}

function Breadcrumbs({ children }: { children: ReactNode }) {
  return <nav className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">{children}</nav>
}

export function AisdQaPanel({
  card,
  snapshot,
  resolver,
  baseline,
}: {
  card: SchoolScorecard
  snapshot: SchoolSnapshot
  resolver?: WeightResolver
  baseline?: WeightResolver
}) {
  const [drill, setDrill] = useState<Drill>({ level: "campus" })
  const [frozenEdits, setFrozenEdits] = useState<QaEditRecord[]>([])
  const [sandboxEdits, setSandboxEdits] = useState<QaEditRecord[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activePhotoUrl, setActivePhotoUrl] = useState<string | null>(null)
  const scoring = useScoringNotes(card.schoolId)

  const frozenRooms = useMemo(
    () => applyEditsToRooms(snapshot.rooms, frozenEdits, snapshot.schoolClass),
    [snapshot.rooms, frozenEdits, snapshot.schoolClass],
  )
  const exploreRooms = useMemo(
    () => applyEditsToRooms(frozenRooms, sandboxEdits, snapshot.schoolClass),
    [frozenRooms, sandboxEdits, snapshot.schoolClass],
  )
  const snapshotCard = useMemo(
    () => (resolver ? scoreSchool({ ...snapshot, rooms: frozenRooms }, resolver, baseline) : card),
    [resolver, snapshot, frozenRooms, baseline, card],
  )
  const exploreCard = useMemo(
    () => (resolver ? scoreSchool({ ...snapshot, rooms: exploreRooms }, resolver, baseline) : snapshotCard),
    [resolver, snapshot, exploreRooms, baseline, snapshotCard],
  )

  const focusAreas = useMemo(
    () => exploreCard.focusAreas.filter((area) => !isHiddenReportLabel(area.label)),
    [exploreCard.focusAreas],
  )

  const selectedRoomId = drill.level === "room" || drill.level === "questions" ? drill.roomId : null
  const selectedSnapshotRoom = selectedRoomId
    ? (exploreRooms.find((room) => room.roomId === selectedRoomId) ??
      frozenRooms.find((room) => room.roomId === selectedRoomId) ??
      null)
    : null
  const sourceSchoolId = baseSchoolIdFromHandoff(card.schoolId)
  const { photos, loading: photosLoading, error: photosError } = useRoomPhotos({
    campusId: card.campusId,
    schoolId: sourceSchoolId,
    roomId: selectedRoomId,
    roomName: selectedSnapshotRoom?.roomName,
  })
  const { general: generalPhotos, byQuestion: photosByQuestion } = useMemo(
    () => partitionRoomPhotos(photos),
    [photos],
  )
  const { notes, loading: notesLoading, error: notesError } = useRoomNotes({
    schoolId: sourceSchoolId,
    roomId: selectedRoomId,
    roomName: selectedSnapshotRoom?.roomName,
  })
  const leftoverNotes = useMemo(() => {
    const used = new Set(selectedSnapshotRoom?.units.map((unit) => unit.questionId) ?? [])
    return Object.entries(notes.comments).filter(([questionId]) => !used.has(questionId))
  }, [notes.comments, selectedSnapshotRoom])
  const roomEdits = selectedRoomId ? editsForRoom(sandboxEdits, card.schoolId, selectedRoomId) : []
  const exploring = sandboxEdits.length > 0

  useEffect(() => {
    let cancelled = false
    fetchQaEdits(sourceSchoolId)
      .then((edits) => {
        if (cancelled) return
        setFrozenEdits(edits)
        setLoadError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : "Could not load the handed-off snapshot")
      })
    return () => {
      cancelled = true
    }
  }, [sourceSchoolId])

  useEffect(() => {
    setActivePhotoUrl(null)
  }, [selectedRoomId])

  function openSpace(focus: string, space: string) {
    setDrill({ level: "space", focus, space })
  }

  function selectRoomFromPlan(roomId: string) {
    const path =
      findRoomPath(exploreCard.focusAreas, roomId) ?? findRoomPath(snapshotCard.focusAreas, roomId)
    const room =
      exploreRooms.find((item) => item.roomId === roomId) ??
      frozenRooms.find((item) => item.roomId === roomId)
    if (path) {
      setDrill({ level: "room", focus: path.focus, space: path.space, roomId })
      return
    }
    if (room) {
      setDrill({
        level: "room",
        focus: room.focusAreaLabel,
        space: room.spaceType,
        roomId,
      })
    }
  }

  function applySandbox(input: {
    questionId: string
    selected: string[]
    previous: string[]
    editor?: string
    reason?: string
  }) {
    if (!selectedRoomId) return
    const next: QaEditRecord = {
      schoolId: card.schoolId,
      roomId: selectedRoomId,
      questionId: input.questionId,
      selected: input.selected,
      previous: input.previous,
      editor: "AISD QA",
      reason: "Exploration — not saved",
      editedAt: new Date().toISOString(),
    }
    setSandboxEdits((current) => [
      ...current.filter(
        (item) =>
          !(item.schoolId === next.schoolId && item.roomId === next.roomId && item.questionId === next.questionId),
      ),
      next,
    ])
  }

  const selectedFocus =
    drill.level === "campus" ? null : (findNode(focusAreas, drill.focus) ?? findNode(exploreCard.focusAreas, drill.focus))
  const selectedSpace =
    selectedFocus && drill.level !== "campus" ? findNode(selectedFocus.children ?? [], drill.space) : null
  const snapshotFocus =
    drill.level === "campus" ? null : findNode(snapshotCard.focusAreas, drill.focus)
  const snapshotSpace =
    snapshotFocus && drill.level !== "campus" ? findNode(snapshotFocus.children ?? [], drill.space) : null
  const rooms = (selectedSpace?.children ?? []).filter((node) => node.kind === "room")
  const selectedRoomNode = selectedRoomId ? findRoomNode(exploreCard.focusAreas, selectedRoomId) : null
  const snapshotRoomNode = selectedRoomId ? findRoomNode(snapshotCard.focusAreas, selectedRoomId) : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{card.schoolName}</h2>
          <p className="text-sm text-slate-500">
            Handed-off snapshot. Explore answers to see score impact; nothing writes back to ESA.
          </p>
          {loadError ? <p className="mt-2 text-sm text-rose-700">{loadError}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {exploring ? (
            <>
              <DeltaChip current={exploreCard.existingOnly} baseline={snapshotCard.existingOnly} />
              <button
                type="button"
                onClick={() => setSandboxEdits([])}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw size={14} />
                Reset exploration
              </button>
            </>
          ) : null}
          <ScoreBadge score={exploreCard.existingOnly} />
        </div>
      </div>

      {exploring ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          You are exploring answers. Campus scores below include those trials. Reset to return to the
          handed-off snapshot.
        </p>
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
        <div className="min-w-0 space-y-4">
      {drill.level === "campus" ? (
        <CampusOverview
          overall={exploreCard.existingOnly}
          snapshotOverall={snapshotCard.existingOnly}
          exploring={exploring}
          focusAreas={focusAreas}
          snapshotFocusAreas={snapshotCard.focusAreas}
          scoring={scoring}
          onOpenSpace={openSpace}
        />
      ) : null}

      {drill.level === "space" && selectedSpace ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <Breadcrumbs>
              <Crumb label={card.schoolName} onClick={() => setDrill({ level: "campus" })} />
              <span>/</span>
              <Crumb label={drill.focus} onClick={() => setDrill({ level: "campus" })} />
              <span>/</span>
              <Crumb label={drill.space} current />
            </Breadcrumbs>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{drill.space}</h3>
                <p className="text-sm text-slate-500">{selectedSpace.countLabel ?? drill.focus}</p>
              </div>
              <div className="flex items-center gap-2">
                {exploring ? <DeltaChip current={selectedSpace.score} baseline={snapshotSpace?.score ?? null} /> : null}
                <ScoreBadge score={selectedSpace.score} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDrill({ level: "campus" })}
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-900"
            >
              <ChevronLeft size={16} />
              Back to campus overview
            </button>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h4 className="text-sm font-semibold text-slate-900">Rooms</h4>
            <p className="mt-1 text-sm text-slate-500">Open a room to review it. Questions stay hidden until you ask to see them.</p>
            {rooms.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No assessed rooms for this space type.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-100">
                {rooms.map((room) => (
                  <li key={room.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setDrill({
                          level: "room",
                          focus: drill.focus,
                          space: drill.space,
                          roomId: room.roomId ?? "",
                        })
                      }
                      className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">{room.label}</span>
                        {room.countLabel ? (
                          <span className="block truncate text-[11px] text-slate-500">{room.countLabel}</span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {exploring ? (
                          <DeltaChip
                            current={room.score}
                            baseline={findRoomNode(snapshotCard.focusAreas, room.roomId ?? "")?.score ?? null}
                          />
                        ) : null}
                        <ScoreBadge score={room.score} />
                        <ChevronRight size={16} className="text-slate-400" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {(drill.level === "room" || drill.level === "questions") && selectedSnapshotRoom ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <Breadcrumbs>
              <Crumb label={card.schoolName} onClick={() => setDrill({ level: "campus" })} />
              <span>/</span>
              <Crumb label={drill.focus} onClick={() => setDrill({ level: "campus" })} />
              <span>/</span>
              <Crumb
                label={drill.space}
                onClick={() => setDrill({ level: "space", focus: drill.focus, space: drill.space })}
              />
              <span>/</span>
              {drill.level === "questions" ? (
                <>
                  <Crumb
                    label={selectedSnapshotRoom.roomName}
                    onClick={() =>
                      setDrill({
                        level: "room",
                        focus: drill.focus,
                        space: drill.space,
                        roomId: drill.roomId,
                      })
                    }
                  />
                  <span>/</span>
                  <Crumb label="Questions" current />
                </>
              ) : (
                <Crumb label={selectedSnapshotRoom.roomName} current />
              )}
            </Breadcrumbs>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{selectedSnapshotRoom.roomName}</h3>
                <p className="text-sm text-slate-500">
                  {selectedSnapshotRoom.spaceType}
                  {selectedSnapshotRoom.neighborhood
                    ? ` · Neighborhood ${selectedSnapshotRoom.neighborhood}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {exploring ? (
                  <DeltaChip current={selectedRoomNode?.score ?? null} baseline={snapshotRoomNode?.score ?? null} />
                ) : null}
                <ScoreBadge score={selectedRoomNode?.score ?? null} />
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setDrill(
                  drill.level === "questions"
                    ? { level: "room", focus: drill.focus, space: drill.space, roomId: drill.roomId }
                    : { level: "space", focus: drill.focus, space: drill.space },
                )
              }
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-900"
            >
              <ChevronLeft size={16} />
              {drill.level === "questions" ? "Back to room" : "Back to rooms"}
            </button>
          </div>

          {drill.level === "room" ? (
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  General space photo
                </p>
                <p className="mt-1 text-sm leading-snug text-slate-700">
                  {generalPhotos[0]
                    ? generalPhotoSpaceLabel(generalPhotos[0], selectedSnapshotRoom.spaceType)
                    : selectedSnapshotRoom.spaceType}
                </p>
                <div className="mt-3">
                  {photosLoading ? (
                    <p className="py-4 text-sm text-slate-500">Loading pictures…</p>
                  ) : photosError ? (
                    <p className="py-4 text-sm text-red-600">{photosError}</p>
                  ) : generalPhotos.length ? (
                    <PhotoThumbs photos={generalPhotos} onOpen={setActivePhotoUrl} />
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
                      No general photo recorded for this room.
                    </p>
                  )}
                </div>
              </div>
              {notesLoading ? (
                <p className="mt-4 text-sm text-slate-500">Loading notes…</p>
              ) : notesError ? (
                <p className="mt-4 text-sm text-rose-700">{notesError}</p>
              ) : notes.roomNotes.length ? (
                <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">Room notes</p>
                  <div className="mt-2 space-y-2">
                    {notes.roomNotes.map((note, index) => (
                      <p key={`${index}-${note.slice(0, 24)}`} className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                        {note}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  setDrill({
                    level: "questions",
                    focus: drill.focus,
                    space: drill.space,
                    roomId: drill.roomId,
                  })
                }
                className="mt-5 inline-flex items-center justify-center rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
              >
                View questions
              </button>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="mb-4 text-sm text-slate-500">
                Click an answer to try a different score. This does not save to ESA or Internal QA. You can
                still leave a question note for AISD reviewers.
              </p>
              <label className="mb-4 block max-w-sm">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Your name for notes
                </span>
                <input
                  type="text"
                  value={scoring.author}
                  onChange={(event) => scoring.setAuthor(event.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-600/10"
                />
              </label>
              {scoring.error ? <p className="mb-3 text-sm text-rose-700">{scoring.error}</p> : null}
              <RoomQuestionReview
                units={selectedSnapshotRoom.units}
                photosByQuestion={photosByQuestion}
                notesByQuestion={notes.comments}
                onOpenPhoto={setActivePhotoUrl}
                edits={roomEdits}
                instantCommit
                onCommitEdit={applySandbox}
                renderQuestionExtra={(questionId) => {
                  const topic = questionNoteTopic(drill.roomId, questionId)
                  return (
                    <ScoringNoteThread
                      title="AISD question notes"
                      comments={scoring.notes.threads[topic] ?? []}
                      draft={scoring.drafts[topic] ?? ""}
                      onDraftChange={(value) =>
                        scoring.setDrafts((current) => ({ ...current, [topic]: value }))
                      }
                      onAdd={() => void scoring.addComment(topic)}
                      saving={scoring.savingTopic === topic}
                      placeholder="Leave a note about this question"
                    />
                  )
                }}
              />
              {leftoverNotes.length ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Other notes</p>
                  <ul className="mt-2 space-y-2">
                    {leftoverNotes.map(([questionId, note]) => (
                      <li key={questionId}>
                        <p className="font-mono text-[10px] text-slate-400">{questionId}</p>
                        <p className="whitespace-pre-wrap text-sm text-slate-800">{note}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
          <PhotoLightbox url={activePhotoUrl} onClose={() => setActivePhotoUrl(null)} />
        </div>
      ) : null}
        </div>
        <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
          <FloorPlanPanel
            campusId={card.campusId}
            schoolName={snapshot.schoolName}
            rooms={exploreCard.rooms}
            selectedRoomId={selectedRoomId}
            onSelectRoom={selectRoomFromPlan}
          />
        </div>
      </div>
    </div>
  )
}

function CampusOverview({
  overall,
  snapshotOverall,
  exploring,
  focusAreas,
  snapshotFocusAreas,
  scoring,
  onOpenSpace,
}: {
  overall: number | null
  snapshotOverall: number | null
  exploring: boolean
  focusAreas: ScoreNode[]
  snapshotFocusAreas: ScoreNode[]
  scoring: ReturnType<typeof useScoringNotes>
  onOpenSpace: (focus: string, space: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <BigScore
          label={exploring ? "Existing spaces · exploring" : "Existing spaces"}
          score={overall}
          baseline={exploring ? snapshotOverall : null}
        />
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Notes about the overall ESA</h3>
              <p className="mt-0.5 text-xs text-slate-600">These stay visible for everyone on AISD QA.</p>
            </div>
            <label className="block min-w-48">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Your name
              </span>
              <input
                type="text"
                value={scoring.author}
                onChange={(event) => scoring.setAuthor(event.target.value)}
                placeholder="Full name"
                className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-600/10"
              />
            </label>
          </div>
          <ScoringNoteThread
            comments={scoring.notes.threads[OVERALL_NOTE_TOPIC] ?? []}
            draft={scoring.drafts[OVERALL_NOTE_TOPIC] ?? ""}
            onDraftChange={(value) =>
              scoring.setDrafts((current) => ({ ...current, [OVERALL_NOTE_TOPIC]: value }))
            }
            onAdd={() => void scoring.addComment(OVERALL_NOTE_TOPIC)}
            saving={scoring.savingTopic === OVERALL_NOTE_TOPIC}
          />
          {scoring.error ? <p className="mt-3 text-sm text-rose-700">{scoring.error}</p> : null}
        </div>
      </div>

      <div className="space-y-4">
        {focusAreas.map((area) => {
          const snapshotArea = findNode(snapshotFocusAreas, area.label)
          const spaces = (area.children ?? []).filter((node) => node.kind !== "room")
          const spaceTotal = spaces.reduce((sum, item) => sum + (item.weight > 0 ? item.weight : 0), 0)
          return (
            <section key={area.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{area.label}</h3>
                  {area.countLabel ? <p className="mt-0.5 text-xs text-slate-500">{area.countLabel}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  {exploring ? <DeltaChip current={area.score} baseline={snapshotArea?.score ?? null} /> : null}
                  <ScoreBadge score={area.score} />
                </div>
              </div>
              <div className="mt-3">
                <ScoreBar score={area.score} />
              </div>
              <ul className="mt-4 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-100">
                {spaces.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-slate-500">No space types scored in this focus area.</li>
                ) : (
                  spaces.map((space) => {
                    const snapshotSpace = findNode(snapshotArea?.children ?? [], space.label)
                    return (
                      <li key={space.id}>
                        <button
                          type="button"
                          onClick={() => onOpenSpace(area.label, space.label)}
                          className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-slate-50"
                        >
                          <div className="min-w-0 flex-1">
                            <ScoreBar
                              score={space.score}
                              label={space.label}
                              weight={space.weight}
                              weightTotal={spaceTotal}
                            />
                            {space.countLabel ? (
                              <p className="mt-1 text-[11px] text-slate-500">{space.countLabel}</p>
                            ) : null}
                          </div>
                          <span className="flex shrink-0 items-center gap-2">
                            {exploring ? (
                              <DeltaChip current={space.score} baseline={snapshotSpace?.score ?? null} />
                            ) : null}
                            <ChevronRight size={16} className="text-slate-400" />
                          </span>
                        </button>
                      </li>
                    )
                  })
                )}
              </ul>
              <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                <ScoringNoteThread
                  title={`Notes · ${area.label}`}
                  comments={scoring.notes.threads[area.label] ?? []}
                  draft={scoring.drafts[area.label] ?? ""}
                  onDraftChange={(value) =>
                    scoring.setDrafts((current) => ({ ...current, [area.label]: value }))
                  }
                  onAdd={() => void scoring.addComment(area.label)}
                  saving={scoring.savingTopic === area.label}
                  placeholder={`Add a comment on ${area.label}`}
                />
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
