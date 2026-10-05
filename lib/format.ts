export const SCORE_GOOD = 80
export const SCORE_FAIR = 55

export function formatScore(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "—"
  return `${Math.round(score)}%`
}

export function formatScoreExact(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "—"
  return `${(Math.round(score * 10) / 10).toFixed(1)}%`
}

export function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-slate-400"
  if (score >= SCORE_GOOD) return "text-emerald-700"
  if (score >= SCORE_FAIR) return "text-amber-700"
  return "text-red-700"
}

export function barTone(score: number | null | undefined): string {
  if (score == null) return "bg-slate-200"
  if (score >= SCORE_GOOD) return "bg-emerald-500"
  if (score >= SCORE_FAIR) return "bg-amber-500"
  return "bg-red-500"
}

export function badgeTone(score: number | null | undefined): string {
  if (score == null) return "bg-slate-100 text-slate-400 ring-slate-200"
  if (score >= SCORE_GOOD) return "bg-emerald-50 text-emerald-700 ring-emerald-200/80"
  if (score >= SCORE_FAIR) return "bg-amber-50 text-amber-800 ring-amber-200/80"
  return "bg-red-50 text-red-700 ring-red-200/80"
}

export function formatDelta(current: number | null, baseline: number | null): string | null {
  if (current == null || baseline == null) return null
  const delta = Math.round((current - baseline) * 10) / 10
  if (Math.abs(delta) < 0.05) return "0.0"
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`
}

export function deltaTone(current: number | null, baseline: number | null): string {
  if (current == null || baseline == null) return "text-slate-400"
  const delta = current - baseline
  if (Math.abs(delta) < 0.05) return "text-slate-400"
  return delta > 0 ? "text-emerald-600" : "text-red-600"
}

export function formatWeightShare(weight: number, total: number): string | null {
  if (weight <= 0 || total <= 0) return null
  const pct = (weight / total) * 100
  const rounded = Math.round(pct * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

export function scoreFillRgba(score: number | null | undefined, alpha = 0.45): string {
  if (score == null) return `rgba(148, 163, 184, ${alpha * 0.35})`
  if (score >= SCORE_GOOD) return `rgba(5, 150, 105, ${alpha})`
  if (score >= SCORE_FAIR) return `rgba(217, 119, 6, ${alpha})`
  return `rgba(225, 29, 72, ${alpha})`
}

export function scoreStrokeRgba(score: number | null | undefined): string {
  if (score == null) return "rgba(148, 163, 184, 0.55)"
  if (score >= SCORE_GOOD) return "rgba(4, 120, 87, 0.9)"
  if (score >= SCORE_FAIR) return "rgba(180, 83, 9, 0.9)"
  return "rgba(190, 18, 60, 0.9)"
}

export function scoreBandLabel(score: number | null | undefined): string | null {
  if (score == null) return null
  if (score >= SCORE_GOOD) return "Good (80%+)"
  if (score >= SCORE_FAIR) return "Fair (55–80%)"
  return "Needs attention (below 55%)"
}
