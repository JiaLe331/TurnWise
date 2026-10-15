import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { framePose, SceneLights, TagProjector, type Insets } from '@/features/floor-scene/FloorScene'
import type { FloorLayout } from '@/features/floor-scene/layout'
import { materials, roundedRect } from '@/features/floor-scene/materials'
import { Room } from '@/features/floor-scene/Room'
import { TableModel } from '@/features/floor-scene/TableModel'
import type { TableBoardEntry } from '@/lib/api/types'
import { STORY_TABLE } from './sample'
import { cameraBlend, cameraStepWeight, chapterAt, CHAPTERS } from './story'

interface CameraParams {
  focus: THREE.Vector3
  zoomK: number
  azimuth: number
  elevation: number
  insets: Required<Insets>
}

const DEG = Math.PI / 180

function paramsFor(index: number, layout: FloorLayout, wide: boolean): CameraParams {
  const key = CHAPTERS[index].camera
  const focus = new THREE.Vector3()
  if (key.focus) {
    const placed = key.focus.map((id) => layout.tables.get(id)).filter((t) => t !== undefined)
    for (const t of placed) focus.add(new THREE.Vector3(t.x, 0.8, t.z))
    focus.divideScalar(Math.max(1, placed.length))
    if (key.offset) focus.add(new THREE.Vector3(...key.offset))
  } else {
    const { minX, maxX } = layout.bounds
    focus.set((minX + maxX) / 2, 1.05, 0)
  }
  const i = wide ? key.wide : key.phone
  return {
    focus,
    zoomK: key.zoomK,
    azimuth: key.azimuthDeg * DEG,
    elevation: key.elevationDeg * DEG,
    insets: { left: i.left ?? 0, right: i.right ?? 0, top: i.top ?? 0, bottom: i.bottom ?? 0 },
  }
}

function mix(a: CameraParams, b: CameraParams, t: number, out: CameraParams): CameraParams {
  out.focus.lerpVectors(a.focus, b.focus, t)
  // Zoom interpolates geometrically so pushes in and pulls out feel even.
  out.zoomK = Math.exp(THREE.MathUtils.lerp(Math.log(a.zoomK), Math.log(b.zoomK), t))
  out.azimuth = THREE.MathUtils.lerp(a.azimuth, b.azimuth, t)
  out.elevation = THREE.MathUtils.lerp(a.elevation, b.elevation, t)
  for (const k of ['left', 'right', 'top', 'bottom'] as const) out.insets[k] = THREE.MathUtils.lerp(a.insets[k], b.insets[k], t)
  return out
}

const blank = (): CameraParams => ({
  focus: new THREE.Vector3(),
  zoomK: 1,
  azimuth: 0,
  elevation: 0,
  insets: { left: 0, right: 0, top: 0, bottom: 0 },
})

/** Moves the camera along the chapter keys as the reader scrolls, easing toward the scroll position. */
function StoryCameraRig({
  layout,
  progress,
  wide,
  reducedMotion,
  register,
}: {
  layout: FloorLayout
  progress: RefObject<number>
  wide: boolean
  reducedMotion: boolean
  register: (invalidate: () => void) => void
}) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const keys = useMemo(() => CHAPTERS.map((_, i) => paramsFor(i, layout, wide)), [layout, wide])
  const target = useRef(blank())
  const current = useRef<CameraParams | null>(null)

  useEffect(() => register(invalidate), [register, invalidate])
  useEffect(() => invalidate(), [size.width, size.height, wide, invalidate])

  useFrame((_, delta) => {
    const p = progress.current
    if (reducedMotion) {
      // No camera travel: hold the opening view, then one steady wide view for the rest.
      const { index } = chapterAt(p)
      mix(keys[index === 0 ? 0 : CHAPTERS.length - 1], keys[index === 0 ? 0 : CHAPTERS.length - 1], 0, target.current)
      if (index !== 0) target.current.insets = { ...keys[1].insets }
    } else {
      const { from, to, t } = cameraBlend(p)
      mix(keys[from], keys[to], t, target.current)
    }

    let settling = false
    if (!current.current || reducedMotion) {
      current.current = mix(target.current, target.current, 0, current.current ?? blank())
    } else {
      const k = 1 - Math.exp(-7 * delta)
      const c = current.current
      const before = c.focus.distanceToSquared(target.current.focus) + Math.abs(c.zoomK - target.current.zoomK) + Math.abs(c.azimuth - target.current.azimuth)
      mix(c, target.current, k, c)
      settling = before > 1e-5
    }

    const c = current.current
    const pose = framePose({
      layout,
      width: size.width,
      height: size.height,
      insets: c.insets,
      azimuth: c.azimuth,
      elevation: c.elevation,
      focus: c.focus,
      zoomK: c.zoomK,
    })
    camera.position.copy(pose.position)
    camera.quaternion.copy(pose.quaternion)
    camera.zoom = pose.zoom
    camera.updateProjectionMatrix()
    if (settling) invalidate()
  })

  return null
}

/**
 * Camera detection: a wall camera, its view cone, and a dashed region around the story table.
 * Dashed outlines mean "seen by a camera"; they never stand for a confirmed state.
 */
