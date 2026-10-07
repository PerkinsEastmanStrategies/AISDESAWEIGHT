/**
 * Pull recent ES / MS / HS walk answers from AISD-ESA Supabase and write
 * question-level scores into this project. Test / merge campuses are skipped.
 *
 * Run from the AISD-ESA repo so path aliases resolve:
 *   cd C:\dev\AISD-ESA
 *   npx tsx "C:\Users\p.davis\dev\live-weighting-tool\scripts\export-pilot-scores.ts"
 */
import fs from "node:fs"
import path from "node:path"
import {
  getRoomSurveyRubric,
  isAbsentSpaceTypeRoomId,
  isInventoryOption,
  isMultiSelectQuestionType,
  isNotAbleToAssessOption,
  lookupTableEntry,
  lookupTableEntryBySpaceType,
  mergeTraditionalStudioSizeScore,
  responseRequiresUnableToAssessNote,
  scoreRoom,
  scoringFocusAreaForRoom,
  scoringFocusAreaLabel,
  type EsaQuestionOption,
  type RoomQuestionResponse,
  type RoomSurveySession,
  type SurveyType,
} from "@aisd/shared"
import { isSkippedDependentQuestion } from "@/lib/question-dependencies"

const ROOT = "C:\\Users\\p.davis\\dev\\live-weighting-tool"
const OUT_DIR = path.join(ROOT, "data")
const SCHOOLS_DIR = path.join(ROOT, "public", "schools")
const WALKED_SINCE = "2026-09-17T00:00:00.000Z"
const MIN_RESPONSES = 100
const TIME_ZONE = "America/Chicago"

function tzOffsetMs(timeZone: string, date: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - date.getTime()
}

function startOfDayInTimeZone(timeZone: string, year: number, month: number, day: number): Date {
  const utc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const offset = tzOffsetMs(timeZone, utc)
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offset)
}

function startOfTodayInTimeZone(timeZone: string, now = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  return startOfDayInTimeZone(timeZone, Number(parts.year), Number(parts.month), Number(parts.day))
}

const WALKED_UNTIL = startOfTodayInTimeZone(TIME_ZONE).toISOString()
const SNAPSHOT_AS_OF = new Date(Date.parse(WALKED_UNTIL) - 1).toISOString()

const CLASS_TO_LEVEL: Record<string, "ES" | "MS" | "HS"> = {
  ELEM: "ES",
  MID: "MS",
  HIGH: "HS",
}

interface ExportSchool {
  schoolId: string
  schoolName: string
  campusId: string
  schoolClass: string
  schoolLevel: "ES" | "MS" | "HS"
}

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=")
      return [
        line.slice(0, index).trim(),
        line.slice(index + 1).trim().replace(/^["']|["']$/g, ""),
      ]
    }),
)

const projectUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "")
const key = String(env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "")
if (!projectUrl || !key) throw new Error("Supabase env is missing in AISD-ESA .env.local")

const headers: Record<string, string> = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
}

function inFilter(column: string, values: string[]): string {
  return `${column}=in.(${values.map((v) => encodeURIComponent(v)).join(",")})`
}

async function restSelectAll<T>(table: string, query: string): Promise<T[]> {
  const pageSize = 1000
  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const url = `${projectUrl}/rest/v1/${table}?${query}&limit=${pageSize}&offset=${offset}`
    const response = await fetch(url, { headers })
    const text = await response.text()
    if (!response.ok) throw new Error(`${table} select ${response.status}: ${text.slice(0, 500)}`)
    const page = JSON.parse(text) as T[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(cell)
      cell = ""
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""))
      rows.push(row)
      row = []
      cell = ""
    } else {
      cell += ch
    }
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""))
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

function csvObjects(fileName: string): Record<string, string>[] {
  const filePath = path.join(OUT_DIR, "weights", fileName)
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"))
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((cols) => {
    const obj: Record<string, string> = {}
    header.forEach((key, i) => {
      obj[key] = (cols[i] ?? "").trim()
    })
    return obj
  })
}

