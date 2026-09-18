import { isObservational } from "@/lib/normalize"

export function isInventoryText(value: string | null | undefined): boolean {
  return /inventory/i.test(String(value ?? ""))
}

/** Dummy select-all choices that must not sit in the score denominator. */
export function isNonViableSelectAllOption(value: string | null | undefined): boolean {
  if (!value) return false
  const text = value.trim().toLowerCase()
  return (
    text === "none of the above" ||
    text.startsWith("none of the above ") ||
    text === "not able to assess" ||
    text.startsWith("not able to assess ") ||
    text === "unable to assess" ||
    text.startsWith("unable to assess")
  )
}

export function isInventoryUnitId(unitId: string | null | undefined): boolean {
  return String(unitId ?? "").trim().endsWith("i")
}

export function isNonScoringQuestion(input: {
  category?: string | null
  subcategory?: string | null
  question?: string | null
  questionId?: string | null
  unitId?: string | null
  weight?: number | null
}): boolean {
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
