"use client"

import { useEffect, useState } from "react"

export interface RoomPhoto {
  url: string
  path: string
  surveyType: string
  kind: string
  questionId: string | null
}

export function useRoomPhotos({
  campusId,
  schoolId,
  roomId,
  roomName,
}: {
  campusId: string
  schoolId: string
  roomId: string | null
  roomName?: string
}) {
  const [photos, setPhotos] = useState<RoomPhoto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!campusId || !schoolId || !roomId) {
      setPhotos([])
      setError(null)
      setLoading(false)
      return
    }

    const params = new URLSearchParams({ campusId, schoolId, roomId })
    if (roomName) params.set("roomName", roomName)
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setPhotos([])

    fetch(`/api/photos?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { photos?: RoomPhoto[]; error?: string }
        if (!response.ok) throw new Error(body.error || "Could not load photos")
        return body.photos ?? []
      })
      .then((next) => {
        if (!controller.signal.aborted) setPhotos(next)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : "Could not load photos")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [campusId, schoolId, roomId, roomName])

  return { photos, loading, error }
}

export function isGeneralPhoto(photo: RoomPhoto): boolean {
  return photo.kind === "prewalk" || !photo.questionId
}

export function partitionRoomPhotos(photos: RoomPhoto[]) {
  const general: RoomPhoto[] = []
  const byQuestion: Record<string, RoomPhoto[]> = {}
  for (const photo of photos) {
    if (isGeneralPhoto(photo)) {
      general.push(photo)
      continue
    }
    const questionId = photo.questionId!
    const list = byQuestion[questionId] ?? []
    list.push(photo)
    byQuestion[questionId] = list
  }
  return { general, byQuestion }
}

export function generalPhotoSpaceLabel(photo: RoomPhoto, fallback: string): string {
  const parts = photo.path.split("/").filter(Boolean)
  const index = parts.findIndex((part) => part.toLowerCase() === "prewalk")
  const space = index >= 0 ? parts[index + 1]?.replace(/\.jpg$/i, "") : ""
  return space ? space.replace(/_/g, " ") : fallback
}

export function PhotoThumbs({
  photos,
  onOpen,
  compact = false,
}: {
  photos: RoomPhoto[]
  onOpen: (url: string) => void
  compact?: boolean
}) {
  if (!photos.length) return null
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
      {photos.map((photo) => (
        <button
          key={photo.path}
          type="button"
          onClick={() => onOpen(photo.url)}
          className="overflow-hidden rounded-xl bg-slate-100 text-left ring-1 ring-slate-200"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            alt={photo.questionId ? `Photo for ${photo.questionId}` : "General space photo"}
            loading="lazy"
            className="aspect-[4/3] w-full object-cover"
          />
        </button>
      ))}
    </div>
  )
}

export function PhotoLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url) return null
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
    </div>
  )
}

export function RoomPhotos({
  campusId,
  schoolId,
  roomId,
  roomName,
}: {
  campusId: string
  schoolId: string
  roomId: string | null
  roomName?: string
}) {
  const { photos, loading, error } = useRoomPhotos({ campusId, schoolId, roomId, roomName })
  const [activeUrl, setActiveUrl] = useState<string | null>(null)

  if (!roomId) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
        Select a room in the breakdown or on the floor plan to load its pictures.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-3 py-2">
        <h3 className="text-sm font-semibold text-slate-900">Room pictures</h3>
        <p className="text-xs text-slate-500">
          {roomName ?? roomId} · loaded only for the selected space
        </p>
      </div>
      <div className="p-3">
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-500">Loading pictures…</p>
        ) : error ? (
          <p className="py-6 text-center text-sm text-red-600">{error}</p>
        ) : photos.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No pictures stored for this room.</p>
        ) : (
          <PhotoThumbs photos={photos} onOpen={setActiveUrl} compact />
        )}
      </div>
      <PhotoLightbox url={activeUrl} onClose={() => setActiveUrl(null)} />
    </div>
  )
}
