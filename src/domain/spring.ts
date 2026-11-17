/**
 * Critically damped spring for one number. It reaches the target without overshoot and its closed
 * form is stable for any step length, so a frame hitch cannot make the head whip. `springStep`
 * mutates the state in place and allocates nothing, so it is safe in `update()`.
 */
export interface SpringState {
  value: number;
  velocity: number;
}

export function createSpring(value = 0): SpringState {
  return { value, velocity: 0 };
}

/**
 * Advance `s` toward `target` by `dtS` seconds. `smoothTimeS` is roughly the time to arrive (the
 * spring's angular frequency is `2 / smoothTimeS`). A non-positive smooth time snaps to the target.
 * A non-finite target or step leaves the state unchanged. Returns the new value.
 */
export function springStep(s: SpringState, target: number, smoothTimeS: number, dtS: number): number {
  if (!Number.isFinite(target) || !Number.isFinite(dtS) || dtS < 0) return s.value;
  if (!(smoothTimeS > 1e-6)) {
    s.value = target;
    s.velocity = 0;
    return s.value;
  }
  const omega = 2 / smoothTimeS;
  const decay = Math.exp(-omega * dtS);
  const offset = s.value - target;
  const temp = (s.velocity + omega * offset) * dtS;
  s.velocity = (s.velocity - omega * temp) * decay;
  s.value = target + (offset + temp) * decay;
  return s.value;
}
