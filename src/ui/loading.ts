/**
 * In-scene loading panel (task 27.1, Requirement 28.1).
 *
 * A small world-space card shown in the session while Capri has not appeared yet: the VRM is still
 * downloading or being prepared, or it failed. It lists the Avatar, the Voice_Library index, and the
 * Vosk voice model with their state, shows the VRM download as a bar when the size is known, and
 * spins a small ring so the user can see something is happening. When the VRM fails it shows the
 * Avatar's own failure line and how to retry. The voice model is reported, never waited on: the panel
 * hides as soon as Capri is in the room, and the voice status chip carries on from there.
 *
 * Placement: about 1 m in front of the head, slightly below eye level, facing the user. It is not
 * head-locked. When the user turns more than `followAngleDeg` away it glides back in front, so an
 * empty room always has the card in view.
 *
 * Cost: the canvas is redrawn only when a load state changed, at most every `redrawIntervalS`. The
 * per-frame work is the placement, the fade, and the spinner turn on class-property numbers, with no
 * allocation. It draws on top of the room (no depth test), like the other display-only overlays.
 */
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  type Entity,
  type World,
} from '@iwsdk/core';
import type { FrameContext } from '../app/frame-context.js';
import type { LoadingSnapshot } from '../app/loading-status.js';
import {
  describeLoading,
  isLoadingPanelVisible,
  type LoadingLineState,
  type LoadingView,
  type VoiceModelSnapshot,
} from '../domain/loading-view.js';

export const LOADING_PANEL = {
  widthM: 0.56,
  distanceM: 1.0,
  dropM: 0.06,
  /** Glide back in front once the panel is this far off the head's horizontal forward. */
  followAngleDeg: 30,
  followSmoothS: 0.35,
  redrawIntervalS: 0.25,
  spinRadPerS: 4,
  fadeS: 0.25,
} as const;

const CANVAS_WIDTH_PX = 640;
const CANVAS_HEIGHT_PX = 400;
const PADDING_PX = 28;
const SPINNER_CENTER_PX = { x: PADDING_PX + 22, y: 54 } as const;
const TITLE_X_PX = PADDING_PX + 58;
const TITLE_FONT = 'bold 38px sans-serif';
const DETAIL_FONT = '27px sans-serif';
const LINE_FONT = '25px sans-serif';
const HINT_FONT = 'italic 23px sans-serif';
const STATE_COLORS: Readonly<Record<LoadingLineState, string>> = {
  pending: '#ffc861',
  done: '#7fe0a8',
  failed: '#ff8f8f',
};
const DEG_TO_RAD = Math.PI / 180;

/** What the panel reads. `LoadingStatus` and `VoiceModelPreload` satisfy these. */
export interface LoadingSources {
  readonly status: { readonly value: LoadingSnapshot; subscribe(listener: () => void): () => void };
  readonly voiceModel: { readonly state: VoiceModelSnapshot; subscribe(listener: () => void): () => void };
  /** True once the Avatar has been placed in the room. */
  readonly isAvatarSpawned: () => boolean;
}

