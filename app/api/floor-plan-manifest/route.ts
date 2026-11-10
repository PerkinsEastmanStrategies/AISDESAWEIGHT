import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"
import {
  DEFAULT_FLOOR_PLAN_MANIFEST_URL,
  mergeLiveFloorPlanManifest,
  parseFloorPlanManifest,
  supabaseRowsToManifest,
  type FloorPlanManifestDbRow,
  type FloorPlanManifestRow,
} from "@/lib/floor-plan-manifest"
import { supabaseRestSelect } from "@/lib/supabase-rest"

export const runtime = "nodejs"

async function fetchCsv(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

async function loadLocalCsv(): Promise<FloorPlanManifestRow[]> {
  try {
    const file = path.join(process.cwd(), "public", "aisd-floor-plan-manifest.csv")
    return parseFloorPlanManifest(await readFile(file, "utf8"))
  } catch {
    return []
  }
}

async function loadSupabaseRows(): Promise<FloorPlanManifestRow[]> {
  try {
    const rows = await supabaseRestSelect<FloorPlanManifestDbRow>(
      "floor_plan_manifest",
      [
        "select=campus_id,school_name,school_class,floor_level_id,floor_label,filename,mobile_filename",
        "order=campus_id,floor_level_id",
        "limit=5000",
      ].join("&"),
    )
    return supabaseRowsToManifest(Array.isArray(rows) ? rows : [])
  } catch {
    return []
  }
}

export async function GET() {
  try {
    const [liveCsv, localRows, supabaseRows] = await Promise.all([
      fetchCsv(process.env.NEXT_PUBLIC_FLOOR_PLAN_MANIFEST_URL?.trim() || DEFAULT_FLOOR_PLAN_MANIFEST_URL),
      loadLocalCsv(),
      loadSupabaseRows(),
    ])
    const sheetRows = liveCsv ? parseFloorPlanManifest(liveCsv) : []
    const rows = mergeLiveFloorPlanManifest(sheetRows, localRows, supabaseRows)
    return NextResponse.json({ rows })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load floor plan manifest"
    return NextResponse.json({ error: message, rows: [] as FloorPlanManifestRow[] }, { status: 500 })
  }
}
