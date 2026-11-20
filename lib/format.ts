import {
  scoreBandDef,
  scoreBandId,
  scoreBandLabel as sharedScoreBandLabel,
  type ScoreBandId,
} from "@aisd/shared"

export { SCORE_BANDS, SCORE_FAIR, SCORE_GOOD, SCORE_EXCELLENT, SCORE_POOR, SCORE_BAND_TICKS } from "@aisd/shared"
export { scoreBandId, scoreBandDef }

const TONE: Record<ScoreBandId, string> = {
  excellent: "text-teal-700",
  good: "text-emerald-700",
  fair: "text-amber-700",
  poor: "text-orange-700",
  critical: "text-red-700",
}

const BAR: Record<ScoreBandId, string> = {
  excellent: "bg-teal-600",
  good: "bg-emerald-500",
  fair: "bg-amber-500",
  poor: "bg-orange-500",
  critical: "bg-red-500",
}

const BADGE: Record<ScoreBandId, string> = {
  excellent: "bg-teal-50 text-teal-800 ring-teal-200/80",
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200/80",
  fair: "bg-amber-50 text-amber-800 ring-amber-200/80",
  poor: "bg-orange-50 text-orange-800 ring-orange-200/80",
  critical: "bg-red-50 text-red-700 ring-red-200/80",
}

export function formatScore(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "—"
  return `${Math.round(score)}%`
}

export function formatScoreExact(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "—"
  return `${(Math.round(score * 10) / 10).toFixed(1)}%`
}

export function scoreTone(score: number | null | undefined): string {
  const band = scoreBandId(score)
  return band ? TONE[band] : "text-slate-400"
}

export function barTone(score: number | null | undefined): string {
  const band = scoreBandId(score)
  return band ? BAR[band] : "bg-slate-200"
}

export function badgeTone(score: number | null | undefined): string {
  const band = scoreBandId(score)
  return band ? BADGE[band] : "bg-slate-100 text-slate-400 ring-slate-200"
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
  const band = scoreBandDef(score)
  if (!band) return `rgba(148, 163, 184, ${alpha * 0.35})`
  const [r, g, b] = band.rgb
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function scoreStrokeRgba(score: number | null | undefined): string {
  const band = scoreBandDef(score)
  if (!band) return "rgba(148, 163, 184, 0.55)"
  const [r, g, b] = band.rgb
  return `rgba(${r}, ${g}, ${b}, 0.9)`
}

export function scoreBandLabel(score: number | null | undefined): string | null {
  return sharedScoreBandLabel(score)
}
