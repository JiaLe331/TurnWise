import { createContext, useContext, type ReactNode } from 'react'
import type { FloorLayout } from './layout'

/**
 * What the floor views draw for the active data source. The live outlet has no floor coordinates,
 * so its layout is generated per zone and labelled illustrative; a source with a real plan (such as
 * the recorded replay, built from camera footage) supplies its own layout, room and viewing angle.
 */
export interface FloorModel {
  /** Fixed table positions; null means generate the illustrative layout from table data. */
  layout: FloorLayout | null
  /** 3D room to draw instead of the generic one. */
  room?: ReactNode
  /** Camera angle around the room, in radians. */
  azimuth?: number
  /** Honest one-line note shown on the floor. */
  note: string
}

export const LIVE_FLOOR: FloorModel = {
  layout: null,
  note: "Illustrative layout. Zones come from table data; positions aren't mapped yet.",
}

const FloorModelContext = createContext<FloorModel>(LIVE_FLOOR)

export function FloorModelProvider({ model, children }: { model: FloorModel; children: ReactNode }) {
  return <FloorModelContext.Provider value={model}>{children}</FloorModelContext.Provider>
}

export function useFloorModel(): FloorModel {
  return useContext(FloorModelContext)
}
