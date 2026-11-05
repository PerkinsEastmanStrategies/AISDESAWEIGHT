/**
 * High-contrast schematic floor plans: white background, black walls, readable labels.
 */

export const PLAN_WALL_STROKE_PX = 0.75
const PLAN_DETAIL_STROKE_PX = 0.5
export const PLAN_STROKE_COLOR = "#0f172a"
const PLAN_LABEL_FILL = "#0f172a"
const PLAN_LABEL_HALO = "#ffffff"

export function prepareFloorPlanSvgForDisplay(svgText: string): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return svgText
  }

  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml")
    const svg = doc.documentElement
    if (!svg || svg.tagName.toLowerCase() !== "svg") return svgText
    if (doc.querySelector("parsererror")) return svgText

    const ns = "http://www.w3.org/2000/svg"

    for (const old of Array.from(svg.querySelectorAll("style"))) {
      old.remove()
    }

    const style = doc.createElementNS(ns, "style")
    style.setAttribute("data-aisd-plan-style", "1")
    style.textContent = `
      svg { background: #ffffff !important; }
      path, line, polyline, polygon, circle, ellipse,
      rect:not([data-aisd-plan-backdrop]) {
        fill: none !important;
        stroke: ${PLAN_STROKE_COLOR} !important;
        stroke-opacity: 1 !important;
        fill-opacity: 1 !important;
        color: #000000 !important;
        stroke-width: ${PLAN_WALL_STROKE_PX}px !important;
        vector-effect: non-scaling-stroke !important;
      }
      rect[data-aisd-plan-backdrop] {
        fill: #ffffff !important;
        stroke: none !important;
      }
      text, tspan {
        fill: ${PLAN_LABEL_FILL} !important;
        stroke: ${PLAN_LABEL_HALO} !important;
        stroke-width: 4px !important;
        paint-order: stroke fill !important;
        fill-opacity: 1 !important;
        font-weight: 700 !important;
        vector-effect: non-scaling-stroke !important;
      }
      a, a * {
        stroke: ${PLAN_STROKE_COLOR} !important;
        color: ${PLAN_LABEL_FILL} !important;
        fill: ${PLAN_LABEL_FILL} !important;
      }
      .proom, .pbuilding, #planWalls *, #planDetail *, #planBuildings * {
        fill: none !important;
        stroke: ${PLAN_STROKE_COLOR} !important;
        vector-effect: non-scaling-stroke !important;
      }
      #planDetail *, #planDetail line, #planDetail path {
        stroke-width: ${PLAN_DETAIL_STROKE_PX}px !important;
      }
      #planWalls *, .pbuilding, #planBuildings * {
        stroke-width: ${PLAN_WALL_STROKE_PX}px !important;
      }
      polygon.proom, #planRooms polygon, polygon[data-i], polygon[data-k] {
        display: none !important;
        stroke: none !important;
        fill: none !important;
      }
    `
    svg.insertBefore(style, svg.firstChild)

    const existingBackdrop = svg.querySelector("[data-aisd-plan-backdrop]")
    existingBackdrop?.remove()
    const vb = readViewBox(svg)
    if (vb) {
      const backdrop = doc.createElementNS(ns, "rect")
      backdrop.setAttribute("data-aisd-plan-backdrop", "1")
      backdrop.setAttribute("x", String(vb.x))
      backdrop.setAttribute("y", String(vb.y))
      backdrop.setAttribute("width", String(vb.width))
      backdrop.setAttribute("height", String(vb.height))
      backdrop.setAttribute("fill", "#ffffff")
      backdrop.setAttribute("stroke", "none")
      svg.insertBefore(backdrop, style.nextSibling)
    }

    svg.setAttribute("style", "background:#ffffff")

    const strokeEls = svg.querySelectorAll("path, line, polyline, polygon, circle, ellipse, rect")
    for (const el of Array.from(strokeEls)) {
      if (el.getAttribute("data-aisd-plan-backdrop")) continue
      if (isRoomOverlayElement(el)) {
        hideRoomOverlayElement(el)
        continue
      }
      schemaizeShape(el)
    }

    for (const el of Array.from(svg.querySelectorAll("text, tspan"))) {
      forceReadableText(el)
    }

    return new XMLSerializer().serializeToString(doc)
  } catch {
    return svgText
  }
}

