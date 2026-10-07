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
import { isSkippedDependentQuestion } from "@/lib/esa-question-dependencies"
import { MIN_SCORED_UNITS, WALKED_SINCE, indexEntryFromSnapshot } from "@/lib/school-catalog"
import { inFilter, supabaseRestSelect } from "@/lib/supabase-rest"
import type { SchoolIndexEntry, SchoolLevel, SchoolSnapshot, ScoredRoom } from "@/lib/types"

const CLASS_TO_LEVEL: Record<string, SchoolLevel> = {
  ELEM: "ES",
  MID: "MS",
  HIGH: "HS",
}

export interface WalkedSchool {
  schoolId: string
  schoolName: string
  campusId: string
  schoolClass: string
  schoolLevel: SchoolLevel
  latestSessionAt: string
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
  if (Array.isArray(value)) return value.map((item) => String(item))
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

function isTestOrSandboxSchool(input: { schoolId: string; campusId: string; name: string }): boolean {
  const haystack = `${input.schoolId} ${input.campusId} ${input.name}`.toLowerCase()
  if (haystack.includes("test")) return true
  if (haystack.includes("merge")) return true
  if (input.schoolId === "barton-hills" || input.schoolId === "casis" || input.schoolId === "ortega") return true
  return false
}

function scoreRoomSnapshot(room: RoomRow, responses: ResponseRow[], schoolClass: string): ScoredRoom | null {
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
    responses: responses.map((row) => ({
      questionId: row.question_id,
      value: asResponseValue(row.value),
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
  if (!rubric || !focusAreaId) return null

  const skipped = rubric.questions
    .filter((question) => isSkippedDependentQuestion(question.questionId, roomSession.responses, rubric.questions))
    .map((question) => question.questionId)

  let result = scoreRoom(
    roomSession.responses,
    rubric.questions,
    rubric.categories,
    rubric.subcategories,
    rubric.options,
    rubric.assessmentArea,
    skipped,
  )
  result = mergeTraditionalStudioSizeScore(result, room.area_sqft, rubric.categories, rubric.subcategories)
  if (!result.questionScores.length) return null

  const questionById = new Map(rubric.questions.map((question) => [question.questionId, question]))
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

  const units: ScoredRoom["units"] = []
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

export async function discoverWalkedSchools(): Promise<WalkedSchool[]> {
  const schools = await supabaseRestSelect<{
    school_id: string
    campus_id: string
    name: string
    display_name: string | null
    school_class: string | null
  }>("esa_schools", "select=school_id,campus_id,name,display_name,school_class")
  const sessions = await supabaseRestSelect<{
    id: string
    school_id: string
    campus_id: string
    school_name: string
    updated_at: string
  }>(
    "esa_survey_sessions",
    `select=id,school_id,campus_id,school_name,updated_at&updated_at=gte.${encodeURIComponent(WALKED_SINCE)}`,
  )
  const schoolById = new Map(schools.map((school) => [school.school_id, school]))
  const bySchool = new Map<string, { latest: string }>()
  for (const session of sessions) {
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
    const current = bySchool.get(session.school_id)
    if (!current || session.updated_at > current.latest) {
      bySchool.set(session.school_id, { latest: session.updated_at })
    }
  }

  return [...bySchool.entries()]
    .sort((a, b) => a[1].latest.localeCompare(b[1].latest) || a[0].localeCompare(b[0]))
    .map(([schoolId, info]) => {
      const school = schoolById.get(schoolId)
      const schoolClass = school?.school_class || "ELEM"
      return {
        schoolId,
        schoolName: school?.display_name?.trim() || school?.name || schoolId,
        campusId: school?.campus_id ?? "",
        schoolClass,
        schoolLevel: CLASS_TO_LEVEL[schoolClass] ?? "ES",
        latestSessionAt: info.latest,
      }
    })
}

export async function exportWalkedSchool(school: WalkedSchool): Promise<SchoolSnapshot> {
  const exportedAt = new Date().toISOString()
  const sessions = await supabaseRestSelect<SessionRow>(
    "esa_survey_sessions",
    `school_id=eq.${encodeURIComponent(school.schoolId)}&select=id,school_id,survey_type,school_name`,
  )
  if (!sessions.length) {
    return { ...school, exportedAt, roomCount: 0, scoredUnitCount: 0, rooms: [] }
  }

  const sessionIds = sessions.map((session) => session.id)
  const [rooms, responses] = await Promise.all([
    supabaseRestSelect<RoomRow>(
      "esa_survey_rooms",
      `${inFilter("survey_session_id", sessionIds)}&select=survey_session_id,room_id,room_number,school_room_number,room_type,grade_type,neighborhood,area_sqft,deferred_to_closeout,source_survey_type`,
    ),
    supabaseRestSelect<ResponseRow>(
      "esa_question_responses",
      `${inFilter("survey_session_id", sessionIds)}&select=survey_session_id,room_id,question_id,value`,
    ),
  ])

  const sessionType = new Map(sessions.map((session) => [session.id, session.survey_type]))
  const responsesByRoom = new Map<string, ResponseRow[]>()
  for (const row of responses) {
    const key = `${row.survey_session_id}::${row.room_id}`
    const list = responsesByRoom.get(key) ?? []
    list.push(row)
    responsesByRoom.set(key, list)
  }

  const bestByRoom = new Map<string, { room: RoomRow; responses: ResponseRow[] }>()
  for (const room of rooms) {
    const surveyType = sessionType.get(room.survey_session_id)
    if (!surveyType) continue
    const roomResponses = responsesByRoom.get(`${room.survey_session_id}::${room.room_id}`) ?? []
    const effectiveType = surveyType === "closeout" ? room.source_survey_type ?? surveyType : surveyType
    const next = {
      room: { ...room, source_survey_type: room.source_survey_type ?? effectiveType },
      responses: roomResponses,
    }
    const existing = bestByRoom.get(room.room_id)
    if (!existing || next.responses.length > existing.responses.length) {
      bestByRoom.set(room.room_id, next)
    }
  }

  const scoredRooms: ScoredRoom[] = []
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
    schoolId: school.schoolId,
    schoolName: school.schoolName,
    campusId: school.campusId,
    schoolClass: school.schoolClass,
    schoolLevel: school.schoolLevel,
    exportedAt,
    roomCount: kept.length,
    scoredUnitCount: kept.reduce((sum, room) => sum + room.units.length, 0),
    rooms: kept,
  }
}

export function snapshotMeetsMinimum(snapshot: SchoolSnapshot): boolean {
  return snapshot.scoredUnitCount >= MIN_SCORED_UNITS
}

export function shouldExportSchool(school: WalkedSchool, current?: SchoolIndexEntry): boolean {
  if (!current) return true
  return school.latestSessionAt > current.exportedAt
}
