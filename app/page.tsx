import type { Metadata } from "next"
import { WeightingApp } from "@/components/weighting-app"
import schoolIndex from "@/data/school-index.json"
import type { SchoolIndexEntry } from "@/lib/types"

const HIDDEN_SCHOOL_IDS = new Set(["barton-hills", "casis", "ortega"])

export const metadata: Metadata = {
  title: "AISD ESA QA Portal",
  description:
    "Change ESA scoring weights live and compare recently walked elementary, middle, and high schools by original or revised focus areas.",
}

export default function Home() {
  const schoolOptions = (schoolIndex as SchoolIndexEntry[]).filter(
    (school) => !HIDDEN_SCHOOL_IDS.has(school.schoolId),
  )
  return <WeightingApp schoolOptions={schoolOptions} />
}
