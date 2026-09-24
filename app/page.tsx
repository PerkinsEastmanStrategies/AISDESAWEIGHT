import type { Metadata } from "next"
import { WeightingApp } from "@/components/weighting-app"
import schoolIndex from "@/data/school-index.json"
import type { SchoolIndexEntry } from "@/lib/types"

export const metadata: Metadata = {
  title: "AISD ESA Live Weighting Lab",
  description:
    "Change ESA scoring weights live and compare recently walked elementary, middle, and high schools by original or revised focus areas.",
}

export default function Home() {
  return <WeightingApp schoolOptions={schoolIndex as SchoolIndexEntry[]} />
}
