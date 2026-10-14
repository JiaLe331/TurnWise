import type { TableBoardEntry } from '@/lib/api/types'
import { compareTableIds } from '@/lib/domain/status'

// Illustrative layout only. The API has no floor coordinates, so tables are arranged in a tidy grid
// per zone. Zone membership and capacity come from table data; positions do not. When the backend
// gains layout coordinates, read them here and drop the "Illustrative layout" note.

export interface TableShape {
  /** Tabletop size in world units (x by z). */
  width: number
  depth: number
  round: boolean
  /** Chair positions relative to the table centre, with the chair's facing angle. */
  seats: { x: number; z: number; rotation: number }[]
}

export interface PlacedTable {
  id: string
  x: number
  z: number
  shape: TableShape
}

export interface ZoneBox {
  name: string
  outdoor: boolean
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface FloorLayout {
  tables: Map<string, PlacedTable>
  zones: ZoneBox[]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
}

const CHAIR_GAP = 0.32
const SEAT_BAND = 1.1 // chair depth on both sides of a table
const COLUMN_GAP = 0.8
const ROW_GAP = 1.3
const ZONE_PAD = 1.1
const INDOOR_BACK = 1.4 // banquette along the back wall
const INDOOR_SIDE = 1.9 // bar along the side wall
const INDOOR_FRONT = 1.6 // entrance and host stand

export function tableShape(capacity: number): TableShape {
  if (capacity <= 2) {
    const d = 0.95
    return {
      width: d,
      depth: d,
      round: true,
      seats: [
        { x: 0, z: -(d / 2 + CHAIR_GAP), rotation: 0 },
        { x: 0, z: d / 2 + CHAIR_GAP, rotation: Math.PI },
      ],
    }
  }
  if (capacity <= 4) {
    const s = 1.1
    return {
      width: s,
      depth: s,
      round: false,
      seats: [
        { x: 0, z: -(s / 2 + CHAIR_GAP), rotation: 0 },
        { x: 0, z: s / 2 + CHAIR_GAP, rotation: Math.PI },
        { x: -(s / 2 + CHAIR_GAP), z: 0, rotation: Math.PI / 2 },
        { x: s / 2 + CHAIR_GAP, z: 0, rotation: -Math.PI / 2 },
      ],
    }
  }
  const perSide = Math.ceil((capacity - 2) / 2)
  const width = 0.9 * perSide
  const depth = 1.0
  const seats: TableShape['seats'] = []
  for (let i = 0; i < perSide; i++) {
    const x = -width / 2 + (width * (i + 0.5)) / perSide
    seats.push({ x, z: -(depth / 2 + CHAIR_GAP), rotation: 0 })
    seats.push({ x, z: depth / 2 + CHAIR_GAP, rotation: Math.PI })
  }
  seats.push({ x: -(width / 2 + CHAIR_GAP), z: 0, rotation: Math.PI / 2 })
  seats.push({ x: width / 2 + CHAIR_GAP, z: 0, rotation: -Math.PI / 2 })
  return { width, depth, round: false, seats: seats.slice(0, capacity) }
}

function footprint(shape: TableShape) {
  const sideChairs = shape.seats.some((s) => s.z === 0)
  return {
    w: shape.width + (sideChairs ? SEAT_BAND : 0.2),
    d: shape.depth + SEAT_BAND,
  }
}

function rowsFor(count: number): number {
  if (count <= 2) return 1
  if (count <= 6) return 2
  return Math.ceil(count / 4)
}

export function illustrativeLayout(entries: TableBoardEntry[]): FloorLayout {
  const zoneNames: string[] = []
  for (const e of entries) if (!zoneNames.includes(e.table.zone)) zoneNames.push(e.table.zone)

  const tables = new Map<string, PlacedTable>()
  const zones: ZoneBox[] = []
  let cursorX = 0

  zoneNames.forEach((name, zoneIndex) => {
    const members = entries
      .filter((e) => e.table.zone === name)
      .sort((a, b) => compareTableIds(a.table.table_id, b.table.table_id))
    const outdoor = members.every((e) => e.table.attributes.includes('outdoor'))
    const rows = rowsFor(members.length)
    const cols = Math.ceil(members.length / rows)
    const shapes = members.map((e) => tableShape(e.table.capacity))

    const colWidths = Array.from({ length: cols }, (_, c) =>
      Math.max(...shapes.filter((_, i) => i % cols === c).map((s) => footprint(s).w)),
    )
    const rowDepths = Array.from({ length: rows }, (_, r) =>
      Math.max(...shapes.filter((_, i) => Math.floor(i / cols) === r).map((s) => footprint(s).d)),
    )

    const indoorFirst = !outdoor && zoneIndex === 0
    const padLeft = ZONE_PAD + (indoorFirst ? INDOOR_SIDE : 0)
    const padBack = ZONE_PAD + (outdoor ? 0 : INDOOR_BACK)
    const padFront = ZONE_PAD + (indoorFirst ? INDOOR_FRONT : 0.4)
    const padRight = ZONE_PAD + (outdoor ? 0.9 : 0)
    const innerW = colWidths.reduce((a, b) => a + b, 0) + COLUMN_GAP * (cols - 1)
    const innerD = rowDepths.reduce((a, b) => a + b, 0) + ROW_GAP * (rows - 1)

    const minX = cursorX
    const maxX = minX + padLeft + innerW + padRight
    const minZ = -(padBack + innerD + padFront) / 2
    const maxZ = -minZ

    members.forEach((entry, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      const x =
        minX + padLeft + colWidths.slice(0, c).reduce((a, b) => a + b, 0) + COLUMN_GAP * c + colWidths[c] / 2
      const z = minZ + padBack + rowDepths.slice(0, r).reduce((a, b) => a + b, 0) + ROW_GAP * r + rowDepths[r] / 2
      tables.set(entry.table.table_id, { id: entry.table.table_id, x, z, shape: shapes[i] })
    })

    zones.push({ name, outdoor, minX, maxX, minZ, maxZ })
    cursorX = maxX
  })

  // Centre the whole floor on the origin.
  const totalW = cursorX
  const maxDepth = Math.max(...zones.map((z) => z.maxZ - z.minZ), 1)
  const shiftX = -totalW / 2
  for (const t of tables.values()) t.x += shiftX
  for (const z of zones) {
    z.minX += shiftX
    z.maxX += shiftX
    z.minZ = -maxDepth / 2
    z.maxZ = maxDepth / 2
  }

  return {
    tables,
    zones,
    bounds: { minX: -totalW / 2, maxX: totalW / 2, minZ: -maxDepth / 2, maxZ: maxDepth / 2 },
  }
}
