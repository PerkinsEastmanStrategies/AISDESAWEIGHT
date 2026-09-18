"use client"

import { useMemo, useState } from "react"
import { RotateCcw } from "lucide-react"
import { SchoolPanel } from "@/components/school-panel"
import { WeightEditor } from "@/components/weight-editor"
import { DeltaChip, ScoreBadge } from "@/components/score-badge"
import { scoreSchool } from "@/lib/scoring"
import {
  createWeightResolver,
  EMPTY_OVERRIDES,
  filterWeightsForLevel,
  overrideCount,
} from "@/lib/weights"
import type { SchoolSnapshot, WeightFile, WeightOverrides } from "@/lib/types"

export function WeightingApp({
  weights,
  schools,
}: {
  weights: WeightFile
  schools: SchoolSnapshot[]
}) {
  const [overrides, setOverrides] = useState<WeightOverrides>(EMPTY_OVERRIDES)
  const esWeights = useMemo(() => filterWeightsForLevel(weights, "ES"), [weights])
  const resolver = useMemo(() => createWeightResolver(esWeights, overrides), [esWeights, overrides])
  const baseline = useMemo(() => createWeightResolver(esWeights, EMPTY_OVERRIDES), [esWeights])
  const changed = overrideCount(overrides)

  const cards = useMemo(
    () => schools.map((school) => scoreSchool(school, resolver, baseline)),
    [schools, resolver, baseline],
  )

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
              AISD ESA
            </p>
            <h1 className="text-xl font-semibold tracking-tight">Live weighting lab</h1>
            <p className="text-sm text-slate-500">
              Casis and Ortega Pilot #2 scores, using the starting-point weight CSVs
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {cards.map((card) => (
              <div
                key={card.schoolId}
                className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 ring-1 ring-slate-200"
              >
                <span className="text-xs font-medium text-slate-500">
                  {card.schoolName.replace(" (Pilot #2)", "")}
                </span>
                <ScoreBadge score={card.overall} />
                <DeltaChip current={card.overall} baseline={card.overallBaseline} />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setOverrides(EMPTY_OVERRIDES)}
              disabled={changed === 0}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <RotateCcw size={14} />
              Reset {changed > 0 ? `(${changed})` : ""}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-[88px] lg:h-[calc(100dvh-104px)]">
          <div className="flex h-full min-h-[420px] flex-col rounded-2xl bg-slate-50 p-4 shadow-sm ring-1 ring-slate-200">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-slate-900">Weights</h2>
              <p className="text-xs text-slate-500">
                Start point is 6 at every scored level. Expand focus area → space type → category
                → subcategory → question. Inventory and observational items have no points and
                are left out of the weighting breakdown.
              </p>
            </div>
            <WeightEditor
              weights={esWeights}
              overrides={overrides}
              resolver={resolver}
              onChange={setOverrides}
            />
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          {cards.length === 2 && (
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Breakout</th>
                    {cards.map((card) => (
                      <th key={card.schoolId} className="px-4 py-2.5 font-semibold">
                        {card.schoolName.replace(" Elementary (Pilot #2)", "")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium">Campus overall</td>
                    {cards.map((card) => (
                      <td key={card.schoolId} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <ScoreBadge score={card.overall} />
                          <DeltaChip current={card.overall} baseline={card.overallBaseline} />
                        </div>
                      </td>
                    ))}
                  </tr>
                  {cards[0].focusAreas.map((area) => (
                    <tr key={area.id} className="border-t border-slate-100">
                      <td className="px-4 py-2">{area.label}</td>
                      {cards.map((card) => {
                        const match = card.focusAreas.find((item) => item.id === area.id)
                        return (
                          <td key={card.schoolId} className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <ScoreBadge score={match?.score ?? null} />
                              <DeltaChip
                                current={match?.score ?? null}
                                baseline={match?.baseline ?? null}
                              />
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {cards.map((card) => (
              <SchoolPanel key={card.schoolId} card={card} />
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
