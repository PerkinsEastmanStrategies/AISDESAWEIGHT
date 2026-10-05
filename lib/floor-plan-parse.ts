export type Pt = { x: number; y: number }

export interface FloorPlanViewBox {
  x: number
  y: number
  w: number
  h: number
}

export interface ParsedPlanRoom {
  id: string
  name: string
  x: number
  y: number
  levelId: string
  points: Pt[]
  overlayKind?: "boundary" | "hotspot"
}

type Matrix2D = [number, number, number, number, number, number]

const IDENTITY: Matrix2D = [1, 0, 0, 1, 0, 0]
const SERIF_XMLNS = 'xmlns:serif="http://www.serif.com/"'

export function sanitizeFloorPlanSvgXml(svgText: string): string {
  if (!svgText || !/serif:id=/.test(svgText) || /xmlns:serif=/.test(svgText)) return svgText
  return svgText.replace(
    /<svg\b([^>]*)>/i,
    (_match, attrs: string) => `<svg ${SERIF_XMLNS}${attrs}>`,
  )
}

export function parseSvgViewBox(svgText: string): FloorPlanViewBox | null {
  const match = svgText.match(/\bviewBox\s*=\s*["']\s*([^"']+)["']/i)
  if (!match) return null
  const nums = match[1].trim().split(/[\s,]+/).map(Number)
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null
  const [x, y, w, h] = nums
  if (w <= 0 || h <= 0) return null
  return { x, y, w, h }
}

