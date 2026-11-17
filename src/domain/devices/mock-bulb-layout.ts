/**
 * Where the three Mock Mode bulbs hang (task 17.4, Requirements 12.9, 23.3). Pure: plain `{ x, y, z }`
 * metres, no Three.js. Each bulb sits at a fixed yaw, distance, and height relative to the head
 * when the session starts, so a seated user sees all three without turning.
 *
 * Handedness matches `idleHome`: positive yaw turns toward the user's right.
 */
import { MOCK_BULB_LAYOUT } from '../../config/constants.js';
import { DEG_TO_RAD, type Vec3 } from '../geometry.js';
import { horizontalForward, type HeadPose } from '../placement.js';

export interface MockBulbPlacement {
  /** The mock light's entity id, for example `mock.bulb_1`. */
  readonly entityId: string;
  /** Spoken name, for example "desk lamp". */
  readonly name: string;
  readonly position: Vec3;
}

/**
 * Positions for every bulb in `MOCK_BULB_LAYOUT`, in layout order. With a known `floorY` no bulb is
 * placed lower than `minAboveFloorM` above it.
 */
export function layoutMockBulbs(head: HeadPose, floorY?: number): MockBulbPlacement[] {
  const f = horizontalForward(head.forward);
  const rightX = -f.z;
  const rightZ = f.x;
  return MOCK_BULB_LAYOUT.bulbs.map((bulb) => {
    const yaw = bulb.yawDeg * DEG_TO_RAD;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    let y = head.position.y + bulb.heightOffsetM;
    if (floorY !== undefined) y = Math.max(y, floorY + MOCK_BULB_LAYOUT.minAboveFloorM);
    return {
      entityId: bulb.entityId,
      name: bulb.name,
      position: {
        x: head.position.x + bulb.distanceM * (f.x * cos + rightX * sin),
        y,
        z: head.position.z + bulb.distanceM * (f.z * cos + rightZ * sin),
      },
    };
  });
}
