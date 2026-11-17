/**
 * Speech bubble (tasks 5.11 and 13.23, Requirements 16.10, 16.14). One line of text on a small
 * world-space quad with a tail that points down at the speaker. It is the visible half of tier 3
 * speech: `AudioEngine` shows it for every line and plays the chirp (`audio/sfx-synth.ts`) for text
 * that has no library audio, so a line is never spoken that the user cannot read.
 *
 * - `show(text, position, facing)` pops the bubble in (a short scale and fade) and turns it toward
 *   `facing`. `hide()` fades it out. A new `show` while one is up replaces the text at once.
 * - `update(dt, headX, headZ)` runs once per frame while the bubble is up: it plays the fade and
 *   keeps the bubble facing the head, turning at most `SPEECH_BUBBLE.turnRadPerS`. Without `update`
 *   the bubble stays at its first frame, so the system calls it every frame.
 *
 * The canvas is redrawn only inside `show`, never per frame, and `update` allocates nothing.
 */
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Entity,
  type World,
} from '@iwsdk/core';
import { SPEECH_BUBBLE } from '../config/constants.js';
import type { Vec3 } from '../domain/geometry.js';
import { billboardYaw } from '../domain/ui-placement.js';

const CANVAS_WIDTH_PX = 512;
const CANVAS_HEIGHT_PX = 224;
/** The rounded body ends here. The tail fills the rest of the canvas. */
const BODY_HEIGHT_PX = 192;
const TAIL_HALF_WIDTH_PX = 22;
const PADDING_PX = 24;
const FONT = 'bold 34px sans-serif';
const LINE_HEIGHT_PX = 44;
const POP_SCALE_FROM = 0.85;

export class SpeechBubble {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly geometry: PlaneGeometry;
  private readonly mesh: Mesh;
  private readonly entity: Entity;
  private shown = false;
  private currentText = '';
  /** 0 hidden, 1 fully shown. Moves toward 1 while shown and toward 0 while hiding. */
  private level = 0;

  constructor(world: World, widthM: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH_PX;
    this.canvas.height = CANVAS_HEIGHT_PX;
    const context = this.canvas.getContext('2d');
    if (context === null) throw new Error('The speech bubble could not get a 2D canvas context.');
    this.context = context;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, opacity: 0 });
    this.geometry = new PlaneGeometry(widthM, (widthM * CANVAS_HEIGHT_PX) / CANVAS_WIDTH_PX);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'capri-speech-bubble';
    this.mesh.renderOrder = 900;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.entity = world.createTransformEntity(this.mesh);
  }

  get visible(): boolean {
    return this.shown;
  }

  get text(): string {
    return this.currentText;
  }

  /** Show `text` at `position`, turned to face `facing` (yaw only). */
  show(text: string, position: Vec3, facing: Vec3): void {
    const wasUp = this.mesh.visible && this.shown;
    this.currentText = text;
    this.draw(text);
    this.mesh.position.set(position.x, position.y, position.z);
    // A plane faces +Z, so yaw by atan2(dx, dz) toward the point it should face.
    this.mesh.rotation.set(0, Math.atan2(facing.x - position.x, facing.z - position.z), 0);
    this.mesh.visible = true;
    this.shown = true;
    if (!wasUp) {
      this.level = 0;
      this.apply();
    }
  }

  /** Start the fade-out. The quad hides when the fade ends, in `update`. */
  hide(): void {
    this.shown = false;
  }

  /** Per frame: fade in or out, and turn toward the head. */
  update(dt: number, headX: number, headZ: number): void {
    if (!this.mesh.visible) return;
    if (this.shown) {
      if (this.level < 1) {
        this.level = Math.min(1, this.level + dt / SPEECH_BUBBLE.fadeInS);
        this.apply();
      }
      const target = Math.atan2(headX - this.mesh.position.x, headZ - this.mesh.position.z);
      this.mesh.rotation.y = billboardYaw(this.mesh.rotation.y, target, dt, SPEECH_BUBBLE.turnRadPerS, 0);
      return;
    }
    this.level = Math.max(0, this.level - dt / SPEECH_BUBBLE.fadeOutS);
    this.apply();
    if (this.level <= 0) this.mesh.visible = false;
  }

  dispose(): void {
    this.entity.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  private apply(): void {
    this.material.opacity = this.level;
    this.mesh.scale.setScalar(POP_SCALE_FROM + (1 - POP_SCALE_FROM) * this.level);
  }

  private draw(text: string): void {
    const context = this.context;
    context.clearRect(0, 0, CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX);
    context.fillStyle = 'rgba(250, 250, 247, 0.96)';
    context.strokeStyle = '#d6246e';
    context.lineWidth = 6;
    context.beginPath();
    context.roundRect(4, 4, CANVAS_WIDTH_PX - 8, BODY_HEIGHT_PX - 8, 28);
    context.fill();
    context.stroke();
    // The tail: a triangle under the body, pointing down at the speaker.
    const mid = CANVAS_WIDTH_PX / 2;
    context.beginPath();
    context.moveTo(mid - TAIL_HALF_WIDTH_PX, BODY_HEIGHT_PX - 7);
    context.lineTo(mid, CANVAS_HEIGHT_PX - 4);
    context.lineTo(mid + TAIL_HALF_WIDTH_PX, BODY_HEIGHT_PX - 7);
    context.closePath();
    context.fill();
    context.stroke();
    // Cover the stroke where the tail meets the body.
    context.fillRect(mid - TAIL_HALF_WIDTH_PX + 3, BODY_HEIGHT_PX - 10, TAIL_HALF_WIDTH_PX * 2 - 6, 8);
    context.font = FONT;
    context.fillStyle = '#1c1d20';
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    const lines = this.wrap(text, CANVAS_WIDTH_PX - PADDING_PX * 2);
    const top = BODY_HEIGHT_PX / 2 - ((lines.length - 1) * LINE_HEIGHT_PX) / 2;
    lines.forEach((line, i) => context.fillText(line, CANVAS_WIDTH_PX / 2, top + i * LINE_HEIGHT_PX));
    this.texture.needsUpdate = true;
  }

  /** Greedy word wrap to `maxWidthPx`, at most three lines (the last is cut with an ellipsis). */
  private wrap(text: string, maxWidthPx: number): string[] {
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
    if (lines.length > 3) {
      lines.length = 3;
      lines[2] = `${lines[2]!.replace(/\s+\S*$/u, '')}…`;
    }
    return lines;
  }
}
