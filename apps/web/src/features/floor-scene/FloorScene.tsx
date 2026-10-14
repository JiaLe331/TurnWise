import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'
import type { TableBoardEntry } from '@/lib/api/types'
import type { FloorLayout } from './layout'
import { Room } from './Room'
import { TableModel } from './TableModel'

export interface Insets {
  left?: number
  right?: number
  top?: number
  bottom?: number
}

const DISTANCE = 60
const TAG_HEIGHT = 1.55

/** The dashboard's fixed viewing angle: 45° around, about 31° above the floor. */
export const DEFAULT_AZIMUTH = Math.PI / 4
export const DEFAULT_ELEVATION = Math.atan2(0.85, Math.SQRT2)

export interface FrameOptions {
  layout: FloorLayout
  width: number
  height: number
  insets: Insets
  /** Radians around the vertical axis, measured from +X toward +Z. */
  azimuth: number
  /** Radians above the floor plane. */
  elevation: number
  /** World point to centre on; the whole floor when null. */
  focus: THREE.Vector3 | null
  /** Zoom relative to fitting the whole floor. */
  zoomK: number
}

export interface CameraPose {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  zoom: number
}

const scratchCamera = new THREE.OrthographicCamera()
const scratch = new THREE.Vector3()

/**
 * Where an orthographic camera must sit to look at the floor from a given angle, fitting the floor
 * (or a focus point) into the area left uncovered by overlays.
 */
export function framePose({ layout, width, height, insets, azimuth, elevation, focus, zoomK }: FrameOptions): CameraPose {
  const { left = 0, right = 0, top = 0, bottom = 0 } = insets
  const dir = new THREE.Vector3(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth),
  )
  // A camera's lookAt points -Z at the target (a plain Object3D would face away).
  const pose = scratchCamera
  pose.position.copy(dir).multiplyScalar(DISTANCE)
  pose.lookAt(0, 0, 0)
  pose.updateMatrixWorld()
  const toView = pose.matrixWorldInverse

  const { minX, maxX, minZ, maxZ } = layout.bounds
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const x of [minX - 0.3, maxX + 0.3])
    for (const y of [-0.8, 2.95])
      for (const z of [minZ - 0.3, maxZ + 0.3]) {
        scratch.set(x, y, z).applyMatrix4(toView)
        x0 = Math.min(x0, scratch.x)
        x1 = Math.max(x1, scratch.x)
        y0 = Math.min(y0, scratch.y)
        y1 = Math.max(y1, scratch.y)
      }

  const availW = Math.max(120, width - left - right)
  const availH = Math.max(120, height - top - bottom)
  const fit = Math.min(availW / (x1 - x0), availH / (y1 - y0)) * 1.04
  const zoom = fit * zoomK

  let cx = (x0 + x1) / 2
  let cy = (y0 + y1) / 2
  if (focus) {
    scratch.copy(focus).applyMatrix4(toView)
    cx = scratch.x
    cy = scratch.y
  }
  // Put the chosen centre in the middle of the uncovered area, not the middle of the canvas.
  const ox = left + availW / 2 - width / 2
  const oy = top + availH / 2 - height / 2
  const rightAxis = new THREE.Vector3().setFromMatrixColumn(pose.matrixWorld, 0)
  const upAxis = new THREE.Vector3().setFromMatrixColumn(pose.matrixWorld, 1)
  const position = pose.position
    .clone()
    .addScaledVector(rightAxis, cx - ox / zoom)
    .addScaledVector(upAxis, cy + oy / zoom)
  return { position, quaternion: pose.quaternion.clone(), zoom }
}

