/**
 * Avatar locomotion (task 7.8, Requirements 11.1, 11.8): a smooth-damped glide at up to 0.9 m/s,
 * with a small vertical bob and a forward lean that grow with speed. She floats or glides, so no
 * walk cycle is needed (design: Avatar locomotion).
 *
 * This class holds numbers only (no Three.js), so it runs in Node tests. `AvatarPresence` reads
 * `pose` and applies it to the pivot group: `x, y, z` is the origin (feet, or the contact point for
 * sit and perch), `yawRad` turns the body about Y, `bobM` is added to the height, and `leanRad` tilts
 * forward about the body's X axis (use the `YXZ` Euler order so the lean follows the yaw).
 *
 * `goTo` and `update` allocate nothing: the goal and facing are copied into fields.
 */
import { LOCOMOTION } from '../config/constants.js';
import {
  createGlide,
  glideDistance,
  glideSpeed,
  glideStep,
  resetGlide,
  shortestAngle,
} from '../domain/glide.js';
import type { Vec3 } from '../domain/geometry.js';
import type { HeadPose } from '../domain/placement.js';
import { createSpring, springStep } from '../domain/spring.js';

/** What the presence adapter applies each frame. Fields are rewritten in place. */
export interface BodyPose {
  x: number;
  y: number;
  z: number;
  yawRad: number;
  bobM: number;
  leanRad: number;
}

/** A longer frame (a hitch, a tab switch) is treated as this long so the glide never lunges. */
const MAX_STEP_S = 0.1;

const TWO_PI = Math.PI * 2;

export class Locomotion {
  readonly pose: BodyPose = { x: 0, y: 0, z: 0, yawRad: 0, bobM: 0, leanRad: 0 };

  private readonly glide = createGlide();
  private readonly yawSpring = createSpring();
  private readonly leanSpring = createSpring();
  private goalX = 0;
  private goalY = 0;
  private goalZ = 0;
  private facingYaw = Number.NaN;
  private travelling = false;
  private bobPhase = 0;

  /** True while a glide is in progress. */
  get moving(): boolean {
    return this.travelling;
  }

  /** Current speed in metres per second. */
  get speedMps(): number {
    return this.travelling ? glideSpeed(this.glide) : 0;
  }

  /**
   * Put the body at a position and yaw without moving. The idle placement reports where it put her
   * every frame, so a trip always starts from where she really is. Cancels a trip in progress.
   */
  syncIdle(x: number, y: number, z: number, yawRad: number): void {
    resetGlide(this.glide, x, y, z);
    this.yawSpring.value = yawRad;
    this.yawSpring.velocity = 0;
    this.leanSpring.value = 0;
    this.leanSpring.velocity = 0;
    this.travelling = false;
    this.facingYaw = Number.NaN;
    this.writePose();
  }

  /**
   * Glide to `destination`. With `facing` (an XZ direction) she turns that way on arrival,
   * otherwise she keeps facing the user. A non-finite destination is ignored and returns false.
   */
  goTo(destination: Vec3, facing?: Vec3): boolean {
    const { x, y, z } = destination;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    this.goalX = x;
    this.goalY = y;
    this.goalZ = z;
    this.facingYaw =
      facing !== undefined && (Math.abs(facing.x) > 1e-6 || Math.abs(facing.z) > 1e-6)
        ? Math.atan2(facing.x, facing.z)
        : Number.NaN;
    // The glide keeps the velocity it has, so a new trip starts smoothly from a trip in progress.
    this.travelling = true;
    return true;
  }

  /** Stop where she is. */
  stop(): void {
    this.travelling = false;
    this.glide.x.velocity = 0;
    this.glide.y.velocity = 0;
    this.glide.z.velocity = 0;
  }

  /**
   * Advance one frame. Returns true on the single frame the glide arrives (the position snaps to the
   * goal inside `arriveWithinM`).
   */
  update(dtS: number, head: HeadPose): boolean {
    const cfg = LOCOMOTION;
    const step = Number.isFinite(dtS) && dtS > 0 ? Math.min(dtS, MAX_STEP_S) : 0;
    let arrived = false;

    if (this.travelling) {
      glideStep(this.glide, this.goalX, this.goalY, this.goalZ, cfg.glideSmoothTimeS, cfg.maxSpeedMps, step);
      if (glideDistance(this.glide, this.goalX, this.goalY, this.goalZ) < cfg.arriveWithinM) {
        resetGlide(this.glide, this.goalX, this.goalY, this.goalZ);
        this.travelling = false;
        arrived = true;
      }
    }

    // Bob and lean grow with the fraction of top speed. Both fade to zero when she stops.
    const speedFrac = this.travelling ? Math.min(1, glideSpeed(this.glide) / cfg.maxSpeedMps) : 0;
    this.bobPhase = (this.bobPhase + step * cfg.bobHz * TWO_PI * speedFrac) % TWO_PI;
    springStep(this.leanSpring, cfg.leanMaxRad * speedFrac, cfg.leanSmoothTimeS, step);

    // Face the user while she moves or idles. After a sit or perch trip she keeps the facing it set.
    const goalYaw =
      !this.travelling && !Number.isNaN(this.facingYaw)
        ? this.facingYaw
        : Math.atan2(head.position.x - this.glide.x.value, head.position.z - this.glide.z.value);
    const yawTarget = this.yawSpring.value + shortestAngle(this.yawSpring.value, goalYaw);
    springStep(this.yawSpring, yawTarget, cfg.yawSmoothTimeS, step);

    this.writePose(cfg.bobAmplitudeM * speedFrac * Math.sin(this.bobPhase));
    return arrived;
  }

  private writePose(bobM = 0): void {
    const p = this.pose;
    p.x = this.glide.x.value;
    p.y = this.glide.y.value;
    p.z = this.glide.z.value;
    p.yawRad = this.yawSpring.value;
    p.bobM = bobM;
    p.leanRad = this.leanSpring.value;
  }
}
