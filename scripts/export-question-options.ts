/**
 * Dump ESA rubric option labels so QA can show unselected choices.
 * Run from AISD-ESA:
 *   npx tsx "C:\Users\p.davis\dev\live-weighting-tool\scripts\export-question-options.ts"
 */
import fs from "node:fs"
import path from "node:path"
import {
  getRoomSurveyRubric,
  TABLE_OF_SURVEY_ENTRIES,
  type QuestionType,
} from "@aisd/shared"

const ROOT = "C:\\Users\\p.davis\\dev\\live-weighting-tool"
const OUT = path.join(ROOT, "public", "question-options.json")

const CLASS_FOR: Record<string, string> = { ES: "ELEM", MS: "MID", HS: "HIGH" }
const GRADE_FOR: Record<string, string> = { ES: "K", MS: "MS", HS: "HS" }

export interface QuestionOptionCatalogEntry {
  questionType: QuestionType | string
  options: string[]
}

function mergeOptions(existing: string[], next: string[]) {
  for (const option of next) {
    if (option && !existing.includes(option)) existing.push(option)
  }
}

function main() {
  const catalog: Record<string, QuestionOptionCatalogEntry> = {}

  for (const entry of TABLE_OF_SURVEY_ENTRIES) {
    const schoolClass = CLASS_FOR[entry.schoolLevel] ?? "ELEM"
    const gradeType = GRADE_FOR[entry.schoolLevel] ?? "K"
    const rubric = getRoomSurveyRubric(entry.surveyType, entry.spaceType, gradeType, schoolClass)
    if (!rubric) continue

    const questionTypeById = new Map(rubric.questions.map((question) => [question.questionId, question.questionType]))
    const optionsByQuestion = new Map<string, { order: number; option: string }[]>()
    for (const option of rubric.options) {
      const label = option.option?.trim()
      if (!label) continue
      const list = optionsByQuestion.get(option.questionId) ?? []
      list.push({ order: option.displayOrder, option: label })
      optionsByQuestion.set(option.questionId, list)
    }

    for (const [questionId, rows] of optionsByQuestion) {
      rows.sort((a, b) => a.order - b.order || a.option.localeCompare(b.option))
      const options = [...new Set(rows.map((row) => row.option))]
      const existing = catalog[questionId]
      if (!existing) {
        catalog[questionId] = {
          questionType: questionTypeById.get(questionId) ?? "SingleSelect",
          options,
        }
      } else {
        mergeOptions(existing.options, options)
      }
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(catalog))
  console.log(`Wrote ${Object.keys(catalog).length} questions -> ${OUT}`)
}

main()
