import { RoundedBox } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import type { OperationalState } from '@/lib/api/types'
import { STATE_HEX } from '@/lib/domain/status'
import type { PlacedTable, TableShape } from './layout'
import { materials, roundedRect, SCENE } from './materials'

const TOP = 0.8

function Chair({ x, z, rotation, flipped, inward }: { x: number; z: number; rotation: number; flipped: boolean; inward: number }) {
  const m = materials()
  // A closed table has its chairs upside down on the tabletop, backs hanging over the edge.
  const position: [number, number, number] = flipped ? [x * inward, TOP + 0.5, z * inward] : [x, 0, z]
  return (
    <group position={position} rotation={[0, rotation, flipped ? Math.PI : 0]}>
      <RoundedBox args={[0.44, 0.06, 0.42]} radius={0.02} position={[0, 0.46, 0]} material={m.oak} castShadow receiveShadow />
      <RoundedBox args={[0.44, 0.44, 0.05]} radius={0.02} position={[0, 0.72, -0.2]} material={m.oak} castShadow />
      <mesh position={[-0.18, 0.23, 0]} material={m.ink} castShadow>
        <boxGeometry args={[0.035, 0.46, 0.38]} />
      </mesh>
      <mesh position={[0.18, 0.23, 0]} material={m.ink} castShadow>
        <boxGeometry args={[0.035, 0.46, 0.38]} />
      </mesh>
    </group>
  )
}

function Plate({ x, z, y = TOP, tilt = 0 }: { x: number; z: number; y?: number; tilt?: number }) {
  return (
    <mesh position={[x, y, z]} rotation={[0, 0, tilt]} material={materials().plate} castShadow>
      <cylinderGeometry args={[0.15, 0.13, 0.025, 28]} />
    </mesh>
  )
}

function Tumbler({ x, z, tipped = false }: { x: number; z: number; tipped?: boolean }) {
  return (
    <mesh
      position={[x, tipped ? TOP + 0.03 : TOP + 0.06, z]}
      rotation={[0, 0, tipped ? Math.PI / 2 : 0]}
      material={materials().tumbler}
      castShadow
    >
      <cylinderGeometry args={[0.035, 0.03, 0.13, 12]} />
    </mesh>
  )
}

/** Tabletop props mirror the confirmed operational state, never camera evidence. */
function Tabletop({ state, shape }: { state: OperationalState; shape: TableShape }) {
  const m = materials()
  const inner = (k: number) => shape.seats.map((s) => [s.x * k, s.z * k] as const)

  switch (state) {
    case 'occupied':
    case 'departure_review':
      return (
        <group>
          {inner(0.52).map(([x, z], i) => (
            <group key={i}>
              <Plate x={x} z={z} />
              <Tumbler x={x + 0.16} z={z + 0.05} />
            </group>
          ))}
          {state === 'occupied' ? (
            <mesh position={[0, TOP + 0.07, 0]} material={m.candle}>
              <cylinderGeometry args={[0.04, 0.05, 0.16, 12]} />
            </mesh>
          ) : null}
        </group>
      )
    case 'needs_clearing':
      return (
        <group>
          {inner(0.45).map(([x, z], i) => (
            <group key={i}>
              <Plate x={x + 0.05 * (i - 1)} z={z - 0.04 * i} tilt={0.05 * (i % 2)} />
              <mesh position={[x + 0.1, TOP + 0.05, z + 0.08]} material={m.napkin} castShadow>
                <icosahedronGeometry args={[0.075, 0]} />
              </mesh>
            </group>
          ))}
          <Tumbler x={0.1} z={0.12} tipped />
        </group>
      )
    case 'cleaning':
      return (
        <group>
          {[0, 1, 2, 3].map((i) => (
            <Plate key={i} x={shape.width / 2 - 0.25} z={0} y={TOP + i * 0.028} />
          ))}
          <RoundedBox args={[0.22, 0.05, 0.14]} radius={0.02} position={[-0.1, TOP + 0.01, 0.05]} material={m.cloth} />
        </group>
      )
    case 'ready':
      return (
        <group>
          {inner(0.55).map(([x, z], i) => (
            <mesh key={i} position={[x, TOP + 0.085, z]} material={m.plate} castShadow>
              <coneGeometry args={[0.06, 0.17, 4]} />
            </mesh>
          ))}
        </group>
      )
  }
}