/** Fits the floor into the area not covered by panels; in compact mode, frames the selected table. */
function CameraRig({
  layout,
  insets,
  focusId,
  focusZoom,
  reducedMotion,
  azimuth = DEFAULT_AZIMUTH,
}: {
  layout: FloorLayout
  insets: Insets
  focusId: string | null
  focusZoom: number
  reducedMotion: boolean
  azimuth?: number
}) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const settled = useRef(false)
  const { left = 0, right = 0, top = 0, bottom = 0 } = insets
  const focus = focusId ? layout.tables.get(focusId) : undefined

  const goal = useMemo(
    () =>
      framePose({
        layout,
        width: size.width,
        height: size.height,
        insets: { left, right, top, bottom },
        azimuth,
        elevation: DEFAULT_ELEVATION,
        focus: focus ? new THREE.Vector3(focus.x, 0.8, focus.z) : null,
        zoomK: focus ? focusZoom : 1,
      }),
    [layout, size.width, size.height, left, right, top, bottom, focus, focusZoom, azimuth],
  )

  useEffect(() => {
    camera.quaternion.copy(goal.quaternion)
    invalidate()
  }, [camera, goal, invalidate])

  useFrame((_, delta) => {
    const snap = reducedMotion || !settled.current
    const t = snap ? 1 : Math.min(1, delta * 8)
    camera.position.lerp(goal.position, t)
    camera.zoom += (goal.zoom - camera.zoom) * t
    camera.updateProjectionMatrix()
    settled.current = true
    const done = camera.position.distanceToSquared(goal.position) < 1e-4 && Math.abs(camera.zoom - goal.zoom) < 0.01
    if (!done) invalidate()
  })

  return null
}

/** Moves the DOM tags to their tables after each rendered frame. No React re-render involved. */
export function TagProjector({ layout, tagEls, tagKey }: { layout: FloorLayout; tagEls: RefObject<Map<string, HTMLElement>>; tagKey: string }) {
  const invalidate = useThree((s) => s.invalidate)
  const v = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => invalidate(), [tagKey, invalidate])
  useFrame(({ camera, size }) => {
    for (const [key, el] of tagEls.current) {
      // Keys may carry a suffix ("T6#note") so several overlays can follow one table.
      const table = layout.tables.get(key.split('#')[0])
      if (!table) continue
      v.set(table.x, TAG_HEIGHT, table.z).project(camera)
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`
      el.style.visibility = 'visible'
    }
  })
  return null
}

/** Soft daylight from the entrance side, sized to cast shadows across the whole floor. */
export function SceneLights({ layout }: { layout: FloorLayout }) {
  const { minX, maxX, minZ, maxZ } = layout.bounds
  const span = Math.max(maxX - minX, maxZ - minZ) / 2 + 2
  return (
    <>
      <hemisphereLight args={['#ffffff', '#cfd5cf', 1.55]} />
      <directionalLight
        position={[-8, 18, 12]}
        intensity={2.1}
        color="#fff1e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-radius={4}
        shadow-normalBias={0.02}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-near={1}
        shadow-camera-far={60}
      />
      <directionalLight position={[14, 8, -6]} intensity={0.5} color="#dfe8ff" />
    </>
  )
}

export interface FloorSceneProps {
  layout: FloorLayout
  entries: TableBoardEntry[]
  selectedId: string | null
  isDimmed: (entry: TableBoardEntry) => boolean
  onSelect: (id: string) => void
  insets: Insets
  focusId: string | null
  focusZoom: number
  reducedMotion: boolean
  tagEls: RefObject<Map<string, HTMLElement>>
  tagKey: string
  /** Replaces the illustrative room, e.g. a room built to match a camera's footage. */
  room?: ReactNode
  azimuth?: number
}

export default function FloorScene({
  layout,
  entries,
  selectedId,
  isDimmed,
  onSelect,
  insets,
  focusId,
  focusZoom,
  reducedMotion,
  tagEls,
  tagKey,
  room,
  azimuth,
}: FloorSceneProps) {
  return (
    <Canvas
      orthographic
      frameloop="demand"
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: [DISTANCE, DISTANCE * 0.85, DISTANCE], zoom: 30, near: 0.1, far: 500 }}
      aria-hidden
      style={{ position: 'absolute', inset: 0 }}
    >
      <SceneLights layout={layout} />
      <CameraRig layout={layout} insets={insets} focusId={focusId} focusZoom={focusZoom} reducedMotion={reducedMotion} azimuth={azimuth} />
      {room ?? <Room layout={layout} />}
      {entries.map((entry) => {
        const placed = layout.tables.get(entry.table.table_id)
        if (!placed) return null
        return (
          <TableModel
            key={entry.table.table_id}
            placed={placed}
            state={entry.session.operational_state}
            blocked={entry.table.blocked}
            selected={entry.table.table_id === selectedId}
            dimmed={isDimmed(entry)}
            reducedMotion={reducedMotion}
            onSelect={onSelect}
          />
        )
      })}
      <TagProjector layout={layout} tagEls={tagEls} tagKey={tagKey} />
    </Canvas>
  )
}
