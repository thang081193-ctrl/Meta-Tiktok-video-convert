import {
  BACKGROUND_MODES,
  DEFAULT_LAYOUT_BOUNDS,
  REVIEW_STATE,
  listBackgroundModes,
  parseAspectRatio,
  serializeProfileForClient,
} from '../../public/layout-core.js';

export const CLASSIFICATION = Object.freeze({
  READY_EXACT: 'READY_EXACT',
  READY_ACCEPTED: 'READY_ACCEPTED',
  CONVERT_RECOMMENDED: 'CONVERT_RECOMMENDED',
  CONVERT_REQUIRED: 'CONVERT_REQUIRED',
  UNSUPPORTED: 'UNSUPPORTED',
});

export const QA_STATUS = Object.freeze({
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
});

export const SPEC_VERSION = '2026-04-local-v2';

export const DEFAULT_SETTINGS = Object.freeze({
  smartSkip: true,
  forceConvert: false,
  layoutMode: 'content-safe',
  audioMode: 'keep',
  qualityMode: 'high',
});

const BUILT_IN_PROFILE_SEEDS = Object.freeze([
  {
    id: 'tiktok_vertical_9x16',
    label: 'TikTok Vertical 9:16',
    platform: 'TikTok',
    placement: 'Auction In-Feed / Vertical',
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    recommendedAspectRatio: '9:16',
    supportedAspectRatios: ['9:16 (recommended)', '1:1 supported but not optimal'],
    recommendedMinResolution: '>= 540 x 960',
    previewNotes: [
      'App output for TikTok is vertical by default.',
      'The full source frame is fitted inside the target safe zone before export.',
    ],
    safeZoneNotes: [
      'Keep caption, CTA, logo, and key subject inside the safe zone.',
      'Bottom caption and CTA space is the highest-risk area on TikTok.',
    ],
    fps: 30,
    minWidth: 540,
    minHeight: 960,
    maxBytes: 500 * 1024 * 1024,
    maxDurationSec: 10 * 60,
    minBitrateBps: 516_000,
    reliabilityWarnBytes: 450 * 1024 * 1024,
    container: ['mp4', 'mov'],
    videoCodec: 'h264',
    audioCodec: 'aac',
    preferredVideoBitrate: '10M',
    fallbackVideoBitrate: '8M',
    crf: { high: 18, balanced: 21, preview: 24 },
    outputLabel: 'TikTok_9x16',
    safeZoneGuide: {
      topPercent: 0.1,
      bottomPercent: 0.18,
      leftPercent: 0.06,
      rightPercent: 0.06,
    },
    layoutDefaults: {
      scale: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      backgroundMode: 'edge-extend',
      backgroundColor: '#101514',
    },
  },
  {
    id: 'meta_reels_9x16',
    label: 'Meta Reels/Stories 9:16',
    platform: 'Meta',
    placement: 'Instagram/Facebook Reels and Stories',
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    recommendedAspectRatio: '9:16',
    supportedAspectRatios: ['9:16 (preferred)'],
    recommendedMinResolution: '>= 720 x 1280',
    previewNotes: [
      'Optimized for Reels and Stories placement.',
      'Auto-fit keeps the full source frame inside the safe zone before export.',
    ],
    safeZoneNotes: [
      'Avoid placing CTA text near the lower edge.',
      'Top profile elements and bottom action chrome may overlap edge content.',
    ],
    fps: 30,
    minWidth: 720,
    minHeight: 1280,
    maxBytes: 4 * 1024 * 1024 * 1024,
    maxDurationSec: 240 * 60,
    minBitrateBps: 1_500_000,
    reliabilityWarnBytes: 1 * 1024 * 1024 * 1024,
    container: ['mp4', 'mov'],
    videoCodec: 'h264',
    audioCodec: 'aac',
    preferredVideoBitrate: '10M',
    fallbackVideoBitrate: '8M',
    crf: { high: 18, balanced: 21, preview: 24 },
    outputLabel: 'Meta_Reels_9x16',
    safeZoneGuide: {
      topPercent: 0.14,
      bottomPercent: 0.22,
      leftPercent: 0.06,
      rightPercent: 0.06,
    },
    layoutDefaults: {
      scale: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      backgroundMode: 'edge-extend',
      backgroundColor: '#101514',
    },
  },
  {
    id: 'meta_feed_4x5',
    label: 'Meta Feed 4:5',
    platform: 'Meta',
    placement: 'Facebook/Instagram Feed',
    width: 1080,
    height: 1350,
    aspectRatio: '4:5',
    recommendedAspectRatio: '4:5',
    supportedAspectRatios: ['4:5 (preferred)', '1:1 commonly accepted in feed'],
    recommendedMinResolution: '>= 600 x 750',
    previewNotes: [
      'This frame is optimized for feed inventory, not full-screen placement.',
      'Auto-fit uses the safe zone first, then background fill for the remaining area.',
    ],
    safeZoneNotes: [
      'Feed UI can overlap the title area and bottom engagement zone.',
    ],
    fps: 30,
    minWidth: 600,
    minHeight: 750,
    maxBytes: 4 * 1024 * 1024 * 1024,
    maxDurationSec: 240 * 60,
    minBitrateBps: 1_200_000,
    reliabilityWarnBytes: 1 * 1024 * 1024 * 1024,
    container: ['mp4', 'mov'],
    videoCodec: 'h264',
    audioCodec: 'aac',
    preferredVideoBitrate: '8M',
    fallbackVideoBitrate: '6M',
    crf: { high: 18, balanced: 21, preview: 24 },
    outputLabel: 'Meta_Feed_4x5',
    safeZoneGuide: {
      topPercent: 0.06,
      bottomPercent: 0.1,
      leftPercent: 0.04,
      rightPercent: 0.04,
    },
    layoutDefaults: {
      scale: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      backgroundMode: 'edge-extend',
      backgroundColor: '#101514',
    },
  },
  {
    id: 'meta_square_1x1',
    label: 'Meta Square 1:1',
    platform: 'Meta',
    placement: 'Feed / Marketplace / Explore',
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    recommendedAspectRatio: '1:1',
    supportedAspectRatios: ['1:1 (preferred for square placements)'],
    recommendedMinResolution: '>= 600 x 600',
    previewNotes: [
      'Square output is useful where centered framing matters more than vertical reach.',
    ],
    safeZoneNotes: [
      'Keep logos and price callouts away from the outer edge for feed overlays and crop safety.',
    ],
    fps: 30,
    minWidth: 600,
    minHeight: 600,
    maxBytes: 4 * 1024 * 1024 * 1024,
    maxDurationSec: 240 * 60,
    minBitrateBps: 1_200_000,
    reliabilityWarnBytes: 1 * 1024 * 1024 * 1024,
    container: ['mp4', 'mov'],
    videoCodec: 'h264',
    audioCodec: 'aac',
    preferredVideoBitrate: '8M',
    fallbackVideoBitrate: '6M',
    crf: { high: 18, balanced: 21, preview: 24 },
    outputLabel: 'Meta_Square_1x1',
    safeZoneGuide: {
      topPercent: 0.06,
      bottomPercent: 0.1,
      leftPercent: 0.04,
      rightPercent: 0.04,
    },
    layoutDefaults: {
      scale: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      backgroundMode: 'edge-extend',
      backgroundColor: '#101514',
    },
  },
]);

