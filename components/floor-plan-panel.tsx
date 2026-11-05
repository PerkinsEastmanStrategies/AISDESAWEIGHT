"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Layers, Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react"
import { ScoreBadge } from "@/components/score-badge"
import { loadFloorPlanForCampus } from "@/lib/floor-plan-loader"
import { overlayPointsForRoom, viewBoxString, type ParsedPlanRoom } from "@/lib/floor-plan-parse"
import { scoreBandLabel, scoreFillRgba, scoreStrokeRgba } from "@/lib/format"
import {
  colorWithAlpha,
  fetchCampusNeighborhoods,
  neighborhoodFillColor,
  neighborhoodForPlanRoom,
  neighborhoodLegendColors,
} from "@/lib/neighborhood-colors"
import { matchScoredRoom, normalizeRoomId } from "@/lib/room-id-match"
import type { ScoredRoomSummary } from "@/lib/types"

const PAN_THRESHOLD_PX = 6
const MIN_ZOOM = 0.75
const MAX_ZOOM = 10
const DEFAULT_ZOOM = 1
const ZOOM_BUTTON_STEP = 0.5

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

function pointerDistance(pointers: Map<number, { x: number; y: number }>): number {
  const pts = [...pointers.values()]
  if (pts.length < 2) return 0
  return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
}

function planRoomMatchesSelection(
  planRoom: ParsedPlanRoom,
  selectedRoomId: string,
  rooms: ScoredRoomSummary[],
) {
  const wanted = normalizeRoomId(selectedRoomId)
  if (!wanted) return false
  if ([planRoom.id, planRoom.name].map(normalizeRoomId).includes(wanted)) return true
  const scored = matchScoredRoom(planRoom, rooms)
  return scored ? [scored.roomId, scored.roomName].map(normalizeRoomId).includes(wanted) : false
}

function polygonPoints(room: ParsedPlanRoom): string {
  return overlayPointsForRoom(room)
    .map((pt) => `${pt.x},${pt.y}`)
    .join(" ")
}

function RoomOverlay({
  room,
  score,
  neighborhood,
  selected,
  showNeighborhoods,
  onSelect,
}: {
  room: ParsedPlanRoom
  score: number | null | undefined
  neighborhood?: string
  selected: boolean
  showNeighborhoods: boolean
  onSelect: (roomId: string) => void
}) {
  const tapRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const hasScore = score != null
  const neighborhoodColor = showNeighborhoods ? neighborhoodFillColor(neighborhood) : null
  const fill =
    showNeighborhoods && neighborhoodColor
      ? colorWithAlpha(neighborhoodColor, selected ? 0.62 : 0.4)
      : hasScore
        ? scoreFillRgba(score, selected ? 0.62 : 0.42)
        : selected
          ? "rgba(37, 99, 235, 0.22)"
          : "rgba(255, 255, 255, 0.01)"
  const stroke = selected
    ? "#1d4ed8"
    : showNeighborhoods && neighborhoodColor
      ? neighborhoodColor
      : hasScore
        ? scoreStrokeRgba(score)
        : "transparent"

  const trySelect = (pointerId: number, x: number, y: number) => {
    const start = tapRef.current
    tapRef.current = null
    if (!start || start.pointerId !== pointerId) return
    if (Math.hypot(x - start.x, y - start.y) > PAN_THRESHOLD_PX) return
    onSelect(room.id)
  }

  return (
    <polygon
      points={polygonPoints(room)}
      fill={fill}
      fillRule="evenodd"
      stroke={selected ? "none" : stroke}
      strokeWidth={hasScore || neighborhoodColor ? 2.5 : 0}
      vectorEffect="non-scaling-stroke"
      style={{ cursor: "pointer", pointerEvents: "all", touchAction: "manipulation" }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return
        event.stopPropagation()
        tapRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      }}
      onPointerUp={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return
        event.stopPropagation()
        trySelect(event.pointerId, event.clientX, event.clientY)
      }}
      onPointerCancel={(event) => {
        event.stopPropagation()
        if (tapRef.current?.pointerId === event.pointerId) tapRef.current = null
      }}
    />
  )
}