/** New tabletop props settle in with a short scale-and-drop when the table's state changes. */
function Appear({ children, reducedMotion }: { children: ReactNode; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null)
  const progress = useRef(reducedMotion ? 1 : 0)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => invalidate(), [invalidate])
  useFrame((_, delta) => {
    const g = group.current
    if (!g || progress.current >= 1) return
    progress.current = Math.min(1, progress.current + delta / 0.3)
    const eased = 1 - (1 - progress.current) ** 3
    g.scale.setScalar(0.6 + 0.4 * eased)
    g.position.y = 0.08 * (1 - eased)
    invalidate()
  })
  const start = reducedMotion ? 1 : 0.6
  return (
    <group ref={group} scale={start} position={[0, reducedMotion ? 0 : 0.08, 0]}>
      {children}
    </group>
  )
}

/** Faceless seated figures: enough to read "occupied" without depicting anyone. */
function Guests({ shape }: { shape: TableShape }) {
  const m = materials()
  return (
    <group>
      {shape.seats.map((seat, i) => {
        // Sit slightly toward the table from the chair centre.
        const x = seat.x * 0.94
        const z = seat.z * 0.94
        return (
          <group key={i} position={[x, 0, z]} rotation={[0, seat.rotation, 0]}>
            <mesh position={[0, 0.78, -0.04]} material={m.guest} castShadow>
              <capsuleGeometry args={[0.15, 0.3, 4, 12]} />
            </mesh>
            <mesh position={[0, 1.2, -0.02]} material={m.guest} castShadow>
              <sphereGeometry args={[0.12, 16, 12]} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/** A bag beside the first chair and a phone on the table: signs a party is still here. */
function Belongings({ shape }: { shape: TableShape }) {
  const m = materials()
  const seat = shape.seats[0]
  const out = 1.45
  return (
    <group>
      <group position={[seat.x * out + 0.28, 0, seat.z * out]} rotation={[0, 0.4, 0]}>
        <RoundedBox args={[0.3, 0.24, 0.14]} radius={0.03} position={[0, 0.12, 0]} material={m.bag} castShadow />
        <mesh position={[0, 0.28, 0]} rotation={[0, 0, Math.PI / 2]} material={m.bag}>
          <torusGeometry args={[0.07, 0.012, 6, 16, Math.PI]} />
        </mesh>
      </group>
      <RoundedBox args={[0.08, 0.012, 0.15]} radius={0.004} position={[0.18, TOP + 0.005, -0.12]} rotation={[0, 0.5, 0]} material={m.screen} />
    </group>
  )
}

/** A floor halo whose colour eases to the new state when the board changes. */
function StatusHalo({ shape, color, selected, dimmed, reducedMotion }: { shape: TableShape; color: string; selected: boolean; dimmed: boolean; reducedMotion: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  const w = shape.width + 1.55
  const d = shape.depth + 1.55
  const [fillGeo, ringGeo, selGeo] = useMemo(() => {
    const ring = roundedRect(w, d, 0.45)
    ring.holes.push(roundedRect(w - 0.12, d - 0.12, 0.4))
    const sel = roundedRect(w + 0.5, d + 0.5, 0.65)
    sel.holes.push(roundedRect(w + 0.36, d + 0.36, 0.58))
    return [new THREE.ShapeGeometry(roundedRect(w, d, 0.45)), new THREE.ShapeGeometry(ring), new THREE.ShapeGeometry(sel)]
  }, [w, d])

  const target = useMemo(() => new THREE.Color(dimmed ? SCENE.dimmed : color), [color, dimmed])
  const fill = useRef<THREE.MeshBasicMaterial>(null)
  const ring = useRef<THREE.MeshBasicMaterial>(null)
  const started = useRef(false)

  useFrame((_, delta) => {
    if (!fill.current || !ring.current) return
    const current = ring.current.color
    if (!started.current || reducedMotion) {
      current.copy(target)
      started.current = true
    } else if (!current.equals(target)) {
      current.lerp(target, Math.min(1, delta * 7))
      if (Math.abs(current.r - target.r) + Math.abs(current.g - target.g) + Math.abs(current.b - target.b) < 0.01) {
        current.copy(target)
      } else {
        invalidate()
      }
    }
    fill.current.color.copy(current)
  })

  // Request a frame whenever the target changes so the easing starts.
  useEffect(() => invalidate(), [target, invalidate])

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={fillGeo} position={[0, 0, 0.012]} receiveShadow>
        <meshBasicMaterial ref={fill} transparent opacity={selected ? 0.3 : dimmed ? 0.1 : 0.17} depthWrite={false} />
      </mesh>
      <mesh geometry={ringGeo} position={[0, 0, 0.016]}>
        <meshBasicMaterial ref={ring} transparent opacity={dimmed ? 0.5 : 0.95} />
      </mesh>
      {selected ? (
        <mesh geometry={selGeo} position={[0, 0, 0.016]}>
          <meshBasicMaterial color="#1b2733" />
        </mesh>
      ) : null}
    </group>
  )
}

interface TableModelProps {
  placed: PlacedTable
  state: OperationalState
  blocked: boolean
  selected: boolean
  dimmed: boolean
  reducedMotion: boolean
  onSelect: (id: string) => void
  /** Seated figures, used by the landing walkthrough. */
  guests?: boolean
  /** A bag and phone, used by the landing walkthrough. */
  belongings?: boolean
}

export const TableModel = memo(function TableModel({
  placed,
  state,
  blocked,
  selected,
  dimmed,
  reducedMotion,
  onSelect,
  guests = false,
  belongings = false,
}: TableModelProps) {
  const m = materials()
  const { shape } = placed
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(placed.id)
  }

  return (
    <group
      position={[placed.x, 0, placed.z]}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
      }}
    >
      <StatusHalo
        shape={shape}
        color={blocked ? '#4a5560' : STATE_HEX[state]}
        selected={selected}
        dimmed={dimmed}
        reducedMotion={reducedMotion}
      />
      {shape.round ? (
        <group>
          <mesh position={[0, 0.75, 0]} material={m.linen} castShadow receiveShadow>
            <cylinderGeometry args={[shape.width / 2, shape.width / 2, 0.07, 40]} />
          </mesh>
          <mesh position={[0, 0.37, 0]} material={m.ink} castShadow>
            <cylinderGeometry args={[0.06, 0.06, 0.72, 12]} />
          </mesh>
          <mesh position={[0, 0.015, 0]} material={m.ink}>
            <cylinderGeometry args={[0.28, 0.28, 0.03, 24]} />
          </mesh>
        </group>
      ) : (
        <group>
          <RoundedBox args={[shape.width, 0.07, shape.depth]} radius={0.03} position={[0, 0.75, 0]} material={m.linen} castShadow receiveShadow />
          {[
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ].map(([sx, sz]) => (
            <mesh key={`${sx}${sz}`} position={[sx * (shape.width / 2 - 0.08), 0.37, sz * (shape.depth / 2 - 0.08)]} material={m.ink} castShadow>
              <boxGeometry args={[0.05, 0.72, 0.05]} />
            </mesh>
          ))}
        </group>
      )}
      {shape.seats.map((seat, i) => {
        const half = seat.z === 0 ? shape.width / 2 : shape.depth / 2
        return (
          <Chair
            key={i}
            x={seat.x}
            z={seat.z}
            rotation={seat.rotation}
            flipped={blocked}
            inward={Math.max(0.2, (half - 0.26) / (half + 0.32))}
          />
        )
      })}
      {blocked ? null : (
        <Appear key={state} reducedMotion={reducedMotion}>
          <Tabletop state={state} shape={shape} />
        </Appear>
      )}
      {guests && !blocked ? <Guests shape={shape} /> : null}
      {belongings && !blocked ? <Belongings shape={shape} /> : null}
    </group>
  )
})
