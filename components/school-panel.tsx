"use client"

import { FloorPlanPanel } from "@/components/floor-plan-panel"
import { BigScore } from "@/components/score-badge"
import { ScoreTree } from "@/components/score-tree"
import type { SchoolScorecard } from "@/lib/types"

export function SchoolPanel({ card }: { card: SchoolScorecard }) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{card.schoolName}</h2>
        <p className="text-sm text-slate-500">
          {card.scoredRoomCount} assessed spaces
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <BigScore label="Campus overall" score={card.overall} baseline={card.overallBaseline} />
        <BigScore
          label="Existing spaces"
          score={card.existingOnly}
          baseline={card.existingOnlyBaseline}
        />
      </div>

      <FloorPlanPanel campusId={card.campusId} schoolName={card.schoolName} rooms={card.rooms} />

      <div>
        <ScoreTree
          nodes={card.focusAreas}
          empty="No focus area scores yet."
          hint={`${card.scoredRoomCount} assessed spaces scored · Tap to expand focus area → space type → room → category → subcategory → question.`}
        />
      </div>
    </section>
  )
}