function CameraDetectionRig({
  layout,
  progress,
  reducedMotion,
}: {
  layout: FloorLayout
  progress: RefObject<number>
  reducedMotion: boolean
}) {
  const table = layout.tables.get(STORY_TABLE)
  const zone = layout.zones.find((z) => table && table.x >= z.minX && table.x <= z.maxX)
  const group = useRef<THREE.Group>(null)
  const region = useRef<THREE.Group>(null)

  const parts = useMemo(() => {
    if (!table || !zone) return null
    const m = materials()
    const fade = {
      dome: m.dome.clone(),
      lens: m.domeLens.clone(),
      cone: m.viewCone.clone(),
      dash: new THREE.MeshBasicMaterial({ color: '#b7791f', transparent: true, depthWrite: false }),
    }
    for (const mat of [fade.dome, fade.lens]) mat.transparent = true

    const dome = new THREE.Vector3(table.x - 0.4, 2.3, zone.minZ + 0.4)
    const aim = new THREE.Vector3(table.x, 0.05, table.z)
    const span = dome.distanceTo(aim)
    const coneQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dome.clone().sub(aim).normalize(),
    )
    const coneMid = dome.clone().add(aim).multiplyScalar(0.5)

    const w = table.shape.width + 2.1
    const d = table.shape.depth + 2.1
    const points = roundedRect(w, d, 0.6).getSpacedPoints(72)
    const dashes: { mid: THREE.Vector3; length: number; angle: number }[] = []
    for (let i = 0; i < points.length - 1; i += 2) {
      const a = points[i]
      const b = points[i + 1]
      dashes.push({
        mid: new THREE.Vector3((a.x + b.x) / 2, 0.03, -(a.y + b.y) / 2),
        length: a.distanceTo(b),
        // Shape space maps (x, y) to world (x, -z); rotation.y = atan2(dy, dx) lines the dash up.
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      })
    }
    return { fade, dome, coneQuat, coneMid, span, dashes }
  }, [table, zone])

  useFrame(() => {
    if (!parts || !group.current) return
    const p = progress.current
    const w = cameraStepWeight(p)
    group.current.visible = w > 0.01
    parts.fade.dome.opacity = w
    parts.fade.lens.opacity = w
    parts.fade.cone.opacity = 0.2 * w
    parts.fade.dash.opacity = 0.95 * w
    if (region.current) {
      const local = chapterAt(p).local
      const pulse = reducedMotion ? 1 : 1 + 0.03 * Math.sin(local * Math.PI * 8)
      region.current.scale.set(pulse, 1, pulse)
    }
  })

  if (!parts || !table) return null
  return (
    <group ref={group} visible={false}>
      <group position={parts.dome} scale={1.8}>
        <mesh material={parts.fade.dome} position={[0, 0.1, -0.12]}>
          <boxGeometry args={[0.12, 0.2, 0.12]} />
        </mesh>
        <mesh material={parts.fade.dome} rotation={[Math.PI, 0, 0]}>
          <sphereGeometry args={[0.22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <mesh material={parts.fade.lens} position={[0.05, -0.12, 0.06]}>
          <sphereGeometry args={[0.08, 16, 12]} />
        </mesh>
      </group>
      <mesh material={parts.fade.cone} position={parts.coneMid} quaternion={parts.coneQuat}>
        <coneGeometry args={[1.35, parts.span, 32, 1, true]} />
      </mesh>
      <group ref={region} position={[table.x, 0, table.z]}>
        {parts.dashes.map((dash, i) => (
          <mesh key={i} material={parts.fade.dash} position={dash.mid} rotation={[0, dash.angle, 0]}>
            <boxGeometry args={[dash.length, 0.012, 0.08]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

const noop = () => {}

export interface StorySceneProps {
  layout: FloorLayout
  entries: TableBoardEntry[]
  chapterIndex: number
  progress: RefObject<number>
  wide: boolean
  reducedMotion: boolean
  tagEls: RefObject<Map<string, HTMLElement>>
  tagKey: string
  registerInvalidate: (invalidate: () => void) => void
}

export default function StoryScene({
  layout,
  entries,
  chapterIndex,
  progress,
  wide,
  reducedMotion,
  tagEls,
  tagKey,
  registerInvalidate,
}: StorySceneProps) {
  const chapter = CHAPTERS[chapterIndex]
  const focusIds = new Set(chapter.camera.focus ?? [])
  const highlight = chapter.step !== null

  return (
    <Canvas
      orthographic
      frameloop="demand"
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: [60, 51, 60], zoom: 30, near: 0.1, far: 500 }}
      aria-hidden
      style={{ position: 'absolute', inset: 0 }}
    >
      <SceneLights layout={layout} />
      <StoryCameraRig layout={layout} progress={progress} wide={wide} reducedMotion={reducedMotion} register={registerInvalidate} />
      <Room layout={layout} />
      {entries.map((entry) => {
        const id = entry.table.table_id
        const placed = layout.tables.get(id)
        if (!placed) return null
        const story = id === STORY_TABLE
        return (
          <TableModel
            key={id}
            placed={placed}
            state={entry.session.operational_state}
            blocked={false}
            selected={story && highlight}
            dimmed={chapter.tags === 'queue' ? !focusIds.has(id) : false}
            reducedMotion={reducedMotion}
            onSelect={noop}
            guests={story && chapter.guests}
            belongings={story && chapter.guests}
          />
        )
      })}
      <CameraDetectionRig layout={layout} progress={progress} reducedMotion={reducedMotion} />
      <TagProjector layout={layout} tagEls={tagEls} tagKey={tagKey} />
    </Canvas>
  )
}
