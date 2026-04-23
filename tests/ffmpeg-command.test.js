import { describe, expect, it } from 'vitest';
import { buildConversionCommand } from '../server/lib/ffmpeg.js';
import { TARGETS_BY_ID } from '../server/lib/specs.js';

const source = {
  durationSec: 12,
  hasAudio: true,
};

describe('FFmpeg command builder', () => {
  it('builds a quality-first no-crop H.264 command with edge extend background', () => {
    const command = buildConversionCommand({
      inputPath: 'input.mp4',
      outputPath: 'out.mp4',
      target: TARGETS_BY_ID.tiktok_vertical_9x16,
      source,
      layoutMode: 'content-safe',
      qualityMode: 'high',
      audioMode: 'keep',
      encoder: 'libx264',
    });
    const joined = command.args.join(' ');
    expect(joined).toContain('fillborders=');
    expect(joined).not.toContain('crop=');
    expect(joined).toContain('-crf 18');
    expect(joined).toContain('-movflags +faststart');
    expect(joined).toContain('-map 0:a:0?');
    expect(joined).toContain('-pix_fmt yuv420p');
    expect(command.layoutMode).toBe('content-safe');
  });

  it('uses blur fit and mutes audio when requested', () => {
    const command = buildConversionCommand({
      inputPath: 'input.mp4',
      outputPath: 'out.mp4',
      target: TARGETS_BY_ID.meta_feed_4x5,
      source,
      layoutMode: 'content-safe',
      layoutOverride: {
        scale: 1,
        backgroundMode: 'blur',
      },
      qualityMode: 'balanced',
      audioMode: 'mute',
      encoder: 'libx264',
    });
    const joined = command.args.join(' ');
    expect(joined).toContain('boxblur=42:10');
    expect(joined).toContain('-an');
    expect(joined).toContain('-crf 21');
  });

  it('can build a fallback bitrate encode', () => {
    const command = buildConversionCommand({
      inputPath: 'input.mp4',
      outputPath: 'out.mp4',
      target: TARGETS_BY_ID.meta_square_1x1,
      source,
      layoutMode: 'content-safe',
      layoutOverride: {
        scale: 0.9,
        backgroundMode: 'solid',
        backgroundColor: '#112233',
      },
      qualityMode: 'high',
      audioMode: 'keep',
      encoder: 'libx264',
      useFallbackBitrate: true,
    });
    const joined = command.args.join(' ');
    expect(joined).toContain('pad=1080:1080');
    expect(joined).toContain('-b:v 6M');
    expect(joined).not.toContain('crop=');
  });
});