interface SessionRow {
  id: string
  school_id: string
  survey_type: SurveyType
  school_name: string
}

interface RoomRow {
  survey_session_id: string
  room_id: string
  room_number: string
  school_room_number: string | null
  room_type: string
  grade_type: string
  neighborhood: string | null
  area_sqft: number | null
  deferred_to_closeout: boolean
  source_survey_type: SurveyType | null
}

interface ResponseRow {
  survey_session_id: string
  room_id: string
  question_id: string
  value: unknown
  created_at?: string | null
  updated_at?: string | null
  client_updated_at?: string | null
}

function responseAsOf(row: { created_at?: string | null; updated_at?: string | null; client_updated_at?: string | null }): string {
  return row.client_updated_at || row.updated_at || row.created_at || ""
}

function isBeforeCutoff(stamp: string | null | undefined): boolean {
  return Boolean(stamp) && stamp < WALKED_UNTIL
}

function asResponseValue(value: unknown): string | string[] {
  if (Array.isArray(value)) return value.map((v) => String(v))
  if (value == null) return ""
  return String(value)
}

function isNonViableSelectAllOption(optionLabel: string | null | undefined): boolean {
  if (!optionLabel) return false
  const text = optionLabel.trim().toLowerCase()
  return (
    text === "none of the above" ||
    text.startsWith("none of the above ") ||
    isNotAbleToAssessOption(optionLabel)
  )
}

function answerLabel(value: string | string[] | null | undefined): string | null {
  if (value == null || value === "") return null
  if (Array.isArray(value)) {
    const joined = value.filter(Boolean).join(", ")
    return joined || null
  }
  return String(value)
}

function viableOptionGroups(questionId: string, options: EsaQuestionOption[]) {
  const groups = new Map<string, EsaQuestionOption[]>()
  for (const opt of options) {
    if (opt.questionId !== questionId) continue
    if (!opt.option?.trim()) continue
    if (isInventoryOption(opt)) continue
    if (isNonViableSelectAllOption(opt.option)) continue
    const unitId = opt.scoreGroupId || opt.scoreId
    if (!unitId) continue
    const list = groups.get(unitId) ?? []
    list.push(opt)
    groups.set(unitId, list)
  }
  return groups
}

