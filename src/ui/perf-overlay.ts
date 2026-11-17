/**
 * Developer frame-time overlay (task 5.10, Requirements 29.4, 29.5). Created only when the page is
 * opened with `?perf=1`. It shows the rolling average and the worst frame in the last
 * `PERF_OVERLAY.windowFrames` frames, against the 13.9 ms budget, on a small head-locked quad.
 *
 * The quad is a child of the player's head, so it needs no per-frame placement. Frame samples go
 * into a preallocated ring (`domain/frame-stats.ts`). The canvas text is redrawn a few times a
 * second, not every frame. `sample(dt)` is the last tick stage.
 */
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type World,
} from '@iwsdk/core';
import { FRAME_BUDGET_MS, PERF_OVERLAY } from '../config/constants.js';
import { FrameStats, formatFrameStats } from '../domain/frame-stats.js';

const CANVAS_WIDTH_PX = 512;
const CANVAS_HEIGHT_PX = 128;
const FONT = 'bold 34px monospace';
const OK_COLOR = '#7dffb0';
const OVER_BUDGET_COLOR = '#ff8a7d';

export class PerfOverlay {
  private readonly stats = new FrameStats(PERF_OVERLAY.windowFrames);
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly geometry: PlaneGeometry;
  private readonly mesh: Mesh;
  private sinceRedrawS: number = PERF_OVERLAY.redrawIntervalS;

  constructor(private readonly world: World) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH_PX;
    this.canvas.height = CANVAS_HEIGHT_PX;
    const context = this.canvas.getContext('2d');
    if (context === null) throw new Error('The frame-time overlay could not get a 2D canvas context.');
    this.context = context;

    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    // Unlit, drawn last and through everything, so it is readable over passthrough and the avatar.
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false });
    this.geometry = new PlaneGeometry(PERF_OVERLAY.widthM, (PERF_OVERLAY.widthM * CANVAS_HEIGHT_PX) / CANVAS_WIDTH_PX);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'capri-perf-overlay';
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.mesh.position.set(0, -PERF_OVERLAY.dropM, -PERF_OVERLAY.distanceM);
    world.player.head.add(this.mesh);
    this.draw();
  }

  /** Last tick stage. Records one frame (`dt` in seconds) and refreshes the text a few times a second. */
  sample(dt: number): void {
    this.stats.push(dt * 1000);
    this.sinceRedrawS += dt;
    if (this.sinceRedrawS < PERF_OVERLAY.redrawIntervalS) return;
    this.sinceRedrawS = 0;
    this.draw();
  }

  get averageMs(): number {
    return this.stats.averageMs;
  }

  get worstMs(): number {
    return this.stats.worstMs;
  }

  dispose(): void {
    this.world.player.head.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  private draw(): void {
    const context = this.context;
    const [averageLine, worstLine] = formatFrameStats(this.stats, FRAME_BUDGET_MS);
    context.clearRect(0, 0, CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX);
    context.fillStyle = 'rgba(0, 0, 0, 0.65)';
    context.fillRect(0, 0, CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX);
    context.font = FONT;
    context.textBaseline = 'middle';
    context.fillStyle = this.stats.averageMs > FRAME_BUDGET_MS ? OVER_BUDGET_COLOR : OK_COLOR;
    context.fillText(averageLine, 16, CANVAS_HEIGHT_PX * 0.3);
    context.fillStyle = this.stats.worstMs > FRAME_BUDGET_MS ? OVER_BUDGET_COLOR : OK_COLOR;
    context.fillText(worstLine, 16, CANVAS_HEIGHT_PX * 0.72);
    this.texture.needsUpdate = true;
  }
}
