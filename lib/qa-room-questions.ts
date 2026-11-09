import {
  getRoomSurveyRubric,
  type EsaQuestion,
  type RoomQuestionResponse,
  type SurveyType,
} from "@aisd/shared"
import {
  dependentQuestionDisabledReason,
} from "@/lib/esa-question-dependencies"
import { isInventoryText } from "@/lib/non-scoring"
import { isObservational } from "@/lib/normalize"
import type { ScoredRoom, ScoredUnit } from "@/lib/types"

export function classForRubric(schoolClass?: string): string | undefined {
  if (!schoolClass) return undefined
  if (schoolClass === "ES") return "ELEM"
  if (schoolClass === "MS") return "MID"
  if (schoolClass === "HS") return "HIGH"
  return schoolClass
}

export function rubricForQaRoom(room: Pick<ScoredRoom, "surveyType" | "spaceType" | "gradeType">, schoolClass?: string) {
  const klass = classForRubric(schoolClass)
  return (
    getRoomSurveyRubric(room.surveyType as SurveyType, room.spaceType, room.gradeType, klass) ??
    getRoomSurveyRubric(room.surveyType as SurveyType, room.spaceType, undefined, klass)
  )
}

export function isRubricInventoryQuestion(
  question: Pick<EsaQuestion, "question" | "category" | "subcategory" | "weight" | "parentScoringPattern">,
): boolean {
  if (isObservational(question.category) || isObservational(question.subcategory)) return true
  if (isInventoryText(question.question) || isInventoryText(question.subcategory) || isInventoryText(question.category)) {
    return true
  }
  if (question.weight != null && question.weight <= 0) return true
  if (String(question.parentScoringPattern ?? "").toLowerCase() === "recordedonly") return true
  return false
}

export function answerFromResponseValue(value: unknown): string | null {
  if (value == null) return null
  if (Array.isArray(value)) {
    const joined = value.map((item) => String(item).trim()).filter(Boolean).join(", ")
    return joined || null
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        return answerFromResponseValue(JSON.parse(trimmed))
      } catch {
        return trimmed
      }
    }
    return trimmed
  }
  const text = String(value).trim()
  return text || null
}

function responsesForSkip(
  units: ScoredUnit[],
  liveAnswers: Record<string, string>,
): RoomQuestionResponse[] {
  const values = new Map<string, string>()
  for (const unit of units) {
    const answer = unit.answer?.trim()
    if (answer) values.set(unit.questionId, answer)
  }
  for (const [questionId, answer] of Object.entries(liveAnswers)) {
    const trimmed = answer.trim()
    if (trimmed) values.set(questionId, trimmed)
  }
  return [...values.entries()].map(([questionId, value]) => ({ questionId, value }))
}

function syntheticUnit(question: EsaQuestion, answer: string | null): ScoredUnit {
  return {
    questionId: question.questionId,
    unitId: question.questionId,
    question: question.question,
    category: question.category,
    subcategory: question.subcategory,
    score: Number.NaN,
    itemLabel: null,
    answer,
  }
}

export function displayUnitsForRoom(input: {
  room: ScoredRoom
  schoolClass?: string
  liveAnswers?: Record<string, string>
}): {
  units: ScoredUnit[]
  skippedReasons: Record<string, string>
  questionIds: string[]
  inventoryIds: string[]
} {
  const liveAnswers = input.liveAnswers ?? {}
  const rubric = rubricForQaRoom(input.room, input.schoolClass)
  if (!rubric?.questions.length) {
    const questionIds = [...new Set(input.room.units.map((unit) => unit.questionId))]
    return { units: input.room.units, skippedReasons: {}, questionIds, inventoryIds: [] }
  }

  const unitsByQuestion = new Map<string, ScoredUnit[]>()
  for (const unit of input.room.units) {
    const list = unitsByQuestion.get(unit.questionId) ?? []
    list.push(unit)
    unitsByQuestion.set(unit.questionId, list)
  }

  const responses = responsesForSkip(input.room.units, liveAnswers)
  const skippedReasons: Record<string, string> = {}
  const units: ScoredUnit[] = []
  const questionIds: string[] = []
  const inventoryIds: string[] = []

  for (const question of rubric.questions) {
    questionIds.push(question.questionId)
    if (isRubricInventoryQuestion(question)) inventoryIds.push(question.questionId)
    const reason = dependentQuestionDisabledReason(question.questionId, responses, rubric.questions)
    if (reason) skippedReasons[question.questionId] = reason
    const existing = unitsByQuestion.get(question.questionId)
    const live = liveAnswers[question.questionId]?.trim() || null
    if (existing?.length) {
      units.push(
        ...existing.map((unit) => (unit.answer?.trim() || !live ? unit : { ...unit, answer: live })),
      )
      continue
    }
    units.push(syntheticUnit(question, live))
  }

  for (const [questionId, existing] of unitsByQuestion) {
    if (questionIds.includes(questionId)) continue
    questionIds.push(questionId)
    units.push(...existing)
  }

  return { units, skippedReasons, questionIds, inventoryIds }
}