function scoreRoomSnapshot(room: RoomRow, responses: ResponseRow[], schoolClass: string) {
  const surveyType = (room.source_survey_type || "studios") as SurveyType
  const roomSession: RoomSurveySession = {
    roomId: room.room_id,
    roomNumber: room.room_number,
    schoolRoomNumber: room.school_room_number ?? undefined,
    roomType: room.room_type,
    gradeType: (room.grade_type || "") as RoomSurveySession["gradeType"],
    neighborhood: room.neighborhood ?? undefined,
    areaSqft: room.area_sqft ?? undefined,
    levelId: "campus",
    responses: responses.map((r) => ({
      questionId: r.question_id,
      value: asResponseValue(r.value),
    })) as RoomQuestionResponse[],
    spaceTypeMarkedAbsent: isAbsentSpaceTypeRoomId(room.room_id) || undefined,
  }

  const markedAbsent = !!roomSession.spaceTypeMarkedAbsent
  const table =
    lookupTableEntry(surveyType, room.room_type, schoolClass) ??
    lookupTableEntryBySpaceType(room.room_type, schoolClass)
  const focusAreaId =
    scoringFocusAreaForRoom(surveyType, room.room_type, schoolClass) ?? table?.scoringFocusAreaId ?? null
  const spaceType = table?.spaceType ?? room.room_type
  const focusAreaLabel = focusAreaId
    ? scoringFocusAreaLabel(focusAreaId)
    : (table?.scoringFocusLabel ?? "Unassigned")

  if (markedAbsent) {
    return {
      roomId: room.room_id,
      roomName: room.school_room_number?.trim() || room.room_number || room.room_id,
      surveyType,
      spaceType,
      focusAreaId: focusAreaId ?? "unassigned",
      focusAreaLabel,
      neighborhood: room.neighborhood ?? undefined,
      gradeType: room.grade_type || undefined,
      markedAbsent: true,
      units: [],
    }
  }

  const rubric = getRoomSurveyRubric(
    surveyType,
    room.room_type,
    room.grade_type,
    schoolClass,
    room.source_survey_type,
  )
  if (!rubric || !focusAreaId) {
    return null
  }

  const skipped = rubric.questions
    .filter((q) => isSkippedDependentQuestion(q.questionId, roomSession.responses, rubric.questions))
    .map((q) => q.questionId)

  let result = scoreRoom(
    roomSession.responses,
    rubric.questions,
    rubric.categories,
    rubric.subcategories,
    rubric.options,
    rubric.assessmentArea,
    skipped,
  )
  result = mergeTraditionalStudioSizeScore(
    result,
    room.area_sqft,
    rubric.categories,
    rubric.subcategories,
  )

  if (!result.questionScores.length) return null

  const questionById = new Map(rubric.questions.map((q) => [q.questionId, q]))
  const parentByUnit = new Map<string, string>()
  for (const opt of rubric.options) {
    const unitId = opt.scoreGroupId || opt.scoreId
    if (unitId && !parentByUnit.has(unitId)) parentByUnit.set(unitId, opt.questionId)
  }

  const scoredByUnitId = new Map(result.questionScores.map((unit) => [unit.questionId, unit]))
  const parentIds = new Set(
    result.questionScores.map((unit) => parentByUnit.get(unit.questionId) ?? unit.questionId),
  )
  const skippedSet = new Set(skipped)
  for (const question of rubric.questions) {
    if (skippedSet.has(question.questionId)) continue
    if (!isMultiSelectQuestionType(question.questionType)) continue
    const response = roomSession.responses.find((row) => row.questionId === question.questionId)
    if (!response) continue
    if (responseRequiresUnableToAssessNote(response.value)) continue
    parentIds.add(question.questionId)
  }

  const units = []
  for (const parentId of parentIds) {
    const question = questionById.get(parentId)
    const groups = viableOptionGroups(parentId, rubric.options)
    if (!groups.size) continue
    const response = roomSession.responses.find((row) => row.questionId === parentId)
    const answer = answerLabel(response?.value)
    const isMulti = question ? isMultiSelectQuestionType(question.questionType) : false

    for (const [unitId, unitOptions] of groups) {
      const scored = scoredByUnitId.get(unitId)
      let score = scored?.score
      if (score == null) {
        if (!isMulti) continue
        score = 0
      }
      const texts = [...new Set(unitOptions.map((opt) => opt.option.trim()).filter(Boolean))]
      units.push({
        questionId: parentId,
        unitId,
        question: question?.question ?? parentId,
        category: scored?.category ?? question?.category ?? "",
        subcategory: scored?.subcategory ?? question?.subcategory ?? "",
        score,
        itemLabel: groups.size > 1 ? (texts.length === 1 ? texts[0] : unitId) : null,
        answer,
      })
    }
  }

  return {
    roomId: room.room_id,
    roomName: room.school_room_number?.trim() || room.room_number || room.room_id,
    surveyType,
    spaceType,
    focusAreaId,
    focusAreaLabel,
    neighborhood: room.neighborhood ?? undefined,
    gradeType: room.grade_type || undefined,
    markedAbsent: false,
    units,
  }
}

function isTestOrSandboxSchool(input: {
  schoolId: string
  campusId: string
  name: string
}): boolean {
  const haystack = `${input.schoolId} ${input.campusId} ${input.name}`.toLowerCase()
  if (haystack.includes("test")) return true
  if (haystack.includes("merge")) return true
  if (input.schoolId === "barton-hills" || input.schoolId === "casis" || input.schoolId === "ortega") return true
  return false
}

