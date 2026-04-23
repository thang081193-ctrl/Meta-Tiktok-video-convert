import { REVIEW_STATE, calculateLayout } from '../../public/layout-core.js';
import { aspectRatioValue, aspectWithinTolerance, CLASSIFICATION } from './specs.js';

export function classifyAssetForTargets(asset, targets = []) {
  if (asset.error || !asset.analysis) {
    return Object.fromEntries(targets.map(target => [target.id, {
      targetId: target.id,
      status: CLASSIFICATION.UNSUPPORTED,
      label: 'Khong ho tro',
      decision: 'blocked',
      reasons: [asset.error || 'Khong phan tich duoc video.'],
      warnings: [],
      summary: 'Khong the dung file nay.',
      reviewState: REVIEW_STATE.BLOCKED,
      reviewReasons: [asset.error || 'Khong co du lieu layout.'],
      autoLayout: null,
    }]));
  }

  return Object.fromEntries(targets.map(target => [target.id, classifyForTarget(asset.analysis, target)]));
}

export function classifyForTarget(info, target, layoutOverride = null) {
  const failures = [];
  const warnings = [];
  const exactMisses = [];
  const video = info.video || {};
  const audio = info.audio;
  const expectedAspect = aspectRatioValue(target.aspectRatio);
  const actualAspect = video.aspectRatio || 0;

  if (!target.container.includes(info.container)) {
    failures.push(`Container ${info.container || 'unknown'} khong nam trong nhom ${target.container.join('/')}.`);
  }

  if (video.codec !== target.videoCodec) {
    failures.push(`Video codec la ${video.codec || 'unknown'}, can ${target.videoCodec}.`);
  }

  if (!aspectWithinTolerance(actualAspect, expectedAspect, 0.025)) {
    failures.push(`Ti le ${formatRatio(actualAspect)} khong khop ${target.aspectRatio}.`);
  }

  if ((video.displayWidth || 0) < target.minWidth || (video.displayHeight || 0) < target.minHeight) {
    failures.push(`Do phan giai ${video.displayWidth}x${video.displayHeight} thap hon toi thieu ${target.minWidth}x${target.minHeight}.`);
  }

  if ((info.durationSec || 0) > target.maxDurationSec) {
    failures.push(`Thoi luong ${formatSeconds(info.durationSec)} vuot gioi han ${formatSeconds(target.maxDurationSec)}.`);
  }

  if ((info.sizeBytes || 0) > target.maxBytes) {
    failures.push(`Dung luong vuot gioi han ${formatMb(target.maxBytes)}.`);
  }

  if ((video.fps || 0) > target.fps + 0.5) {
    failures.push(`FPS ${video.fps.toFixed(2)} cao hon nguong ${target.fps}.`);
  }

  if (video.pixelFormat && video.pixelFormat !== 'yuv420p') {
    warnings.push(`Pixel format ${video.pixelFormat}; nen chuan hoa ve yuv420p.`);
  }

  if (!video.hasSquarePixels) {
    warnings.push('Sample aspect ratio khong phai square pixels; nen chuan hoa.');
  }

  if (video.hasRotationMetadata) {
    warnings.push(`Co rotation metadata ${video.rotation} do; nen bake rotation vao video.`);
  }

  if (!info.faststart && info.container === 'mp4') {
    warnings.push('MP4 chua co faststart/moov atom o dau file; nen toi uu upload/playback.');
  }

  if ((info.bitrateBps || 0) > 0 && info.bitrateBps < target.minBitrateBps) {
    warnings.push(`Bitrate ${(info.bitrateBps / 1000).toFixed(0)} kbps thap hon muc khuyen nghi ${(target.minBitrateBps / 1000).toFixed(0)} kbps.`);
  }

  if ((info.sizeBytes || 0) > target.reliabilityWarnBytes) {
    warnings.push(`Dung luong tren ${formatMb(target.reliabilityWarnBytes)}; upload co the cham hoac kem on dinh.`);
  }

  if (audio) {
    if (audio.codec !== target.audioCodec) warnings.push(`Audio codec ${audio.codec}; nen dung ${target.audioCodec}.`);
    if (![1, 2].includes(audio.channels)) warnings.push(`Audio ${audio.channels || 0} channels; nen dung stereo.`);
    if (![44100, 48000].includes(audio.sampleRate)) warnings.push(`Audio sample rate ${audio.sampleRate || 0} Hz; nen dung 44.1 kHz hoac 48 kHz.`);
  } else {
    warnings.push('Video khong co audio; van co the dung neu creative chap nhan silent.');
  }

  if (Math.abs((video.displayWidth || 0) - target.width) > 2) exactMisses.push(`Width hien tai ${video.displayWidth}, preferred ${target.width}.`);
  if (Math.abs((video.displayHeight || 0) - target.height) > 2) exactMisses.push(`Height hien tai ${video.displayHeight}, preferred ${target.height}.`);
  if (!info.faststart && info.container === 'mp4') exactMisses.push('Chua faststart.');

  const autoLayout = calculateLayout({
    sourceWidth: video.displayWidth || 0,
    sourceHeight: video.displayHeight || 0,
    target,
    override: layoutOverride || null,
  });

  let status;
  let decision;
  let label;
  if (failures.length) {
    status = CLASSIFICATION.CONVERT_REQUIRED;
    decision = 'convert';
    label = 'Can convert';
  } else if (warnings.length) {
    status = CLASSIFICATION.CONVERT_RECOMMENDED;
    decision = 'convert';
    label = 'Nen convert';
  } else if (exactMisses.length) {
    status = CLASSIFICATION.READY_ACCEPTED;
    decision = 'skip';
    label = 'Da san sang';
  } else {
    status = CLASSIFICATION.READY_EXACT;
    decision = 'skip';
    label = 'Da san sang';
  }

  return {
    targetId: target.id,
    status,
    label,
    decision,
    reasons: failures,
    warnings: [...warnings, ...(status === CLASSIFICATION.READY_ACCEPTED ? exactMisses : [])],
    summary: summarize(status),
    reviewState: failures.length ? autoLayout.reviewState : (decision === 'skip' ? REVIEW_STATE.SAFE_AUTO : autoLayout.reviewState),
    reviewReasons: failures.length ? autoLayout.reviewReasons : (decision === 'skip' ? [] : autoLayout.reviewReasons),
    autoLayout,
    measured: {
      width: video.displayWidth,
      height: video.displayHeight,
      aspectRatio: actualAspect,
      fps: video.fps,
      sizeBytes: info.sizeBytes,
      durationSec: info.durationSec,
      container: info.container,
      videoCodec: video.codec,
      audioCodec: audio?.codec || null,
    },
  };
}

export function shouldConvert(classification, { smartSkip = true, forceConvert = false, useOriginalTargets = [] } = {}) {
  if (!classification || classification.status === CLASSIFICATION.UNSUPPORTED) return false;
  if (forceConvert) return true;
  if (useOriginalTargets.includes(classification.targetId)) return false;
  if (!smartSkip) return true;
  if ([CLASSIFICATION.READY_EXACT, CLASSIFICATION.READY_ACCEPTED].includes(classification.status)) return false;
  return true;
}

function summarize(status) {
  switch (status) {
    case CLASSIFICATION.READY_EXACT:
      return 'Dung chuan target, khong can convert.';
    case CLASSIFICATION.READY_ACCEPTED:
      return 'Platform co the dung file goc, khong can convert mac dinh.';
    case CLASSIFICATION.CONVERT_RECOMMENDED:
      return 'Co the upload nhung nen convert de giam rui ro quality/delivery.';
    case CLASSIFICATION.CONVERT_REQUIRED:
      return 'Khong dat yeu cau target, can convert.';
    default:
      return 'Khong ho tro.';
  }
}

function formatRatio(value) {
  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  return value.toFixed(3);
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown';
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}
