"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { DeltaChip, ScoreBadge, ScoreBar, WeightLabel } from "@/components/score-badge"
import { scoreTone, formatScore } from "@/lib/format"
import type { ScoreNode } from "@/lib/types"

function siblingTotal(nodes: ScoreNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.weight > 0 ? node.weight : 0), 0)
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
          {node.itemLabel && <p className="mt-0.5 text-[11px] text-slate-500">{node.itemLabel}</p>}
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
          {questions.length > 0 && (
            <ul className={nested.length ? "mt-1 border-t border-slate-100/80 pt-1" : ""}>
              {questions.map((child) => (
                <QuestionRow key={child.id} node={child} weightTotal={childTotal} />
              ))}
            </ul>
          )}
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