async function discoverWalkedSchools(): Promise<ExportSchool[]> {
  const schools = await restSelectAll<{
    school_id: string
    campus_id: string
    name: string
    display_name: string | null
    school_class: string | null
  }>("esa_schools", "select=school_id,campus_id,name,display_name,school_class")
  const sessions = await restSelectAll<{
    id: string
    school_id: string
    campus_id: string
    school_name: string
    updated_at: string
  }>("esa_survey_sessions", "select=id,school_id,campus_id,school_name,updated_at")
  const responses = await restSelectAll<{
    survey_session_id: string
    created_at: string | null
    updated_at: string | null
    client_updated_at: string | null
  }>("esa_question_responses", "select=survey_session_id,created_at,updated_at,client_updated_at")
  const schoolById = new Map(schools.map((school) => [school.school_id, school]))
  const responseCount = new Map<string, number>()
  for (const row of responses) {
    if (!isBeforeCutoff(responseAsOf(row))) continue
    responseCount.set(row.survey_session_id, (responseCount.get(row.survey_session_id) ?? 0) + 1)
  }

  const bySchool = new Map<string, { responses: number; latest: string }>()
  for (const session of sessions) {
    if (session.updated_at < WALKED_SINCE) continue
    if (!isBeforeCutoff(session.updated_at) && (responseCount.get(session.id) ?? 0) === 0) continue
    const school = schoolById.get(session.school_id)
    const schoolClass = school?.school_class ?? ""
    if (!CLASS_TO_LEVEL[schoolClass]) continue
    if (
      isTestOrSandboxSchool({
        schoolId: session.school_id,
        campusId: school?.campus_id ?? session.campus_id,
        name: school?.name ?? session.school_name,
      })
    ) {
      continue
    }
    const current = bySchool.get(session.school_id) ?? { responses: 0, latest: session.updated_at }
    current.responses += responseCount.get(session.id) ?? 0
    if (session.updated_at > current.latest) current.latest = session.updated_at
    bySchool.set(session.school_id, current)
  }

  return [...bySchool.entries()]
    .filter(([, info]) => info.responses >= MIN_RESPONSES)
    .sort((a, b) => a[1].latest.localeCompare(b[1].latest) || a[0].localeCompare(b[0]))
    .map(([schoolId]) => {
      const school = schoolById.get(schoolId)
      const schoolClass = school?.school_class || "ELEM"
      return {
        schoolId,
        schoolName: school?.display_name?.trim() || school?.name || schoolId,
        campusId: school?.campus_id ?? "",
        schoolClass,
        schoolLevel: CLASS_TO_LEVEL[schoolClass] ?? "ES",
      }
    })
}

