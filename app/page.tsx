import type { Metadata } from "next"
import { WeightingApp } from "@/components/weighting-app"
import casis from "@/data/schools/casis-pilot-2.json"
import ortega from "@/data/schools/ortega-pilot-2.json"
import weights from "@/data/weights.json"
import type { SchoolSnapshot, WeightFile } from "@/lib/types"

export const metadata: Metadata = {
  title: "AISD ESA Live Weighting Lab",
  description:
    "Change ESA scoring weights live and see how Casis and Ortega Pilot #2 campus and breakout scores respond.",
}

export default function Home() {
  return (
    <WeightingApp
      weights={weights as WeightFile}
      schools={[casis as SchoolSnapshot, ortega as SchoolSnapshot]}
    />
  )
}
