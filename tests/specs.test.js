import { describe, expect, it } from 'vitest';
import { DEFAULT_TARGET_IDS, getSpecsPayload, TARGET_PROFILES } from '../server/lib/specs.js';

describe('platform specs', () => {
  it('ships the expected default bundle targets', () => {
    expect(DEFAULT_TARGET_IDS).toEqual([
      'tiktok_vertical_9x16',
      'meta_reels_9x16',
      'meta_feed_4x5',
      'meta_square_1x1',
    ]);
  });

  it('keeps target ids unique and dimensions even for H.264 output', () => {
    const ids = new Set();
    for (const profile of TARGET_PROFILES) {
      expect(ids.has(profile.id)).toBe(false);
      ids.add(profile.id);
      expect(profile.width % 2).toBe(0);
      expect(profile.height % 2).toBe(0);
      expect(profile.videoCodec).toBe('h264');
      expect(profile.audioCodec).toBe('aac');
    }
  });

  it('marks built-in ad profiles as strict no-crop exports', () => {
    const reels = TARGET_PROFILES.find(profile => profile.id === 'meta_reels_9x16');
    expect(reels.complianceMode).toBe('ads-safe-strict');
    expect(reels.allowUseOriginal).toBe(false);
    expect(reels.requireAudio).toBe(true);
    expect(reels.container).toEqual(['mp4']);
    expect(reels.layoutBounds.maxScale).toBe(1);
    expect(reels.maxDurationSec).toBe(90);
  });

  it('exposes defaults used by the frontend', () => {
    const specs = getSpecsPayload();
    expect(specs.defaults.smartSkip).toBe(true);
    expect(specs.defaults.forceConvert).toBe(false);
    expect(specs.profiles).toHaveLength(4);
    expect(specs.ui.profileFields).toContain('layoutBounds');
  });

  it('includes preview metadata needed by the UI legend', () => {
    const specs = getSpecsPayload();
    const tiktok = specs.profiles.find(profile => profile.id === 'tiktok_vertical_9x16');
    expect(tiktok.previewLabel).toContain('TikTok');
    expect(tiktok.outputResolutionLabel).toBe('1080 x 1920');
    expect(tiktok.recommendedAspectRatio).toBe('9:16');
    expect(tiktok.supportedAspectRatios.join(' ')).toContain('1:1 supported but not optimal');
    expect(tiktok.recommendedMinResolution).toBe('>= 540 x 960');
    expect(tiktok.safeZoneNotes.length).toBeGreaterThan(0);
  });
});
