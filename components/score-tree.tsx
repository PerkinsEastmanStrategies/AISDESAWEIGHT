"use client"

import { useState } from "react"
import { CheckCircle2, ChevronDown, ChevronRight, Circle } from "lucide-react"
import { DeltaChip, ScoreBadge, ScoreBar, WeightLabel } from "@/components/score-badge"
import { scoreTone, formatScore } from "@/lib/format"
import type { ScoreNode } from "@/lib/types"

function siblingTotal(nodes: ScoreNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.weight > 0 ? node.weight : 0), 0)
}

function isSelectAllOption(node: ScoreNode): boolean {
  return !!node.itemLabel
}

function isOptionSelected(node: ScoreNode): boolean {
  if (node.itemLabel && node.answer) {
    const selected = node.answer.split(/\s*,\s*/).map((part) => part.trim())
    if (selected.includes(node.itemLabel)) return true
  }
  return (node.score ?? 0) > 0
}

function groupQuestionRows(questions: ScoreNode[]): ScoreNode[][] {
  const groups: ScoreNode[][] = []
  for (const question of questions) {
    const last = groups[groups.length - 1]
    if (
      last &&
      last[0]?.questionId &&
      last[0].questionId === question.questionId &&
      (isSelectAllOption(last[0]) || isSelectAllOption(question))
    ) {
      last.push(question)
    } else {
      groups.push([question])
    }
  }
  return groups
}

