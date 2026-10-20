import { isObservational } from "@/lib/normalize"

export function isInventoryText(value: string | null | undefined): boolean {
  return /inventory/i.test(String(value ?? ""))
}

export function isNotAbleToAssessText(value: string | null | undefined): boolean {
  if (!value) return false
  const text = value.trim().toLowerCase()
  return (
    text === "not able to assess" ||
    text.startsWith("not able to assess ") ||
    text === "unable to assess" ||
    text.startsWith("unable to assess")
  )
}

/** Dummy select-all choices that must not sit in the score denominator. */
export function isNonViableSelectAllOption(value: string | null | undefined): boolean {
  if (!value) return false
  const text = value.trim().toLowerCase()
  return (
    text === "none of the above" ||
    text.startsWith("none of the above ") ||
    isNotAbleToAssessText(value)
  )
}

export function isInventoryUnitId(unitId: string | null | undefined): boolean {
  return String(unitId ?? "").trim().endsWith("i")
}

export function isDiningCommonsTackboardQuestion(questionId: string | null | undefined): boolean {
  return String(questionId ?? "").trim().toUpperCase() === "DC-015"
}

/** MS science utilities (SC-032): only floor drain and eyewash are scored. */
export function isMsScienceUtilitiesScoredOption(label: string | null | undefined): boolean {
  const text = String(label ?? "").trim().toLowerCase()
  if (!text) return false
  if (text.includes("floor drain")) return true
  return text.includes("eye wash") || text.includes("eyewash")
}

export function isMsScienceUtilitiesInventoryOption(input: {
  questionId?: string | null
  itemLabel?: string | null
  schoolLevel?: string | null
}): boolean {
  if (String(input.questionId ?? "").trim().toUpperCase() !== "SC-032") return false
  if (String(input.schoolLevel ?? "").trim().toUpperCase() !== "MS") return false
  if (isNonViableSelectAllOption(input.itemLabel)) return false
  return !isMsScienceUtilitiesScoredOption(input.itemLabel)
}

export function isNonScoringQuestion(input: {
  category?: string | null
  subcategory?: string | null
  question?: string | null
  questionId?: string | null
  unitId?: string | null
  itemLabel?: string | null
  schoolLevel?: string | null
  weight?: number | null
}): boolean {
  if (isDiningCommonsTackboardQuestion(input.questionId)) return true
  if (isMsScienceUtilitiesInventoryOption(input)) return true
  if (isObservational(input.category) || isObservational(input.subcategory)) return true
  if (isInventoryText(input.question) || isInventoryText(input.subcategory) || isInventoryText(input.category)) {
    return true
  }
  if (isInventoryUnitId(input.unitId)) return true
  if (input.weight != null && input.weight <= 0) return true
  return false
}

/** Drop none-of-the-above / not-able-to-assess rows from select-all questions. */
export function unitsForScoring<
  T extends {
    questionId: string
    itemLabel?: string | null
    unitId?: string | null
    category?: string | null
    subcategory?: string | null
    question?: string | null
    schoolLevel?: string | null
    weight?: number | null
  },
>(units: T[]): T[] {
  const scored = units.filter((unit) => !isNonScoringQuestion(unit))
  const siblingCount = new Map<string, number>()
  for (const unit of scored) {
    siblingCount.set(unit.questionId, (siblingCount.get(unit.questionId) ?? 0) + 1)
  }
  return scored.filter((unit) => {
    if ((siblingCount.get(unit.questionId) ?? 1) < 2) return true
    return !isNonViableSelectAllOption(unit.itemLabel)
  })
}
