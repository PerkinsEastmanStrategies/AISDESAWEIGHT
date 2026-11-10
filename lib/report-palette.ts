import { SCORE_FAIR, SCORE_GOOD } from "@/lib/format"

export const AISD_NAVY = "#243A76"
export const AISD_BLUE = "#557DBF"
export const AISD_GREEN = "#57A545"
export const AISD_GOLD = "#F3BC1A"

export type ReportPaletteId = "good" | "worst"

export interface ReportPalette {
  id: ReportPaletteId
  label: string
  navy: string
  blue: string
  accent: string
}

export const REPORT_PALETTES: Record<ReportPaletteId, ReportPalette> = {
  good: {
    id: "good",
    label: "Option 1",
    navy: AISD_NAVY,
    blue: AISD_BLUE,
    accent: AISD_GREEN,
  },
  worst: {
    id: "worst",
    label: "Option 2",
    navy: AISD_NAVY,
    blue: AISD_BLUE,
    accent: AISD_GOLD,
  },
}

const PALETTE_STORAGE_KEY = "esa-report-palette"

export function isReportPaletteId(value: string | null | undefined): value is ReportPaletteId {
  return value === "good" || value === "worst"
}

export function loadReportPaletteId(): ReportPaletteId {
  if (typeof window === "undefined") return "good"
  try {
    const stored = window.sessionStorage.getItem(PALETTE_STORAGE_KEY)
    return isReportPaletteId(stored) ? stored : "good"
  } catch {
    return "good"
  }
}

export function saveReportPaletteId(id: ReportPaletteId): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(PALETTE_STORAGE_KEY, id)
  } catch {
    /* ignore quota */
  }
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace("#", "").trim()
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value
  const int = Number.parseInt(full, 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function mixHex(hex: string, other: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount))
  const [r1, g1, b1] = parseHex(hex)
  const [r2, g2, b2] = parseHex(other)
  const hexPart = (value: number) => Math.round(value).toString(16).padStart(2, "0")
  return `#${hexPart(r1 + (r2 - r1) * t)}${hexPart(g1 + (g2 - g1) * t)}${hexPart(b1 + (b2 - b1) * t)}`
}

export function tintHex(hex: string, amount = 0.82): string {
  return mixHex(hex, "#ffffff", amount)
}

/** Solid color for the score band in the selected palette. */
export function scoreBandHex(score: number | null | undefined, palette: ReportPalette): string {
  if (score == null || Number.isNaN(score)) return "#94a3b8"
  if (palette.id === "worst") {
    if (score >= SCORE_GOOD) return palette.navy
    if (score >= SCORE_FAIR) return palette.blue
    return palette.accent
  }
  if (score >= SCORE_GOOD) return palette.accent
  if (score >= SCORE_FAIR) return palette.blue
  return palette.navy
}

export function scoreBandColors(
  score: number | null | undefined,
  palette: ReportPalette,
): { fill: string; bg: string; fg: string } {
  if (score == null || Number.isNaN(score)) {
    return { fill: "#94a3b8", bg: "#f8fafc", fg: "#94a3b8" }
  }
  const fill = scoreBandHex(score, palette)
  return {
    fill,
    bg: fill,
    fg: "#ffffff",
  }
}
