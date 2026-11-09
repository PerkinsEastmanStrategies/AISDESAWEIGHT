"use client"

import { useEffect, useRef, useState } from "react"
import { loadSavedEditorName, saveEditorName } from "@/lib/qa-edits"
import {
  addScoringCommentLive,
  emptyScoringNotes,
  fetchScoringNotes,
  notesForStream,
  type QaNoteStream,
  type QaScoringNotes,
} from "@/lib/qa-scoring-notes"

export function useScoringNotes(schoolId: string, stream: QaNoteStream) {
  const [notes, setNotes] = useState<QaScoringNotes>(emptyScoringNotes(schoolId))
  const [author, setAuthorState] = useState(loadSavedEditorName())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [savingTopic, setSavingTopic] = useState<string | null>(null)
  const savingRef = useRef(false)

  function setAuthor(value: string) {
    setAuthorState(value)
    saveEditorName(value)
  }

  useEffect(() => {
    let cancelled = false
    setNotes(emptyScoringNotes(schoolId))
    setAuthorState(loadSavedEditorName())
    setDrafts({})
    setError(null)
    setSavingTopic(null)
    savingRef.current = false

    async function load(background = false) {
      if (!schoolId) return
      try {
        const loaded = await fetchScoringNotes(schoolId)
        if (cancelled || savingRef.current) return
        setNotes(notesForStream(loaded, stream))
        if (!background) setError(null)
      } catch (caught) {
        if (!cancelled && !background) {
          setError(caught instanceof Error ? caught.message : "Could not load scoring notes")
        }
      }
    }

    void load()
    if (!schoolId) {
      return () => {
        cancelled = true
      }
    }
    const timer = window.setInterval(() => {
      void load(true)
    }, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [schoolId, stream])

  async function addComment(topic: string) {
    const name = author.trim()
    const text = (drafts[topic] ?? "").trim()
    if (!name) {
      setError("Enter your name so others can see who wrote the comment.")
      return
    }
    if (!text) {
      setError("Write a comment before saving.")
      return
    }
    saveEditorName(name)
    savingRef.current = true
    setSavingTopic(topic)
    setError(null)
    try {
      const saved = await addScoringCommentLive({ schoolId, topic, author: name, text, stream })
      setNotes(notesForStream(saved, stream))
      setDrafts((current) => ({ ...current, [topic]: "" }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save scoring notes")
    } finally {
      savingRef.current = false
      setSavingTopic(null)
    }
  }

  return {
    notes,
    author,
    setAuthor,
    drafts,
    setDrafts,
    error,
    savingTopic,
    addComment,
  }
}
