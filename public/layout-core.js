export const BACKGROUND_MODES = Object.freeze([
  { id: 'edge-extend', label: 'Edge Extend' },
  { id: 'mirror', label: 'Mirror' },
  { id: 'blur', label: 'Blur' },
  { id: 'solid', label: 'Solid' },
]);

export const REVIEW_STATE = Object.freeze({
  SAFE_AUTO: 'SAFE_AUTO',
  REVIEW_RECOMMENDED: 'REVIEW_RECOMMENDED',
  BLOCKED: 'BLOCKED',
});

export const DEFAULT_LAYOUT_BOUNDS = Object.freeze({
  minScale: 0.7,
  maxScale: 2.5,
  step: 0.05,
});

const DEFAULT_BACKGROUND_COLOR = '#101514';

export function clamp(value, min, max) {
  const lower = Number.isFinite(min) ? min : value;
  const upper = Number.isFinite(max) ? max : value;
  return Math.min(Math.max(value, lower), upper);
}

export function roundEven(value, fallback = 2) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  let rounded = Math.round(value);
  if (rounded % 2 !== 0) rounded += 1;
  return Math.max(fallback, rounded);
}

function floorEven(value, fallback = 2) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  let rounded = Math.floor(value);
  if (rounded % 2 !== 0) rounded -= 1;
  return Math.max(fallback, rounded);
}

export function parseAspectRatio(aspectRatio, fallback = 1) {
  const [w, h] = String(aspectRatio || '').split(':').map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return fallback;
  return w / h;
}

export function normalizeSafeZoneGuide(guide = {}) {
  return {
    leftPercent: clamp(Number(guide.leftPercent ?? guide.sidePercent ?? 0.06), 0, 0.45),
    rightPercent: clamp(Number(guide.rightPercent ?? guide.sidePercent ?? 0.06), 0, 0.45),
    topPercent: clamp(Number(guide.topPercent ?? 0.1), 0, 0.45),
    bottomPercent: clamp(Number(guide.bottomPercent ?? 0.16), 0, 0.45),
  };
}

export function buildSafeRect(target) {
  const guide = normalizeSafeZoneGuide(target?.safeZoneGuide);
  const width = Math.max(2, target.width * (1 - guide.leftPercent - guide.rightPercent));
  const height = Math.max(2, target.height * (1 - guide.topPercent - guide.bottomPercent));
  return {
    x: target.width * guide.leftPercent,
    y: target.height * guide.topPercent,
    width,
    height,
  };
}

export function normalizeRiskZones(target) {
  const guide = normalizeSafeZoneGuide(target?.safeZoneGuide);
  const source = Array.isArray(target?.riskZones) && target.riskZones.length
    ? target.riskZones
    : [
        {
          id: 'top',
          label: 'Top UI',
          color: 'rgba(255, 191, 71, 0.20)',
          topPercent: 0,
          leftPercent: 0,
          rightPercent: 0,
          bottomPercent: 1 - guide.topPercent,
        },
        {
          id: 'bottom',
          label: 'Bottom UI',
          color: 'rgba(255, 99, 71, 0.22)',
          topPercent: 1 - guide.bottomPercent,
          leftPercent: 0,
          rightPercent: 0,
          bottomPercent: 0,
        },
        {
          id: 'left',
          label: 'Side UI',
          color: 'rgba(120, 124, 255, 0.18)',
          topPercent: guide.topPercent,
          leftPercent: 0,
          rightPercent: 1 - guide.leftPercent,
          bottomPercent: guide.bottomPercent,
        },
        {
          id: 'right',
          label: 'Side UI',
          color: 'rgba(120, 124, 255, 0.18)',
          topPercent: guide.topPercent,
          leftPercent: 1 - guide.rightPercent,
          rightPercent: 0,
          bottomPercent: guide.bottomPercent,
        },
      ];

  return source.map((zone, index) => ({
    id: zone.id || `zone_${index + 1}`,
    label: zone.label || `Zone ${index + 1}`,
    color: zone.color || 'rgba(255, 191, 71, 0.18)',
    topPercent: clamp(Number(zone.topPercent ?? 0), 0, 1),
    leftPercent: clamp(Number(zone.leftPercent ?? 0), 0, 1),
    rightPercent: clamp(Number(zone.rightPercent ?? 0), 0, 1),
    bottomPercent: clamp(Number(zone.bottomPercent ?? 0), 0, 1),
    note: zone.note || '',
  }));
}