export const BUILT_IN_PROFILES = BUILT_IN_PROFILE_SEEDS.map(seed => normalizeProfile(seed, { isBuiltIn: true }));
export const BUILT_IN_PROFILE_IDS = BUILT_IN_PROFILES.map(profile => profile.id);
export const TARGET_PROFILES = BUILT_IN_PROFILES.map(profile => serializeProfileForClient(profile));
export const TARGETS_BY_ID = Object.freeze(Object.fromEntries(TARGET_PROFILES.map(profile => [profile.id, profile])));
export const DEFAULT_TARGET_IDS = getDefaultTargetIds(BUILT_IN_PROFILES);

export function getBuiltInProfiles() {
  return BUILT_IN_PROFILES.map(profile => ({ ...profile }));
}

export function buildEffectiveProfiles({ customProfiles = [], disabledBuiltInIds = [] } = {}) {
  const disabled = new Set(disabledBuiltInIds || []);
  const builtIns = BUILT_IN_PROFILES.map(profile => ({
    ...profile,
    enabled: !disabled.has(profile.id),
  }));
  const customs = (customProfiles || []).map(profile => normalizeProfile(profile, { isBuiltIn: false }));
  return [...builtIns, ...customs];
}

export function getProfilesById(profiles = BUILT_IN_PROFILES) {
  return Object.fromEntries(profiles.map(profile => [profile.id, profile]));
}

