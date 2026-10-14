import { RoundedBox } from '@react-three/drei'
import { memo } from 'react'
import type { FloorLayout, ZoneBox } from './layout'
import { materials } from './materials'

type Mat = ReturnType<typeof materials>[keyof ReturnType<typeof materials>]

function Box({ size, at, mat, rotation }: { size: [number, number, number]; at: [number, number, number]; mat: Mat; rotation?: [number, number, number] }) {
  return (
    <mesh position={at} rotation={rotation} material={mat} castShadow receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  )
}

function Plant({ x, z, scale = 1 }: { x: number; z: number; scale?: number }) {
  const m = materials()
  return (
    <group position={[x, 0, z]} scale={scale}>
      <mesh position={[0, 0.25, 0]} material={m.stone} castShadow receiveShadow>
        <cylinderGeometry args={[0.28, 0.22, 0.5, 20]} />
      </mesh>
      <mesh position={[0, 0.85, 0]} material={m.leaf} castShadow>
        <icosahedronGeometry args={[0.5, 0]} />
      </mesh>
      <mesh position={[0.18, 1.2, -0.1]} material={m.leafDark} castShadow>
        <icosahedronGeometry args={[0.34, 0]} />
      </mesh>
    </group>
  )
}

function IndoorZone({ zone, first }: { zone: ZoneBox; first: boolean }) {
  const m = materials()
  const w = zone.maxX - zone.minX
  const d = zone.maxZ - zone.minZ
  const cx = (zone.minX + zone.maxX) / 2
  const back = zone.minZ
  const windows = Math.max(1, Math.floor(w / 3.6))

  return (
    <group>
      <Box size={[w, 0.5, d]} at={[cx, -0.25, 0]} mat={m.terrazzo} />
      {/* Cutaway back wall with windows */}
      <Box size={[w, 2.7, 0.24]} at={[cx, 1.35, back - 0.12]} mat={m.plaster} />
      {Array.from({ length: windows }, (_, i) => {
        const x = zone.minX + (w / windows) * (i + 0.5)
        return (
          <group key={i}>
            <Box size={[2.1, 1.3, 0.04]} at={[x, 1.6, back + 0.02]} mat={m.window} />
            <Box size={[2.1, 0.06, 0.12]} at={[x, 0.92, back + 0.05]} mat={m.ink} />
          </group>
        )
      })}
      {/* Banquette along the back wall */}
      <RoundedBox args={[w - 2.6, 0.42, 0.72]} radius={0.06} position={[cx + 0.4, 0.21, back + 0.5]} material={m.sage} castShadow receiveShadow />
      <RoundedBox args={[w - 2.6, 0.62, 0.2]} radius={0.06} position={[cx + 0.4, 0.72, back + 0.22]} material={m.sageDark} castShadow receiveShadow />
      {first ? (
        <>
          {/* Side wall, bar and host stand belong to the room you enter. */}
          <Box size={[0.24, 2.7, d]} at={[zone.minX - 0.12, 1.35, 0]} mat={m.plaster} />
          <RoundedBox args={[0.8, 1.05, d * 0.42]} radius={0.04} position={[zone.minX + 0.55, 0.525, d * 0.12]} material={m.screen} castShadow receiveShadow />
          <RoundedBox args={[1.0, 0.07, d * 0.44]} radius={0.03} position={[zone.minX + 0.6, 1.08, d * 0.12]} material={m.counter} castShadow receiveShadow />
          {Array.from({ length: 4 }, (_, i) => {
            const z = d * 0.12 - d * 0.16 + (d * 0.32 * i) / 3
            return (
              <group key={i} position={[zone.minX + 1.3, 0, z]}>
                <mesh position={[0, 0.78, 0]} material={m.oak} castShadow>
                  <cylinderGeometry args={[0.2, 0.2, 0.07, 24]} />
                </mesh>
                <mesh position={[0, 0.38, 0]} material={m.ink} castShadow>
                  <cylinderGeometry args={[0.03, 0.03, 0.75, 8]} />
                </mesh>
              </group>
            )
          })}
          <Box size={[0.3, 0.04, d * 0.34]} at={[zone.minX + 0.18, 1.39, d * 0.12]} mat={m.ink} />
          {Array.from({ length: 9 }, (_, i) => (
            <mesh key={i} position={[zone.minX + 0.18, 1.56, d * 0.12 - d * 0.15 + (d * 0.3 * i) / 8]} material={i % 3 ? m.bottleGreen : m.bottleAmber} castShadow>
              <cylinderGeometry args={[0.05, 0.05, 0.3, 10]} />
            </mesh>
          ))}
          <group position={[zone.maxX - 1.0, 0, zone.maxZ - 0.75]}>
            <RoundedBox args={[0.95, 1.12, 0.55]} radius={0.05} position={[0, 0.56, 0]} material={m.screen} castShadow receiveShadow />
            <RoundedBox args={[1.05, 0.06, 0.62]} radius={0.03} position={[0, 1.15, 0]} material={m.counter} castShadow />
            <Box size={[0.42, 0.28, 0.03]} at={[0, 1.32, -0.1]} rotation={[-0.35, 0, 0]} mat={m.ink} />
          </group>
          <Plant x={zone.minX + 0.6} z={back + 0.6} scale={1.1} />
        </>
      ) : null}
      <Plant x={zone.maxX - 0.6} z={back + 0.6} scale={0.9} />
    </group>
  )
}

