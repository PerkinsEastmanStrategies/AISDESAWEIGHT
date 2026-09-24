/**
 * Rebuild data/weights.json from the CSV starting-point files.
 * Run: npx tsx scripts/rebuild-weights.ts
 */
import fs from "node:fs"
import path from "node:path"

const OUT_DIR = path.join(process.cwd(), "data")
const WEIGHTS_DIR = path.join(OUT_DIR, "weights")

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

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function writeCsv(fileName: string, rows: string[][]) {
  const text = rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n"
  fs.writeFileSync(path.join(WEIGHTS_DIR, fileName), text)
}

function readCsv(fileName: string): string[][] {
  return parseCsv(fs.readFileSync(path.join(WEIGHTS_DIR, fileName), "utf8"))
}

function isBoostedSubcategory(name: string): boolean {
  const text = name.trim().toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ")
  return text === "occupant comfort" || text === "safety and supervision"
}

const FOCUS_WEIGHTS: Record<string, number> = {
  "Arrival Experience and Campus Organization": 3,
  Administration: 6,
  Studios: 12,
  "Special Education": 12,
  Neighborhoods: 9,
  "Shared Spaces": 9,
  Outdoor: 6,
}

function applyFocusDefaults(rows: string[][]): string[][] {
  const header = rows[0]
  const focusIdx = header.indexOf("Scoring Focus Area")
  const weightIdx = header.indexOf("Weight")
  return rows.map((row, index) => {
    if (index === 0) return row
    const next = [...row]
    const mapped = FOCUS_WEIGHTS[row[focusIdx] ?? ""]
    if (mapped != null) next[weightIdx] = String(mapped)
    return next
  })
}

function boostSubcategoryWeights(rows: string[][], subcategoryHeader: string): string[][] {
  const header = rows[0]
  const subIdx = header.indexOf(subcategoryHeader)
  const weightIdx = header.indexOf("Weight")
  return rows.map((row, index) => {
    if (index === 0) return row
    if (!isBoostedSubcategory(row[subIdx] ?? "")) return row
    const current = Number(row[weightIdx]) || 0
    if (current <= 0) return row
    const next = [...row]
    next[weightIdx] = "12"
    return next
  })
}

function objects(rows: string[][], map: (row: Record<string, string>) => object) {
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((cols) => {
    const obj: Record<string, string> = {}
    header.forEach((key, i) => {
      obj[key] = (cols[i] ?? "").trim()
    })
    return map(obj)
  })
}

const focusRows = applyFocusDefaults(readCsv("01_focus_area_weights.csv"))
const subcategoryRows = boostSubcategoryWeights(readCsv("04_subcategory_weights.csv"), "Subcategory")
const questionRows = boostSubcategoryWeights(readCsv("05_question_weights.csv"), "Subcategory")

writeCsv("01_focus_area_weights.csv", focusRows)
writeCsv("04_subcategory_weights.csv", subcategoryRows)
writeCsv("05_question_weights.csv", questionRows)

const weights = {
  schoolLevelDefault: "ES",
  focusAreas: objects(focusRows, (row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    weight: Number(row.Weight) || 0,
  })),
  spaceTypes: objects(readCsv("02_space_type_weights.csv"), (row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    spaceType: row["Space Type"],
    weight: Number(row.Weight) || 0,
  })),
  categories: objects(readCsv("03_category_weights.csv"), (row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    spaceType: row["Space Type"],
    category: row.Category,
    weight: Number(row.Weight) || 0,
  })),
  subcategories: objects(subcategoryRows, (row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    spaceType: row["Space Type"],
    category: row.Category,
    subcategory: row.Subcategory,
    weight: Number(row.Weight) || 0,
  })),
  questions: objects(questionRows, (row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    spaceType: row["Space Type"],
    category: row.Category,
    subcategory: row.Subcategory,
    questionId: row.QuestionID,
    question: row.Question,
    weight: Number(row.Weight) || 0,
  })),
}

fs.writeFileSync(path.join(OUT_DIR, "weights.json"), JSON.stringify(weights, null, 2))
const boostedSubs = weights.subcategories.filter((row) => row.weight === 12).length
const boostedQs = weights.questions.filter((row) => row.weight === 12).length
console.log(
  `Updated starting weights. Focus ${weights.focusAreas.length}, subcategories at 12: ${boostedSubs}, questions at 12: ${boostedQs}`,
)
