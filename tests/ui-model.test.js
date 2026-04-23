import { describe, expect, it } from 'vitest';
import {
  buildCreateJobPayload,
  getSelectionState,
  isTerminalJobStatus,
  mergeSelectedAssetIds,
  shouldPersistLastJob,
  toggleAllAssetIds,
} from '../public/ui-model.js';

describe('ui selection model', () => {
  it('auto-selects newly uploaded assets without dropping previous selection', () => {
    const next = mergeSelectedAssetIds(new Set(['a1']), [{ id: 'a2' }, { id: 'a3' }]);
    expect(Array.from(next).sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('reports selection counters and partial select-all state', () => {
    const state = getSelectionState(['a1', 'a2', 'a3'], new Set(['a1', 'a3']));
    expect(state.uploadedCount).toBe(3);
    expect(state.selectedCount).toBe(2);
    expect(state.partiallySelected).toBe(true);
    expect(state.allSelected).toBe(false);
  });

  it('toggles select all on and off', () => {
    const selected = toggleAllAssetIds(['a1', 'a2'], true);
    expect(Array.from(selected).sort()).toEqual(['a1', 'a2']);
    expect(toggleAllAssetIds(['a1', 'a2'], false).size).toBe(0);
  });

  it('treats complete, failed, and cancelled jobs as terminal', () => {
    expect(isTerminalJobStatus('complete')).toBe(true);
    expect(isTerminalJobStatus('failed')).toBe(true);
    expect(isTerminalJobStatus('cancelled')).toBe(true);
    expect(isTerminalJobStatus('running')).toBe(false);
  });

  it('only persists active jobs as last job', () => {
    expect(shouldPersistLastJob({ id: 'j1', status: 'queued' })).toBe(true);
    expect(shouldPersistLastJob({ id: 'j1', status: 'running' })).toBe(true);
    expect(shouldPersistLastJob({ id: 'j1', status: 'complete' })).toBe(false);
    expect(shouldPersistLastJob(null)).toBe(false);
  });

  it('builds job payload from selected asset ids only', () => {
    const payload = buildCreateJobPayload({
      assets: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
      selectedAssetIds: new Set(['a1', 'a3']),
      profiles: [
        { id: 'tiktok_vertical_9x16', enabled: true },
        { id: 'meta_feed_4x5', enabled: true },
        { id: 'meta_square_1x1', enabled: false },
      ],
      settings: {
        smartSkip: true,
        forceConvert: false,
        layoutMode: 'content-safe',
        audioMode: 'keep',
        qualityMode: 'high',
      },
      music: null,
      useOriginalKeys: new Set(['a1:tiktok_vertical_9x16']),
      layoutOverrides: {
        'a1:tiktok_vertical_9x16': {
          scale: 1,
          anchorX: 0.5,
          anchorY: 0.5,
          backgroundMode: 'edge-extend',
          backgroundColor: '#101514',
        },
      },
    });

    expect(payload.assetIds).toEqual(['a1', 'a3']);
    expect(payload.targetIds).toEqual(['tiktok_vertical_9x16', 'meta_feed_4x5']);
    expect(payload.useOriginalKeys).toEqual(['a1:tiktok_vertical_9x16']);
    expect(payload.layoutMode).toBe('content-safe');
    expect(payload.layoutOverrides).toHaveLength(1);
  });
});