function ChoiceStatus({ selected }: { selected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
        selected ? "text-emerald-700" : "text-slate-400"
      }`}
    >
      {selected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
      {selected ? "Selected" : "Not selected"}
    </span>
  )
}

function QuestionRow({ node, weightTotal }: { node: ScoreNode; weightTotal: number }) {
  return (
    <li className="border-b border-slate-100/80 py-2.5 pl-5 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] text-slate-400">
            {node.questionId}
            <WeightLabel weight={node.weight} weightTotal={weightTotal} />
          </p>
          <p className="mt-0.5 text-xs leading-snug text-slate-800">{node.label}</p>
          {node.answer && (
            <p className="mt-1 text-[11px] text-slate-600">
              <span className="text-slate-400">Answer: </span>
              {node.answer}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`text-xs font-bold tabular-nums ${scoreTone(node.score)}`}>
            {formatScore(node.score)}
          </span>
          <DeltaChip current={node.score} baseline={node.baseline} />
        </div>
      </div>
    </li>
  )
}

function SelectAllQuestion({
  nodes,
  weightTotal,
}: {
  nodes: ScoreNode[]
  weightTotal: number
}) {
  const first = nodes[0]
  const groupWeight = nodes.reduce((sum, node) => sum + node.weight, 0)
  const scored = nodes.filter((node) => node.score != null && node.weight > 0)
  const totalScore =
    scored.length === 0
      ? null
      : scored.reduce((sum, node) => sum + (node.score as number) * node.weight, 0) /
        scored.reduce((sum, node) => sum + node.weight, 0)
  const selectedCount = nodes.filter((node) => isOptionSelected(node)).length

  return (
    <li className="border-b border-slate-100/80 py-2.5 pl-5 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] text-slate-400">
            {first.questionId}
            <WeightLabel weight={groupWeight} weightTotal={weightTotal} />
          </p>
          <p className="mt-0.5 text-xs leading-snug text-slate-800">{first.label}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {selectedCount} of {nodes.length} selected
          </p>
        </div>
        <span className={`shrink-0 text-xs font-bold tabular-nums ${scoreTone(totalScore)}`}>
          {formatScore(totalScore)}
        </span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {nodes.map((node) => {
          const selected = isOptionSelected(node)
          return (
            <li
              key={node.id}
              className="flex items-start justify-between gap-3 rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-100"
            >
              <div className="min-w-0">
                <p className={`text-[12px] leading-snug ${selected ? "text-slate-800" : "text-slate-500"}`}>
                  {node.itemLabel ?? node.label}
                </p>
                <div className="mt-0.5">
                  <ChoiceStatus selected={selected} />
                </div>
              </div>
              <span className={`shrink-0 text-xs font-bold tabular-nums ${scoreTone(node.score)}`}>
                {formatScore(node.score)}
              </span>
            </li>
          )
        })}
      </ul>
    </li>
  )
}

function QuestionList({
  questions,
  weightTotal,
  className,
}: {
  questions: ScoreNode[]
  weightTotal: number
  className?: string
}) {
  if (!questions.length) return null
  return (
    <ul className={className}>
      {groupQuestionRows(questions).map((group) =>
        group.length > 1 || isSelectAllOption(group[0]) ? (
          <SelectAllQuestion key={group[0].id} nodes={group} weightTotal={weightTotal} />
        ) : (
          <QuestionRow key={group[0].id} node={group[0]} weightTotal={weightTotal} />
        ),
      )}
    </ul>
  )
}

function GroupRow({
  node,
  depth,
  weightTotal,
}: {
  node: ScoreNode
  depth: number
  weightTotal: number
}) {
  const [open, setOpen] = useState(false)
  const children = node.children ?? []
  const childTotal = siblingTotal(children)
  const compact = depth === 1 || depth >= 4
  const questions = children.filter((child) => child.kind === "question")
  const nested = children.filter((child) => child.kind !== "question")
  const isRoom = node.kind === "room"
  const chevronClass = depth === 0 ? "mt-0.5 h-4 w-4 shrink-0 text-slate-400" : "mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400"

  return (
    <div
      className={
        depth === 0
          ? "overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
          : isRoom
            ? "mb-1 last:mb-0 rounded-lg border border-slate-100 bg-white"
            : depth === 3
              ? "rounded-xl border border-slate-200/80 bg-white"
              : "rounded-lg border border-slate-100 bg-slate-50/80"
      }
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`flex w-full gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 ${
          isRoom ? "items-center" : "items-start"
        }`}
      >
        {open ? (
          <ChevronDown className={chevronClass} />
        ) : (
          <ChevronRight className={chevronClass} />
        )}
        {isRoom ? (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{node.label}</p>
              {node.countLabel && <p className="mt-0.5 text-[10px] text-slate-500">{node.countLabel}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <DeltaChip current={node.score} baseline={node.baseline} />
              <ScoreBadge score={node.score} />
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <ScoreBar
              score={node.score}
              label={node.label}
              weight={node.weight}
              weightTotal={weightTotal}
              compact={compact}
            />
            {node.countLabel && <p className="mt-1 text-[10px] text-slate-500">{node.countLabel}</p>}
            {node.baseline != null && (
              <div className="mt-0.5 flex justify-end">
                <DeltaChip current={node.score} baseline={node.baseline} />
              </div>
            )}
          </div>
        )}
      </button>

      {open && children.length > 0 && (
        <div className="border-t border-slate-100 px-3 pb-3 pt-1">
          {nested.length > 0 && (
            <div className="space-y-1">
              {nested.map((child) => (
                <GroupRow key={child.id} node={child} depth={depth + 1} weightTotal={childTotal} />
              ))}
            </div>
          )}
          <QuestionList
            questions={questions}
            weightTotal={childTotal}
            className={nested.length ? "mt-1 border-t border-slate-100/80 pt-1" : ""}
          />
        </div>
      )}
    </div>
  )
}

export function ScoreTree({
  nodes,
  empty,
  hint,
}: {
  nodes: ScoreNode[]
  empty: string
  hint?: string
}) {
  if (!nodes.length) {
    return <p className="px-2 py-6 text-sm text-slate-500">{empty}</p>
  }
  const total = siblingTotal(nodes)
  return (
    <div className="space-y-2">
      {hint && <p className="px-0.5 text-xs text-slate-500">{hint}</p>}
      {nodes.map((node) =>
        node.kind === "question" ? (
          <div key={node.id} className="rounded-2xl border border-slate-200/90 bg-white px-3">
            <QuestionRow node={node} weightTotal={total} />
          </div>
        ) : (
          <GroupRow key={node.id} node={node} depth={0} weightTotal={total} />
        ),
      )}
    </div>
  )
}
