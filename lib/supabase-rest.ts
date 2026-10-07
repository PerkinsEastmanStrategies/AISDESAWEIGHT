export function supabaseProjectUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured")
  return url.replace(/\/$/, "")
}

export function supabaseServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) {
    throw new Error("Add SUPABASE_SERVICE_ROLE_KEY to .env.local to save QA changes")
  }
  return key
}

function restHeaders(prefer?: string): HeadersInit {
  const key = supabaseServiceKey()
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  }
}

function tableMissingMessage(table: string, detail: string): string {
  if (
    detail.includes("schema cache") ||
    detail.includes("Could not find the table") ||
    detail.includes("PGRST205") ||
    detail.includes("does not exist")
  ) {
    return `Supabase is missing ${table}. Run supabase/qa-portal.sql in the SQL Editor, then try again.`
  }
  return detail || `${table} request failed`
}

export async function supabaseRestSelect<T>(table: string, query: string): Promise<T[]> {
  if (/\blimit=/i.test(query)) {
    const url = `${supabaseProjectUrl()}/rest/v1/${table}?${query}`
    const response = await fetch(url, { headers: restHeaders(), cache: "no-store" })
    const text = await response.text()
    if (!response.ok) throw new Error(tableMissingMessage(table, text.slice(0, 400)))
    const page = JSON.parse(text) as T[]
    return Array.isArray(page) ? page : []
  }
  const pageSize = 1000
  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const url = `${supabaseProjectUrl()}/rest/v1/${table}?${query}&limit=${pageSize}&offset=${offset}`
    const response = await fetch(url, { headers: restHeaders(), cache: "no-store" })
    const text = await response.text()
    if (!response.ok) throw new Error(tableMissingMessage(table, text.slice(0, 400)))
    const page = JSON.parse(text) as T[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

export async function supabaseRestUpsert<T extends object>(
  table: string,
  rows: T | T[],
  onConflict: string,
): Promise<T[]> {
  const url = `${supabaseProjectUrl()}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`
  const response = await fetch(url, {
    method: "POST",
    headers: restHeaders("resolution=merge-duplicates,return=representation"),
    body: JSON.stringify(rows),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(tableMissingMessage(table, text.slice(0, 400)))
  const data = JSON.parse(text) as T | T[]
  return Array.isArray(data) ? data : [data]
}

export async function supabaseRestInsert<T extends object>(table: string, rows: T | T[]): Promise<T[]> {
  const url = `${supabaseProjectUrl()}/rest/v1/${table}`
  const response = await fetch(url, {
    method: "POST",
    headers: restHeaders("return=representation"),
    body: JSON.stringify(rows),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(tableMissingMessage(table, text.slice(0, 400)))
  const data = JSON.parse(text) as T | T[]
  return Array.isArray(data) ? data : [data]
}

export async function supabaseRestPatch<T extends object>(table: string, query: string, body: T): Promise<void> {
  const url = `${supabaseProjectUrl()}/rest/v1/${table}?${query}`
  const response = await fetch(url, {
    method: "PATCH",
    headers: restHeaders("return=minimal"),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(tableMissingMessage(table, detail.slice(0, 400)))
  }
}

export function inFilter(column: string, values: string[]): string {
  return `${column}=in.(${values.map((value) => encodeURIComponent(value)).join(",")})`
}

export function sourceSchoolId(schoolId: string): string {
  return schoolId.replace(/-test$/i, "").replace(/-pilot-\d+$/i, "")
}

export function schoolIdLookups(schoolId: string): string[] {
  const ids = [schoolId]
  const withoutTest = schoolId.replace(/-test$/i, "")
  if (withoutTest !== schoolId) ids.push(withoutTest)
  const withoutPilot = withoutTest.replace(/-pilot-\d+$/i, "")
  if (withoutPilot !== withoutTest) ids.push(withoutPilot)
  return [...new Set(ids.filter(Boolean))]
}

export function campusIdLookups(campusId: string): string[] {
  const ids = [campusId]
  let current = campusId
  const suffix = /-(PILOT(?:-\d+)?(?:-MERGE)?|TEST(?:-ES|-MS|-HS)?)$/i
  while (suffix.test(current)) {
    current = current.replace(suffix, "")
    ids.push(current)
  }
  return [...new Set(ids.filter(Boolean))]
}
