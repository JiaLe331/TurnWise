import { RoundedBox } from '@react-three/drei'
import { memo } from 'react'
import type { FloorLayout, PlacedTable, TableShape } from '@/features/floor-scene/layout'
import { materials } from '@/features/floor-scene/materials'

// Floor plan built from the demo footage (Mixkit 4385): one long dining room, bar and stools along
// the left wall, a banquette along the right wall with a single column of tables, windows at the
// far end. Chairs sit on the aisle side; guests on the wall side use the banquette.

const ROOM = { minX: -2.2, maxX: 2.2, minZ: -5, maxZ: 5 }
const TABLE_X = 1.2
const CHAIR_OUT = 0.33

function twoTop(): TableShape {
  const width = 0.76
  return {
    width,
    depth: 0.82,
    round: false,
    seats: [{ x: -(width / 2 + CHAIR_OUT), z: 0, rotation: Math.PI / 2 }],
  }
}

function sixTop(): TableShape {
  const width = 0.82
  const depth = 1.95
  return {
    width,
    depth,
    round: false,
    seats: [
      ...[-0.62, 0, 0.62].map((z) => ({ x: -(width / 2 + CHAIR_OUT), z, rotation: Math.PI / 2 })),
      { x: 0, z: depth / 2 + CHAIR_OUT, rotation: Math.PI },
    ],
  }
}

const TABLES: PlacedTable[] = [
  { id: 'T1', x: TABLE_X, z: -3.55, shape: twoTop() },
  { id: 'T2', x: TABLE_X, z: -2.05, shape: twoTop() },
  { id: 'T3', x: TABLE_X, z: -0.55, shape: twoTop() },
  { id: 'T4', x: TABLE_X, z: 1.75, shape: sixTop() },
]

export const MIXKIT_LAYOUT: FloorLayout = {
  tables: new Map(TABLES.map((t) => [t.id, t])),
  zones: [{ name: 'Dining room', outdoor: false, ...ROOM }],
  bounds: ROOM,
}

/** Looks down the room from the entrance, roughly where the camera hangs. */
export const MIXKIT_AZIMUTH = Math.PI / 2 - 0.42

type Mat = ReturnType<typeof materials>[keyof ReturnType<typeof materials>]

function Box({ size, at, mat }: { size: [number, number, number]; at: [number, number, number]; mat: Mat }) {
  return (
    <mesh position={at} material={mat} castShadow receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  )
}

export const MixkitRoom = memo(function MixkitRoom() {
  const m = materials()
  const w = ROOM.maxX - ROOM.minX
  const d = ROOM.maxZ - ROOM.minZ
  const far = ROOM.minZ
  const left = ROOM.minX
  const barStart = -3.9
  const barEnd = 2.6
  const barLen = barEnd - barStart
  const barZ = (barStart + barEnd) / 2
  return (
    <group>
      <Box size={[w, 0.5, d]} at={[0, -0.25, 0]} mat={m.terrazzo} />

      {/* Far wall: street windows and the entrance door */}
      <Box size={[w, 2.8, 0.22]} at={[0, 1.4, far - 0.11]} mat={m.plaster} />
      <Box size={[1.5, 2.1, 0.04]} at={[-0.9, 1.25, far + 0.03]} mat={m.window} />
      <Box size={[1.3, 1.6, 0.04]} at={[1.0, 1.5, far + 0.03]} mat={m.window} />
      <Box size={[0.06, 2.1, 0.08]} at={[-0.15, 1.05, far + 0.05]} mat={m.ink} />

      {/* Left wall with wall lights and framed prints */}
      <Box size={[0.22, 2.8, d]} at={[left - 0.11, 1.4, 0]} mat={m.plaster} />
      {[-1.5, 1.2, 3.6].map((z) => (
        <mesh key={z} position={[left + 0.05, 1.9, z]} material={m.candle}>
          <boxGeometry args={[0.08, 0.14, 0.32]} />
        </mesh>
      ))}
      {[2.6, 3.4].map((z) => (
        <Box key={z} size={[0.03, 0.55, 0.42]} at={[left + 0.03, 1.5, z]} mat={m.ink} />
      ))}

      {/* Bar: back shelf with bottles, counter, stools on the aisle side */}
      <Box size={[0.28, 0.04, barLen * 0.7]} at={[left + 0.18, 1.45, barZ - 0.6]} mat={m.ink} />
      {Array.from({ length: 12 }, (_, i) => (
        <mesh
          key={i}
          position={[left + 0.18, 1.6, barZ - 0.6 - barLen * 0.33 + (barLen * 0.66 * i) / 11]}
          material={i % 3 ? m.bottleGreen : m.bottleAmber}
          castShadow
        >
          <cylinderGeometry args={[0.04, 0.04, 0.26, 10]} />
        </mesh>
      ))}
      <RoundedBox args={[0.7, 1.05, barLen]} radius={0.04} position={[left + 0.75, 0.525, barZ]} material={m.screen} castShadow receiveShadow />
      <RoundedBox args={[0.86, 0.06, barLen + 0.06]} radius={0.03} position={[left + 0.8, 1.08, barZ]} material={m.counter} castShadow receiveShadow />
      {Array.from({ length: 7 }, (_, i) => {
        const z = barStart + 0.5 + (i * (barLen - 1)) / 6
        return (
          <group key={i} position={[left + 1.45, 0, z]}>
            <mesh position={[0, 0.38, 0]} material={m.ink} castShadow>
              <cylinderGeometry args={[0.03, 0.05, 0.76, 8]} />
            </mesh>
            <mesh position={[0, 0.78, 0]} material={m.ink} castShadow>
              <cylinderGeometry args={[0.2, 0.2, 0.08, 18]} />
            </mesh>
          </group>
        )
      })}

      {/* Banquette along the right wall, behind the table column */}
      <RoundedBox args={[0.62, 0.44, 8.6]} radius={0.06} position={[ROOM.maxX - 0.42, 0.22, -0.4]} material={m.stone} castShadow receiveShadow />
      <RoundedBox args={[0.18, 0.7, 8.6]} radius={0.06} position={[ROOM.maxX - 0.1, 0.78, -0.4]} material={m.counter} castShadow receiveShadow />

      {/* Pendant globes over the aisle */}
      {[-3.2, -0.6, 2.4].map((z) => (
        <group key={z} position={[0.15, 0, z]}>
          <mesh position={[0, 2.65, 0]} material={m.ink}>
            <cylinderGeometry args={[0.008, 0.008, 0.5, 4]} />
          </mesh>
          <mesh position={[0, 2.25, 0]} material={m.dome}>
            <sphereGeometry args={[0.3, 24, 16]} />
          </mesh>
        </group>
      ))}

      {/* Plants by the windows */}
      <group position={[1.6, 0, far + 0.45]}>
        <mesh position={[0, 0.25, 0]} material={m.stone} castShadow>
          <cylinderGeometry args={[0.22, 0.18, 0.5, 16]} />
        </mesh>
        <mesh position={[0, 0.8, 0]} material={m.leaf} castShadow>
          <icosahedronGeometry args={[0.4, 0]} />
        </mesh>
      </group>
    </group>
  )
})