export class LoadingPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly cardMaterial: MeshBasicMaterial;
  private readonly cardGeometry: PlaneGeometry;
  private readonly spinnerMaterial: MeshBasicMaterial;
  private readonly spinnerGeometry: RingGeometry;
  private readonly spinner: Mesh;
  private readonly group = new Group();
  private readonly entity: Entity;
  private readonly unsubscribe: (() => void)[] = [];

  private currentView: LoadingView;
  private dirty = false;
  private sinceRedrawS = 0;
  private shown = false;
  private placed = false;
  /** 0 hidden, 1 fully shown. */
  private level = 0;
  private goalX = 0;
  private goalY = 0;
  private goalZ = 0;
  private readonly cosFollow = Math.cos(LOADING_PANEL.followAngleDeg * DEG_TO_RAD);

  constructor(
    world: World,
    private readonly sources: LoadingSources,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH_PX;
    this.canvas.height = CANVAS_HEIGHT_PX;
    const context = this.canvas.getContext('2d');
    if (context === null) throw new Error('The loading panel could not get a 2D canvas context.');
    this.context = context;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;

    const widthM = LOADING_PANEL.widthM;
    const heightM = (widthM * CANVAS_HEIGHT_PX) / CANVAS_WIDTH_PX;
    this.cardMaterial = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0,
    });
    this.cardGeometry = new PlaneGeometry(widthM, heightM);
    const card = new Mesh(this.cardGeometry, this.cardMaterial);
    card.name = 'capri-loading-card';
    card.renderOrder = 950;
    card.frustumCulled = false;

    const pxToM = widthM / CANVAS_WIDTH_PX;
    this.spinnerMaterial = new MeshBasicMaterial({
      color: '#b9a8ff',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0,
    });
    this.spinnerGeometry = new RingGeometry(12 * pxToM, 18 * pxToM, 24, 1, 0, Math.PI * 1.4);
    this.spinner = new Mesh(this.spinnerGeometry, this.spinnerMaterial);
    this.spinner.name = 'capri-loading-spinner';
    this.spinner.renderOrder = 951;
    this.spinner.frustumCulled = false;
    this.spinner.position.set(
      (SPINNER_CENTER_PX.x - CANVAS_WIDTH_PX / 2) * pxToM,
      (CANVAS_HEIGHT_PX / 2 - SPINNER_CENTER_PX.y) * pxToM,
      0.001,
    );

    this.group.name = 'capri-loading-panel';
    this.group.add(card, this.spinner);
    this.group.visible = false;
    this.entity = world.createTransformEntity(this.group);

    this.currentView = this.describe();
    this.draw(this.currentView);
    const markDirty = (): void => {
      this.dirty = true;
    };
    this.unsubscribe.push(sources.status.subscribe(markDirty), sources.voiceModel.subscribe(markDirty));
  }

  /** True while the panel is meant to be on screen (it may still be fading in). */
  get visible(): boolean {
    return this.shown;
  }

  /** True while any of the card is on screen, its fade-out included. The greeting waits for false. */
  get onScreen(): boolean {
    return this.shown || this.level > 0;
  }

  /** The view last drawn on the card. */
  get view(): LoadingView {
    return this.currentView;
  }

  /** Once per frame, after the avatar presence has run for this frame. */
  update(frame: FrameContext): void {
    const p = frame.head.position;
    const hx = p[0]!;
    const hy = p[1]!;
    const hz = p[2]!;
    // The head sits at the origin until the first XR pose arrives.
    const headKnown = hx !== 0 || hy !== 0 || hz !== 0;
    const want = isLoadingPanelVisible({
      inSession: frame.inSession,
      headKnown,
      avatarSpawned: this.sources.isAvatarSpawned(),
    });
    const dt = Number.isFinite(frame.dt) && frame.dt > 0 ? Math.min(frame.dt, 0.1) : 0;

    if (want !== this.shown) {
      this.shown = want;
      if (want) {
        this.placed = false;
        this.redraw();
      }
    }
    if (!this.shown) {
      if (this.level > 0) {
        this.level = Math.max(0, this.level - dt / LOADING_PANEL.fadeS);
        this.applyLevel();
      }
      if (this.level <= 0) {
        this.group.visible = false;
        this.placed = false;
      }
      return;
    }

    this.sinceRedrawS += dt;
    if (this.dirty && this.sinceRedrawS >= LOADING_PANEL.redrawIntervalS) this.redraw();

    this.follow(frame, hx, hy, hz, dt);
    this.group.visible = true;
    if (this.level < 1) {
      this.level = Math.min(1, this.level + dt / LOADING_PANEL.fadeS);
      this.applyLevel();
    }
    this.spinner.visible = !this.currentView.failed;
    this.spinner.rotation.z -= LOADING_PANEL.spinRadPerS * dt;
  }

  dispose(): void {
    for (const stop of this.unsubscribe) stop();
    this.unsubscribe.length = 0;
    this.entity.dispose();
    this.cardGeometry.dispose();
    this.cardMaterial.dispose();
    this.spinnerGeometry.dispose();
    this.spinnerMaterial.dispose();
    this.texture.dispose();
  }

  // ---- Placement ---------------------------------------------------------------------------

  /** Keep the card in front of the user: re-aim when they turn away, glide there, face the head. */
  private follow(frame: FrameContext, hx: number, hy: number, hz: number, dt: number): void {
    const q = frame.head.orientation;
    const x = q[0]!;
    const y = q[1]!;
    const z = q[2]!;
    const w = q[3]!;
    // The head looks down its local -Z axis. Only the horizontal part is used.
    let fx = -2 * (x * z + w * y);
    let fz = -(1 - 2 * (x * x + y * y));
    const len = Math.hypot(fx, fz);
    if (len < 1e-6) {
      fx = 0;
      fz = -1;
    } else {
      fx /= len;
      fz /= len;
    }
    const pos = this.group.position;
    let retarget = !this.placed;
    if (!retarget) {
      const dx = this.goalX - hx;
      const dz = this.goalZ - hz;
      const d = Math.hypot(dx, dz);
      retarget = d < 1e-6 || (dx * fx + dz * fz) / d < this.cosFollow;
    }
    if (retarget) {
      this.goalX = hx + fx * LOADING_PANEL.distanceM;
      this.goalY = hy - LOADING_PANEL.dropM;
      this.goalZ = hz + fz * LOADING_PANEL.distanceM;
    }
    if (!this.placed) {
      pos.set(this.goalX, this.goalY, this.goalZ);
      this.placed = true;
    } else {
      const k = dt > 0 ? 1 - Math.exp(-dt / LOADING_PANEL.followSmoothS) : 0;
      pos.x += (this.goalX - pos.x) * k;
      pos.y += (this.goalY - pos.y) * k;
      pos.z += (this.goalZ - pos.z) * k;
    }
    // A plane faces +Z, so yaw by atan2(dx, dz) toward the head.
    this.group.rotation.set(0, Math.atan2(hx - pos.x, hz - pos.z), 0);
  }

  private applyLevel(): void {
    this.cardMaterial.opacity = this.level;
    this.spinnerMaterial.opacity = this.level;
  }

  // ---- Drawing -----------------------------------------------------------------------------

  private describe(): LoadingView {
    const snapshot = this.sources.status.value;
    return describeLoading({
      avatar: snapshot.avatar,
      voiceLines: snapshot.voiceLines,
      voiceModel: this.sources.voiceModel.state,
      where: 'scene',
    });
  }

  private redraw(): void {
    this.dirty = false;
    this.sinceRedrawS = 0;
    this.currentView = this.describe();
    this.draw(this.currentView);
  }

  private draw(view: LoadingView): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX);
    ctx.fillStyle = 'rgba(20, 23, 34, 0.94)';
    ctx.strokeStyle = view.failed ? '#ff8f8f' : '#7d65ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(4, 4, CANVAS_WIDTH_PX - 8, CANVAS_HEIGHT_PX - 8, 26);
    ctx.fill();
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (view.failed) {
      // Where the spinner sits while loading: an exclamation badge.
      ctx.fillStyle = '#ff8f8f';
      ctx.beginPath();
      ctx.arc(SPINNER_CENTER_PX.x, SPINNER_CENTER_PX.y, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#141722';
      ctx.font = TITLE_FONT;
      ctx.textAlign = 'center';
      ctx.fillText('!', SPINNER_CENTER_PX.x, SPINNER_CENTER_PX.y + 2);
      ctx.textAlign = 'left';
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = TITLE_FONT;
    ctx.fillText(view.title, TITLE_X_PX, SPINNER_CENTER_PX.y, CANVAS_WIDTH_PX - TITLE_X_PX - PADDING_PX);

    const maxWidth = CANVAS_WIDTH_PX - PADDING_PX * 2;
    let y = 108;
    ctx.fillStyle = '#d9dceb';
    ctx.font = DETAIL_FONT;
    for (const line of this.wrap(view.detail, maxWidth, 2)) {
      ctx.fillText(line, PADDING_PX, y);
      y += 34;
    }

    if (view.avatarFraction !== undefined) {
      const barY = y - 6;
      ctx.fillStyle = '#2c3142';
      ctx.beginPath();
      ctx.roundRect(PADDING_PX, barY, maxWidth, 12, 6);
      ctx.fill();
      ctx.fillStyle = '#7d65ff';
      ctx.beginPath();
      ctx.roundRect(PADDING_PX, barY, Math.max(12, maxWidth * view.avatarFraction), 12, 6);
      ctx.fill();
      y += 22;
    } else {
      y += 6;
    }

    ctx.font = LINE_FONT;
    for (const item of view.lines) {
      ctx.fillStyle = STATE_COLORS[item.state];
      ctx.beginPath();
      ctx.arc(PADDING_PX + 8, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eef0f6';
      for (const line of this.wrap(item.text, maxWidth - 28, 2)) {
        ctx.fillText(line, PADDING_PX + 28, y);
        y += 32;
      }
    }

    if (view.hint !== undefined && y < CANVAS_HEIGHT_PX - 24) {
      ctx.fillStyle = '#b9bdcc';
      ctx.font = HINT_FONT;
      ctx.fillText(view.hint, PADDING_PX, y + 4, maxWidth);
    }
    this.texture.needsUpdate = true;
  }

  /** Greedy word wrap to `maxWidthPx`, at most `maxLines` lines (the last is cut with an ellipsis). */
  private wrap(text: string, maxWidthPx: number, maxLines: number): string[] {
    const words = text.split(/\s+/u).filter((word) => word.length > 0);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (this.context.measureText(candidate).width <= maxWidthPx || line === '') {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line !== '') lines.push(line);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/\s+\S*$/u, '')}…`;
    }
    return lines;
  }
}