export function buildDefaultLayoutOverride(target) {
  const layoutDefaults = target?.layoutDefaults || {};
  const bounds = resolveLayoutBounds(target);
  return {
    scale: clamp(Number(layoutDefaults.scale ?? 1), bounds.minScale, bounds.maxScale),
    anchorX: clamp(Number(layoutDefaults.anchorX ?? 0.5), 0, 1),
    anchorY: clamp(Number(layoutDefaults.anchorY ?? 0.5), 0, 1),
    backgroundMode: layoutDefaults.backgroundMode || 'edge-extend',
    backgroundColor: layoutDefaults.backgroundColor || DEFAULT_BACKGROUND_COLOR,
  };
}

export function normalizeLayoutOverride(target, override = {}) {
  const fallback = buildDefaultLayoutOverride(target);
  const bounds = resolveLayoutBounds(target);
  return {
    scale: clamp(Number(override.scale ?? fallback.scale), bounds.minScale, bounds.maxScale),
    anchorX: clamp(Number(override.anchorX ?? fallback.anchorX), 0, 1),
    anchorY: clamp(Number(override.anchorY ?? fallback.anchorY), 0, 1),
    backgroundMode: override.backgroundMode || fallback.backgroundMode,
    backgroundColor: override.backgroundColor || fallback.backgroundColor,
  };
}

export function calculateLayout({ sourceWidth, sourceHeight, target, override = {} }) {
  const rawOverride = override || {};
  const safeRect = buildSafeRect(target);
  const bounds = resolveLayoutBounds(target);
  const resolved = normalizeLayoutOverride(target, rawOverride);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return {
      canvas: { width: target.width, height: target.height },
      safeRect,
      layout: resolved,
      maxScale: 1,
      baseScale: 0,
      canvasFitScale: 0,
      foregroundRect: { x: 0, y: 0, width: 0, height: 0 },
      reviewState: REVIEW_STATE.BLOCKED,
      reviewReasons: ['Missing source dimensions.'],
      metrics: {
        canvasCoverage: 0,
        safeCoverage: 0,
        ratioDelta: 0,
        horizontalPaddingPercent: 1,
        verticalPaddingPercent: 1,
      },
    };
  }

  const baseScale = Math.min(safeRect.width / sourceWidth, safeRect.height / sourceHeight);
  const canvasFitScale = Math.min(target.width / sourceWidth, target.height / sourceHeight);
  const computedMaxScale = Math.max(1, canvasFitScale / baseScale);
  const maxScale = clamp(Math.min(computedMaxScale, bounds.maxScale), bounds.minScale, Math.max(bounds.minScale, bounds.maxScale));
  const scaleMultiplier = clamp(resolved.scale, bounds.minScale, maxScale);
  const actualScale = baseScale * scaleMultiplier;
  const strictSafeBounds = getStrictSafeBounds(safeRect);
  const fitMaxWidth = target?.complianceMode === 'ads-safe-strict'
    ? Math.min(target.width, floorEven(strictSafeBounds.width))
    : target.width;
  const fitMaxHeight = target?.complianceMode === 'ads-safe-strict'
    ? Math.min(target.height, floorEven(strictSafeBounds.height))
    : target.height;
  const size = fitSourceIntoCanvas(sourceWidth, sourceHeight, actualScale, fitMaxWidth, fitMaxHeight);
  const availableX = Math.max(0, target.width - size.width);
  const availableY = Math.max(0, target.height - size.height);
  const positionBounds = getPositionBounds(target, safeRect, strictSafeBounds, size.width, size.height, availableX, availableY);
  const defaultPosition = getSafeCenteredPosition(positionBounds);
  const anchorX = rawOverride.anchorX == null ? defaultPosition.anchorX : resolved.anchorX;
  const anchorY = rawOverride.anchorY == null ? defaultPosition.anchorY : resolved.anchorY;
  const x = Math.round(positionBounds.minX + (positionBounds.maxX - positionBounds.minX) * anchorX);
  const y = Math.round(positionBounds.minY + (positionBounds.maxY - positionBounds.minY) * anchorY);
  const foregroundRect = {
    x,
    y,
    width: size.width,
    height: size.height,
  };

  const metrics = calculateMetrics(target, safeRect, foregroundRect, sourceWidth, sourceHeight);
  const review = evaluateLayoutReview({ target, foregroundRect, safeRect, metrics, sourceWidth, sourceHeight });

  return {
    canvas: { width: target.width, height: target.height },
    safeRect,
    layout: {
      ...resolved,
      scale: scaleMultiplier,
      anchorX,
      anchorY,
    },
    maxScale,
    baseScale,
    canvasFitScale,
    foregroundRect,
    reviewState: review.state,
    reviewReasons: review.reasons,
    metrics,
  };
}