function SelectedRoomCallout({
  room,
  label,
  viewBoxWidth,
}: {
  room: ParsedPlanRoom
  label: string
  viewBoxWidth: number
}) {
  const fontSize = Math.max(viewBoxWidth * 0.012, 18)
  const padX = fontSize * 0.55
  const padY = fontSize * 0.32
  const width = Math.max(label.length, 4) * fontSize * 0.62 + padX * 2
  const height = fontSize + padY * 2
  return (
    <g pointerEvents="none">
      <polygon
        points={polygonPoints(room)}
        fill="none"
        stroke="#ffffff"
        strokeWidth={5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={polygonPoints(room)}
        fill="none"
        stroke="#1d4ed8"
        strokeWidth={2.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <g transform={`translate(${room.x}, ${room.y})`}>
        <rect
          x={-width / 2}
          y={-height - fontSize * 0.35}
          width={width}
          height={height}
          rx={fontSize * 0.28}
          fill="#1d4ed8"
          stroke="#ffffff"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <text
          y={-fontSize * 0.55}
          textAnchor="middle"
          fill="#ffffff"
          fontSize={fontSize}
          fontWeight={700}
          style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
        >
          {label}
        </text>
      </g>
    </g>
  )
}

export function FloorPlanPanel({
  campusId,
  schoolName,
  rooms,
  selectedRoomId: selectedRoomIdProp,
  onSelectRoom,
}: {
  campusId: string
  schoolName: string
  rooms: ScoredRoomSummary[]
  selectedRoomId?: string | null
  onSelectRoom?: (roomId: string) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(DEFAULT_ZOOM)
  const panRef = useRef({ x: 0, y: 0 })
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof loadFloorPlanForCampus>>>(null)
  const [levelId, setLevelId] = useState<string | null>(null)
  const [internalSelected, setInternalSelected] = useState<string | null>(null)
  const selectedRoomId = selectedRoomIdProp ?? internalSelected
  const [zoom, setZoomState] = useState(DEFAULT_ZOOM)
  const [pan, setPanState] = useState({ x: 0, y: 0 })
  const [rotation, setRotation] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [planView, setPlanView] = useState<"scores" | "neighborhoods">("scores")
  const [neighborhoodLookup, setNeighborhoodLookup] = useState<Map<string, string>>(new Map())
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const activePointerId = useRef<number | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null)

  const setZoom = useCallback((value: number | ((prev: number) => number)) => {
    setZoomState((prev) => {
      const next = typeof value === "function" ? value(prev) : value
      const clamped = clampZoom(next)
      zoomRef.current = clamped
      return clamped
    })
  }, [])

  const setPan = useCallback((value: { x: number; y: number }) => {
    panRef.current = value
    setPanState(value)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPlan(null)
    setLevelId(null)
    setInternalSelected(null)
    setZoom(DEFAULT_ZOOM)
    setPan({ x: 0, y: 0 })
    setRotation(0)
    setPlanView("scores")
    setNeighborhoodLookup(new Map())

    loadFloorPlanForCampus(campusId, schoolName)
      .then((result) => {
        if (cancelled) return
        setPlan(result)
        setLevelId(result?.defaultLevelId ?? result?.levels[0]?.id ?? null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [campusId, schoolName, setPan, setZoom])

  useEffect(() => {
    let cancelled = false
    fetchCampusNeighborhoods(campusId)
      .then((lookup) => {
        if (!cancelled) setNeighborhoodLookup(lookup)
      })
      .catch(() => {
        if (!cancelled) setNeighborhoodLookup(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [campusId])

  const activeLevelId = levelId ?? plan?.defaultLevelId ?? plan?.levels[0]?.id ?? null
  const level = plan?.levels.find((item) => item.id === activeLevelId)
  const levelRooms = useMemo(
    () => (plan?.rooms ?? []).filter((room) => room.levelId === activeLevelId && room.points.length >= 3),
    [plan, activeLevelId],
  )

  const scoredByPlanId = useMemo(() => {
    const map = new Map<string, ScoredRoomSummary>()
    for (const planRoom of levelRooms) {
      const match = matchScoredRoom(planRoom, rooms)
      if (match) map.set(planRoom.id, match)
    }
    return map
  }, [levelRooms, rooms])

  const matchedScoreCount = scoredByPlanId.size
  const neighborhoodByPlanId = useMemo(() => {
    const map = new Map<string, string>()
    for (const planRoom of levelRooms) {
      const neighborhood = neighborhoodForPlanRoom(
        planRoom,
        neighborhoodLookup,
        scoredByPlanId.get(planRoom.id)?.neighborhood,
      )
      if (neighborhood) map.set(planRoom.id, neighborhood)
    }
    return map
  }, [levelRooms, neighborhoodLookup, scoredByPlanId])
  const neighborhoodLegend = useMemo(
    () => neighborhoodLegendColors(neighborhoodByPlanId.values()),
    [neighborhoodByPlanId],
  )
  const showNeighborhoods = planView === "neighborhoods"
  const selectedPlan =
    selectedRoomId && plan
      ? plan.rooms.find((room) => planRoomMatchesSelection(room, selectedRoomId, rooms))
      : undefined
  const selectedScored = selectedPlan ? matchScoredRoom(selectedPlan, rooms) : undefined

  const selectRoom = useCallback(
    (planRoomId: string) => {
      const planRoom = plan?.rooms.find((room) => room.id === planRoomId)
      const scored = planRoom ? matchScoredRoom(planRoom, rooms) : undefined
      const next = scored?.roomId ?? planRoomId
      setInternalSelected(next)
      onSelectRoom?.(next)
    },
    [onSelectRoom, plan, rooms],
  )

  useEffect(() => {
    if (!selectedRoomId || !plan) return
    const match = plan.rooms.find((room) => planRoomMatchesSelection(room, selectedRoomId, rooms))
    if (match && match.levelId !== activeLevelId) setLevelId(match.levelId)
  }, [selectedRoomId, plan, rooms, activeLevelId])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const factor = Math.exp(-event.deltaY * 0.003)
      setZoom((value) => clampZoom(value * factor))
    }
    el.addEventListener("wheel", onWheel, { passive: false, capture: true })
    return () => el.removeEventListener("wheel", onWheel, { capture: true })
  }, [setZoom, loading, expanded])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [expanded])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size === 2) {
      pinchRef.current = { dist: pointerDistance(pointersRef.current), zoom: zoomRef.current }
      activePointerId.current = null
      setIsPanning(false)
      return
    }
    activePointerId.current = event.pointerId
    panStart.current = { x: event.clientX, y: event.clientY, panX: panRef.current.x, panY: panRef.current.y }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const dist = pointerDistance(pointersRef.current)
      if (dist > 0 && pinchRef.current.dist > 0) {
        setZoom(clampZoom(pinchRef.current.zoom * (dist / pinchRef.current.dist)))
      }
      return
    }
    if (activePointerId.current !== event.pointerId) return
    const dx = event.clientX - panStart.current.x
    const dy = event.clientY - panStart.current.y
    if (!isPanning) {
      if (Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return
      setIsPanning(true)
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
    }
    setPan({
      x: panStart.current.panX + dx,
      y: panStart.current.panY + dy,
    })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (activePointerId.current === event.pointerId) activePointerId.current = null
    setIsPanning(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
  }

  if (loading && !plan) {
    return (
      <div className="flex h-[min(48vh,460px)] items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500">
        Loading floor plan…
      </div>
    )
  }

  if (!plan || !level) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
        No floor plan is available for this campus yet.
      </div>
    )
  }

  const vb = level.viewBox
  const panel = (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] ${expanded ? "flex h-full min-h-0 flex-col" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <div className="flex flex-1 gap-1 overflow-x-auto">
          {plan.levels.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setLevelId(item.id)
                setInternalSelected(null)
                setZoom(DEFAULT_ZOOM)
                setPan({ x: 0, y: 0 })
              }}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                item.id === activeLevelId
                  ? "bg-violet-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:text-slate-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <div className="mr-1 grid grid-cols-2 gap-0.5 rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setPlanView("scores")}
              aria-pressed={planView === "scores"}
              className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${
                planView === "scores"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Scores
            </button>
            <button
              type="button"
              onClick={() => setPlanView("neighborhoods")}
              aria-pressed={planView === "neighborhoods"}
              disabled={neighborhoodLegend.length === 0 && neighborhoodLookup.size === 0}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                planView === "neighborhoods"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Neighborhoods
            </button>
          </div>
          <button
            type="button"
            onClick={() => setZoom((value) => clampZoom(value + ZOOM_BUTTON_STEP))}
            className="flex h-9 w-8 items-center justify-center rounded-lg hover:bg-slate-100"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => clampZoom(value - ZOOM_BUTTON_STEP))}
            className="flex h-9 w-8 items-center justify-center rounded-lg hover:bg-slate-100"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setRotation((prev) => (prev + 270) % 360)}
            className="flex h-9 w-8 items-center justify-center rounded-lg hover:bg-slate-100"
            aria-label="Rotate floor plan"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex h-9 w-8 items-center justify-center rounded-lg hover:bg-slate-100"
            aria-label={expanded ? "Minimize floor plan" : "Expand floor plan"}
            aria-pressed={expanded}
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`relative w-full overflow-hidden bg-white select-none ${expanded ? "min-h-0 flex-1" : "h-[min(48vh,460px)]"}`}
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="absolute inset-0 origin-center will-change-transform"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
          }}
        >
          <svg
            viewBox={viewBoxString(vb)}
            preserveAspectRatio="xMidYMid meet"
            className={`h-full w-full ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
          >
            <image
              href={level.src}
              x={vb.x}
              y={vb.y}
              width={vb.w}
              height={vb.h}
              preserveAspectRatio="none"
              pointerEvents="none"
            />
            {levelRooms.map((room) => (
              <RoomOverlay
                key={room.id}
                room={room}
                score={scoredByPlanId.get(room.id)?.score}
                neighborhood={neighborhoodByPlanId.get(room.id)}
                selected={Boolean(selectedRoomId && planRoomMatchesSelection(room, selectedRoomId, rooms))}
                showNeighborhoods={showNeighborhoods}
                onSelect={selectRoom}
              />
            ))}
            {selectedPlan && selectedPlan.levelId === activeLevelId ? (
              <SelectedRoomCallout
                room={selectedPlan}
                label={selectedScored?.roomName ?? selectedPlan.name}
                viewBoxWidth={vb.w}
              />
            ) : null}
          </svg>
        </div>
      </div>

      {showNeighborhoods && neighborhoodLegend.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-slate-200 bg-white px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Neighborhood
          </span>
          {neighborhoodLegend.map((item) => (
            <span key={item.id} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-slate-300/70"
                style={{ backgroundColor: item.color }}
                aria-hidden
              />
              {item.id}
            </span>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-slate-200 bg-white px-3 py-2 text-[10px] text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600/70" aria-hidden />
            Good (80%+)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500/70" aria-hidden />
            Fair (55–80%)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-600/70" aria-hidden />
            Needs attention (&lt;55%)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300/50" aria-hidden />
            No score
          </span>
        </div>
      )}

      <div className="border-t border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-500">
        {matchedScoreCount} of {levelRooms.length} rooms on this level match assessed spaces. Tap a room for
        details · Drag to pan · Scroll to zoom
        {!expanded ? " · Expand for a larger view" : ""}
      </div>

      {selectedPlan ? (
        <div className="border-t-2 border-blue-600 bg-blue-50/70 px-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-800">
                Selected room
              </p>
              <p className="text-sm font-semibold text-slate-900">
                {selectedScored?.roomName ?? selectedPlan.name}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {selectedScored?.spaceType ?? "Unscored on this walk"}
                {(selectedPlan && neighborhoodByPlanId.get(selectedPlan.id)) || selectedScored?.neighborhood
                  ? ` · Neighborhood ${neighborhoodByPlanId.get(selectedPlan.id) ?? selectedScored?.neighborhood}`
                  : ""}
              </p>
              {scoreBandLabel(selectedScored?.score ?? null) ? (
                <p className="mt-1 text-[11px] text-slate-500">{scoreBandLabel(selectedScored?.score ?? null)}</p>
              ) : null}
            </div>
            <ScoreBadge score={selectedScored?.score ?? null} />
          </div>
        </div>
      ) : null}
    </div>
  )

  if (expanded && typeof document !== "undefined") {
    return createPortal(
      <div
        className="fixed inset-0 z-[90] flex flex-col bg-white sm:bg-slate-900/50 sm:p-3"
        role="dialog"
        aria-modal="true"
        aria-label="Expanded floor plan"
        onClick={() => setExpanded(false)}
      >
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden sm:mx-auto sm:my-auto sm:max-h-[min(920px,calc(100dvh-1.5rem))] sm:w-full sm:max-w-6xl"
          onClick={(event) => event.stopPropagation()}
        >
          {panel}
        </div>
      </div>,
      document.body,
    )
  }

  return panel
}
