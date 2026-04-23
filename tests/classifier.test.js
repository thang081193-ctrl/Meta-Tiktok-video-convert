import { describe, expect, it } from 'vitest';
import { classifyForTarget, shouldConvert } from '../server/lib/classifier.js';
import { CLASSIFICATION, TARGETS_BY_ID } from '../server/lib/specs.js';
import { REVIEW_STATE } from '../public/layout-core.js';

function analysis(overrides = {}) {
  return {
    container: 'mp4',
    sizeBytes: 8 * 1024 * 1024,
    durationSec: 20,
    bitrateBps: 4_000_000,
    faststart: true,
    video: {
      codec: 'h264',
      pixelFormat: 'yuv420p',
      displayWidth: 1080,
      displayHeight: 1920,
      aspectRatio: 1080 / 1920,
      fps: 30,
      hasSquarePixels: true,
      hasRotationMetadata: false,
      rotation: 0,
    },
    audio: {
      codec: 'aac',
      channels: 2,
      sampleRate: 48000,
    },
    hasAudio: true,
    ...overrides,
    video: {
      codec: 'h264',
      pixelFormat: 'yuv420p',
      displayWidth: 1080,
      displayHeight: 1920,
      aspectRatio: 1080 / 1920,
      fps: 30,
      hasSquarePixels: true,
      hasRotationMetadata: false,
      rotation: 0,
      ...(overrides.video || {}),
    },
  };
}

describe('readiness classifier', () => {
  it('marks an exact TikTok 9:16 source as READY_EXACT and skips by default', () => {
    const result = classifyForTarget(analysis(), TARGETS_BY_ID.tiktok_vertical_9x16);
    expect(result.status).toBe(CLASSIFICATION.READY_EXACT);
    expect(result.reviewState).toBe(REVIEW_STATE.SAFE_AUTO);
    expect(shouldConvert(result, { smartSkip: true, forceConvert: false })).toBe(false);
  });

  it('marks a valid but non-preferred 9:16 source as READY_ACCEPTED', () => {
    const result = classifyForTarget(analysis({
      video: {
        displayWidth: 720,
        displayHeight: 1280,
        aspectRatio: 720 / 1280,
      },
    }), TARGETS_BY_ID.meta_reels_9x16);
    expect(result.status).toBe(CLASSIFICATION.READY_ACCEPTED);
    expect(result.warnings.join(' ')).toContain('preferred');
  });

  it('recommends conversion for delivery risks without making the file unsupported', () => {
    const result = classifyForTarget(analysis({
      faststart: false,
      bitrateBps: 100_000,
    }), TARGETS_BY_ID.tiktok_vertical_9x16);
    expect(result.status).toBe(CLASSIFICATION.CONVERT_RECOMMENDED);
    expect(shouldConvert(result, { smartSkip: true })).toBe(true);
  });

  it('requires conversion for wrong aspect ratio and high fps', () => {
    const result = classifyForTarget(analysis({
      video: {
        displayWidth: 1920,
        displayHeight: 1080,
        aspectRatio: 1920 / 1080,
        fps: 60,
      },
    }), TARGETS_BY_ID.tiktok_vertical_9x16);
    expect(result.status).toBe(CLASSIFICATION.CONVERT_REQUIRED);
    expect(result.reasons.join(' ')).toContain('khong khop');
  });

  it('force convert overrides ready skip', () => {
    const result = classifyForTarget(analysis(), TARGETS_BY_ID.tiktok_vertical_9x16);
    expect(shouldConvert(result, { smartSkip: true, forceConvert: true })).toBe(true);
  });
});
