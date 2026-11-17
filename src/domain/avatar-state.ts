/**
 * Avatar state machine (task 7.8, design: Avatar state machine). Pure: no clock, no Three.js.
 *
 * Modes: idle, moving, perched, sitting, acting, away.
 *
 * - A move request starts `moving` with a purpose that says where the trip ends:
 *     home  -> idle, handed back to the idle placement rules (come_here)
 *     float -> idle, but anchored where she was told to go (move_to)
 *     perch -> perched
 *     sit   -> sitting
 *     away  -> away
 *   A new move is accepted from idle, moving, perched, sitting, and away. It is refused while acting.
 * - `beginAction` enters `acting` from idle, perched, sitting, or away, and `endAction` returns to the
 *   mode she was in. It is refused while moving or already acting.
 * - `driving` is true when the Avatar controller, not the idle placement, owns her position: any
 *   mode but idle, or idle while anchored.
 */
export type AvatarMode = 'idle' | 'moving' | 'perched' | 'sitting' | 'acting' | 'away';

export type MovePurpose = 'home' | 'float' | 'perch' | 'sit' | 'away';

/** Modes she can return to after an action. */
type RestMode = 'idle' | 'perched' | 'sitting' | 'away';

const ARRIVAL_MODE: Readonly<Record<MovePurpose, RestMode>> = {
  home: 'idle',
  float: 'idle',
  perch: 'perched',
  sit: 'sitting',
  away: 'away',
};

export class AvatarStateMachine {
  private modeNow: AvatarMode = 'idle';
  private purposeNow: MovePurpose | null = null;
  private anchoredNow = false;
  private resume: RestMode = 'idle';

  get mode(): AvatarMode {
    return this.modeNow;
  }

  /** The purpose of the trip in progress, or null when not moving. */
  get purpose(): MovePurpose | null {
    return this.purposeNow;
  }

  /** True when she is idle but held where she was sent, so the idle follow rules stay off. */
  get anchored(): boolean {
    return this.anchoredNow;
  }

  /** True when the controller owns her position (see the class comment). */
  get driving(): boolean {
    return this.modeNow !== 'idle' || this.anchoredNow;
  }

  /** Start a trip. Returns false (and changes nothing) while acting. */
  requestMove(purpose: MovePurpose): boolean {
    if (this.modeNow === 'acting') return false;
    this.modeNow = 'moving';
    this.purposeNow = purpose;
    return true;
  }

  /** The trip ended. Returns the new mode. Does nothing unless moving. */
  arrive(): AvatarMode {
    if (this.modeNow !== 'moving' || this.purposeNow === null) return this.modeNow;
    const purpose = this.purposeNow;
    this.modeNow = ARRIVAL_MODE[purpose];
    this.purposeNow = null;
    this.anchoredNow = purpose === 'float';
    return this.modeNow;
  }

  /** Enter `acting`. Returns false while moving or already acting. */
  beginAction(): boolean {
    if (this.modeNow === 'moving' || this.modeNow === 'acting') return false;
    this.resume = this.modeNow;
    this.modeNow = 'acting';
    return true;
  }

  /** Leave `acting` for the mode she was in. Does nothing unless acting. */
  endAction(): void {
    if (this.modeNow !== 'acting') return;
    this.modeNow = this.resume;
  }

  /** Back to the unanchored idle (session ended or a new session started). */
  reset(): void {
    this.modeNow = 'idle';
    this.purposeNow = null;
    this.anchoredNow = false;
    this.resume = 'idle';
  }
}
