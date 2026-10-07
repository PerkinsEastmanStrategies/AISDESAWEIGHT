/**
 * Clone Casis (Pilot #2) and Cook ES into QA portal test campuses,
 * including JSON snapshots and live ESA rows in Supabase.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CLONES = [
  {
    sourceId: "casis-pilot-2",
    id: "casis-pilot-2-test",
    name: "CASIS (Pilot #2) Test",
    displayName: "Casis Elementary (Pilot #2) — Test",
    campusId: "112-TEST",
  },
  {
    sourceId: "cook",
    id: "cook-test",
    name: "COOK Test",
    displayName: "Cook ES — Test",
    campusId: "161-TEST",
  },
]

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=")
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")]
    }),
)
const projectUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "")
const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "")
if (!projectUrl || !key) throw new Error("Supabase env is missing in .env.local")

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
}

async function restSelectAll(table, query) {
  const pageSize = 1000
  const rows = []
  for (let offset = 0; ; offset += pageSize) {
    const url = `${projectUrl}/rest/v1/${table}?${query}&limit=${pageSize}&offset=${offset}`
    const response = await fetch(url, { headers })
    const text = await response.text()
    if (!response.ok) throw new Error(`${table} select ${response.status}: ${text.slice(0, 500)}`)
    const page = JSON.parse(text)
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

async function restUpsert(table, rows, onConflict) {
  const response = await fetch(
    `${projectUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rows),
    },
  )
  const text = await response.text()
  if (!response.ok) throw new Error(`${table} upsert ${response.status}: ${text.slice(0, 800)}`)
  const data = JSON.parse(text)
  return Array.isArray(data) ? data : [data]
}

async function restInsert(table, rows) {
  const response = await fetch(`${projectUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(rows),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${table} insert ${response.status}: ${text.slice(0, 800)}`)
  const data = JSON.parse(text)
  return Array.isArray(data) ? data : [data]
}

async function restDelete(table, query) {
  const response = await fetch(`${projectUrl}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers,
  })
  const text = await response.text()
  if (!response.ok && response.status !== 404) {
    throw new Error(`${table} delete ${response.status}: ${text.slice(0, 500)}`)
  }
}

async function restUpsertChunked(table, rows, onConflict, chunkSize = 150) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    await restUpsert(table, rows.slice(index, index + chunkSize), onConflict)
  }
}

function inFilter(column, values) {
  if (!values.length) return `${column}=eq.__none__`
  return `${column}=in.(${values.map((value) => encodeURIComponent(value)).join(",")})`
}

function withoutMeta(row) {
  const next = { ...row }
  delete next.id
  delete next.created_at
  delete next.updated_at
  return next
}

function writeSnapshot(clone, source) {
  const sourceFile = path.join(ROOT, "public", "schools", `${source.sourceId}.json`)
  const destFile = path.join(ROOT, "public", "schools", `${clone.id}.json`)
  const snapshot = JSON.parse(fs.readFileSync(sourceFile, "utf8"))
  snapshot.schoolId = clone.id
  snapshot.schoolName = clone.displayName
  snapshot.campusId = clone.campusId
  snapshot.exportedAt = new Date().toISOString()
  fs.writeFileSync(destFile, `${JSON.stringify(snapshot)}\n`)
  return {
    schoolId: snapshot.schoolId,
    schoolName: snapshot.schoolName,
    campusId: snapshot.campusId,
    schoolClass: snapshot.schoolClass,
    schoolLevel: snapshot.schoolLevel,
    roomCount: snapshot.roomCount,
    scoredUnitCount: snapshot.scoredUnitCount,
    exportedAt: snapshot.exportedAt,
  }
}

function upsertIndex(filePath, entry) {
  const rows = JSON.parse(fs.readFileSync(filePath, "utf8"))
  const next = rows.filter((row) => row.schoolId !== entry.schoolId)
  const after = next.findIndex((row) => row.schoolId === entry.schoolId.replace(/-test$/i, ""))
  if (after >= 0) next.splice(after + 1, 0, entry)
  else next.push(entry)
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`)
}

async function cloneInSupabase(clone) {
  const sourceSchool = (
    await restSelectAll(
      "esa_schools",
      `school_id=eq.${encodeURIComponent(clone.sourceId)}&select=*`,
    )
  )[0]
  if (!sourceSchool) throw new Error(`Source school ${clone.sourceId} is missing from esa_schools`)

  await restUpsert(
    "esa_schools",
    {
      school_id: clone.id,
      campus_id: clone.campusId,
      name: clone.name,
      display_name: clone.displayName,
      school_class: sourceSchool.school_class,
      address: sourceSchool.address,
      city: sourceSchool.city,
      state: sourceSchool.state,
      zip: sourceSchool.zip,
      lat: sourceSchool.lat,
      lng: sourceSchool.lng,
      has_floor_plan: sourceSchool.has_floor_plan,
    },
    "school_id",
  )

  const existingSessions = await restSelectAll(
    "esa_survey_sessions",
    `school_id=eq.${encodeURIComponent(clone.id)}&select=id`,
  )
  if (existingSessions.length) {
    await restDelete("esa_survey_sessions", `school_id=eq.${encodeURIComponent(clone.id)}`)
    console.log(`Cleared ${existingSessions.length} existing ${clone.displayName} session(s).`)
  }

  const existingAssessment = await restSelectAll(
    "esa_campus_assessments",
    `school_id=eq.${encodeURIComponent(clone.id)}&select=id&order=created_at.desc`,
  )
  const campusAssessmentId =
    existingAssessment[0]?.id ??
    (
      await restInsert("esa_campus_assessments", {
        school_id: clone.id,
        campus_id: clone.campusId,
        school_name: clone.displayName,
        status: "in_progress",
      })
    )[0].id

  const sourceSessions = await restSelectAll(
    "esa_survey_sessions",
    `school_id=eq.${encodeURIComponent(clone.sourceId)}&select=*`,
  )
  if (!sourceSessions.length) throw new Error(`No survey sessions on ${clone.sourceId}`)

  const sourceIds = sourceSessions.map((row) => row.id)
  const [sourceRooms, sourceResponses, sourcePins] = await Promise.all([
    restSelectAll("esa_survey_rooms", `${inFilter("survey_session_id", sourceIds)}&select=*`),
    restSelectAll("esa_question_responses", `${inFilter("survey_session_id", sourceIds)}&select=*`),
    restSelectAll("esa_outdoor_pins", `${inFilter("survey_session_id", sourceIds)}&select=*`),
  ])

  const roomsBySession = new Map()
  for (const row of sourceRooms) {
    const list = roomsBySession.get(row.survey_session_id) ?? []
    list.push(row)
    roomsBySession.set(row.survey_session_id, list)
  }
  const responsesBySession = new Map()
  for (const row of sourceResponses) {
    const list = responsesBySession.get(row.survey_session_id) ?? []
    list.push(row)
    responsesBySession.set(row.survey_session_id, list)
  }
  const pinsBySession = new Map()
  for (const row of sourcePins) {
    const list = pinsBySession.get(row.survey_session_id) ?? []
    list.push(row)
    pinsBySession.set(row.survey_session_id, list)
  }

  let roomCount = 0
  let responseCount = 0
  for (const session of sourceSessions) {
    const [destSession] = await restUpsert(
      "esa_survey_sessions",
      {
        survey_id: `AISD-QA-${clone.id}-${session.survey_type}`,
        campus_assessment_id: campusAssessmentId,
        school_id: clone.id,
        campus_id: clone.campusId,
        school_name: clone.displayName,
        survey_type: session.survey_type,
        building: session.building || "Main",
        assessor_name: session.assessor_name,
        assessor_email: session.assessor_email,
        assessor_registered_at: session.assessor_registered_at,
        started_at: session.started_at,
        submitted_at: null,
        final_comment: session.final_comment,
        campus_submitted_at: null,
      },
      "school_id,survey_type",
    )

    const destRooms = (roomsBySession.get(session.id) ?? []).map((row) => ({
      ...withoutMeta(row),
      survey_session_id: destSession.id,
    }))
    const destResponses = (responsesBySession.get(session.id) ?? []).map((row) => ({
      ...withoutMeta(row),
      survey_session_id: destSession.id,
    }))
    const destPins = (pinsBySession.get(session.id) ?? []).map((row) => ({
      ...withoutMeta(row),
      survey_session_id: destSession.id,
    }))

    if (destRooms.length) await restUpsertChunked("esa_survey_rooms", destRooms, "survey_session_id,room_id")
    if (destResponses.length) {
      await restUpsertChunked("esa_question_responses", destResponses, "survey_session_id,room_id,question_id")
    }
    if (destPins.length) await restUpsertChunked("esa_outdoor_pins", destPins, "survey_session_id,pin_id")
    roomCount += destRooms.length
    responseCount += destResponses.length
    console.log(
      `${clone.displayName} ${session.survey_type}: ${destRooms.length} rooms, ${destResponses.length} answers`,
    )
  }
  console.log(`${clone.displayName}: ${roomCount} rooms, ${responseCount} answers cloned from ${clone.sourceId}.`)
}

const snapshots = []
for (const clone of CLONES) {
  snapshots.push(writeSnapshot(clone, clone))
  await cloneInSupabase(clone)
}

for (const filePath of [
  path.join(ROOT, "data", "school-index.json"),
  path.join(ROOT, "public", "schools", "index.json"),
]) {
  for (const entry of snapshots) upsertIndex(filePath, entry)
}

console.log("QA test campuses ready:")
for (const entry of snapshots) {
  console.log(`  ${entry.schoolName} (${entry.schoolId})`)
}