export function buildProfileDetails(profile) {
  const supported = Array.isArray(profile.supportedAspectRatios) && profile.supportedAspectRatios.length
    ? profile.supportedAspectRatios.join(' | ')
    : profile.aspectRatio;
  const notes = Array.isArray(profile.previewNotes) ? profile.previewNotes.join(' ') : '';
  const safeNotes = Array.isArray(profile.safeZoneNotes) ? profile.safeZoneNotes.join(' ') : '';

  return [
    { key: 'target_format', label: 'Target format', value: profile.label, multiline: false, order: 1 },
    { key: 'placement', label: 'Placement', value: profile.placement, multiline: false, order: 2 },
    { key: 'output_ratio', label: 'Ti le output', value: profile.aspectRatio, multiline: false, order: 3 },
    { key: 'output_resolution', label: 'Resolution output', value: `${profile.width} x ${profile.height}`, multiline: false, order: 4 },
    { key: 'recommended_ratio', label: 'Ti le khuyen nghi', value: profile.recommendedAspectRatio || profile.aspectRatio, multiline: false, order: 5 },
    { key: 'supported_ratio', label: 'Ho tro / ghi chu', value: supported, multiline: true, order: 6 },
    { key: 'minimum_resolution', label: 'Resolution ho tro toi thieu', value: profile.recommendedMinResolution || `${profile.minWidth} x ${profile.minHeight}`, multiline: false, order: 7 },
    { key: 'safe_zone', label: 'Luu y safe zone', value: safeNotes, multiline: true, order: 8 },
    { key: 'preview_notes', label: 'Ghi chu target', value: notes, multiline: true, order: 9 },
  ];
}

export function serializeProfileForClient(profile) {
  return {
    ...profile,
    previewLabel: profile.label,
    safeZoneGuide: normalizeSafeZoneGuide(profile.safeZoneGuide),
    riskZones: normalizeRiskZones(profile),
    details: buildProfileDetails(profile),
    layoutDefaults: buildDefaultLayoutOverride(profile),
    outputResolutionLabel: `${profile.width} x ${profile.height}`,
  };
}

export function listBackgroundModes() {
  return BACKGROUND_MODES.map(mode => ({ ...mode }));
}

function fitSourceIntoCanvas(sourceWidth, sourceHeight, scale, maxWidth, maxHeight) {
  let width = roundEven(sourceWidth * scale);
  let height = roundEven(sourceHeight * scale);

  if (width > maxWidth || height > maxHeight) {
    const correction = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
    width = roundEven(sourceWidth * correction);
    height = roundEven(sourceHeight * correction);
  }

  if (width > maxWidth) width = roundEven(maxWidth);
  if (height > maxHeight) height = roundEven(maxHeight);

  while ((width > maxWidth || height > maxHeight) && width > 2 && height > 2) {
    width -= width % 2 === 0 ? 2 : 1;
    height -= height % 2 === 0 ? 2 : 1;
  }

  return { width: Math.max(2, width), height: Math.max(2, height) };
}