async function exportSchool(school: ExportSchool) {
  const sessions = await restSelectAll<SessionRow>(
    "esa_survey_sessions",
    `school_id=eq.${encodeURIComponent(school.schoolId)}&select=id,school_id,survey_type,school_name`,
  )
  if (!sessions.length) {
    console.warn(`No sessions for ${school.schoolId}`)
    return {
      ...school,
      exportedAt: SNAPSHOT_AS_OF,
      roomCount: 0,
      scoredUnitCount: 0,
      rooms: [],
    }
  }

  const sessionIds = sessions.map((s) => s.id)
  const [rooms, allResponses] = await Promise.all([
    restSelectAll<RoomRow>(
      "esa_survey_rooms",
      `${inFilter("survey_session_id", sessionIds)}&select=survey_session_id,room_id,room_number,school_room_number,room_type,grade_type,neighborhood,area_sqft,deferred_to_closeout,source_survey_type`,
    ),
    restSelectAll<ResponseRow>(
      "esa_question_responses",
      `${inFilter("survey_session_id", sessionIds)}&select=survey_session_id,room_id,question_id,value,created_at,updated_at,client_updated_at`,
    ),
  ])
  const responses = allResponses.filter((row) => isBeforeCutoff(responseAsOf(row)))

  const sessionType = new Map(sessions.map((s) => [s.id, s.survey_type]))
  const responsesByRoom = new Map<string, ResponseRow[]>()
  for (const row of responses) {
    const key = `${row.survey_session_id}::${row.room_id}`
    const list = responsesByRoom.get(key) ?? []
    list.push(row)
    responsesByRoom.set(key, list)
  }

  const bestByRoom = new Map<
    string,
    { room: RoomRow; surveyType: SurveyType; responses: ResponseRow[] }
  >()

  for (const room of rooms) {
    const surveyType = sessionType.get(room.survey_session_id)
    if (!surveyType) continue
    const roomResponses = responsesByRoom.get(`${room.survey_session_id}::${room.room_id}`) ?? []
    const effectiveType = surveyType === "closeout" ? room.source_survey_type ?? surveyType : surveyType
    const next = {
      room: {
        ...room,
        source_survey_type: room.source_survey_type ?? effectiveType,
      },
      surveyType: effectiveType,
      responses: roomResponses,
    }
    const existing = bestByRoom.get(room.room_id)
    if (!existing || next.responses.length > existing.responses.length) {
      bestByRoom.set(room.room_id, next)
    }
  }

  const scoredRooms = []
  for (const entry of bestByRoom.values()) {
    const scored = scoreRoomSnapshot(entry.room, entry.responses, school.schoolClass)
    if (scored) scoredRooms.push(scored)
  }

  const assessedTypes = new Set(
    scoredRooms
      .filter((room) => !room.markedAbsent)
      .map((room) => `${room.surveyType}::${room.spaceType}`),
  )
  const kept = scoredRooms.filter((room) => {
    if (!room.markedAbsent) return true
    return !assessedTypes.has(`${room.surveyType}::${room.spaceType}`)
  })
  kept.sort((a, b) => a.roomName.localeCompare(b.roomName, undefined, { numeric: true }))

  return {
    ...school,
    exportedAt: SNAPSHOT_AS_OF,
    roomCount: kept.length,
    scoredUnitCount: kept.reduce((sum, room) => sum + room.units.length, 0),
    rooms: kept,
  }
}

function buildWeightsJson() {
  const focusAreas = csvObjects("01_focus_area_weights.csv").map((row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    weight: Number(row.Weight) || 0,
  }))
  const spaceTypes = csvObjects("02_space_type_weights.csv").map((row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    spaceType: row["Space Type"],
    weight: Number(row.Weight) || 0,
  }))
  const categories = csvObjects("03_category_weights.csv").map((row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    spaceType: row["Space Type"],
    category: row.Category,
    weight: Number(row.Weight) || 0,
  }))
  const subcategories = csvObjects("04_subcategory_weights.csv").map((row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    spaceType: row["Space Type"],
    category: row.Category,
    subcategory: row.Subcategory,
    weight: Number(row.Weight) || 0,
  }))
  const questions = csvObjects("05_question_weights.csv").map((row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    spaceType: row["Space Type"],
    category: row.Category,
    subcategory: row.Subcategory,
    questionId: row.QuestionID,
    question: row.Question,
    weight: Number(row.Weight) || 0,
  }))
  return { schoolLevelDefault: "ES", focusAreas, spaceTypes, categories, subcategories, questions }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function writeFileRetry(file: string, contents: string) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const tmp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, contents)
      try {
        fs.unlinkSync(file)
      } catch {
        /* dest may not exist yet */
      }
      fs.renameSync(tmp, file)
      return
    } catch (error) {
      lastError = error
      await sleep(300 * attempt)
    }
  }
  throw lastError
}

