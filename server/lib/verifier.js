import { analyzeVideo } from './ffmpeg.js';
import { aspectRatioValue, aspectWithinTolerance, isStrictComplianceMode, QA_STATUS } from './specs.js';

export async function verifyOutput(filePath, target, { decision = 'converted', command = null, layout = null } = {}) {
  let analysis;
  try {
    analysis = await analyzeVideo(filePath);
  } catch (err) {
    return {
      status: QA_STATUS.FAIL,
      decision,
      issues: [`Khong phan tich duoc output: ${err.message}`],
      warnings: [],
      analysis: null,
    };
  }

  const issues = [];
  const warnings = [];
  const video = analysis.video || {};
  const audio = analysis.audio;
  const expectedAspect = aspectRatioValue(target.aspectRatio);
  const strictMode = isStrictComplianceMode(target);

  if (decision === 'converted') {
    if (Math.abs((video.displayWidth || 0) - target.width) > 2) {
      issues.push(`Width sai: expected ${target.width}, got ${video.displayWidth}.`);
    }
    if (Math.abs((video.displayHeight || 0) - target.height) > 2) {
      issues.push(`Height sai: expected ${target.height}, got ${video.displayHeight}.`);
    }
  } else {
    if (!aspectWithinTolerance(video.aspectRatio, expectedAspect, 0.025)) {
      issues.push(`Aspect ratio ${video.aspectRatio?.toFixed?.(3) || 'unknown'} khong khop ${target.aspectRatio}.`);
    }
    if ((video.displayWidth || 0) < target.minWidth || (video.displayHeight || 0) < target.minHeight) {
      issues.push(`Do phan giai thap hon toi thieu ${target.minWidth}x${target.minHeight}.`);
    }
    if (Math.abs((video.displayWidth || 0) - target.width) > 2 || Math.abs((video.displayHeight || 0) - target.height) > 2) {
      warnings.push(`File goc dung duoc nhung khong phai preferred ${target.width}x${target.height}.`);
    }
  }

  if (!target.container.includes(analysis.container)) {
    issues.push(`Container ${analysis.container} khong thuoc ${target.container.join('/')}.`);
  }
  if (video.codec !== target.videoCodec) {
    issues.push(`Video codec ${video.codec}; can ${target.videoCodec}.`);
  }
  if (video.pixelFormat !== 'yuv420p') {
    if (strictMode) issues.push(`Pixel format ${video.pixelFormat || 'unknown'}; strict target requires yuv420p.`);
    warnings.push(`Pixel format ${video.pixelFormat || 'unknown'}; preferred yuv420p.`);
  }
  if ((video.fps || 0) > target.fps + 0.5) {
    issues.push(`FPS ${video.fps.toFixed(2)} cao hon ${target.fps}.`);
  }
  if ((analysis.sizeBytes || 0) > target.maxBytes) {
    issues.push(`Dung luong vuot gioi han ${(target.maxBytes / 1024 / 1024).toFixed(0)} MB.`);
  }
  if ((analysis.durationSec || 0) > target.maxDurationSec) {
    issues.push('Thoi luong vuot gioi han target.');
  }
  if (!video.hasSquarePixels) {
    warnings.push('Sample aspect ratio chua square.');
  }
  if (video.hasRotationMetadata) {
    warnings.push(`Con rotation metadata ${video.rotation} do.`);
  }
  if (!analysis.faststart && analysis.container === 'mp4') {
    if (strictMode) issues.push('Strict target requires MP4 faststart/moov atom at the front of the file.');
    warnings.push('MP4 chua faststart.');
  }
  if (!audio && target.requireAudio) {
    issues.push('Strict target requires an AAC audio stream.');
  }
  if (audio && audio.codec !== target.audioCodec) {
    if (strictMode) issues.push(`Audio codec ${audio.codec}; strict target requires ${target.audioCodec}.`);
    warnings.push(`Audio codec ${audio.codec}; preferred ${target.audioCodec}.`);
  }
  if (audio && ![44100, 48000].includes(audio.sampleRate)) {
    warnings.push(`Audio sample rate ${audio.sampleRate}; preferred 44100/48000.`);
  }

  if (command?.args?.join(' ').includes('crop=')) {
    issues.push('Command metadata still contains crop filter, which is forbidden in content-safe mode.');
  }

  if (layout?.foregroundRect) {
    const rect = layout.foregroundRect;
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > target.width || rect.y + rect.height > target.height) {
      issues.push('Foreground rect falls outside the output canvas.');
    }
    if (strictMode && layout.safeRect) {
      const safeRect = layout.safeRect;
      if (rect.x < safeRect.x || rect.y < safeRect.y || rect.x + rect.width > safeRect.x + safeRect.width || rect.y + rect.height > safeRect.y + safeRect.height) {
        issues.push('Foreground rect falls outside the strict safe rect.');
      }
    }
  }

  const status = issues.length
    ? QA_STATUS.FAIL
    : (warnings.length ? QA_STATUS.WARN : QA_STATUS.PASS);

  return { status, decision, issues, warnings, analysis };
}