function getSafeCenteredPosition(positionBounds) {
  const centeredX = (positionBounds.minX + positionBounds.maxX) / 2;
  const centeredY = (positionBounds.minY + positionBounds.maxY) / 2;
  return {
    anchorX: positionBounds.maxX > positionBounds.minX ? (centeredX - positionBounds.minX) / (positionBounds.maxX - positionBounds.minX) : 0.5,
    anchorY: positionBounds.maxY > positionBounds.minY ? (centeredY - positionBounds.minY) / (positionBounds.maxY - positionBounds.minY) : 0.5,
  };
}

function getPositionBounds(target, safeRect, strictSafeBounds, width, height, availableX, availableY) {
  if (target?.complianceMode !== 'ads-safe-strict') {
    return {
      minX: 0,
      maxX: availableX,
      minY: 0,
      maxY: availableY,
    };
  }

  const minX = clamp(strictSafeBounds.minX, 0, availableX);
  const maxX = clamp(strictSafeBounds.maxX - width, minX, availableX);
  const minY = clamp(strictSafeBounds.minY, 0, availableY);
  const maxY = clamp(strictSafeBounds.maxY - height, minY, availableY);
  return { minX, maxX, minY, maxY };
}

function resolveLayoutBounds(target) {
  const source = target?.layoutBounds || {};
  const minScale = clamp(Number(source.minScale ?? DEFAULT_LAYOUT_BOUNDS.minScale), 0.1, DEFAULT_LAYOUT_BOUNDS.maxScale);
  const maxScale = clamp(Number(source.maxScale ?? DEFAULT_LAYOUT_BOUNDS.maxScale), minScale, DEFAULT_LAYOUT_BOUNDS.maxScale);
  const step = clamp(Number(source.step ?? DEFAULT_LAYOUT_BOUNDS.step), 0.01, 1);
  return { minScale, maxScale, step };
}

function getStrictSafeBounds(safeRect) {
  const minX = Math.ceil(safeRect.x);
  const maxX = Math.floor(safeRect.x + safeRect.width);
  const minY = Math.ceil(safeRect.y);
  const maxY = Math.floor(safeRect.y + safeRect.height);
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(2, maxX - minX),
    height: Math.max(2, maxY - minY),
  };
}

function calculateMetrics(target, safeRect, foregroundRect, sourceWidth, sourceHeight) {
  const canvasArea = target.width * target.height;
  const safeArea = safeRect.width * safeRect.height;
  const foregroundArea = foregroundRect.width * foregroundRect.height;
  const targetRatio = target.width / target.height;
  const sourceRatio = sourceWidth / sourceHeight;
  return {
    canvasCoverage: canvasArea > 0 ? foregroundArea / canvasArea : 0,
    safeCoverage: safeArea > 0 ? foregroundArea / safeArea : 0,
    ratioDelta: targetRatio > 0 ? Math.abs(sourceRatio - targetRatio) / targetRatio : 0,
    horizontalPaddingPercent: target.width > 0 ? (target.width - foregroundRect.width) / target.width : 0,
    verticalPaddingPercent: target.height > 0 ? (target.height - foregroundRect.height) / target.height : 0,
  };
}

function evaluateLayoutReview({ foregroundRect, safeRect, metrics, sourceWidth, sourceHeight }) {
  const reasons = [];
  if (foregroundRect.x < safeRect.x || foregroundRect.y < safeRect.y || foregroundRect.x + foregroundRect.width > safeRect.x + safeRect.width || foregroundRect.y + foregroundRect.height > safeRect.y + safeRect.height) {
    reasons.push('Full frame is outside the safe zone.');
  }
  if (metrics.canvasCoverage < 0.34 || metrics.safeCoverage < 0.58) {
    reasons.push('Content becomes small because source and target ratios differ too much.');
  }
  if (metrics.ratioDelta > 0.45) {
    reasons.push('Large ratio mismatch should be reviewed before export.');
  }
  if (Math.max(metrics.horizontalPaddingPercent, metrics.verticalPaddingPercent) > 0.42) {
    reasons.push('Border area is large and should be reviewed.');
  }
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
    reasons.push('Source dimensions are invalid.');
  }

  return {
    state: reasons.length ? REVIEW_STATE.REVIEW_RECOMMENDED : REVIEW_STATE.SAFE_AUTO,
    reasons,
  };
}
