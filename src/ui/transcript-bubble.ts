/**
 * Transcript_Bubble (task 33.6, Requirements 33.24 to 33.28): one small bubble above Capri that
 * replaces the floating mic orb and the large Transcript_Panel.
 *
 * It looks unlike her Speech_Bubble on purpose: a dark pill with a coloured outline and a mic glyph,
 * no tail, smaller (`TRANSCRIPT_BUBBLE.widthM`). Her bubble is white with a pink outline and a tail.
 *
 * - `listening`: "Listening" and a row of bars whose height follows the microphone level (with a
 *   small idle pulse, so it moves in silence too). The bars are meshes scaled in place, so the
 *   level animation never redraws the canvas.
 * - `partial`: the live words in italics (the newest words win when they do not fit).
 * - `final`: the final words, bold, then the model hides it.
 * - `notice`: the failure reason ("Mic not allowed", "Voice loading") with an amber outline.
 *
 * Placement: `stackTranscriptBubble` (pure) puts it at its own spot above Capri, or above her
 * Speech_Bubble when the two would overlap, or hides it while she speaks if the stack would be too
 * high. It slides to a new spot and turns toward the head about +Y like the Speech_Bubble.
 *
 * The canvas is redrawn only when the model's revision changes. `update` writes numbers only, so a
 * frame allocates nothing. Unlit `MeshBasicMaterial` throughout. `dispose()` frees everything.
 */
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Entity,
  type World,
} from '@iwsdk/core';
import { SPEECH_BUBBLE, TRANSCRIPT_BUBBLE } from '../config/constants.js';
import {
  stackTranscriptBubble,
  type BubbleRect,
  type BubbleSize,
  type MutableStackPlacement,
} from '../domain/bubble-stack.js';
import type { Vec3 } from '../domain/geometry.js';
import { billboardYaw } from '../domain/ui-placement.js';
import type { TranscriptBubbleKind, TranscriptBubbleModel, TranscriptBubbleView } from '../domain/voice-ui-model.js';

const CANVAS_WIDTH_PX = 512;
const CANVAS_HEIGHT_PX = 144;
const TEXT_LEFT_PX = 96;
const TEXT_RIGHT_PAD_PX = 34;
const LINE_HEIGHT_PX = 46;
const FONT_PX = 40;
const POP_SCALE_FROM = 0.85;
const MIN_BAR_SCALE = 0.12;

const ACCENT: Readonly<Record<TranscriptBubbleKind, string>> = {
  hidden: '#3dd6c8',
  listening: '#3dd6c8',
  partial: '#3dd6c8',
  final: '#8be0a8',
  notice: '#f0b429',
};
const BAR_COLOR = 0x3dd6c8;

/** The bubble's size, for stacking. */
export const TRANSCRIPT_BUBBLE_SIZE: BubbleSize = {
  halfWidthM: TRANSCRIPT_BUBBLE.widthM / 2,
  halfHeightM: (TRANSCRIPT_BUBBLE.widthM * CANVAS_HEIGHT_PX) / CANVAS_WIDTH_PX / 2,
};

export class TranscriptBubble {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly bodyMaterial: MeshBasicMaterial;
  private readonly bodyGeometry: PlaneGeometry;
  private readonly barMaterial: MeshBasicMaterial;
  private readonly barGeometry: PlaneGeometry;
  private readonly bars: Mesh[] = [];
  private readonly barGroup = new Group();
  private readonly root = new Group();
  private readonly entity: Entity;
  private readonly placement: MutableStackPlacement = { kind: 'alone', x: 0, y: 0, z: 0 };
  private drawnRevision = -1;
  private drawnKind: TranscriptBubbleKind = 'hidden';
  /** 0 hidden, 1 fully shown. */
  private fade = 0;
  private shownLevel = 0;

