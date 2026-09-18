import { badgeTone, barTone, deltaTone, formatDelta, formatScore, formatScoreExact, formatWeightShare, scoreTone } from "@/lib/format"

export function ScoreBadge({ score }: { score: number | null }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ring-1 ${badgeTone(score)}`}
    >
      {formatScore(score)}
    </span>
  )
}

export function WeightLabel({
  weight,
  weightTotal,
}: {
  weight?: number | null
  weightTotal?: number | null
}) {
  if (weight == null || weight <= 0 || weightTotal == null || weightTotal <= 0) return null
  const formatted = formatWeightShare(weight, weightTotal)
  if (!formatted) return null
  return <span className="font-normal text-slate-400"> · {formatted}</span>
}

export function ScoreBar({
  score,
  compact = false,
  label,
  weight,
  weightTotal,
}: {
  score: number | null
  compact?: boolean
  label?: string
  weight?: number | null
  weightTotal?: number | null
}) {
  if (!label) {
    return (
      <div className={`overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 ${compact ? "h-1.5" : "h-2"}`}>
        {score != null && (
          <div
            className={`h-full rounded-full transition-all duration-300 ${barTone(score)}`}
            style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
          />
        )}
      </div>
    )
  }

  return (
    <div>
      <div className={`mb-1 flex justify-between gap-2 ${compact ? "text-[11px]" : "text-xs"}`}>
        <span className="min-w-0 font-medium text-slate-700">
          {label}
          <WeightLabel weight={weight} weightTotal={weightTotal} />
        </span>
        <span className={`shrink-0 tabular-nums font-semibold ${scoreTone(score)}`}>
          {formatScore(score)}
        </span>
      </div>
      <div className={`overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 ${compact ? "h-1.5" : "h-2"}`}>
        {score != null && (
          <div
            className={`h-full rounded-full transition-all duration-300 ${barTone(score)}`}
            style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
          />
        )}
      </div>
    </div>
  )
}

export function DeltaChip({ current, baseline }: { current: number | null; baseline: number | null }) {
  const label = formatDelta(current, baseline)
  if (!label || label === "0.0") return null
  return (
    <span className={`tabular-nums text-[11px] font-semibold ${deltaTone(current, baseline)}`}>
      {label} pts
    </span>
  )
}

export function BigScore({
  label,
  score,
  baseline,
}: {
  label: string
  score: number | null
  baseline: number | null
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="text-4xl font-bold tabular-nums tracking-tight text-slate-900">
          {formatScoreExact(score)}
        </div>
        <DeltaChip current={score} baseline={baseline} />
      </div>
      <div className="mt-3">
        <ScoreBar score={score} />
      </div>
    </div>
  )
}
