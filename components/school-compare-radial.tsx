"use client"

import { useState } from "react"
import { CategorySpider } from "@/components/category-spider"
import type { SchoolIndexEntry, SchoolScorecard } from "@/lib/types"

const SLOTS = ["School 1", "School 2", "School 3", "School 4"]

export function SchoolCompareRadial({
  options,
  cards,
  axisOrder,
  loading = false,
}: {
  options: SchoolIndexEntry[]
  cards: SchoolScorecard[]
  axisOrder: string[]
  loading?: boolean
}) {
  const [ids, setIds] = useState(["", "", "", ""])
  const selected = ids
    .map((id) => cards.find((card) => card.schoolId === id) ?? null)
    .filter((card): card is SchoolScorecard => Boolean(card))
  const waiting = ids.some((id) => id && !cards.some((card) => card.schoolId === id))

  function choose(index: number, schoolId: string) {
    setIds((current) => current.map((value, slot) => (slot === index ? schoolId : value)))
  }

  return (
    <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Four-school comparison</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Pick up to four campuses to overlay scoring focus areas on a radial plot.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SLOTS.map((label, index) => {
          const hidden = ids.filter((id, slot) => slot !== index && id)
          return (
            <label key={label} className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                {label}
              </span>
              <select
                value={ids[index]}
                onChange={(event) => choose(index, event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
              >
                <option value="">Select a school</option>
                {options.map((school) => (
                  <option
                    key={school.schoolId}
                    value={school.schoolId}
                    disabled={hidden.includes(school.schoolId)}
                  >
                    {school.schoolName}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
      {loading || waiting ? <p className="text-sm text-slate-500">Loading campus scores…</p> : null}
      <CategorySpider cards={selected} axisOrder={axisOrder} embedded />
    </div>
  )
}
