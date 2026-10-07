"use client"

import { useEffect, useMemo, useState } from "react"
import { Trash2 } from "lucide-react"
import { FloorPlanPanel } from "@/components/floor-plan-panel"
import {
  PhotoLightbox,
  PhotoThumbs,
  generalPhotoSpaceLabel,
  partitionRoomPhotos,
  useRoomPhotos,
} from "@/components/room-photos"
import { QaAnswerMatrix } from "@/components/qa-answer-matrix"
import { AisdScoringNotes } from "@/components/aisd-scoring-notes"
import { QaDiscardDialog } from "@/components/qa-discard-dialog"
import { RoomQuestionReview } from "@/components/room-question-review"
import { ScoreBadge } from "@/components/score-badge"
import { ScoreTree } from "@/components/score-tree"
import { useRoomNotes } from "@/components/use-room-notes"
import { answerConsistency } from "@/lib/answer-consistency"
import { canonicalName } from "@/lib/normalize"
import { editsForRoom, saveEditorName, type QaEditRecord } from "@/lib/qa-edits"
import { applyEditsToRooms, fetchQaEdits, saveQaEditLive } from "@/lib/qa-live"
import type { SchoolScorecard, SchoolSnapshot, ScoreNode } from "@/lib/types"

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

export function SchoolQaPanel({
  card,
  snapshot,
  selectedRoomId,
  onSelectRoom,
  allowDiscard = false,
  onDiscardRoom,
  allowScoringNotes = false,
}: {
  card: SchoolScorecard
  snapshot: SchoolSnapshot
  selectedRoomId: string | null
  onSelectRoom: (roomId: string | null) => void
  allowDiscard?: boolean
  onDiscardRoom?: (roomId: string) => void
  allowScoringNotes?: boolean
}) {
  const [discardOpen, setDiscardOpen] = useState(false)
  const focusAreas = card.focusAreas
  const [focusLabel, setFocusLabel] = useState(focusAreas[0]?.label ?? "")
  const selectedFocus = focusAreas.find((area) => area.label === focusLabel) ?? focusAreas[0] ?? null
  const spaceTypes = useMemo(
    () => (selectedFocus?.children ?? []).filter((node) => node.kind !== "room"),
    [selectedFocus],
  )
  const [spaceLabel, setSpaceLabel] = useState(spaceTypes[0]?.label ?? "")
  const selectedSpace = spaceTypes.find((space) => space.label === spaceLabel) ?? spaceTypes[0] ?? null
  const rooms = useMemo(
    () => (selectedSpace?.children ?? []).filter((node) => node.kind === "room"),
    [selectedSpace],
  )

  useEffect(() => {
    if (!focusLabel && focusAreas[0]) setFocusLabel(focusAreas[0].label)
  }, [focusAreas, focusLabel])

  useEffect(() => {
    if (!selectedFocus) return
    if (!spaceTypes.some((space) => space.label === spaceLabel)) {
      setSpaceLabel(spaceTypes[0]?.label ?? "")
    }
  }, [selectedFocus, spaceTypes, spaceLabel])

  useEffect(() => {
    if (!selectedRoomId) return
    const path = findRoomPath(focusAreas, selectedRoomId)
    if (!path) return
    if (path.focus !== focusLabel) setFocusLabel(path.focus)
    if (path.space !== spaceLabel) setSpaceLabel(path.space)
  }, [selectedRoomId, focusAreas, focusLabel, spaceLabel])

  const selectedRoomNode = selectedRoomId ? findRoomNode(focusAreas, selectedRoomId) : null
  const selectedSnapshotRoom = selectedRoomId
    ? snapshot.rooms.find((room) => room.roomId === selectedRoomId)
    : null
  const { photos, loading: photosLoading, error: photosError } = useRoomPhotos({
    campusId: card.campusId,
    schoolId: card.schoolId,
    roomId: selectedRoomId,
    roomName: selectedSnapshotRoom?.roomName,
  })
  const { general: generalPhotos, byQuestion: photosByQuestion } = useMemo(
    () => partitionRoomPhotos(photos),
    [photos],
  )
  const { notes, loading: notesLoading, error: notesError } = useRoomNotes({
    schoolId: card.schoolId,
    roomId: selectedRoomId,
    roomName: selectedSnapshotRoom?.roomName,
  })
  const leftoverNotes = useMemo(() => {
    const used = new Set(selectedSnapshotRoom?.units.map((unit) => unit.questionId) ?? [])
    return Object.entries(notes.comments).filter(([questionId]) => !used.has(questionId))
  }, [notes.comments, selectedSnapshotRoom])
  const [activePhotoUrl, setActivePhotoUrl] = useState<string | null>(null)
  const [qaEdits, setQaEdits] = useState<QaEditRecord[]>([])
  const [editsError, setEditsError] = useState<string | null>(null)
  const roomsWithEdits = useMemo(
    () => applyEditsToRooms(snapshot.rooms, qaEdits),
    [snapshot.rooms, qaEdits],
  )
  const selectedEditedRoom = selectedRoomId
    ? (roomsWithEdits.find((room) => room.roomId === selectedRoomId) ?? selectedSnapshotRoom)
    : null
  const matrixRooms = useMemo(() => {
    if (selectedRoomId || !selectedSpace?.label) return []
    const wanted = canonicalName(selectedSpace.label)
    return roomsWithEdits.filter(
      (room) => !room.markedAbsent && canonicalName(room.spaceType) === wanted,
    )
  }, [selectedRoomId, selectedSpace?.label, roomsWithEdits])
  const matrixRows = useMemo(() => answerConsistency(matrixRooms), [matrixRooms])
  const showAnswerMatrix = !selectedRoomId && matrixRooms.length > 1
  const roomEdits = selectedRoomId ? editsForRoom(qaEdits, card.schoolId, selectedRoomId) : []

  useEffect(() => {
    let cancelled = false
    fetchQaEdits(card.schoolId)
      .then((edits) => {
        if (cancelled) return
        setQaEdits(edits)
        setEditsError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setEditsError(error instanceof Error ? error.message : "Could not load QA edits")
      })
    return () => {
      cancelled = true
    }
  }, [card.schoolId])

  useEffect(() => {
    setActivePhotoUrl(null)
    setDiscardOpen(false)
  }, [selectedRoomId])

  function chooseFocus(next: string) {
    setFocusLabel(next)
    setSpaceLabel("")
    onSelectRoom(null)
  }

  function chooseSpace(next: string) {
    setSpaceLabel(next)
    onSelectRoom(null)
  }

  async function commitEdit(input: {
    questionId: string
    selected: string[]
    previous: string[]
    editor: string
    reason: string
  }) {
    if (!selectedRoomId) return
    saveEditorName(input.editor)
    const saved = await saveQaEditLive(
      {
        schoolId: card.schoolId,
        roomId: selectedRoomId,
        questionId: input.questionId,
        selected: input.selected,
        previous: input.previous,
        editor: input.editor,
        reason: input.reason,
        editedAt: new Date().toISOString(),
      },
      selectedSnapshotRoom?.roomName,
    )
    setQaEdits((current) => [
      ...current.filter(
        (item) =>
          !(item.schoolId === saved.schoolId && item.roomId === saved.roomId && item.questionId === saved.questionId),
      ),
      saved,
    ])
    setEditsError(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{card.schoolName}</h2>
          <p className="text-sm text-slate-500">
            Pick a focus area and space type. If more than one room of that type was assessed, compare answers
            before opening a room.
          </p>
          {editsError ? <p className="mt-2 text-sm text-rose-700">{editsError}</p> : null}
        </div>
        <ScoreBadge score={card.existingOnly} />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(380px,0.95fr)_minmax(0,1.05fr)]">
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Focus area
                </span>
                <select
                  value={selectedFocus?.label ?? ""}
                  onChange={(event) => chooseFocus(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
                >
                  {focusAreas.map((area) => (
                    <option key={area.id} value={area.label}>
                      {area.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Space type
                </span>
                <select
                  value={selectedSpace?.label ?? ""}
                  onChange={(event) => chooseSpace(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
                >
                  {spaceTypes.length === 0 ? <option value="">No space types</option> : null}
                  {spaceTypes.map((space) => (
                    <option key={space.id} value={space.label}>
                      {space.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Rooms
                {selectedSpace ? ` · ${rooms.length}` : ""}
              </p>
              {rooms.length === 0 ? (
                <p className="text-sm text-slate-500">No assessed rooms for this space type.</p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-auto">
                  {rooms.map((room) => {
                    const active = room.roomId === selectedRoomId
                    return (
                      <li key={room.id}>
                        <button
                          type="button"
                          onClick={() => onSelectRoom(room.roomId ?? null)}
                          className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                            active
                              ? "bg-blue-50 ring-2 ring-blue-200"
                              : "bg-slate-50 hover:bg-slate-100"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-900">{room.label}</span>
                            {room.countLabel ? (
                              <span className="block truncate text-[11px] text-slate-500">{room.countLabel}</span>
                            ) : null}
                          </span>
                          <ScoreBadge score={room.score} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            {selectedSnapshotRoom ? (
              <>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{selectedSnapshotRoom.roomName}</h3>
                    <p className="text-xs text-slate-500">
                      {selectedSnapshotRoom.spaceType}
                      {selectedSnapshotRoom.neighborhood
                        ? ` · Neighborhood ${selectedSnapshotRoom.neighborhood}`
                        : ""}
                    </p>
                  </div>
                  <ScoreBadge score={selectedRoomNode?.score ?? null} />
                </div>
                {allowDiscard && onDiscardRoom ? (
                  <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-rose-900/90">
                      Remove this room from the campus survey if it should not be reviewed or scored.
                    </p>
                    <button
                      type="button"
                      onClick={() => setDiscardOpen(true)}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-rose-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-rose-800"
                    >
                      <Trash2 size={15} />
                      Discard room
                    </button>
                  </div>
                ) : null}
                <div className="mb-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3">
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
                  <p className="mb-4 text-sm text-slate-500">Loading notes…</p>
                ) : notesError ? (
                  <p className="mb-4 text-sm text-rose-700">{notesError}</p>
                ) : notes.roomNotes.length ? (
                  <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                      Room notes
                    </p>
                    <div className="mt-2 space-y-2">
                      {notes.roomNotes.map((note, index) => (
                        <p key={`${index}-${note.slice(0, 24)}`} className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                          {note}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
                <p className="mb-3 text-xs text-slate-500">
                  Click an answer to edit it. You will be asked who is making the change and why. Nothing is saved to ESA yet.
                </p>
                <RoomQuestionReview
                  units={selectedEditedRoom?.units ?? selectedSnapshotRoom.units}
                  photosByQuestion={photosByQuestion}
                  notesByQuestion={notes.comments}
                  onOpenPhoto={setActivePhotoUrl}
                  edits={roomEdits}
                  onCommitEdit={commitEdit}
                />
                {leftoverNotes.length ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Other notes
                    </p>
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
                <PhotoLightbox url={activePhotoUrl} onClose={() => setActivePhotoUrl(null)} />
                {discardOpen && selectedSnapshotRoom ? (
                  <QaDiscardDialog
                    roomName={selectedSnapshotRoom.roomName}
                    schoolName={card.schoolName}
                    onCancel={() => setDiscardOpen(false)}
                    onConfirm={() => {
                      setDiscardOpen(false)
                      onDiscardRoom?.(selectedSnapshotRoom.roomId)
                    }}
                  />
                ) : null}
              </>
            ) : showAnswerMatrix ? (
              <QaAnswerMatrix
                spaceLabel={selectedSpace?.label ?? "Space type"}
                roomCount={matrixRooms.length}
                rows={matrixRows}
                onSelectRoom={onSelectRoom}
              />
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">
                {matrixRooms.length === 1
                  ? "Only one room of this space type was assessed. Select it to review every recorded answer."
                  : "Select a room to see every question and what was recorded, the same way ESA shows a room."}
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <FloorPlanPanel
            campusId={card.campusId}
            schoolName={card.schoolName}
            rooms={card.rooms}
            selectedRoomId={selectedRoomId}
            onSelectRoom={onSelectRoom}
          />
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Scoring focus areas</h3>
            <ScoreTree
              nodes={focusAreas}
              empty="No focus area scores yet."
              hint="Focus area → space type → room → category. Open a row to drill down."
              selectedRoomId={selectedRoomId}
              onSelectRoom={(roomId) => onSelectRoom(roomId)}
            />
          </div>
          {allowScoringNotes ? (
            <AisdScoringNotes
              schoolId={card.schoolId}
              overallScore={card.existingOnly}
              focusAreas={focusAreas}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