export function getTargetProfiles(ids = [], profiles = BUILT_IN_PROFILES) {
  const map = getProfilesById(profiles);
  return ids.map(id => map[id]).filter(Boolean);
}

export function getDefaultTargetIds(profiles = BUILT_IN_PROFILES) {
  return profiles.filter(profile => profile.enabled !== false).map(profile => profile.id);
}

export function getSpecsPayload({ profiles = BUILT_IN_PROFILES } = {}) {
  const clientProfiles = profiles.map(profile => serializeProfileForClient(profile));
  return {
    version: SPEC_VERSION,
    defaults: {
      ...DEFAULT_SETTINGS,
      targetIds: getDefaultTargetIds(profiles),
    },
    classification: CLASSIFICATION,
    reviewState: REVIEW_STATE,
    qaStatus: QA_STATUS,
    ui: {
      backgroundModes: listBackgroundModes(),
      layoutScale: { ...DEFAULT_LAYOUT_BOUNDS },
      qualityModes: [
        { id: 'high', label: 'High' },
        { id: 'balanced', label: 'Balanced' },
        { id: 'preview', label: 'Fast' },
      ],
      profileFields: [
        'label',
        'platform',
        'placement',
        'width',
        'height',
        'aspectRatio',
        'fps',
        'safeZoneGuide',
        'riskZones',
        'layoutDefaults',
      ],
    },
    builtInProfiles: BUILT_IN_PROFILES.map(profile => serializeProfileForClient(profile)),
    profiles: clientProfiles,
    backgroundModes: BACKGROUND_MODES,
  };
}

export function normalizeProfile(input, { isBuiltIn = false } = {}) {
  const width = toEvenNumber(input.width, 1080);
  const height = toEvenNumber(input.height, 1920);
  const aspectRatio = input.aspectRatio || `${width}:${height}`;

  return {
    id: sanitizeProfileId(input.id || slugify(input.label || 'profile')),
    label: String(input.label || 'Untitled Profile').trim(),
    platform: String(input.platform || 'Custom').trim(),
    placement: String(input.placement || 'Custom Placement').trim(),
    width,
    height,
    aspectRatio,
    recommendedAspectRatio: String(input.recommendedAspectRatio || aspectRatio).trim(),
    supportedAspectRatios: normalizeStringArray(input.supportedAspectRatios),
    recommendedMinResolution: String(input.recommendedMinResolution || `>= ${input.minWidth || Math.round(width * 0.5)} x ${input.minHeight || Math.round(height * 0.5)}`).trim(),
    previewNotes: normalizeStringArray(input.previewNotes),
    safeZoneNotes: normalizeStringArray(input.safeZoneNotes),
    fps: clampNumber(input.fps, 30, 1, 120),
    minWidth: toEvenNumber(input.minWidth, Math.round(width * 0.5)),
    minHeight: toEvenNumber(input.minHeight, Math.round(height * 0.5)),
    maxBytes: clampNumber(input.maxBytes, 500 * 1024 * 1024, 1024 * 1024, 8 * 1024 * 1024 * 1024),
    maxDurationSec: clampNumber(input.maxDurationSec, 600, 1, 24 * 60 * 60),
    minBitrateBps: clampNumber(input.minBitrateBps, 516_000, 1, 250_000_000),
    reliabilityWarnBytes: clampNumber(input.reliabilityWarnBytes, Math.round((input.maxBytes || 500 * 1024 * 1024) * 0.8), 1024 * 1024, 8 * 1024 * 1024 * 1024),
    container: normalizeStringArray(input.container).length ? normalizeStringArray(input.container) : ['mp4', 'mov'],
    videoCodec: String(input.videoCodec || 'h264').trim(),
    audioCodec: String(input.audioCodec || 'aac').trim(),
    preferredVideoBitrate: String(input.preferredVideoBitrate || '8M').trim(),
    fallbackVideoBitrate: String(input.fallbackVideoBitrate || '6M').trim(),
    crf: {
      high: clampNumber(input.crf?.high, 18, 1, 40),
      balanced: clampNumber(input.crf?.balanced, 21, 1, 40),
      preview: clampNumber(input.crf?.preview, 24, 1, 40),
    },
    outputLabel: String(input.outputLabel || slugify(`${input.platform || 'Custom'}_${aspectRatio}`)).trim(),
    safeZoneGuide: normalizeSafeGuide(input.safeZoneGuide),
    riskZones: normalizeRiskZoneInput(input.riskZones),
    layoutDefaults: normalizeLayoutDefaults(input.layoutDefaults),
    enabled: input.enabled !== false,
    isBuiltIn,
  };
}

