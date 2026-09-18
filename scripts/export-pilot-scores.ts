/**
 * Pull Casis / Ortega Pilot #2 answers from AISD-ESA Supabase and write
 * question-level scores into this project.
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

const OUT_DIR = "C:\\Users\\p.davis\\dev\\live-weighting-tool\\data"
const SCHOOLS = [
  {
    schoolId: "casis-pilot-2",
    schoolName: "Casis Elementary (Pilot #2)",
    campusId: "112-PILOT-2",
    schoolClass: "ELEM",
    schoolLevel: "ES" as const,
  },
  {
    schoolId: "ortega-pilot-2",
    schoolName: "Ortega Elementary (Pilot #2)",
    campusId: "126-PILOT-2",
    schoolClass: "ELEM",
    schoolLevel: "ES" as const,
  },
]

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

async function exportSchool(school: (typeof SCHOOLS)[number]) {
  const sessions = await restSelectAll<SessionRow>(
    "esa_survey_sessions",
    `school_id=eq.${encodeURIComponent(school.schoolId)}&select=id,school_id,survey_type,school_name`,
  )
  if (!sessions.length) {
    console.warn(`No sessions for ${school.schoolId}`)
    return {
      ...school,
      exportedAt: new Date().toISOString(),
      roomCount: 0,
      scoredUnitCount: 0,
      rooms: [],
    }
  }

  const sessionIds = sessions.map((s) => s.id)
  const [rooms, responses] = await Promise.all([
    restSelectAll<RoomRow>(
      "esa_survey_rooms",
      `${inFilter("survey_session_id", sessionIds)}&select=survey_session_id,room_id,room_number,school_room_number,room_type,grade_type,neighborhood,area_sqft,deferred_to_closeout,source_survey_type`,
    ),
    restSelectAll<ResponseRow>(
      "esa_question_responses",
      `${inFilter("survey_session_id", sessionIds)}&select=survey_session_id,room_id,question_id,value`,
    ),
  ])

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
    exportedAt: new Date().toISOString(),
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

async function main() {
  fs.mkdirSync(path.join(OUT_DIR, "schools"), { recursive: true })
  const weights = buildWeightsJson()
  fs.writeFileSync(path.join(OUT_DIR, "weights.json"), JSON.stringify(weights, null, 2))
  console.log(
    `Wrote weights.json (${weights.focusAreas.length} focus, ${weights.spaceTypes.length} space, ${weights.questions.length} questions)`,
  )

  for (const school of SCHOOLS) {
    const snapshot = await exportSchool(school)
    const file = path.join(OUT_DIR, "schools", `${school.schoolId}.json`)
    fs.writeFileSync(file, JSON.stringify(snapshot))
    console.log(
      `${school.schoolName}: ${snapshot.roomCount} rooms, ${snapshot.scoredUnitCount} scored units -> ${file}`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
