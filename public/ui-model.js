export function getSelectionState(assetIds, selectedAssetIds) {
  const uploadedCount = assetIds.length;
  const selectedCount = assetIds.filter(id => selectedAssetIds.has(id)).length;
  const allSelected = uploadedCount > 0 && selectedCount === uploadedCount;
  const noneSelected = selectedCount === 0;
  const partiallySelected = !noneSelected && !allSelected;

  return {
    uploadedCount,
    selectedCount,
    allSelected,
    noneSelected,
    partiallySelected,
  };
}

export function mergeSelectedAssetIds(currentSelectedAssetIds, newAssets) {
  const next = new Set(currentSelectedAssetIds);
  for (const asset of newAssets) {
    if (asset?.id) next.add(asset.id);
  }
  return next;
}

export function toggleAllAssetIds(assetIds, shouldSelect) {
  return shouldSelect ? new Set(assetIds) : new Set();
}

export function layoutOverrideKey(assetId, targetId) {
  return `${assetId}:${targetId}`;
}

export function buildCreateJobPayload({
  assets,
  selectedAssetIds,
  targetIds,
  profiles,
  settings,
  music,
  useOriginalKeys,
  layoutOverrides,
}) {
  const assetIds = assets
    .map(asset => asset.id)
    .filter(assetId => selectedAssetIds.has(assetId));
  const resolvedTargetIds = Array.isArray(profiles)
    ? profiles.filter(profile => profile.enabled !== false).map(profile => profile.id)
    : (Array.isArray(targetIds) ? targetIds : []);
  const overrides = [];
  const sourceOverrides = layoutOverrides || {};

  for (const assetId of assetIds) {
    for (const targetId of resolvedTargetIds) {
      const key = layoutOverrideKey(assetId, targetId);
      const override = sourceOverrides[key];
      if (!override) continue;
      overrides.push({
        assetId,
        targetId,
        scale: override.scale,
        anchorX: override.anchorX,
        anchorY: override.anchorY,
        backgroundMode: override.backgroundMode,
        backgroundColor: override.backgroundColor,
      });
    }
  }

  return {
    assetIds,
    targetIds: resolvedTargetIds,
    smartSkip: settings.smartSkip,
    forceConvert: settings.forceConvert,
    layoutMode: settings.layoutMode,
    audioMode: settings.audioMode,
    qualityMode: settings.qualityMode,
    musicAssetId: music?.id || null,
    useOriginalKeys: Array.from(useOriginalKeys),
    layoutOverrides: overrides,
  };
}
