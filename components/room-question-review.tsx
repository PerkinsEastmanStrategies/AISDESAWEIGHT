"use client"

import { useEffect, useState } from "react"
import { Check } from "lucide-react"
import { formatScore, scoreTone } from "@/lib/format"
import { formatEditTimestamp, type QaEditRecord } from "@/lib/qa-edits"
import { QaQuestionEditDialog, type PendingQuestionEdit } from "@/components/qa-edit-session"
import type { ScoredUnit } from "@/lib/types"

interface QuestionOptionCatalogEntry {
  questionType: string
  options: string[]
}

type QuestionOptionCatalog = Record<string, QuestionOptionCatalogEntry>

function categoryChip(category: string): string {
  switch (category) {
    case "Infrastructure":
      return "bg-blue-50 text-blue-700"
    case "Function":
      return "bg-violet-50 text-violet-700"
    case "Occupant Experience":
      return "bg-rose-50 text-rose-700"
    case "Amenities":
      return "bg-orange-50 text-orange-800"
    case "Size":
      return "bg-cyan-50 text-cyan-800"
    case "Observational":
      return "bg-slate-100 text-slate-600"
    default:
      return "bg-slate-100 text-slate-600"
  }
}

function categoryAccent(category: string): string {
  switch (category) {
    case "Infrastructure":
      return "border-l-blue-500"
    case "Function":
      return "border-l-violet-500"
    case "Occupant Experience":
      return "border-l-rose-500"
    case "Amenities":
      return "border-l-orange-500"
    case "Size":
      return "border-l-cyan-500"
    default:
      return "border-l-slate-400"
  }
}

function scorePct(score: number): number {
  return score <= 1 ? score * 100 : score
}

function isNotAbleToAssess(value: string | null | undefined): boolean {
  if (!value) return false
  const text = value.trim().toLowerCase()
  return text === "not able to assess" || text.startsWith("not able to assess ") || text === "unable to assess" || text.startsWith("unable to assess")
}

function isMultiSelectType(questionType: string | undefined, items: ScoredUnit[]): boolean {
  if (questionType) {
    return questionType === "MultiSelect" || questionType.startsWith("MultiSelect")
  }
  return items.length > 1 || items.some((item) => Boolean(item.itemLabel))
}

function optionMatchesValue(optionLabel: string, value: string): boolean {
  if (optionLabel === value) return true
  return isNotAbleToAssess(optionLabel) && isNotAbleToAssess(value)
}

function selectedLabels(items: ScoredUnit[], options: string[]): Set<string> {
  const selected = new Set<string>()
  const answer = items.find((item) => item.answer)?.answer?.trim() ?? ""

  if (answer) {
    const exact = options.filter((option) => optionMatchesValue(option, answer))
    if (exact.length) {
      for (const option of exact) selected.add(option)
    } else {
      const remaining = [...options].sort((a, b) => b.length - a.length)
      let leftover = answer
      for (const option of remaining) {
        const index = leftover.indexOf(option)
        if (index === -1) continue
        selected.add(option)
        leftover = `${leftover.slice(0, index)} ${leftover.slice(index + option.length)}`
      }
    }
  }

  for (const item of items) {
    const label = item.itemLabel?.trim()
    if (!label) continue
    const answerTokens = (item.answer ?? "")
      .split(/\s*,\s*/)
      .map((part) => part.trim())
      .filter(Boolean)
    const chosen = answerTokens.some((token) => optionMatchesValue(label, token)) || item.score > 0
    if (chosen) selected.add(label)
  }

  return selected
}

function choiceList(items: ScoredUnit[], catalog: QuestionOptionCatalogEntry | undefined): string[] {
  const labels: string[] = []
  const seen = new Set<string>()
  function add(label: string | null | undefined) {
    const value = label?.trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    labels.push(value)
  }
  for (const option of catalog?.options ?? []) add(option)
  for (const item of items) add(item.itemLabel)
  if (!labels.length) {
    for (const item of items) add(item.answer)
  }
  return labels
}

function optionGridClass(options: string[]): string {
  const longest = Math.max(...options.map((option) => option.length), 0)
  const count = options.length
  if (longest > 70) return "grid grid-cols-1 gap-2 sm:grid-cols-2"
  if (count === 1) return "grid grid-cols-1 gap-2"
  if (count === 3) return "grid grid-cols-2 gap-2 sm:grid-cols-3"
  if (count <= 4) return "grid grid-cols-2 gap-2 sm:grid-cols-4"
  if (longest > 36) return "grid grid-cols-2 gap-2 lg:grid-cols-3"
  return "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
}

interface QuestionGroup {
  questionId: string
  question: string
  category: string
  subcategory: string
  items: ScoredUnit[]
}

function groupUnits(units: ScoredUnit[]): QuestionGroup[] {
  const order: string[] = []
  const byId = new Map<string, ScoredUnit[]>()
  for (const unit of units) {
    const existing = byId.get(unit.questionId)
    if (existing) existing.push(unit)
    else {
      order.push(unit.questionId)
      byId.set(unit.questionId, [unit])
    }
  }
  return order.map((questionId) => {
    const items = byId.get(questionId) ?? []
    const first = items[0]!
    return {
      questionId,
      question: first.question,
      category: first.category,
      subcategory: first.subcategory,
      items,
    }
  })
}

