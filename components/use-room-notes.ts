"use client"

import { useEffect, useState } from "react"

export interface RoomNotesPayload {
  roomNotes: string[]
  comments: Record<string, string>
}

export function useRoomNotes({
  schoolId,
  roomId,
  roomName,
}: {
  schoolId: string
  roomId: string | null
  roomName?: string
}) {
  const [notes, setNotes] = useState<RoomNotesPayload>({ roomNotes: [], comments: {} })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!schoolId || !roomId) {
      setNotes({ roomNotes: [], comments: {} })
      setError(null)
      setLoading(false)
      return
    }

    const params = new URLSearchParams({ schoolId, roomId })
    if (roomName) params.set("roomName", roomName)
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setNotes({ roomNotes: [], comments: {} })

    fetch(`/api/notes?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as RoomNotesPayload & { error?: string }
        if (!response.ok) throw new Error(body.error || "Could not load notes")
        return {
          roomNotes: body.roomNotes ?? [],
          comments: body.comments ?? {},
        }
      })
      .then((next) => {
        if (!controller.signal.aborted) setNotes(next)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : "Could not load notes")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [schoolId, roomId, roomName])

  return { notes, loading, error }
}
