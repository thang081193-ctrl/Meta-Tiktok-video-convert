import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  analysis: null,
}));

vi.mock('../server/lib/ffmpeg.js', () => ({
  analyzeVideo: vi.fn(async () => mockState.analysis),
}));

import { TARGETS_BY_ID, QA_STATUS } from '../server/lib/specs.js';
import { verifyOutput } from '../server/lib/verifier.js';

describe('output verifier strict mode', () => {
  beforeEach(() => {
    mockState.analysis = buildAnalysis();
  });

  it('fails strict built-ins when the output has no audio stream', async () => {
    mockState.analysis = buildAnalysis({ audio: null });

    const result = await verifyOutput('out.mp4', TARGETS_BY_ID.tiktok_vertical_9x16, {
      decision: 'converted',
      layout: buildLayout(),
    });

    expect(result.status).toBe(QA_STATUS.FAIL);
    expect(result.issues.join(' ')).toContain('requires an AAC audio stream');
  });

  it('fails strict built-ins when the foreground leaves the safe rect', async () => {
    const result = await verifyOutput('out.mp4', TARGETS_BY_ID.meta_feed_4x5, {
      decision: 'converted',
      layout: buildLayout({
        foregroundRect: {
          x: 0,
          y: 0,
          width: 1080,
          height: 1080,
        },
      }),
    });

    expect(result.status).toBe(QA_STATUS.FAIL);
    expect(result.issues.join(' ')).toContain('strict safe rect');
  });

  it('keeps custom targets tolerant of missing audio when audio is not required', async () => {
    const customTarget = {
      ...TARGETS_BY_ID.tiktok_vertical_9x16,
      id: 'custom_vertical_9x16',
      complianceMode: 'standard',
      requireAudio: false,
      container: ['mp4', 'mov'],
    };
    mockState.analysis = buildAnalysis({ audio: null });

    const result = await verifyOutput('out.mp4', customTarget, {
      decision: 'converted',
      layout: buildLayout(),
    });

    expect(result.status).toBe(QA_STATUS.PASS);
  });
});

function buildAnalysis(overrides = {}) {
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
      ...(overrides.video || {}),
    },
    audio: overrides.audio === null ? null : {
      codec: 'aac',
      channels: 2,
      sampleRate: 48000,
      ...(overrides.audio || {}),
    },
    ...overrides,
  };
}

function buildLayout(overrides = {}) {
  return {
    foregroundRect: {
      x: 100,
      y: 100,
      width: 800,
      height: 1000,
      ...(overrides.foregroundRect || {}),
    },
    safeRect: {
      x: 80,
      y: 80,
      width: 920,
      height: 1160,
      ...(overrides.safeRect || {}),
    },
    ...overrides,
  };
}