  constructor(world: World) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH_PX;
    this.canvas.height = CANVAS_HEIGHT_PX;
    const context = this.canvas.getContext('2d');
    if (context === null) throw new Error('The transcript bubble could not get a 2D canvas context.');
    this.context = context;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.bodyMaterial = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, opacity: 0 });
    this.bodyGeometry = new PlaneGeometry(TRANSCRIPT_BUBBLE_SIZE.halfWidthM * 2, TRANSCRIPT_BUBBLE_SIZE.halfHeightM * 2);
    const body = new Mesh(this.bodyGeometry, this.bodyMaterial);
    body.name = 'capri-transcript-bubble-body';
    body.renderOrder = 905;
    body.frustumCulled = false;

    const b = TRANSCRIPT_BUBBLE.bars;
    this.barGeometry = new PlaneGeometry(b.widthM, b.maxHeightM);
    this.barMaterial = new MeshBasicMaterial({ color: BAR_COLOR, transparent: true, depthWrite: false, opacity: 0 });
    for (let i = 0; i < b.count; i += 1) {
      const bar = new Mesh(this.barGeometry, this.barMaterial);
      bar.name = `capri-transcript-bubble-bar-${i}`;
      bar.renderOrder = 906;
      bar.frustumCulled = false;
      bar.position.set(b.centerXM + (i - (b.count - 1) / 2) * b.spacingM, 0, 0.001);
      bar.scale.y = MIN_BAR_SCALE;
      this.bars.push(bar);
      this.barGroup.add(bar);
    }
    this.barGroup.visible = false;

    this.root.name = 'capri-transcript-bubble';
    this.root.add(body, this.barGroup);
    this.root.visible = false;
    this.root.frustumCulled = false;
    this.entity = world.createTransformEntity(this.root);
  }

  /** True while any part of the bubble is drawn (fading out included). */
  get visible(): boolean {
    return this.root.visible;
  }

  /** The kind last drawn on the canvas. */
  get kind(): TranscriptBubbleKind {
    return this.drawnKind;
  }

  /** World centre of the bubble. Read only. */
  get position(): Vec3 {
    return this.root.position;
  }

  /**
   * Per frame, in session. `anchor` is the bubble's own spot (above Capri, or in front of the head
   * before she has appeared), `speech` her Speech_Bubble while drawn, `headY` the eye height for
   * the stacking ceiling.
   */
  update(
    model: TranscriptBubbleModel,
    dt: number,
    timeS: number,
    anchor: Vec3,
    speech: BubbleRect | undefined,
    headX: number,
    headY: number,
    headZ: number,
  ): void {
    const view = model.view;
    if (model.revision !== this.drawnRevision) {
      this.drawnRevision = model.revision;
      if (view.kind !== 'hidden') this.draw(view);
    }
    const place = stackTranscriptBubble(
      anchor,
      TRANSCRIPT_BUBBLE_SIZE,
      speech,
      { gapM: TRANSCRIPT_BUBBLE.stackGapM, maxCenterY: headY + TRANSCRIPT_BUBBLE.maxAboveHeadM },
      this.placement,
    );
    const wanted = view.kind !== 'hidden' && place.kind !== 'replaced';
    const root = this.root;
    if (wanted) {
      const target = Math.atan2(headX - place.x, headZ - place.z);
      if (!root.visible) {
        root.position.set(place.x, place.y, place.z);
        root.rotation.set(0, target, 0);
        root.visible = true;
        this.fade = 0;
        this.shownLevel = 0;
      } else {
        const k = 1 - Math.exp(-TRANSCRIPT_BUBBLE.followRatePerS * Math.max(0, dt));
        root.position.x += (place.x - root.position.x) * k;
        root.position.y += (place.y - root.position.y) * k;
        root.position.z += (place.z - root.position.z) * k;
        const yawTarget = Math.atan2(headX - root.position.x, headZ - root.position.z);
        root.rotation.y = billboardYaw(root.rotation.y, yawTarget, dt, SPEECH_BUBBLE.turnRadPerS, 0);
      }
      if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / SPEECH_BUBBLE.fadeInS);
    } else if (root.visible) {
      this.fade = Math.max(0, this.fade - dt / SPEECH_BUBBLE.fadeOutS);
      if (this.fade <= 0) root.visible = false;
    }
    if (!root.visible) return;
    this.bodyMaterial.opacity = this.fade;
    this.barMaterial.opacity = this.fade;
    root.scale.setScalar(POP_SCALE_FROM + (1 - POP_SCALE_FROM) * this.fade);
    this.updateBars(wanted && view.kind === 'listening', model.level, dt, timeS);
  }

  /** Hide at once (the session ended). */
  hide(): void {
    this.root.visible = false;
    this.fade = 0;
    this.barGroup.visible = false;
  }

  dispose(): void {
    this.entity.dispose();
    this.bodyGeometry.dispose();
    this.barGeometry.dispose();
    this.bodyMaterial.dispose();
    this.barMaterial.dispose();
    this.texture.dispose();
  }

  private updateBars(listening: boolean, level: number, dt: number, timeS: number): void {
    this.barGroup.visible = listening;
    if (!listening) return;
    const l = TRANSCRIPT_BUBBLE.level;
    const rate = level > this.shownLevel ? l.attackPerS : l.releasePerS;
    this.shownLevel += (level - this.shownLevel) * (1 - Math.exp(-rate * Math.max(0, dt)));
    const idle = TRANSCRIPT_BUBBLE.bars.idleAmount;
    const mid = (this.bars.length - 1) / 2;
    for (let i = 0; i < this.bars.length; i += 1) {
      const wave = 0.5 + 0.5 * Math.sin(timeS * 7 + i * 1.3);
      // The middle bars reach higher, like a voice meter.
      const shape = 1 - (Math.abs(i - mid) / (mid + 1)) * 0.5;
      const h = idle * (0.6 + 0.4 * wave) + (1 - idle) * this.shownLevel * shape * (0.55 + 0.45 * wave);
      this.bars[i]!.scale.y = Math.max(MIN_BAR_SCALE, Math.min(1, h));
    }
  }

  private draw(view: TranscriptBubbleView): void {
    this.drawnKind = view.kind;
    const c = this.context;
    const accent = ACCENT[view.kind];
    c.clearRect(0, 0, CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX);
    c.fillStyle = 'rgba(16, 20, 28, 0.9)';
    c.strokeStyle = accent;
    c.lineWidth = 5;
    c.beginPath();
    c.roundRect(4, 4, CANVAS_WIDTH_PX - 8, CANVAS_HEIGHT_PX - 8, (CANVAS_HEIGHT_PX - 8) / 2);
    c.fill();
    c.stroke();
    this.drawMic(accent);

    let font = `bold ${FONT_PX}px sans-serif`;
    let color = '#fafaf7';
    let text = view.text;
    if (view.kind === 'listening') {
      text = 'Listening';
      color = '#e8fbf8';
    } else if (view.kind === 'partial') {
      font = `italic ${FONT_PX}px sans-serif`;
      color = '#cfd6e2';
    } else if (view.kind === 'notice') {
      color = '#ffe2a8';
    }
    c.font = font;
    c.fillStyle = color;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    const maxWidth = CANVAS_WIDTH_PX - TEXT_LEFT_PX - TEXT_RIGHT_PAD_PX;
    const lines = view.kind === 'partial' ? this.wrapTail(text, maxWidth) : this.wrapHead(text, maxWidth);
    const top = CANVAS_HEIGHT_PX / 2 - ((lines.length - 1) * LINE_HEIGHT_PX) / 2;
    for (let i = 0; i < lines.length; i += 1) c.fillText(lines[i]!, TEXT_LEFT_PX, top + i * LINE_HEIGHT_PX);
    this.texture.needsUpdate = true;
  }

  /** A small microphone: capsule, cradle, and stem. */
  private drawMic(accent: string): void {
    const c = this.context;
    const cx = 56;
    const cy = CANVAS_HEIGHT_PX / 2;
    c.fillStyle = accent;
    c.beginPath();
    c.roundRect(cx - 10, cy - 30, 20, 38, 10);
    c.fill();
    c.strokeStyle = accent;
    c.lineWidth = 4;
    c.beginPath();
    c.arc(cx, cy - 6, 18, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
    c.beginPath();
    c.moveTo(cx, cy + 12);
    c.lineTo(cx, cy + 26);
    c.moveTo(cx - 10, cy + 26);
    c.lineTo(cx + 10, cy + 26);
    c.stroke();
  }

  /** At most two lines from the start, the second cut with "..." when the text is longer. */
  private wrapHead(text: string, maxWidthPx: number): string[] {
    const words = text.split(/\s+/u).filter((w) => w.length > 0);
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
    if (lines.length > 2) {
      lines.length = 2;
      lines[1] = `${lines[1]!.replace(/\s+\S*$/u, '')}...`;
    }
    return lines;
  }

  /** At most two lines ending with the newest words, starting with "..." when earlier words are cut. */
  private wrapTail(text: string, maxWidthPx: number): string[] {
    const words = text.split(/\s+/u).filter((w) => w.length > 0);
    const lines: string[] = [];
    let line = '';
    let i = words.length - 1;
    for (; i >= 0; i -= 1) {
      const word = words[i]!;
      const candidate = line === '' ? word : `${word} ${line}`;
      if (this.context.measureText(candidate).width <= maxWidthPx || line === '') {
        line = candidate;
      } else {
        lines.unshift(line);
        line = word;
        if (lines.length === 2) break;
      }
    }
    if (lines.length < 2 && line !== '') {
      lines.unshift(line);
    } else if (lines.length === 2) {
      lines[0] = `...${lines[0]!}`;
    }
    return lines;
  }
}
