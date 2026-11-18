/**
 * When the optional idle base pose (the retargeted idle clip, task 31.2, Requirement 32) may play.
 * Pure: no clock, no Three.js.
 *
 * The base pose replaces the procedural rest pose and breathing only while she is free and still.
 * Every other state keeps the procedural pose, so sitting, perching, acting, gliding, and every
 * gesture look exactly as they do without clips (Requirement 32.6).
 */
import type { GestureId, PostureId } from './animation-types.js';
import type { AvatarMode } from './avatar-state.js';

/**
 * True in the modes where the idle base pose may play: `idle` (anchored or not) and `away`, and only
 * while the idle follow glide is not moving her. False while moving, acting, sitting, or perched.
 */
export function idleBaseAllowedInMode(mode: AvatarMode, following: boolean): boolean {
  return (mode === 'idle' || mode === 'away') && !following;
}

/**
 * Target weight of the idle base pose: 1 when the mode allows it, no posture is held, and no gesture
 * plays other than `glance` (a head-and-eyes look with a small tilt that sits well on top of it).
 * Otherwise 0. The animator eases its weight toward this value, so the change is a cross-fade.
 */
export function idleBaseGoal(allowed: boolean, gesture: GestureId, posture: PostureId | 'none'): 0 | 1 {
  return allowed && posture === 'none' && (gesture === 'none' || gesture === 'glance') ? 1 : 0;
}