function OutdoorZone({ zone }: { zone: ZoneBox }) {
  const m = materials()
  const w = zone.maxX - zone.minX
  const d = zone.maxZ - zone.minZ
  const cx = (zone.minX + zone.maxX) / 2
  const slats = Math.floor(w / 0.5)
  const planters = Math.max(2, Math.round(d / 2.8))

  return (
    <group>
      <Box size={[w, 0.42, d]} at={[cx, -0.21, 0]} mat={m.deck} />
      {Array.from({ length: slats }, (_, i) => (
        <Box key={i} size={[0.035, 0.012, d]} at={[zone.minX + 0.25 + i * 0.5, 0.006, 0]} mat={m.deckLine} />
      ))}
      {Array.from({ length: planters }, (_, i) => {
        const z = zone.minZ + (d / planters) * (i + 0.5)
        return (
          <group key={i} position={[zone.maxX - 0.45, 0, z]}>
            <RoundedBox args={[0.7, 0.55, d / planters - 0.6]} radius={0.05} position={[0, 0.275, 0]} material={m.stone} castShadow receiveShadow />
            {[-1, 0, 1].map((k) => (
              <mesh key={k} position={[0, 0.75, k * 0.55]} material={m.leaf} castShadow>
                <icosahedronGeometry args={[0.34, 0]} />
              </mesh>
            ))}
          </group>
        )
      })}
      {/* Pergola along the back edge */}
      <Box size={[0.16, 2.8, 0.16]} at={[zone.minX + 0.3, 1.4, zone.minZ + 0.2]} mat={m.ink} />
      <Box size={[0.16, 2.8, 0.16]} at={[zone.maxX - 0.2, 1.4, zone.minZ + 0.2]} mat={m.ink} />
      <Box size={[w - 0.3, 0.14, 0.14]} at={[cx + 0.05, 2.8, zone.minZ + 0.2]} mat={m.ink} />
      {Array.from({ length: Math.floor(w / 0.8) }, (_, i) => (
        <Box key={i} size={[0.08, 0.1, 1.6]} at={[zone.minX + 0.5 + i * 0.8, 2.84, zone.minZ + 0.9]} mat={m.ink} />
      ))}
    </group>
  )
}

function Partition({ x, d }: { x: number; d: number }) {
  const m = materials()
  const length = d * 0.6
  const z0 = -d / 2
  return (
    <group>
      <Box size={[0.05, 2.2, length]} at={[x, 1.1, z0 + length / 2]} mat={m.glass} />
      {[0, 1 / 3, 2 / 3, 1].map((f) => (
        <Box key={f} size={[0.08, 2.2, 0.08]} at={[x, 1.1, z0 + f * length]} mat={m.ink} />
      ))}
      <Box size={[0.08, 0.08, length]} at={[x, 2.2, z0 + length / 2]} mat={m.ink} />
    </group>
  )
}

/** Static architecture around the tables. Re-renders only when the set of zones changes. */
export const Room = memo(function Room({ layout }: { layout: FloorLayout }) {
  const m = materials()
  const { bounds, zones } = layout
  const w = bounds.maxX - bounds.minX
  const d = bounds.maxZ - bounds.minZ
  return (
    <group>
      {/* Plinth: the model sits on a base, which reads as a representation, not a camera view. */}
      <Box size={[w + 0.6, 0.35, d + 0.6]} at={[(bounds.minX + bounds.maxX) / 2, -0.62, 0]} mat={m.plinth} />
      {zones.map((zone, i) =>
        zone.outdoor ? <OutdoorZone key={zone.name} zone={zone} /> : <IndoorZone key={zone.name} zone={zone} first={i === 0} />,
      )}
      {zones.slice(1).map((zone) => (
        <Partition key={`p-${zone.name}`} x={zone.minX} d={d} />
      ))}
    </group>
  )
})