export function validateNewProfileId(id, profiles = BUILT_IN_PROFILES) {
  const normalized = sanitizeProfileId(id);
  const existing = new Set((profiles || []).map(profile => profile.id));
  if (existing.has(normalized)) {
    const err = new Error(`Profile id already exists: ${normalized}`);
    err.status = 400;
    throw err;
  }
  return normalized;
}

export function buildUniqueProfileId(label, profiles = BUILT_IN_PROFILES) {
  const existing = new Set((profiles || []).map(profile => profile.id));
  const base = sanitizeProfileId(slugify(label || 'profile'));
  let candidate = base;
  let index = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  return candidate;
}

export function aspectRatioValue(aspectRatio) {
  return parseAspectRatio(aspectRatio, 1);
}

export function aspectWithinTolerance(actual, expected, tolerance = 0.02) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || expected <= 0) return false;
  return Math.abs(actual - expected) / expected <= tolerance;
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function toEvenNumber(value, fallback) {
  const numeric = clampNumber(value, fallback, 2, 20000);
  const rounded = Math.round(numeric);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|,/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeSafeGuide(guide = {}) {
  return {
    topPercent: clampNumber(guide.topPercent ?? 0.1, 0.1, 0, 0.45),
    bottomPercent: clampNumber(guide.bottomPercent ?? 0.16, 0.16, 0, 0.45),
    leftPercent: clampNumber(guide.leftPercent ?? guide.sidePercent ?? 0.06, 0.06, 0, 0.45),
    rightPercent: clampNumber(guide.rightPercent ?? guide.sidePercent ?? 0.06, 0.06, 0, 0.45),
  };
}

function normalizeRiskZoneInput(riskZones) {
  if (!Array.isArray(riskZones)) return [];
  return riskZones.map((zone, index) => ({
    id: sanitizeProfileId(zone.id || `zone_${index + 1}`),
    label: String(zone.label || `Zone ${index + 1}`).trim(),
    color: String(zone.color || 'rgba(255, 191, 71, 0.18)').trim(),
    topPercent: clampNumber(zone.topPercent ?? 0, 0, 0, 1),
    leftPercent: clampNumber(zone.leftPercent ?? 0, 0, 0, 1),
    rightPercent: clampNumber(zone.rightPercent ?? 0, 0, 0, 1),
    bottomPercent: clampNumber(zone.bottomPercent ?? 0, 0, 0, 1),
    note: String(zone.note || '').trim(),
  }));
}

function normalizeLayoutDefaults(layoutDefaults = {}) {
  return {
    scale: clampNumber(layoutDefaults.scale ?? 1, 1, DEFAULT_LAYOUT_BOUNDS.minScale, DEFAULT_LAYOUT_BOUNDS.maxScale),
    anchorX: clampNumber(layoutDefaults.anchorX ?? 0.5, 0.5, 0, 1),
    anchorY: clampNumber(layoutDefaults.anchorY ?? 0.5, 0.5, 0, 1),
    backgroundMode: listBackgroundModes().some(mode => mode.id === layoutDefaults.backgroundMode)
      ? layoutDefaults.backgroundMode
      : 'edge-extend',
    backgroundColor: String(layoutDefaults.backgroundColor || '#101514').trim(),
  };
}

function sanitizeProfileId(id) {
  return slugify(id || 'profile');
}

function slugify(value) {
  return String(value || 'profile')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'profile';
}
