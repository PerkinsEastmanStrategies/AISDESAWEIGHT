/**
 * Build a weights JSON file from a CSV folder.
 *   npx tsx scripts/build-weights-json.ts data/weights-revised data/weights-revised.json
 */
import fs from "node:fs"
import path from "node:path"

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false
  const source = text.replace(/^\uFEFF/, "")
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (inQuotes) {
      if (ch === '"' && source[i + 1] === '"') {
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

function objects(filePath: string): Record<string, string>[] {
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"))
  const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""))
  return rows.slice(1).map((cols) => {
    const obj: Record<string, string> = {}
    header.forEach((key, i) => {
      obj[key] = (cols[i] ?? "").trim()
    })
    return obj
  })
}

const csvDir = path.resolve(process.argv[2] ?? "data/weights-revised")
const outFile = path.resolve(process.argv[3] ?? "data/weights-revised.json")

const weights = {
  schoolLevelDefault: "ES",
  focusAreas: objects(path.join(csvDir, "01_focus_area_weights.csv")).map((row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    weight: Number(row.Weight) || 0,
  })),
  spaceTypes: objects(path.join(csvDir, "02_space_type_weights.csv")).map((row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    spaceType: row["Space Type"],
    weight: Number(row.Weight) || 0,
  })),
  categories: objects(path.join(csvDir, "03_category_weights.csv")).map((row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    spaceType: row["Space Type"],
    category: row.Category,
    weight: Number(row.Weight) || 0,
  })),
  subcategories: objects(path.join(csvDir, "04_subcategory_weights.csv")).map((row) => ({
    schoolLevel: row["School Level"],
    focusArea: row["Scoring Focus Area"],
    spaceType: row["Space Type"],
    category: row.Category,
    subcategory: row.Subcategory,
    weight: Number(row.Weight) || 0,
  })),
  questions: objects(path.join(csvDir, "05_question_weights.csv")).map((row) => ({
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

fs.writeFileSync(outFile, JSON.stringify(weights, null, 2))
console.log(
  `Wrote ${outFile} (${weights.focusAreas.length} focus, ${weights.spaceTypes.length} space, ${weights.questions.length} questions)`,
)
