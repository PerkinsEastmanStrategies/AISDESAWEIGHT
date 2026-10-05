"use client"

import { useState } from "react"
import { Check, X } from "lucide-react"
import type { AnswerConsistencyRow } from "@/lib/answer-consistency"

export function QaAnswerMatrix({
  spaceLabel,
  roomCount,
  rows,
  onSelectRoom,
}: {
  spaceLabel: string
  roomCount: number
  rows: AnswerConsistencyRow[]
  onSelectRoom?: (roomId: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const different = rows.filter((row) => !row.same).length
  const same = rows.length - different

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Answer consistency</h3>
          <p className="text-xs text-slate-500">
            {spaceLabel} · {roomCount} rooms · click a red X to see which rooms differ
          </p>
        </div>
        <p className="shrink-0 text-[11px] text-slate-500">
          <span className="font-semibold text-emerald-700">{same} same</span>
          <span className="px-1 text-slate-300">·</span>
          <span className="font-semibold text-rose-700">{different} different</span>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Need at least two rooms to compare answers.</p>
      ) : (
        <ul className="max-h-[min(70vh,40rem)] space-y-1 overflow-auto">
          {rows.map((row) => {
            const open = openId === row.questionId
            const body = (
              <>
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    row.same ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                  }`}
                  title={row.same ? "Same in every room" : "Different across rooms"}
                >
                  {row.same ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
                </span>
                <span className="min-w-0 text-left">
                  <span className="block text-sm leading-snug text-slate-800">{row.question}</span>
                  <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{row.questionId}</span>
                </span>
              </>
            )
            return (
              <li key={row.questionId} className={`rounded-xl ${open ? "bg-rose-50 ring-1 ring-rose-100" : "bg-slate-50"}`}>
                {row.same ? (
                  <div className="flex items-start gap-3 px-3 py-2">{body}</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : row.questionId)}
                    className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-rose-50/80"
                  >
                    {body}
                  </button>
                )}
                {open && !row.same ? (
                  <div className="space-y-3 border-t border-rose-100 px-3 py-3">
                    {row.groups.map((group, index) => {
                      const majority = index === 0 && !group.unanswered
                      return (
                        <div key={group.rooms.map((room) => room.roomId).join("-")}>
                          <p
                            className={`text-[11px] font-semibold uppercase tracking-wide ${
                              majority ? "text-emerald-700" : "text-rose-700"
                            }`}
                          >
                            {group.unanswered
                              ? `Not answered · ${group.rooms.length}`
                              : majority
                                ? `Same · ${group.rooms.length} room${group.rooms.length === 1 ? "" : "s"}`
                                : `Different · ${group.rooms.length} room${group.rooms.length === 1 ? "" : "s"}`}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {group.rooms.map((room) => (
                              <button
                                key={room.roomId}
                                type="button"
                                onClick={() => onSelectRoom?.(room.roomId)}
                                className={`rounded-lg px-2 py-1 text-xs font-medium ${
                                  majority
                                    ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                    : "bg-rose-100 text-rose-800 hover:bg-rose-200"
                                }`}
                              >
                                {room.roomName}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