function readViewBox(svg: Element): { x: number; y: number; width: number; height: number } | null {
  const raw = svg.getAttribute("viewBox")
  if (raw) {
    const parts = raw.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
    }
  }
  const width = parseFloat(svg.getAttribute("width") ?? "")
  const height = parseFloat(svg.getAttribute("height") ?? "")
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { x: 0, y: 0, width, height }
  }
  return null
}

function isRoomOverlayElement(el: Element): boolean {
  if (el.classList.contains("proom")) return true
  if (el.closest("#planRooms")) return true
  if (el.tagName.toLowerCase() === "polygon" && (el.hasAttribute("data-i") || el.hasAttribute("data-k"))) {
    return true
  }
  return false
}

function hideRoomOverlayElement(el: Element): void {
  el.setAttribute("display", "none")
  el.setAttribute("fill", "none")
  el.setAttribute("stroke", "none")
}

function schemaizeShape(el: Element): void {
  el.setAttribute("fill", "none")
  el.setAttribute("stroke", PLAN_STROKE_COLOR)
  el.setAttribute("stroke-opacity", "1")
  el.setAttribute("fill-opacity", "1")
  el.removeAttribute("color")

  const style = el.getAttribute("style")
  if (style) {
    el.setAttribute(
      "style",
      style
        .replace(/fill\s*:\s*[^;]+/gi, "fill: none")
        .replace(/stroke\s*:\s*[^;]+/gi, `stroke: ${PLAN_STROKE_COLOR}`)
        .replace(/stroke-opacity\s*:\s*[^;]+/gi, "stroke-opacity: 1")
        .replace(/fill-opacity\s*:\s*[^;]+/gi, "fill-opacity: 1")
        .replace(/color\s*:\s*[^;]+/gi, "color: #000000"),
    )
  }

  normalizeStroke(el)
}

function currentFontSize(el: Element): number {
  const attr = parseFloat(el.getAttribute("font-size") ?? "")
  if (Number.isFinite(attr) && attr > 0) return attr
  const style = el.getAttribute("style")
  const match = style?.match(/font-size\s*:\s*([\d.]+)/i)
  if (match) {
    const value = parseFloat(match[1])
    if (Number.isFinite(value) && value > 0) return value
  }
  return 0
}

function forceReadableText(el: Element): void {
  const size = currentFontSize(el)
  if (size > 0) {
    const next = String(Math.round(size * 1.45 * 10) / 10)
    el.setAttribute("font-size", next)
  }
  el.setAttribute("fill", PLAN_LABEL_FILL)
  el.setAttribute("stroke", PLAN_LABEL_HALO)
  el.setAttribute("stroke-width", "4px")
  el.setAttribute("paint-order", "stroke fill")
  el.setAttribute("fill-opacity", "1")
  el.setAttribute("font-weight", "700")
  el.setAttribute("vector-effect", "non-scaling-stroke")
  const style = el.getAttribute("style")
  if (!style) return
  el.setAttribute(
    "style",
    style
      .replace(/fill\s*:\s*[^;]+/gi, `fill: ${PLAN_LABEL_FILL}`)
      .replace(/stroke\s*:\s*[^;]+/gi, `stroke: ${PLAN_LABEL_HALO}`)
      .replace(/fill-opacity\s*:\s*[^;]+/gi, "fill-opacity: 1")
      .replace(/font-weight\s*:\s*[^;]+/gi, "font-weight: 700")
      .replace(/font-size\s*:\s*[^;]+/gi, size > 0 ? `font-size: ${el.getAttribute("font-size")}` : "font-size: inherit"),
  )
}

function isDetailStrokeElement(el: Element): boolean {
  if (el.closest("#planDetail")) return true
  const raw = el.getAttribute("stroke-width")
  const style = el.getAttribute("style")
  let n = raw ? parseFloat(raw) : NaN
  if ((!Number.isFinite(n) || n <= 0) && style) {
    const match = style.match(/stroke-width\s*:\s*([\d.]+)/i)
    if (match) n = parseFloat(match[1])
  }
  return Number.isFinite(n) && n > 0 && n < 1.5
}

function normalizeStroke(el: Element): void {
  const px = isDetailStrokeElement(el) ? PLAN_DETAIL_STROKE_PX : PLAN_WALL_STROKE_PX
  const width = `${px}px`
  el.setAttribute("stroke-width", width)
  el.setAttribute("vector-effect", "non-scaling-stroke")
  const style = el.getAttribute("style")
  if (style && /stroke-width\s*:/i.test(style)) {
    el.setAttribute("style", style.replace(/stroke-width\s*:\s*[^;]+/gi, `stroke-width: ${width}`))
  }
}