export function viewBoxString(vb: FloorPlanViewBox): string {
  return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`
}

export function overlayPointsForRoom(room: Pick<ParsedPlanRoom, "x" | "y" | "points" | "overlayKind">): Pt[] {
  if (room.overlayKind === "hotspot" && room.points.length >= 3) {
    const xs = room.points.map((p) => p.x)
    const ys = room.points.map((p) => p.y)
    const half = Math.max((Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2, 1)
    return [
      { x: room.x - half, y: room.y - half },
      { x: room.x + half, y: room.y - half },
      { x: room.x + half, y: room.y + half },
      { x: room.x - half, y: room.y + half },
    ]
  }
  return room.points
}

export function floorPlanSvgDataUrl(svgText: string): string {
  try {
    const bytes = new TextEncoder().encode(svgText)
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    return `data:image/svg+xml;base64,${btoa(binary)}`
  } catch {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
  }
}

function multiplyMatrices(a: Matrix2D, b: Matrix2D): Matrix2D {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

function applyMatrix(m: Matrix2D, x: number, y: number): Pt {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  }
}

function parseNumbers(raw: string): number[] {
  return raw.trim().split(/[\s,]+/).filter(Boolean).map(Number)
}

function parseTransformList(attr: string): Matrix2D {
  let matrix: Matrix2D = IDENTITY
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(attr))) {
    const kind = match[1].toLowerCase()
    const nums = parseNumbers(match[2]).filter(Number.isFinite)
    let next: Matrix2D = IDENTITY
    if (kind === "matrix" && nums.length === 6) {
      next = nums as Matrix2D
    } else if (kind === "translate") {
      next = [1, 0, 0, 1, nums[0] ?? 0, nums[1] ?? 0]
    } else if (kind === "scale") {
      const sx = nums[0] ?? 1
      next = [sx, 0, 0, nums[1] ?? sx, 0, 0]
    } else if (kind === "rotate" && nums.length >= 1) {
      const rad = ((nums[0] ?? 0) * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const rotate: Matrix2D = [cos, sin, -sin, cos, 0, 0]
      if (nums.length >= 3) {
        const cx = nums[1] ?? 0
        const cy = nums[2] ?? 0
        next = multiplyMatrices(
          multiplyMatrices([1, 0, 0, 1, cx, cy], rotate),
          [1, 0, 0, 1, -cx, -cy],
        )
      } else {
        next = rotate
      }
    }
    matrix = multiplyMatrices(matrix, next)
  }
  return matrix
}

function parentElementNode(node: Node | null): Element | null {
  let current: Node | null = node?.parentNode ?? null
  while (current && current.nodeType !== 1) current = current.parentNode
  return (current as Element | null) ?? null
}

function accumulatedTransform(element: Element, root: Element): Matrix2D {
  let matrix: Matrix2D = IDENTITY
  let node: Element | null = element
  while (node && node !== root) {
    const attr = node.getAttribute("transform")
    if (attr) matrix = multiplyMatrices(parseTransformList(attr), matrix)
    node = parentElementNode(node)
  }
  return matrix
}

function transformPoint(el: Element, root: Element, x: number, y: number): Pt {
  const svg = root as SVGSVGElement
  const graphics = el as SVGGraphicsElement
  if (
    typeof graphics.getCTM === "function" &&
    typeof svg.getCTM === "function" &&
    typeof svg.createSVGPoint === "function"
  ) {
    try {
      const ctm = graphics.getCTM()
      const rootCtm = svg.getCTM()
      if (ctm && rootCtm) {
        const pt = svg.createSVGPoint()
        pt.x = x
        pt.y = y
        const global = pt.matrixTransform(ctm)
        const local = global.matrixTransform(rootCtm.inverse())
        if (Number.isFinite(local.x) && Number.isFinite(local.y)) return { x: local.x, y: local.y }
      }
    } catch {
      /* unmounted SVG or missing CTM */
    }
  }
  return applyMatrix(accumulatedTransform(el, root), x, y)
}

function parseSimpleMlPathPoints(d: string): Pt[] | null {
  const trimmed = d.trim()
  if (!/^M/i.test(trimmed)) return null
  if (/[HVCSQTAhvcsqta]/.test(trimmed)) return null
  const numbers = trimmed.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)
  if (!numbers || numbers.length < 6) return null
  const points: Pt[] = []
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const x = Number(numbers[i])
    const y = Number(numbers[i + 1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    points.push({ x, y })
  }
  if (points.length >= 2) {
    const first = points[0]!
    const last = points[points.length - 1]!
    if ((first.x - last.x) ** 2 + (first.y - last.y) ** 2 < 0.01) points.pop()
  }
  return points.length >= 3 ? points : null
}

function samplePathPoints(el: Element): Pt[] {
  const simple = parseSimpleMlPathPoints(el.getAttribute("d") ?? "")
  if (simple?.length) return simple
  const path = el as SVGPathElement
  if (typeof path.getTotalLength !== "function" || typeof path.getPointAtLength !== "function") return []
  try {
    const length = path.getTotalLength()
    if (!Number.isFinite(length) || length <= 0) return []
    const count = Math.min(160, Math.max(16, Math.ceil(length / 150)))
    const points: Pt[] = []
    for (let i = 0; i < count; i++) {
      const point = path.getPointAtLength((length * i) / Math.max(count - 1, 1))
      points.push({ x: point.x, y: point.y })
    }
    return points
  } catch {
    return []
  }
}

function localShapePoints(el: Element): Pt[] {
  const tag = el.tagName.toLowerCase()
  if (tag === "polygon" || tag === "polyline") {
    const nums = parseNumbers(el.getAttribute("points") ?? "")
    const points: Pt[] = []
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) {
        points.push({ x: nums[i], y: nums[i + 1] })
      }
    }
    return points
  }
  if (tag === "rect") {
    const x = Number(el.getAttribute("x") ?? 0)
    const y = Number(el.getAttribute("y") ?? 0)
    const w = Number(el.getAttribute("width") ?? 0)
    const h = Number(el.getAttribute("height") ?? 0)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return []
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ]
  }
  if (tag === "path") return samplePathPoints(el)
  return []
}

function shapePointsInRoot(el: Element, root: Element): Pt[] {
  return localShapePoints(el).map((pt) => transformPoint(el, root, pt.x, pt.y))
}

function bboxFromPoints(points: Pt[]): { x: number; y: number; w: number; h: number; area: number } | null {
  if (points.length < 3) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const pt of points) {
    minX = Math.min(minX, pt.x)
    minY = Math.min(minY, pt.y)
    maxX = Math.max(maxX, pt.x)
    maxY = Math.max(maxY, pt.y)
  }
  const w = maxX - minX
  const h = maxY - minY
  if (w <= 0 || h <= 0) return null
  return { x: minX, y: minY, w, h, area: w * h }
}

function pointInBBox(x: number, y: number, box: { x: number; y: number; w: number; h: number }): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h
}

function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x
    const yi = poly[i]!.y
    const xj = poly[j]!.x
    const yj = poly[j]!.y
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function centroid(points: Pt[]): Pt {
  const n = points.length || 1
  return {
    x: points.reduce((sum, pt) => sum + pt.x, 0) / n,
    y: points.reduce((sum, pt) => sum + pt.y, 0) / n,
  }
}

function shoelaceArea(points: Pt[]): number {
  let area = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j]!.x * points[i]!.y - points[i]!.x * points[j]!.y
  }
  return Math.abs(area) / 2
}

function cafmRoomKey(rawText: string): { key: string; kind: "room" | "tag" } | null {
  const text = rawText.trim().toUpperCase().replace(/\s+/g, "")
  if (!text || text.length > 24) return null
  if (text === "WORKAREA") return null
  if (text.length === 1 && !/^\d$/.test(text)) return null
  if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(text)) return null
  if (/^\d{1,4}[A-Z]?$/.test(text)) return { key: text, kind: "room" }
  if (/^[A-Z]\d{1,4}(\.\d+)?[A-Z]?$/.test(text)) return { key: text, kind: "room" }
  if (/^\d{1,4}\.\d+[A-Z]?$/.test(text)) return { key: text, kind: "room" }
  if (/^[A-Z]-\d{1,4}[A-Z]?$/.test(text)) return { key: text, kind: "room" }
  if (/^[ENW]\d{1,2}$/.test(text)) return { key: text, kind: "room" }
  if (/^S\d+-[A-Z0-9]+$/.test(text)) return { key: text, kind: "room" }
  if (/^[A-Z][A-Z0-9.-]{1,}$/.test(text)) return { key: text, kind: "room" }
  return { key: text, kind: "tag" }
}

function textAnchor(el: Element, root: Element): Pt | null {
  const graphics = el as SVGGraphicsElement
  if (typeof graphics.getBBox === "function") {
    try {
      const box = graphics.getBBox()
      if (box && (box.width > 0 || box.height > 0)) {
        return transformPoint(el, root, box.x + box.width / 2, box.y + box.height / 2)
      }
    } catch {
      /* unmounted */
    }
  }
  const x = Number(el.getAttribute("x") ?? el.querySelector("tspan")?.getAttribute("x") ?? 0)
  const y = Number(el.getAttribute("y") ?? el.querySelector("tspan")?.getAttribute("y") ?? 0)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return transformPoint(el, root, x, y)
}

function syntheticHotspot(x: number, y: number, half: number): Pt[] {
  const h = Math.max(half, 1)
  return [
    { x: x - h, y: y - h },
    { x: x + h, y: y - h },
    { x: x + h, y: y + h },
    { x: x - h, y: y + h },
  ]
}

function hotspotHalfSize(labels: Pt[], root: Element): number {
  const vb = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number)
  const extent = vb.length === 4 ? Math.min(Math.abs(vb[2]!), Math.abs(vb[3]!)) : 4000
  const minHalf = extent * 0.035
  const maxHalf = extent * 0.06
  if (labels.length < 2) return Math.max(minHalf, 48)

  const gaps: number[] = []
  for (let i = 0; i < labels.length; i++) {
    let best = Infinity
    for (let j = 0; j < labels.length; j++) {
      if (i === j) continue
      const dist = Math.hypot(labels[i]!.x - labels[j]!.x, labels[i]!.y - labels[j]!.y)
      if (dist > 1 && dist < best) best = dist
    }
    if (Number.isFinite(best)) gaps.push(best)
  }
  if (!gaps.length) return Math.max(minHalf, 48)
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)] ?? minHalf
  return Math.min(Math.max(median * 0.45, minHalf), maxHalf)
}

type CafmLabel = { key: string; kind: "room" | "tag"; x: number; y: number }

function cafmLabels(svg: Element, cafmId: Element): CafmLabel[] {
  const labels: CafmLabel[] = []
  for (const textEl of Array.from(cafmId.querySelectorAll("text"))) {
    const raw = (textEl.querySelector("tspan")?.textContent ?? textEl.textContent ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
    const parsed = cafmRoomKey(raw)
    const pos = textAnchor(textEl, svg)
    if (!parsed || !pos) continue
    labels.push({ key: parsed.key, kind: parsed.kind, x: pos.x, y: pos.y })
  }
  return labels
}

function overlayForShape(
  points: Pt[],
  bbox: { x: number; y: number; w: number; h: number; area: number },
  label: CafmLabel,
  half: number,
): { points: Pt[]; overlayKind: "boundary" | "hotspot" } {
  const polyArea = shoelaceArea(points)
  if (points.length < 3 || polyArea > bbox.area * 2.5) {
    return { points: syntheticHotspot(label.x, label.y, half), overlayKind: "hotspot" }
  }
  return { points, overlayKind: "boundary" }
}

function roomsFromLabels(
  labels: CafmLabel[],
  levelId: string,
  half: number,
  resolve: (label: CafmLabel) => { points: Pt[]; overlayKind: "boundary" | "hotspot" } | null,
): ParsedPlanRoom[] {
  const roomsByKey = new Map<string, ParsedPlanRoom>()
  const ordered = [...labels].sort((a, b) => (a.kind === "room" ? 0 : 1) - (b.kind === "room" ? 0 : 1))
  for (const label of ordered) {
    if (roomsByKey.has(label.key)) continue
    const overlay = resolve(label)
    if (!overlay) continue
    roomsByKey.set(label.key, {
      id: label.key,
      name: label.key,
      x: label.x,
      y: label.y,
      levelId,
      points: overlay.points,
      overlayKind: overlay.overlayKind,
    })
  }
  return [...roomsByKey.values()].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" }),
  )
}

function extractAttributePolygons(svg: Element, selector: string, idAttr: string, levelId: string): ParsedPlanRoom[] {
  const rooms: ParsedPlanRoom[] = []
  const seen = new Set<string>()
  for (const poly of Array.from(svg.querySelectorAll(selector))) {
    const id = poly.getAttribute(idAttr)?.trim() || poly.getAttribute("data-label")?.trim()
    const points = shapePointsInRoot(poly, svg)
    if (!id || points.length < 3 || seen.has(id)) continue
    seen.add(id)
    const c = centroid(points)
    rooms.push({
      id,
      name: poly.getAttribute("data-label")?.trim() || id,
      x: c.x,
      y: c.y,
      levelId,
      points,
      overlayKind: "boundary",
    })
  }
  return rooms
}

function extractCafmRooms(svg: Element, levelId: string): ParsedPlanRoom[] {
  const cafmId = svg.querySelector("#CAFM_ID")
  if (!cafmId) return []

  const labels = cafmLabels(svg, cafmId)
  if (!labels.length) return []
  const half = hotspotHalfSize(labels, svg)

  const cafmSpace = svg.querySelector("#CAFM_SPACE")
  const shapes = cafmSpace
    ? Array.from(cafmSpace.querySelectorAll("path, rect, polygon, polyline"))
        .map((el) => {
          const points = shapePointsInRoot(el, svg)
          const bbox = bboxFromPoints(points)
          if (!bbox) return null
          return { points, bbox, centroid: centroid(points) }
        })
        .filter((shape): shape is NonNullable<typeof shape> => Boolean(shape))
    : []

  if (!shapes.length) {
    return roomsFromLabels(labels, levelId, half, (label) => ({
      points: syntheticHotspot(label.x, label.y, half),
      overlayKind: "hotspot",
    }))
  }

  return roomsFromLabels(labels, levelId, half, (label) => {
    const pos = { x: label.x, y: label.y }
    const containing = shapes
      .filter((shape) => pointInPolygon(pos, shape.points) || pointInBBox(pos.x, pos.y, shape.bbox))
      .sort((a, b) => a.bbox.area - b.bbox.area)
    const shape =
      containing.find((item) => pointInPolygon(pos, item.points)) ??
      containing[0] ??
      shapes
        .map((item) => ({
          item,
          dist: (item.centroid.x - pos.x) ** 2 + (item.centroid.y - pos.y) ** 2,
        }))
        .sort((a, b) => a.dist - b.dist || a.item.bbox.area - b.item.bbox.area)[0]?.item
    if (!shape) {
      return { points: syntheticHotspot(label.x, label.y, half), overlayKind: "hotspot" }
    }
    return overlayForShape(shape.points, shape.bbox, label, half)
  })
}

function extractRoomsFromSvgElement(svg: Element, levelId: string): ParsedPlanRoom[] {
  const cafm = extractCafmRooms(svg, levelId)
  if (cafm.length) return cafm

  const proom = extractAttributePolygons(svg, "polygon.proom, #planRooms polygon.proom", "data-i", levelId)
  if (proom.length) return proom

  return extractAttributePolygons(svg, "polygon[data-k]", "data-k", levelId)
}

function withMountedSvg<T>(svg: Element, fn: (mounted: SVGSVGElement) => T): T {
  if (typeof document === "undefined" || !document.body) return fn(svg as SVGSVGElement)

  const mount = document.createElement("div")
  mount.setAttribute("data-floor-plan-parse", "1")
  mount.style.cssText =
    "position:fixed;left:-10000px;top:0;width:2400px;height:2400px;overflow:hidden;visibility:hidden;pointer-events:none;"
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute("width", "2400")
  clone.setAttribute("height", "2400")
  mount.appendChild(clone)
  document.body.appendChild(mount)
  try {
    return fn(clone)
  } finally {
    mount.remove()
  }
}

export function parsePlanRoomsFromSvg(svgText: string, levelId: string): ParsedPlanRoom[] {
  if (typeof DOMParser === "undefined") return []
  try {
    const doc = new DOMParser().parseFromString(sanitizeFloorPlanSvgXml(svgText), "image/svg+xml")
    if (doc.querySelector("parsererror")) return []
    const svg = doc.documentElement
    if (!svg || svg.tagName.toLowerCase() !== "svg") return []
    return withMountedSvg(svg, (mounted) => extractRoomsFromSvgElement(mounted, levelId))
  } catch {
    return []
  }
}
