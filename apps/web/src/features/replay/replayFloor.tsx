import { MIXKIT_AZIMUTH, MIXKIT_LAYOUT, MixkitRoom } from '@/features/demo/mixkitFloor'
import type { FloorModel } from '@/features/floor-scene/floorModel'

/** The replay's floor: the dining room in the footage, with tables where the camera sees them. */
export const REPLAY_FLOOR: FloorModel = {
  layout: MIXKIT_LAYOUT,
  room: <MixkitRoom />,
  azimuth: MIXKIT_AZIMUTH,
}

/** Who acts in each view during a replay, matching the autopilot's people. */
export const REPLAY_PERSONA = { host: 'host-1', staff: 'staff-ana', manager: 'manager-1' } as const
