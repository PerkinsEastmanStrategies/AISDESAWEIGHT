"use client"

import { useEffect, useRef, useState } from "react"
import { loadSavedEditorName, saveEditorName } from "@/lib/qa-edits"
import {
  addScoringCommentLive,
  emptyScoringNotes,
  fetchScoringNotes,
  type QaScoringNotes,
} from "@/lib/qa-scoring-notes"

export function useScoringNotes(schoolId: string) {
  const [notes, setNotes] = useState<QaScoringNotes>(emptyScoringNotes(schoolId))
  const [author, setAuthor] = useState(loadSavedEditorName())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [savingTopic, setSavingTopic] = useState<string | null>(null)
  const savingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setNotes(emptyScoringNotes(schoolId))
    setAuthor(loadSavedEditorName())
    setDrafts({})
    setError(null)
    setSavingTopic(null)
    savingRef.current = false

    async function load(background = false) {
      try {
        const loaded = await fetchScoringNotes(schoolId)
        if (cancelled || savingRef.current) return
        setNotes(loaded)
        if (loaded.author && !loadSavedEditorName()) setAuthor(loaded.author)
        if (!background) setError(null)
      } catch (caught) {
        if (!cancelled && !background) {
          setError(caught instanceof Error ? caught.message : "Could not load scoring notes")
        }
      }
    }

    void load()
    const timer = window.setInterval(() => {
      void load(true)
    }, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [schoolId])

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
      const saved = await addScoringCommentLive({ schoolId, topic, author: name, text })
      setNotes(saved)
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
