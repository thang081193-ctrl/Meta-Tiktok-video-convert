import { describe, expect, it } from 'vitest';
import { calculateLayout, REVIEW_STATE } from '../public/layout-core.js';
import { TARGETS_BY_ID } from '../server/lib/specs.js';

describe('layout-core', () => {
  it('auto-fits a vertical source inside the target safe zone without cropping', () => {
    const layout = calculateLayout({
      sourceWidth: 1080,
      sourceHeight: 1920,
      target: TARGETS_BY_ID.tiktok_vertical_9x16,
      override: null,
    });

    expect(layout.reviewState).toBe(REVIEW_STATE.SAFE_AUTO);
    expect(layout.foregroundRect.x).toBeGreaterThanOrEqual(layout.safeRect.x);
    expect(layout.foregroundRect.y).toBeGreaterThanOrEqual(layout.safeRect.y);
    expect(layout.foregroundRect.x + layout.foregroundRect.width).toBeLessThanOrEqual(layout.safeRect.x + layout.safeRect.width);
    expect(layout.foregroundRect.y + layout.foregroundRect.height).toBeLessThanOrEqual(layout.safeRect.y + layout.safeRect.height);
  });

  it('flags large ratio mismatch for manual review while keeping the full frame inside canvas', () => {
    const layout = calculateLayout({
      sourceWidth: 1920,
      sourceHeight: 1080,
      target: TARGETS_BY_ID.tiktok_vertical_9x16,
      override: null,
    });

    expect(layout.reviewState).toBe(REVIEW_STATE.REVIEW_RECOMMENDED);
    expect(layout.foregroundRect.width).toBeLessThanOrEqual(layout.canvas.width);
    expect(layout.foregroundRect.height).toBeLessThanOrEqual(layout.canvas.height);
  });

  it('clamps built-in ad profiles to safe-fit scale and keeps the frame inside the safe rect', () => {
    const layout = calculateLayout({
      sourceWidth: 1920,
      sourceHeight: 1080,
      target: TARGETS_BY_ID.meta_feed_4x5,
      override: {
        scale: 1.4,
        anchorX: 0.9,
        anchorY: 0.2,
        backgroundMode: 'mirror',
      },
    });

    expect(layout.maxScale).toBe(1);
    expect(layout.layout.scale).toBe(1);
    expect(layout.foregroundRect.x).toBeGreaterThanOrEqual(layout.safeRect.x);
    expect(layout.foregroundRect.y).toBeGreaterThanOrEqual(layout.safeRect.y);
    expect(layout.foregroundRect.x + layout.foregroundRect.width).toBeLessThanOrEqual(layout.safeRect.x + layout.safeRect.width);
    expect(layout.foregroundRect.y + layout.foregroundRect.height).toBeLessThanOrEqual(layout.safeRect.y + layout.safeRect.height);
  });

  it('keeps custom profiles in advanced mode with canvas-wide anchor freedom', () => {
    const customTarget = {
      ...TARGETS_BY_ID.tiktok_vertical_9x16,
      id: 'custom_vertical_9x16',
      complianceMode: 'standard',
      allowUseOriginal: true,
      requireAudio: false,
      layoutBounds: {
        minScale: 0.7,
        maxScale: 2.5,
        step: 0.05,
      },
    };
    const layout = calculateLayout({
      sourceWidth: 1080,
      sourceHeight: 1920,
      target: customTarget,
      override: {
        scale: 1.2,
        anchorX: 0.9,
        anchorY: 0.2,
      },
    });

    expect(layout.maxScale).toBeGreaterThan(1);
    expect(layout.layout.scale).toBe(1.2);
    expect(layout.foregroundRect.x + layout.foregroundRect.width).toBeLessThanOrEqual(layout.canvas.width);
    expect(layout.foregroundRect.y + layout.foregroundRect.height).toBeLessThanOrEqual(layout.canvas.height);
  });
});