function OptionTile({
  label,
  selected,
  editable,
  onToggle,
}: {
  label: string
  selected: boolean
  editable?: boolean
  onToggle?: () => void
}) {
  const className = `relative flex min-h-12 items-center rounded-xl border px-3 py-2.5 text-left text-sm leading-snug ${
    selected
      ? "border-blue-600 bg-blue-50 text-slate-900 shadow-sm ring-2 ring-blue-200/90"
      : "border-slate-300 bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
  } ${editable ? "cursor-pointer hover:border-blue-400" : ""}`
  const content = (
    <>
      {selected ? <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-blue-700" aria-hidden /> : null}
      <span className={`w-full break-words ${selected ? "pr-5 font-medium" : ""}`}>{label}</span>
    </>
  )
  if (editable) {
    return (
      <button type="button" onClick={onToggle} className={`w-full ${className}`}>
        {content}
      </button>
    )
  }
  return <div className={className}>{content}</div>
}

export function RoomQuestionReview({
  units,
  photosByQuestion = {},
  notesByQuestion = {},
  onOpenPhoto,
  edits = [],
  onCommitEdit,
}: {
  units: ScoredUnit[]
  photosByQuestion?: Record<string, { url: string; path: string; questionId: string | null }[]>
  notesByQuestion?: Record<string, string>
  onOpenPhoto?: (url: string) => void
  edits?: QaEditRecord[]
  onCommitEdit?: (input: { questionId: string; selected: string[]; previous: string[]; editor: string; reason: string }) => void
}) {
  const [catalog, setCatalog] = useState<QuestionOptionCatalog>({})
  const [pending, setPending] = useState<PendingQuestionEdit | null>(null)
  const questions = groupUnits(units)

  useEffect(() => {
    let cancelled = false
    fetch("/question-options.json")
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: QuestionOptionCatalog) => {
        if (!cancelled) setCatalog(data)
      })
      .catch(() => {
        if (!cancelled) setCatalog({})
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!questions.length) {
    return <p className="px-1 py-6 text-sm text-slate-500">No recorded answers for this room.</p>
  }

  return (
    <div className="space-y-3">
      {questions.map((group, index) => {
        const entry = catalog[group.questionId]
        const choices = choiceList(group.items, entry)
        const recorded = selectedLabels(group.items, choices)
        const edit = edits.find((item) => item.questionId === group.questionId)
        const selected = new Set(edit?.selected ?? [...recorded])
        const isMulti = isMultiSelectType(entry?.questionType, group.items)
        const scored = group.items.map((item) => scorePct(item.score))
        const average = scored.reduce((sum, value) => sum + value, 0) / scored.length
        function toggle(label: string) {
          if (!onCommitEdit) return
          const next = new Set(selected)
          if (isMulti) {
            if (next.has(label)) next.delete(label)
            else next.add(label)
          } else {
            next.clear()
            next.add(label)
          }
          setPending({
            questionId: group.questionId,
            question: group.question,
            isMulti,
            options: choices.length ? choices : [label],
            previous: [...recorded],
            selected: [...next],
          })
        }
        return (
          <article
            key={group.questionId}
            className={`overflow-hidden rounded-2xl border border-slate-200/90 border-l-[3px] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] ${categoryAccent(group.category)}`}
          >
            <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50/90 to-white px-3.5 py-3.5">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold tabular-nums text-emerald-700">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold leading-snug tracking-tight text-slate-900">
                    {group.question}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] text-slate-400">{group.questionId}</span>
                    <span
                      className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${categoryChip(group.category)}`}
                    >
                      {group.category}
                    </span>
                    {group.subcategory ? (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        {group.subcategory}
                      </span>
                    ) : null}
                    {isMulti ? (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        Select all that apply
                      </span>
                    ) : null}
                    {edit ? (
                      <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        Edited
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className={`shrink-0 text-sm font-bold tabular-nums ${scoreTone(average)}`}>
                  {formatScore(average)}
                </span>
              </div>
            </div>
            <div className="bg-slate-50/80 px-3.5 py-3.5">
              {choices.length ? (
                <div className={optionGridClass(choices)}>
                  {choices.map((label) => (
                    <OptionTile
                      key={label}
                      label={label}
                      selected={selected.has(label)}
                      editable={Boolean(onCommitEdit)}
                      onToggle={() => toggle(label)}
                    />
                  ))}
                </div>
              ) : (
                <OptionTile
                  label={group.items[0]?.answer || "Not answered"}
                  selected={Boolean(group.items[0]?.answer)}
                />
              )}
              {edit ? (
                <p className="mt-3 text-[11px] leading-snug text-slate-500">
                  Edited by {edit.editor} · {formatEditTimestamp(edit.editedAt)} · {edit.reason}
                </p>
              ) : null}
            </div>
            {photosByQuestion[group.questionId]?.length || notesByQuestion[group.questionId] ? (
              <div className="space-y-3 border-t border-slate-100 bg-slate-50/70 px-3.5 py-2.5">
                {notesByQuestion[group.questionId] ? (
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Note</p>
                    <p className="whitespace-pre-wrap rounded-xl bg-blue-50 px-3 py-2 text-sm leading-relaxed text-slate-800 ring-1 ring-blue-100">
                      {notesByQuestion[group.questionId]}
                    </p>
                  </div>
                ) : null}
                {photosByQuestion[group.questionId]?.length ? (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Photos</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {photosByQuestion[group.questionId]!.map((photo) => (
                        <button
                          key={photo.path}
                          type="button"
                          onClick={() => onOpenPhoto?.(photo.url)}
                          className="overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.url}
                            alt={`Photo for ${group.questionId}`}
                            loading="lazy"
                            className="aspect-[4/3] w-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        )
      })}
      {pending ? (
        <QaQuestionEditDialog
          pending={pending}
          onCancel={() => setPending(null)}
          onConfirm={({ editor, reason, selected }) => {
            onCommitEdit?.({
              questionId: pending.questionId,
              selected,
              previous: pending.previous,
              editor,
              reason,
            })
            setPending(null)
          }}
        />
      ) : null}
    </div>
  )
}