async function main() {
  fs.mkdirSync(SCHOOLS_DIR, { recursive: true })
  const weights = buildWeightsJson()
  await writeFileRetry(path.join(OUT_DIR, "weights.json"), JSON.stringify(weights, null, 2))
  console.log(
    `Wrote weights.json (${weights.focusAreas.length} focus, ${weights.spaceTypes.length} space, ${weights.questions.length} questions)`,
  )

  const schools = await discoverWalkedSchools()
  const byLevel = { ES: 0, MS: 0, HS: 0 }
  for (const school of schools) byLevel[school.schoolLevel] += 1
  console.log(
    `Found ${schools.length} walked schools ${WALKED_SINCE.slice(0, 10)} through end of ${new Date(Date.parse(WALKED_UNTIL) - 1).toLocaleDateString("en-CA", { timeZone: TIME_ZONE })} ${TIME_ZONE} (ES ${byLevel.ES}, MS ${byLevel.MS}, HS ${byLevel.HS})`,
  )

  const keep = new Set(schools.map((school) => `${school.schoolId}.json`))
  for (const file of fs.readdirSync(SCHOOLS_DIR)) {
    if (!file.endsWith(".json") || file === "index.json" || file.endsWith("-test.json") || keep.has(file)) {
      continue
    }
    try {
      fs.unlinkSync(path.join(SCHOOLS_DIR, file))
    } catch {
      /* file may be locked by the dev server */
    }
  }
  const legacyDir = path.join(OUT_DIR, "schools")
  if (fs.existsSync(legacyDir)) {
    for (const file of fs.readdirSync(legacyDir)) {
      fs.unlinkSync(path.join(legacyDir, file))
    }
    fs.rmdirSync(legacyDir)
  }

  const index: Array<{
    schoolId: string
    schoolName: string
    campusId: string
    schoolClass: string
    schoolLevel: "ES" | "MS" | "HS"
    roomCount: number
    scoredUnitCount: number
    exportedAt: string
  }> = []

  for (const school of schools) {
    const snapshot = await exportSchool(school)
    const file = path.join(SCHOOLS_DIR, `${school.schoolId}.json`)
    await writeFileRetry(file, JSON.stringify(snapshot))
    index.push({
      schoolId: snapshot.schoolId,
      schoolName: snapshot.schoolName,
      campusId: snapshot.campusId,
      schoolClass: snapshot.schoolClass,
      schoolLevel: snapshot.schoolLevel,
      roomCount: snapshot.roomCount,
      scoredUnitCount: snapshot.scoredUnitCount,
      exportedAt: snapshot.exportedAt,
    })
    console.log(
      `${school.schoolName}: ${snapshot.roomCount} rooms, ${snapshot.scoredUnitCount} scored units -> ${file}`,
    )
  }

  for (const file of fs.readdirSync(SCHOOLS_DIR)) {
    if (!file.endsWith("-test.json")) continue
    const snapshot = JSON.parse(fs.readFileSync(path.join(SCHOOLS_DIR, file), "utf8")) as {
      schoolId: string
      schoolName: string
      campusId: string
      schoolClass: string
      schoolLevel: "ES" | "MS" | "HS"
      roomCount: number
      scoredUnitCount: number
      exportedAt: string
    }
    if (index.some((entry) => entry.schoolId === snapshot.schoolId)) continue
    index.push({
      schoolId: snapshot.schoolId,
      schoolName: snapshot.schoolName,
      campusId: snapshot.campusId,
      schoolClass: snapshot.schoolClass,
      schoolLevel: snapshot.schoolLevel,
      roomCount: snapshot.roomCount,
      scoredUnitCount: snapshot.scoredUnitCount,
      exportedAt: snapshot.exportedAt,
    })
  }

  const levelOrder = { ES: 0, MS: 1, HS: 2 }
  index.sort(
    (a, b) =>
      levelOrder[a.schoolLevel] - levelOrder[b.schoolLevel] ||
      a.schoolName.localeCompare(b.schoolName, undefined, { sensitivity: "base" }),
  )
  const indexJson = JSON.stringify(index, null, 2)
  await writeFileRetry(path.join(OUT_DIR, "school-index.json"), indexJson)
  await writeFileRetry(path.join(SCHOOLS_DIR, "index.json"), indexJson)
  console.log(`Wrote school index (${index.length} schools)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
