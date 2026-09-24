"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react"
import { ScoreBadge } from "@/components/score-badge"
import { loadFloorPlanForCampus } from "@/lib/floor-plan-loader"
import { overlayPointsForRoom, viewBoxString, type ParsedPlanRoom } from "@/lib/floor-plan-parse"
import { scoreBandLabel, scoreFillRgba, scoreStrokeRgba } from "@/lib/format"
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

function normalizeRoomId(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "")
}

function matchScoredRoom(planRoom: ParsedPlanRoom, rooms: ScoredRoomSummary[]): ScoredRoomSummary | undefined {
  const aliases = [planRoom.id, planRoom.name].map(normalizeRoomId).filter(Boolean)
  return rooms.find((room) => {
    const ids = [room.roomId, room.roomName].map(normalizeRoomId)
    return aliases.some((alias) => ids.includes(alias))
  })
}

function RoomOverlay({
  room,
  score,
  selected,
  onSelect,
}: {
  room: ParsedPlanRoom
  score: number | null | undefined
  selected: boolean
  onSelect: (roomId: string) => void
}) {
  const tapRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const hasScore = score != null
  const fill = hasScore
    ? scoreFillRgba(score, selected ? 0.58 : 0.45)
    : selected
      ? "rgba(37, 99, 235, 0.15)"
      : "rgba(255, 255, 255, 0.01)"
  const stroke = hasScore
    ? selected
      ? "#2563eb"
      : scoreStrokeRgba(score)
    : selected
      ? "#2563eb"
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
      points={overlayPointsForRoom(room)
        .map((pt) => `${pt.x},${pt.y}`)
        .join(" ")}
      fill={fill}
      fillRule="evenodd"
      stroke={stroke}
      strokeWidth={selected ? 14 : hasScore ? 8 : 0}
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

export function FloorPlanPanel({
  campusId,
  schoolName,
  rooms,
}: {
  campusId: string
  schoolName: string
  rooms: ScoredRoomSummary[]
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(DEFAULT_ZOOM)
  const panRef = useRef({ x: 0, y: 0 })
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof loadFloorPlanForCampus>>>(null)
  const [levelId, setLevelId] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [zoom, setZoomState] = useState(DEFAULT_ZOOM)
  const [pan, setPanState] = useState({ x: 0, y: 0 })
  const [rotation, setRotation] = useState(0)
  const [expanded, setExpanded] = useState(false)
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
    setSelectedRoomId(null)
    setZoom(DEFAULT_ZOOM)
    setPan({ x: 0, y: 0 })
    setRotation(0)

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
  const selectedScored = selectedRoomId ? scoredByPlanId.get(selectedRoomId) : undefined
  const selectedPlan = selectedRoomId ? levelRooms.find((room) => room.id === selectedRoomId) : undefined

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
      <div className="flex h-[min(42vh,380px)] items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500">
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
                setSelectedRoomId(null)
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
        className={`relative w-full overflow-hidden bg-white select-none ${expanded ? "min-h-0 flex-1" : "h-[min(42vh,380px)]"}`}
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
                selected={selectedRoomId === room.id}
                onSelect={setSelectedRoomId}
              />
            ))}
          </svg>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-slate-200 bg-white px-3 py-2 text-[10px] text-slate-600">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600/70" aria-hidden />
          Good (70%+)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500/70" aria-hidden />
          Fair (45–69%)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-600/70" aria-hidden />
          Needs attention (&lt;45%)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300/50" aria-hidden />
          No score
        </span>
      </div>

      <div className="border-t border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-500">
        {matchedScoreCount} of {levelRooms.length} rooms on this level match assessed spaces. Tap a room for
        details · Drag to pan · Scroll to zoom
        {!expanded ? " · Expand for a larger view" : ""}
      </div>

      {selectedPlan ? (
        <div className="border-t border-slate-200 bg-white px-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">
                {selectedScored?.roomName ?? selectedPlan.name}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {selectedScored?.spaceType ?? "Unscored on this walk"}
                {selectedScored?.neighborhood ? ` · Neighborhood ${selectedScored.neighborhood}` : ""}
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
