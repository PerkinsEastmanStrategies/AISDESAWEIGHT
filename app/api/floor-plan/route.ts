import { NextResponse } from "next/server"

export const runtime = "nodejs"

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://mgflyiwrzcmxxuxpfotk.supabase.co"
).replace(/\/$/, "")
const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_FLOOR_PLANS_BUCKET ?? "floor-plans"

function isSafeFilename(filename: string): boolean {
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return false
  }
  return /^[A-Za-z0-9][A-Za-z0-9 .()_+#-]*\.svg$/i.test(filename)
}

function toMobileFilename(filename: string): string {
  if (/\.mobile\.svg$/i.test(filename)) return filename
  return filename.replace(/\.svg$/i, ".mobile.svg")
}

function publicObjectUrl(filename: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(filename)}`
}

async function proxySvg(filename: string): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const response = await fetch(publicObjectUrl(filename), {
      cache: "force-cache",
      signal: controller.signal,
    })
    if (!response.ok || !response.body) return null
    return new NextResponse(response.body, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const file = params.get("file")?.trim() ?? ""
  if (!isSafeFilename(file)) {
    return NextResponse.json({ error: "Invalid floor plan filename" }, { status: 400 })
  }

  const preferMobile = params.get("preferMobile") === "1"
  const candidates = /\.mobile\.svg$/i.test(file)
    ? [file]
    : preferMobile
      ? [toMobileFilename(file), file]
      : [file, toMobileFilename(file)]
  for (const candidate of candidates) {
    const svg = await proxySvg(candidate)
    if (svg) return svg
  }

  return NextResponse.json({ error: "Floor plan not found" }, { status: 404 })
}
