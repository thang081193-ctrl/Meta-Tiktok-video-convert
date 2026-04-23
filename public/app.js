import {
  REVIEW_STATE,
  buildDefaultLayoutOverride,
  calculateLayout,
} from './layout-core.js';
import {
  buildCreateJobPayload,
  getSelectionState,
  isTerminalJobStatus,
  layoutOverrideKey,
  mergeSelectedAssetIds,
  shouldPersistLastJob,
  toggleAllAssetIds,
} from './ui-model.js';

const app = document.getElementById('app');

const state = {
  health: null,
  specs: null,
  profiles: [],
  enabledTargetIds: [],
  assets: [],
  selectedAssetIds: new Set(),
  selectedAssetId: null,
  selectedTargetId: null,
  music: null,
  job: null,
  pollTimer: null,
  uploading: false,
  musicUploading: false,
  settings: {
    smartSkip: true,
    forceConvert: false,
    layoutMode: 'content-safe',
    audioMode: 'keep',
    qualityMode: 'high',
  },
  useOriginalKeys: new Set(),
  layoutOverrides: {},
  profileManager: {
    open: false,
    mode: 'create',
    draft: null,
    editingId: null,
    busy: false,
  },
};

init();

async function init() {
  await refreshCoreState();

  const lastJobId = localStorage.getItem('lastJobId');
  if (lastJobId) {
    const restoredJob = await api(`/api/jobs/${lastJobId}`).catch(() => null);
    if (shouldPersistLastJob(restoredJob)) {
      state.job = restoredJob;
      startPolling();
    } else {
      state.job = null;
      clearStoredJob();
    }
  }

  render();
}

async function refreshCoreState() {
  const [health, specs, profilePayload] = await Promise.all([
    api('/api/health').catch(err => ({ ok: false, error: err.message })),
    api('/api/specs'),
    api('/api/profiles'),
  ]);

  state.health = health;
  state.specs = specs;
  state.profiles = profilePayload.profiles || [];
  state.enabledTargetIds = profilePayload.enabledTargetIds || [];
  state.settings = { ...state.settings, ...specs.defaults };

  const currentEnabled = getEnabledProfiles();
  if (!currentEnabled.length) {
    state.selectedTargetId = null;
  } else if (!currentEnabled.some(profile => profile.id === state.selectedTargetId)) {
    state.selectedTargetId = currentEnabled[0].id;
  }
}

function render() {
  const asset = getSelectedAsset();
  const target = getSelectedTarget();
  const classification = asset && target ? asset.classifications?.[target.id] : null;
  const layoutContext = asset && target && !asset.error ? getLayoutContext(asset, target) : null;

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">MT</div>
          <div>
            <h1>Meta/TikTok Video Converter</h1>
            <p>${esc(healthText())}</p>
          </div>
        </div>
        <div class="top-actions">
          ${badge(state.health?.ok ? 'Sẵn sàng' : 'FFmpeg lỗi', state.health?.ok ? 'ready' : 'fail')}
          <button class="btn" id="profiles-open-btn">${icon('layers')}Profiles</button>
          <a class="btn" href="/api/specs" target="_blank" rel="noopener">${icon('file')}Specs</a>
        </div>
      </header>
      <main class="workspace">
        ${renderLeftPanel()}
        ${renderPreviewPanel(asset, target, classification, layoutContext)}
        ${renderRightPanel(asset)}
      </main>
      ${state.profileManager.open ? renderProfileManager() : ''}
    </div>
  `;

  bindEvents();
  renderJobPanel();
}

function renderLeftPanel() {
  const assetIds = state.assets.map(asset => asset.id);
  const selection = getSelectionState(assetIds, state.selectedAssetIds);

  return `
    <section class="panel left-panel">
      <div class="panel-header">
        <div>
          <h2>Nguồn video</h2>
          <p class="panel-subtitle">${selection.selectedCount} đã chọn / ${selection.uploadedCount} đã upload</p>
        </div>
        <span class="small muted">${state.assets.length}/${state.health?.limits?.maxFilesPerUpload || 30}</span>
      </div>
      <div class="panel-body">
        <label class="dropzone" id="dropzone">
          <input id="video-input" class="hidden" type="file" multiple accept="video/*">
          <span>
            <strong>${state.uploading ? 'Đang phân tích...' : 'Thả video vào đây'}</strong>
            <span>MP4/MOV, tối đa ${formatBytes(state.health?.limits?.maxFileSizeBytes || 0)} mỗi file</span>
          </span>
        </label>

        <div class="asset-toolbar">
          <label class="checkbox-row">
            <input id="select-all-assets" type="checkbox" ${selection.allSelected ? 'checked' : ''}>
            <span>Chọn tất cả</span>
          </label>
          <span class="small muted">${selection.noneSelected ? 'Chưa chọn video để convert' : `${selection.selectedCount} video sẽ được convert`}</span>
        </div>

        <div class="asset-list">
          ${state.assets.map(renderAssetItem).join('') || '<p class="small muted">Chưa có video.</p>'}
        </div>
      </div>
    </section>
  `;
}

function renderAssetItem(asset) {
  const aggregate = aggregateStatus(asset);
  const selectedForPreview = asset.id === state.selectedAssetId;
  const selectedForJob = state.selectedAssetIds.has(asset.id);
  const video = asset.analysis?.video;

  return `
    <article class="asset-item ${selectedForPreview ? 'active' : ''}">
      <div class="asset-item-row">
        <label class="checkbox-row asset-checkbox">
          <input type="checkbox" data-asset-select="${esc(asset.id)}" ${selectedForJob ? 'checked' : ''}>
        </label>
        <button class="asset-open" data-asset-open="${esc(asset.id)}">
          <div class="asset-title">
            <strong class="truncate">${esc(asset.originalName)}</strong>
            ${badge(aggregate.label, aggregate.className)}
          </div>
          <div class="meta-line">
            <span>${esc(asset.sizeLabel || formatBytes(asset.sizeBytes))}</span>
            ${video ? `<span>${video.displayWidth}x${video.displayHeight}</span><span>${Number(video.fps || 0).toFixed(1)} fps</span>` : ''}
          </div>
        </button>
      </div>
    </article>
  `;
}

function renderPreviewPanel(asset, target, classification, layoutContext) {
  return `
    <section class="panel preview-panel">
      <div class="panel-header preview-header">
        <div>
          <h2>Preview</h2>
          <p class="panel-subtitle">${asset ? esc(asset.originalName) : 'Chọn một video để preview'}</p>
        </div>
        <div class="preview-header-badges">
          ${classification ? badge(statusLabel(classification.status), statusClass(classification.status)) : ''}
          ${classification ? badge(reviewLabel(classification.reviewState), reviewClass(classification.reviewState)) : ''}
        </div>
      </div>

      <div class="preview-toolbar">
        <div class="target-tabs">
          ${getEnabledProfiles().map(profile => `
            <button class="target-tab ${profile.id === state.selectedTargetId ? 'active' : ''}" data-target-tab="${profile.id}">
              ${esc(profile.label)}
            </button>
          `).join('') || '<span class="small muted">Chưa có profile đang bật.</span>'}
        </div>
      </div>

      <div class="preview-stage">
        ${asset?.previewUrl && !asset.error && target && layoutContext
          ? renderPreviewCanvas(asset, target, layoutContext)
          : '<div class="preview-empty">Chọn một video và một profile đang bật để xem layout an toàn.</div>'}
      </div>

      ${renderPreviewInspector(asset, target, classification, layoutContext)}
    </section>
  `;
}

function renderPreviewCanvas(asset, target, layoutContext) {
  const layout = layoutContext.layout;
  const targetStyle = `--preview-ratio:${target.width} / ${target.height}`;
  const rectStyle = toCanvasRectStyle(layout.foregroundRect, target);
  const safeStyle = toCanvasRectStyle(layout.safeRect, target);
  const backgroundMode = layout.layout.backgroundMode;
  const backgroundColor = layout.layout.backgroundColor;

  return `
    <div class="preview-canvas-shell">
      <div class="preview-canvas" style="${targetStyle}">
        <div class="preview-canvas-solid" style="background:${esc(backgroundColor)}"></div>
        <div class="preview-canvas-media preview-bg ${backgroundClass(backgroundMode)}">
          ${asset.thumbnailUrl ? `<img class="preview-bg-image" src="${asset.thumbnailUrl}" alt="">` : ''}
          ${asset.previewUrl ? `<video class="preview-bg-video" src="${asset.previewUrl}" muted autoplay loop playsinline></video>` : ''}
        </div>
        ${target.riskZones.map(zone => `
          <div class="risk-zone" style="${toZoneStyle(zone)}; background:${esc(zone.color)}" title="${esc(zone.label)}"></div>
        `).join('')}
        <div class="safe-zone" style="${safeStyle}"></div>
        <div class="preview-foreground" style="${rectStyle}">
          <video class="preview-video" src="${asset.previewUrl}" controls playsinline></video>
        </div>
        <div class="preview-canvas-outline"></div>
      </div>
    </div>
  `;
}

function renderPreviewInspector(asset, target, classification, layoutContext) {
  if (!target || !layoutContext) {
    return '<div class="preview-inspector"><p class="small muted">Chưa có dữ liệu preview.</p></div>';
  }

  const { layout } = layoutContext;
  const strictMode = target.complianceMode === 'ads-safe-strict';
  const dynamicDetails = [
    ...target.details,
    {
      key: 'source_view',
      label: 'Source đang xem',
      value: asset?.analysis?.video ? `${asset.analysis.video.displayWidth}x${asset.analysis.video.displayHeight} • ${Number(asset.analysis.video.fps || 0).toFixed(1)} fps` : 'Không có dữ liệu',
    },
    {
      key: 'content_frame',
      label: 'Khung content',
      value: `${layout.foregroundRect.width} x ${layout.foregroundRect.height}`,
    },
    {
      key: 'background_mode',
      label: 'Background fill',
      value: backgroundLabel(layout.layout.backgroundMode),
    },
    {
      key: 'canvas_coverage',
      label: 'Canvas coverage',
      value: `${Math.round(layout.metrics.canvasCoverage * 100)}%`,
    },
    {
      key: 'safe_coverage',
      label: 'Safe zone coverage',
      value: `${Math.round(layout.metrics.safeCoverage * 100)}%`,
    },
  ];

  return `
    <div class="preview-inspector">
      <div class="editor-grid">
        <div class="editor-card">
          <div class="editor-card-header">
            <strong>${strictMode ? 'No-Crop Ads Safe Mode' : 'Layout editor'}</strong>
            <button class="btn small-btn" data-layout-reset>Auto-safe reset</button>
          </div>
          ${strictMode ? '<p class="small muted">Full frame stays inside the safe zone. Built-in ad profiles always render a fresh MP4.</p>' : ''}
          <div class="field">
            <label for="layout-scale">Content size</label>
            <input id="layout-scale" type="range" min="0.70" max="${Math.max(1, layout.maxScale).toFixed(2)}" step="0.05" value="${layout.layout.scale.toFixed(2)}">
            <small>${Math.round(layout.layout.scale * 100)}% của safe-fit, tối đa ${Math.round(layout.maxScale * 100)}%</small>
          </div>
          <div class="field">
            <label for="layout-anchor-x">Horizontal position</label>
            <input id="layout-anchor-x" type="range" min="0" max="1" step="0.01" value="${layout.layout.anchorX.toFixed(2)}">
          </div>
          <div class="field">
            <label for="layout-anchor-y">Vertical position</label>
            <input id="layout-anchor-y" type="range" min="0" max="1" step="0.01" value="${layout.layout.anchorY.toFixed(2)}">
          </div>
          <div class="field">
            <label for="background-mode">Background fill</label>
            <select id="background-mode">
              ${(state.specs?.ui?.backgroundModes || []).map(mode => `
                <option value="${mode.id}" ${mode.id === layout.layout.backgroundMode ? 'selected' : ''}>${esc(mode.label)}</option>
              `).join('')}
            </select>
          </div>
          <label class="field ${layout.layout.backgroundMode === 'solid' ? '' : 'hidden'}">
            <span>Background color</span>
            <input id="background-color" type="color" value="${esc(layout.layout.backgroundColor || '#101514')}">
          </label>
        </div>

        <div class="editor-card">
          <div class="editor-card-header">
            <strong>Review</strong>
            ${badge(reviewLabel(classification?.reviewState), reviewClass(classification?.reviewState))}
          </div>
          ${classification?.reviewReasons?.length
            ? `<ul class="note-list">${classification.reviewReasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>`
            : '<p class="small muted">Auto-safe layout đang giữ toàn bộ content trong safe zone.</p>'}
        </div>
      </div>

      <div class="details-grid">
        ${dynamicDetails.map(detail => `
          <div class="detail-card ${detail.multiline ? 'wide' : ''}">
            <span class="detail-label">${esc(detail.label)}</span>
            <strong>${esc(detail.value)}</strong>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderRightPanel(asset) {
  return `
    <section class="panel right-panel">
      <div class="panel-header">
        <h2>Bundle output</h2>
        <button class="btn primary" id="convert-btn" ${canConvert() ? '' : 'disabled'}>${icon('play')}Convert</button>
      </div>
      <div class="panel-body">
        ${renderSettings()}
        <hr class="section-divider">
        <div class="target-list">
          ${asset ? getEnabledProfiles().map(profile => renderTargetRow(asset, profile)).join('') : '<p class="small muted">Upload video để xem phân loại từng target.</p>'}
        </div>
      </div>
      <div class="job-panel" id="job-panel"></div>
    </section>
  `;
}

function renderSettings() {
  const selection = getSelectionState(state.assets.map(asset => asset.id), state.selectedAssetIds);

  return `
    <div class="settings-grid">
      <div class="switch-row">
        <div><span>Smart Skip</span><small>Bỏ qua target đã đủ điều kiện.</small></div>
        <input id="smart-skip" type="checkbox" ${state.settings.smartSkip ? 'checked' : ''}>
      </div>
      <div class="switch-row">
        <div><span>Force Convert</span><small>Convert lại toàn bộ target hợp lệ.</small></div>
        <input id="force-convert" type="checkbox" ${state.settings.forceConvert ? 'checked' : ''}>
      </div>
      <div class="switch-row">
        <div><span>Layout mode</span><small>Content-safe mode luôn giữ trọn khung nguồn.</small></div>
        <strong class="small">Content-safe</strong>
      </div>
      <div class="switch-row">
        <div><span>Selected videos</span><small>Chỉ convert những video đang được chọn ở cột Nguồn video.</small></div>
        <strong class="small">${selection.selectedCount}</strong>
      </div>
      <div class="switch-row">
        <div><span>Enabled profiles</span><small>Convert theo các profile đang bật trong Profile Manager.</small></div>
        <strong class="small">${getEnabledProfiles().length}</strong>
      </div>
      <div class="field">
        <label for="audio-mode">Audio</label>
        <select id="audio-mode">
          <option value="keep" ${sel(state.settings.audioMode, 'keep')}>Keep original</option>
          <option value="mute" ${sel(state.settings.audioMode, 'mute')}>Mute</option>
          <option value="replace" ${sel(state.settings.audioMode, 'replace')}>Replace with music</option>
          <option value="mix" ${sel(state.settings.audioMode, 'mix')}>Mix original + music</option>
        </select>
      </div>
      <label class="field ${['replace', 'mix'].includes(state.settings.audioMode) ? '' : 'hidden'}">
        <span>Music file</span>
        <input id="music-input" class="file-input-proxy" type="file" accept="audio/*,video/*">
        <small class="muted">${state.musicUploading ? 'Đang upload music...' : (state.music ? `Đã chọn: ${esc(state.music.originalName)}` : 'Chưa chọn music.')}</small>
      </label>
      <div class="field">
        <label>Quality</label>
        <div class="segmented">
          ${(state.specs?.ui?.qualityModes || []).map(mode => `
            <button data-quality="${mode.id}" class="${state.settings.qualityMode === mode.id ? 'active' : ''}">${esc(mode.label)}</button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderTargetRow(asset, target) {
  const cls = asset.classifications?.[target.id];
  const key = `${asset.id}:${target.id}`;
  const canUseOriginal = target.allowUseOriginal !== false && cls && !['CONVERT_REQUIRED', 'UNSUPPORTED'].includes(cls.status);
  const checked = canUseOriginal && (state.useOriginalKeys.has(key) || (state.settings.smartSkip && ['READY_EXACT', 'READY_ACCEPTED'].includes(cls?.status)));
  const notePool = [...(cls?.reasons || []), ...(cls?.warnings || []), ...(cls?.reviewReasons || [])];

  return `
    <div class="target-row ${target.id === state.selectedTargetId ? 'active' : ''}">
      <div class="row-title">
        <strong>${esc(target.label)}</strong>
        <div class="target-badges">
          ${badge(statusLabel(cls?.status), statusClass(cls?.status))}
          ${badge(reviewLabel(cls?.reviewState), reviewClass(cls?.reviewState))}
        </div>
      </div>
      <div class="meta-line">
        <span>${esc(target.aspectRatio)}</span>
        <span>${esc(target.width)} x ${esc(target.height)}</span>
        <span>${esc(target.platform)}</span>
      </div>
      <div class="target-note">${esc(notePool.join(' | ') || cls?.summary || 'Chưa phân tích.')}</div>
      <div class="target-actions">
        <label class="use-original ${target.allowUseOriginal === false ? 'hidden' : ''}">
          <input type="checkbox" data-use-original="${esc(key)}" ${checked ? 'checked' : ''} ${canUseOriginal ? '' : 'disabled'}>
          Dùng file gốc cho target này
        </label>
        <button class="btn small-btn" data-open-target="${esc(target.id)}">Mở editor</button>
      </div>
    </div>
  `;
}

function renderJobPanel() {
  const el = document.getElementById('job-panel');
  if (!el) return;

  if (!state.job) {
    el.innerHTML = '<p class="small muted">Chưa có job convert.</p>';
    return;
  }

  const done = isTerminalJobStatus(state.job.status);
  el.innerHTML = `
    <div class="row-title">
      <strong>Job ${esc(state.job.id.slice(0, 8))}</strong>
      ${badge(jobLabel(state.job.status), state.job.status)}
    </div>
    ${state.job.error ? `<p class="small" style="color:var(--red)">${esc(state.job.error)}</p>` : ''}
    <div class="actions-row top-gap">
      ${done ? `<a class="btn primary" href="${state.job.zipUrl}">${icon('download')}ZIP</a>` : `<button class="btn danger" id="cancel-btn">${icon('stop')}Cancel</button>`}
      ${done ? `<a class="btn" href="${state.job.reportHtmlUrl}" target="_blank" rel="noopener">${icon('report')}QA HTML</a>` : ''}
      ${done ? `<a class="btn" href="${state.job.reportUrl}" target="_blank" rel="noopener">${icon('file')}JSON</a>` : ''}
      ${done ? `<button class="btn danger" id="clear-completed-btn">${icon('trash')}Clear completed jobs</button>` : ''}
    </div>
    <div class="output-list">
      ${state.job.outputs.map(renderOutputRow).join('')}
    </div>
  `;

  const cancel = document.getElementById('cancel-btn');
  if (cancel) cancel.onclick = cancelJob;
  const clearCompleted = document.getElementById('clear-completed-btn');
  if (clearCompleted) clearCompleted.onclick = clearCompletedJobs;
}

function renderOutputRow(output) {
  const status = output.qa?.status || output.state;
  const note = output.error || output.qa?.issues?.[0] || output.qa?.warnings?.[0] || output.progressMsg || '';
  const backgroundMode = output.layoutResult?.layout?.backgroundMode || output.layoutOverride?.backgroundMode || '-';

  return `
    <div class="output-row">
      <div class="row-title">
        <strong class="truncate">${esc(output.outputName)}</strong>
        ${badge(String(status), String(status).toLowerCase())}
      </div>
      <div class="meta-line">
        <span>${esc(output.targetLabel)}</span>
        <span>${esc(output.decision)}</span>
        <span>${esc(backgroundLabel(backgroundMode))}</span>
      </div>
      <div class="progress"><span style="width:${Math.round((output.progress || 0) * 100)}%"></span></div>
      ${note ? `<p class="target-note">${esc(note)}</p>` : ''}
      ${output.downloadUrl ? `<a class="btn" href="${output.downloadUrl}">${icon('download')}Download</a>` : ''}
    </div>
  `;
}

function renderProfileManager() {
  const profiles = state.profiles;
  const draft = state.profileManager.draft;

  return `
    <div class="modal-shell">
      <div class="modal-backdrop" data-close-profiles></div>
      <div class="modal profile-modal">
        <div class="modal-header">
          <div>
            <h2>Profile Manager</h2>
            <p class="panel-subtitle">Built-in profiles là read-only seeds. Duplicate để custom.</p>
          </div>
          <button class="btn" data-close-profiles>${icon('close')}Close</button>
        </div>
        <div class="profile-layout">
          <aside class="profile-sidebar">
            <div class="actions-row">
              <button class="btn" id="profile-new-btn">${icon('plus')}New profile</button>
              <button class="btn" id="profile-export-btn">${icon('download')}Export</button>
            </div>
            <label class="btn file-btn">
              ${icon('upload')}Import JSON
              <input id="profile-import-input" class="hidden" type="file" accept="application/json">
            </label>
            <div class="profile-list">
              ${profiles.map(profile => renderProfileListItem(profile)).join('') || '<p class="small muted">Chưa có profile.</p>'}
            </div>
          </aside>
          <section class="profile-editor">
            ${draft ? renderProfileForm(draft) : '<div class="empty-editor">Chọn Duplicate hoặc New profile để chỉnh.</div>'}
          </section>
        </div>
      </div>
    </div>
  `;
}

function renderProfileListItem(profile) {
  const editing = state.profileManager.editingId === profile.id;
  return `
    <article class="profile-item ${editing ? 'active' : ''}">
      <div class="row-title">
        <strong>${esc(profile.label)}</strong>
        <div class="target-badges">
          ${badge(profile.isBuiltIn ? 'Built-in' : 'Custom', profile.isBuiltIn ? 'ready' : 'skipped')}
          ${badge(profile.enabled !== false ? 'Enabled' : 'Disabled', profile.enabled !== false ? 'ready' : 'fail')}
        </div>
      </div>
      <div class="meta-line">
        <span>${esc(profile.platform)}</span>
        <span>${esc(profile.aspectRatio)}</span>
        <span>${esc(profile.width)} x ${esc(profile.height)}</span>
      </div>
      <div class="actions-row">
        <label class="checkbox-row">
          <input type="checkbox" data-profile-enable="${esc(profile.id)}" ${profile.enabled !== false ? 'checked' : ''}>
          <span>Bật</span>
        </label>
        ${profile.isBuiltIn
          ? `<button class="btn small-btn" data-profile-duplicate="${esc(profile.id)}">${icon('copy')}Duplicate</button>`
          : `<button class="btn small-btn" data-profile-edit="${esc(profile.id)}">${icon('edit')}Edit</button>`}
        ${!profile.isBuiltIn ? `<button class="btn small-btn danger-outline" data-profile-delete="${esc(profile.id)}">${icon('trash')}Delete</button>` : ''}
      </div>
    </article>
  `;
}

function renderProfileForm(draft) {
  return `
    <div class="profile-form">
      <div class="editor-card-header">
        <strong>${state.profileManager.mode === 'edit' ? 'Edit custom profile' : 'Create/duplicate profile'}</strong>
      </div>
      <div class="profile-form-grid">
        ${renderDraftField('ID', 'draft-id', draft.id)}
        ${renderDraftField('Label', 'draft-label', draft.label)}
        ${renderDraftField('Platform', 'draft-platform', draft.platform)}
        ${renderDraftField('Placement', 'draft-placement', draft.placement, true)}
        ${renderDraftField('Width', 'draft-width', draft.width, false, 'number')}
        ${renderDraftField('Height', 'draft-height', draft.height, false, 'number')}
        ${renderDraftField('Aspect ratio', 'draft-aspect-ratio', draft.aspectRatio)}
        ${renderDraftField('Output label', 'draft-output-label', draft.outputLabel)}
        ${renderDraftField('Min width', 'draft-min-width', draft.minWidth, false, 'number')}
        ${renderDraftField('Min height', 'draft-min-height', draft.minHeight, false, 'number')}
        ${renderDraftField('FPS', 'draft-fps', draft.fps, false, 'number')}
        ${renderDraftField('Max size (MB)', 'draft-max-bytes-mb', draft.maxBytesMb, false, 'number')}
        ${renderDraftField('Duration (sec)', 'draft-max-duration-sec', draft.maxDurationSec, false, 'number')}
        ${renderDraftField('Min bitrate (kbps)', 'draft-min-bitrate-kbps', draft.minBitrateKbps, false, 'number')}
        ${renderDraftField('Warn size (MB)', 'draft-reliability-warn-mb', draft.reliabilityWarnMb, false, 'number')}
        ${renderDraftField('Recommended ratio', 'draft-recommended-ratio', draft.recommendedAspectRatio)}
        ${renderDraftField('Supported ratios', 'draft-supported-ratios', draft.supportedAspectRatiosText, true)}
        ${renderDraftField('Recommended min resolution', 'draft-min-resolution', draft.recommendedMinResolution)}
        ${renderDraftField('Preview notes', 'draft-preview-notes', draft.previewNotesText, true)}
        ${renderDraftField('Safe zone notes', 'draft-safe-notes', draft.safeZoneNotesText, true)}
        ${renderDraftField('Safe top %', 'draft-safe-top', draft.safeTop, false, 'number')}
        ${renderDraftField('Safe bottom %', 'draft-safe-bottom', draft.safeBottom, false, 'number')}
        ${renderDraftField('Safe left %', 'draft-safe-left', draft.safeLeft, false, 'number')}
        ${renderDraftField('Safe right %', 'draft-safe-right', draft.safeRight, false, 'number')}
        ${renderDraftField('Default scale', 'draft-layout-scale', draft.layoutScale, false, 'number')}
        <label class="field">
          <span>Default background</span>
          <select id="draft-background-mode">
            ${(state.specs?.ui?.backgroundModes || []).map(mode => `
              <option value="${mode.id}" ${mode.id === draft.backgroundMode ? 'selected' : ''}>${esc(mode.label)}</option>
            `).join('')}
          </select>
        </label>
        ${renderDraftField('Background color', 'draft-background-color', draft.backgroundColor, false, 'color')}
        ${renderDraftField('Risk zones JSON', 'draft-risk-zones', draft.riskZonesJson, true)}
      </div>
      <div class="actions-row top-gap">
        <button class="btn primary" id="profile-save-btn" ${state.profileManager.busy ? 'disabled' : ''}>${icon('save')}Save</button>
        <button class="btn" id="profile-cancel-btn">Cancel</button>
      </div>
    </div>
  `;
}

function renderDraftField(label, id, value, multiline = false, type = 'text') {
  if (type === 'color') {
    return `
      <label class="field">
        <span>${esc(label)}</span>
        <input id="${id}" type="color" value="${esc(value || '#101514')}">
      </label>
    `;
  }

  if (multiline) {
    return `
      <label class="field field-wide">
        <span>${esc(label)}</span>
        <textarea id="${id}" rows="3">${esc(value || '')}</textarea>
      </label>
    `;
  }

  return `
    <label class="field">
      <span>${esc(label)}</span>
      <input id="${id}" type="${type}" value="${esc(value ?? '')}">
    </label>
  `;
}

function bindEvents() {
  bindDropzone();
  bindAssetSelection();
  bindTabs();
  bindSettings();
  bindTargetActions();
  bindPreviewEditor();
  bindConvert();
  bindProfiles();
}

function bindDropzone() {
  const dropzone = document.getElementById('dropzone');
  const videoInput = document.getElementById('video-input');
  if (!dropzone || !videoInput) return;

  dropzone.onclick = () => videoInput.click();
  videoInput.onchange = () => uploadVideos(videoInput.files);
  dropzone.ondragover = event => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  };
  dropzone.ondragleave = () => dropzone.classList.remove('dragover');
  dropzone.ondrop = event => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
    uploadVideos(event.dataTransfer.files);
  };
}

function bindAssetSelection() {
  const selectAll = document.getElementById('select-all-assets');
  if (selectAll) {
    const selection = getSelectionState(state.assets.map(asset => asset.id), state.selectedAssetIds);
    selectAll.indeterminate = selection.partiallySelected;
    selectAll.onchange = () => {
      state.selectedAssetIds = toggleAllAssetIds(state.assets.map(asset => asset.id), selectAll.checked);
      render();
    };
  }

  document.querySelectorAll('[data-asset-open]').forEach(button => {
    button.onclick = () => {
      state.selectedAssetId = button.dataset.assetOpen;
      render();
    };
  });

  document.querySelectorAll('[data-asset-select]').forEach(input => {
    input.onchange = event => {
      const assetId = input.dataset.assetSelect;
      if (input.checked) state.selectedAssetIds.add(assetId);
      else state.selectedAssetIds.delete(assetId);
      event.stopPropagation();
      render();
    };
    input.onclick = event => event.stopPropagation();
  });
}

function bindTabs() {
  document.querySelectorAll('[data-target-tab]').forEach(button => {
    button.onclick = () => {
      state.selectedTargetId = button.dataset.targetTab;
      render();
    };
  });
}

function bindSettings() {
  bindSetting('smart-skip', 'smartSkip', 'checked', true);
  bindSetting('force-convert', 'forceConvert', 'checked', true);
  bindSetting('audio-mode', 'audioMode', 'value', true);

  document.querySelectorAll('[data-quality]').forEach(button => {
    button.onclick = () => {
      state.settings.qualityMode = button.dataset.quality;
      render();
    };
  });

  const musicInput = document.getElementById('music-input');
  if (musicInput) musicInput.onchange = () => uploadMusic(musicInput.files?.[0]);
}

function bindTargetActions() {
  document.querySelectorAll('[data-use-original]').forEach(input => {
    input.onchange = () => {
      const key = input.dataset.useOriginal;
      if (input.checked) state.useOriginalKeys.add(key);
      else state.useOriginalKeys.delete(key);
    };
  });

  document.querySelectorAll('[data-open-target]').forEach(button => {
    button.onclick = () => {
      state.selectedTargetId = button.dataset.openTarget;
      render();
    };
  });
}

function bindPreviewEditor() {
  const asset = getSelectedAsset();
  const target = getSelectedTarget();
  const layoutContext = asset && target ? getLayoutContext(asset, target) : null;
  if (!asset || !target || !layoutContext) return;

  const scale = document.getElementById('layout-scale');
  if (scale) scale.oninput = () => updateCurrentLayout(asset, target, { scale: Number(scale.value) });
  const anchorX = document.getElementById('layout-anchor-x');
  if (anchorX) anchorX.oninput = () => updateCurrentLayout(asset, target, { anchorX: Number(anchorX.value) });
  const anchorY = document.getElementById('layout-anchor-y');
  if (anchorY) anchorY.oninput = () => updateCurrentLayout(asset, target, { anchorY: Number(anchorY.value) });
  const backgroundMode = document.getElementById('background-mode');
  if (backgroundMode) backgroundMode.onchange = () => updateCurrentLayout(asset, target, { backgroundMode: backgroundMode.value });
  const backgroundColor = document.getElementById('background-color');
  if (backgroundColor) backgroundColor.oninput = () => updateCurrentLayout(asset, target, { backgroundColor: backgroundColor.value });
  const reset = document.querySelector('[data-layout-reset]');
  if (reset) {
    reset.onclick = () => {
      delete state.layoutOverrides[layoutOverrideKey(asset.id, target.id)];
      render();
    };
  }
}

function bindConvert() {
  const convert = document.getElementById('convert-btn');
  if (convert) convert.onclick = createJob;
}

function bindProfiles() {
  const openButton = document.getElementById('profiles-open-btn');
  if (openButton) openButton.onclick = openProfileManager;

  document.querySelectorAll('[data-close-profiles]').forEach(button => {
    button.onclick = closeProfileManager;
  });

  const newButton = document.getElementById('profile-new-btn');
  if (newButton) {
    newButton.onclick = () => {
      state.profileManager.mode = 'create';
      state.profileManager.editingId = null;
      state.profileManager.draft = draftFromProfile(null);
      render();
    };
  }

  const exportButton = document.getElementById('profile-export-btn');
  if (exportButton) exportButton.onclick = () => window.open('/api/profiles/export', '_blank');

  const importInput = document.getElementById('profile-import-input');
  if (importInput) {
    importInput.onchange = async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text());
        await api('/api/profiles/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(raw),
        });
        await refreshCoreState();
        render();
      } catch (err) {
        alert(err.message);
      } finally {
        importInput.value = '';
      }
    };
  }

  document.querySelectorAll('[data-profile-enable]').forEach(input => {
    input.onchange = async () => {
      try {
        await api(`/api/profiles/${input.dataset.profileEnable}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: input.checked }),
        });
        await refreshCoreState();
        render();
      } catch (err) {
        alert(err.message);
      }
    };
  });

  document.querySelectorAll('[data-profile-duplicate]').forEach(button => {
    button.onclick = () => {
      const profile = state.profiles.find(item => item.id === button.dataset.profileDuplicate);
      state.profileManager.mode = 'create';
      state.profileManager.editingId = null;
      state.profileManager.draft = draftFromProfile(profile, true);
      render();
    };
  });

  document.querySelectorAll('[data-profile-edit]').forEach(button => {
    button.onclick = () => {
      const profile = state.profiles.find(item => item.id === button.dataset.profileEdit);
      state.profileManager.mode = 'edit';
      state.profileManager.editingId = profile.id;
      state.profileManager.draft = draftFromProfile(profile, false);
      render();
    };
  });

  document.querySelectorAll('[data-profile-delete]').forEach(button => {
    button.onclick = async () => {
      if (!confirm('Xóa custom profile này?')) return;
      try {
        await api(`/api/profiles/${button.dataset.profileDelete}`, { method: 'DELETE' });
        await refreshCoreState();
        state.profileManager.draft = null;
        state.profileManager.editingId = null;
        render();
      } catch (err) {
        alert(err.message);
      }
    };
  });

  const saveButton = document.getElementById('profile-save-btn');
  if (saveButton) saveButton.onclick = saveProfileDraft;
  const cancelButton = document.getElementById('profile-cancel-btn');
  if (cancelButton) {
    cancelButton.onclick = () => {
      state.profileManager.draft = null;
      state.profileManager.editingId = null;
      render();
    };
  }
}

function bindSetting(id, key, prop, rerender = false) {
  const element = document.getElementById(id);
  if (!element) return;
  element.onchange = () => {
    state.settings[key] = element[prop];
    if (rerender) render();
  };
}

async function uploadVideos(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length || state.uploading) return;

  state.uploading = true;
  render();

  try {
    const form = new FormData();
    for (const file of files) form.append('videos', file);
    const data = await api('/api/assets', { method: 'POST', body: form });
    state.assets.push(...data.assets);
    state.selectedAssetIds = mergeSelectedAssetIds(state.selectedAssetIds, data.assets);
    if (!state.selectedAssetId && state.assets[0]) state.selectedAssetId = state.assets[0].id;
  } catch (err) {
    alert(err.message);
  } finally {
    state.uploading = false;
    render();
  }
}

async function uploadMusic(file) {
  if (!file) return;
  state.musicUploading = true;
  render();

  try {
    const form = new FormData();
    form.append('music', file);
    const data = await api('/api/music', { method: 'POST', body: form });
    state.music = data.music;
  } catch (err) {
    alert(err.message);
  } finally {
    state.musicUploading = false;
    render();
  }
}

async function createJob() {
  if (!canConvert()) return;
  try {
    const body = buildCreateJobPayload({
      assets: state.assets,
      selectedAssetIds: state.selectedAssetIds,
      profiles: getEnabledProfiles(),
      settings: state.settings,
      music: state.music,
      useOriginalKeys: state.useOriginalKeys,
      layoutOverrides: state.layoutOverrides,
    });
    state.job = await api('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    syncStoredJob(state.job);
    render();
    startPolling();
  } catch (err) {
    alert(err.message);
  }
}

async function cancelJob() {
  if (!state.job) return;
  try {
    await api(`/api/jobs/${state.job.id}/cancel`, { method: 'POST' });
    await pollJob();
  } catch (err) {
    alert(err.message);
  }
}

async function clearCompletedJobs() {
  if (!state.job || !isTerminalJobStatus(state.job.status)) return;
  if (!confirm('Clear all completed, failed, and cancelled jobs?')) return;

  try {
    await api('/api/jobs/completed', { method: 'DELETE' });
    state.job = null;
    clearStoredJob();
    renderJobPanel();
  } catch (err) {
    alert(err.message);
  }
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(pollJob, 1500);
}

async function pollJob() {
  if (!state.job) return;
  try {
    state.job = await api(`/api/jobs/${state.job.id}`);
    syncStoredJob(state.job);
    renderJobPanel();
    if (isTerminalJobStatus(state.job.status)) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      renderJobPanel();
    }
  } catch (err) {
    console.warn(err);
  }
}

function syncStoredJob(job) {
  if (shouldPersistLastJob(job)) {
    localStorage.setItem('lastJobId', job.id);
    return;
  }
  clearStoredJob();
}

function clearStoredJob() {
  localStorage.removeItem('lastJobId');
}

function getSelectedAsset() {
  return state.assets.find(asset => asset.id === state.selectedAssetId) || state.assets[0] || null;
}

function getSelectedTarget() {
  return getEnabledProfiles().find(profile => profile.id === state.selectedTargetId) || getEnabledProfiles()[0] || null;
}

function getEnabledProfiles() {
  return state.profiles.filter(profile => profile.enabled !== false);
}

function getLayoutContext(asset, target) {
  const key = layoutOverrideKey(asset.id, target.id);
  const override = state.layoutOverrides[key] || null;
  return {
    key,
    override,
    layout: calculateLayout({
      sourceWidth: asset.analysis?.video?.displayWidth || 0,
      sourceHeight: asset.analysis?.video?.displayHeight || 0,
      target,
      override,
    }),
  };
}

function updateCurrentLayout(asset, target, patch) {
  const context = getLayoutContext(asset, target);
  const key = layoutOverrideKey(asset.id, target.id);
  state.layoutOverrides[key] = {
    ...buildDefaultLayoutOverride(target),
    ...context.layout.layout,
    ...patch,
  };
  render();
}

function aggregateStatus(asset) {
  if (asset.error) return { label: 'Không hỗ trợ', className: 'unsupported' };
  const enabledIds = getEnabledProfiles().map(profile => profile.id);
  const statuses = enabledIds.map(id => asset.classifications?.[id]?.status).filter(Boolean);
  if (!statuses.length) return { label: 'Đang phân tích', className: 'queued' };
  if (statuses.every(status => ['READY_EXACT', 'READY_ACCEPTED'].includes(status))) return { label: 'Đã sẵn sàng', className: 'ready' };
  if (statuses.includes('CONVERT_REQUIRED')) return { label: 'Cần convert', className: 'required' };
  if (statuses.includes('CONVERT_RECOMMENDED')) return { label: 'Nên convert', className: 'recommended' };
  return { label: 'Đã sẵn sàng', className: 'ready' };
}

function reviewLabel(reviewState) {
  switch (reviewState) {
    case REVIEW_STATE.SAFE_AUTO:
      return 'SAFE_AUTO';
    case REVIEW_STATE.REVIEW_RECOMMENDED:
      return 'REVIEW_RECOMMENDED';
    case REVIEW_STATE.BLOCKED:
      return 'BLOCKED';
    default:
      return 'SAFE_AUTO';
  }
}

function reviewClass(reviewState) {
  switch (reviewState) {
    case REVIEW_STATE.REVIEW_RECOMMENDED:
      return 'warn';
    case REVIEW_STATE.BLOCKED:
      return 'fail';
    default:
      return 'ready';
  }
}

function statusLabel(status) {
  switch (status) {
    case 'READY_EXACT':
      return 'READY_EXACT';
    case 'READY_ACCEPTED':
      return 'READY_ACCEPTED';
    case 'CONVERT_RECOMMENDED':
      return 'Nên convert';
    case 'CONVERT_REQUIRED':
      return 'Cần convert';
    case 'UNSUPPORTED':
      return 'Không hỗ trợ';
    default:
      return 'Đang phân tích';
  }
}

function statusClass(status) {
  return String(status || 'queued').toLowerCase();
}

function jobLabel(status) {
  switch (status) {
    case 'complete':
      return 'Hoàn tất';
    case 'failed':
      return 'Lỗi QA';
    case 'cancelled':
      return 'Đã hủy';
    case 'running':
      return 'Đang convert';
    default:
      return 'Đang chờ';
  }
}

function healthText() {
  if (!state.health) return 'Đang kiểm tra runtime';
  if (!state.health.ok) return state.health.error || 'FFmpeg/FFprobe chưa sẵn sàng';
  const ffmpeg = state.health.ffmpegVersion?.split(' ')[2] || 'ready';
  return `Local FFmpeg ${ffmpeg} | ${state.specs?.version || ''}`;
}

function canConvert() {
  if (!state.health?.ok || state.uploading) return false;
  if (!state.selectedAssetIds.size) return false;
  if (!getEnabledProfiles().length) return false;
  if (['replace', 'mix'].includes(state.settings.audioMode) && !state.music) return false;
  return true;
}

function openProfileManager() {
  state.profileManager.open = true;
  render();
}

function closeProfileManager() {
  state.profileManager.open = false;
  state.profileManager.draft = null;
  state.profileManager.editingId = null;
  render();
}

async function saveProfileDraft() {
  try {
    state.profileManager.busy = true;
    const payload = profilePayloadFromDraft();
    if (state.profileManager.mode === 'edit' && state.profileManager.editingId) {
      await api(`/api/profiles/${state.profileManager.editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await api('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    await refreshCoreState();
    state.profileManager.draft = null;
    state.profileManager.editingId = null;
    render();
  } catch (err) {
    alert(err.message);
  } finally {
    state.profileManager.busy = false;
  }
}

function draftFromProfile(profile, duplicate = false) {
  const riskZones = Array.isArray(profile?.riskZones) ? profile.riskZones : [];
  return {
    id: duplicate ? '' : (profile?.id || ''),
    label: duplicate && profile ? `${profile.label} Copy` : (profile?.label || ''),
    platform: profile?.platform || 'Custom',
    placement: profile?.placement || 'Custom Placement',
    width: profile?.width || 1080,
    height: profile?.height || 1920,
    aspectRatio: profile?.aspectRatio || '9:16',
    outputLabel: duplicate ? '' : (profile?.outputLabel || ''),
    minWidth: profile?.minWidth || 540,
    minHeight: profile?.minHeight || 960,
    fps: profile?.fps || 30,
    maxBytesMb: Math.round((profile?.maxBytes || 500 * 1024 * 1024) / 1024 / 1024),
    maxDurationSec: profile?.maxDurationSec || 600,
    minBitrateKbps: Math.round((profile?.minBitrateBps || 516_000) / 1000),
    reliabilityWarnMb: Math.round((profile?.reliabilityWarnBytes || 400 * 1024 * 1024) / 1024 / 1024),
    recommendedAspectRatio: profile?.recommendedAspectRatio || profile?.aspectRatio || '9:16',
    supportedAspectRatiosText: (profile?.supportedAspectRatios || []).join('\n'),
    recommendedMinResolution: profile?.recommendedMinResolution || '',
    previewNotesText: (profile?.previewNotes || []).join('\n'),
    safeZoneNotesText: (profile?.safeZoneNotes || []).join('\n'),
    safeTop: profile?.safeZoneGuide?.topPercent ?? 0.1,
    safeBottom: profile?.safeZoneGuide?.bottomPercent ?? 0.16,
    safeLeft: profile?.safeZoneGuide?.leftPercent ?? profile?.safeZoneGuide?.sidePercent ?? 0.06,
    safeRight: profile?.safeZoneGuide?.rightPercent ?? profile?.safeZoneGuide?.sidePercent ?? 0.06,
    layoutScale: profile?.layoutDefaults?.scale ?? 1,
    backgroundMode: profile?.layoutDefaults?.backgroundMode || 'edge-extend',
    backgroundColor: profile?.layoutDefaults?.backgroundColor || '#101514',
    riskZonesJson: JSON.stringify(riskZones, null, 2),
  };
}

function profilePayloadFromDraft() {
  const riskZones = JSON.parse(document.getElementById('draft-risk-zones').value || '[]');
  return {
    id: document.getElementById('draft-id').value.trim() || undefined,
    label: document.getElementById('draft-label').value.trim(),
    platform: document.getElementById('draft-platform').value.trim(),
    placement: document.getElementById('draft-placement').value.trim(),
    width: Number(document.getElementById('draft-width').value),
    height: Number(document.getElementById('draft-height').value),
    aspectRatio: document.getElementById('draft-aspect-ratio').value.trim(),
    outputLabel: document.getElementById('draft-output-label').value.trim(),
    minWidth: Number(document.getElementById('draft-min-width').value),
    minHeight: Number(document.getElementById('draft-min-height').value),
    fps: Number(document.getElementById('draft-fps').value),
    maxBytes: Number(document.getElementById('draft-max-bytes-mb').value) * 1024 * 1024,
    maxDurationSec: Number(document.getElementById('draft-max-duration-sec').value),
    minBitrateBps: Number(document.getElementById('draft-min-bitrate-kbps').value) * 1000,
    reliabilityWarnBytes: Number(document.getElementById('draft-reliability-warn-mb').value) * 1024 * 1024,
    recommendedAspectRatio: document.getElementById('draft-recommended-ratio').value.trim(),
    supportedAspectRatios: textareaLines('draft-supported-ratios'),
    recommendedMinResolution: document.getElementById('draft-min-resolution').value.trim(),
    previewNotes: textareaLines('draft-preview-notes'),
    safeZoneNotes: textareaLines('draft-safe-notes'),
    safeZoneGuide: {
      topPercent: Number(document.getElementById('draft-safe-top').value),
      bottomPercent: Number(document.getElementById('draft-safe-bottom').value),
      leftPercent: Number(document.getElementById('draft-safe-left').value),
      rightPercent: Number(document.getElementById('draft-safe-right').value),
    },
    riskZones,
    layoutDefaults: {
      scale: Number(document.getElementById('draft-layout-scale').value),
      backgroundMode: document.getElementById('draft-background-mode').value.trim(),
      backgroundColor: document.getElementById('draft-background-color').value,
    },
  };
}

function textareaLines(id) {
  return (document.getElementById(id)?.value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

function toCanvasRectStyle(rect, target) {
  return [
    `left:${((rect.x / target.width) * 100).toFixed(4)}%`,
    `top:${((rect.y / target.height) * 100).toFixed(4)}%`,
    `width:${((rect.width / target.width) * 100).toFixed(4)}%`,
    `height:${((rect.height / target.height) * 100).toFixed(4)}%`,
  ].join(';');
}

function toZoneStyle(zone) {
  return [
    `left:${(zone.leftPercent * 100).toFixed(4)}%`,
    `top:${(zone.topPercent * 100).toFixed(4)}%`,
    `right:${(zone.rightPercent * 100).toFixed(4)}%`,
    `bottom:${(zone.bottomPercent * 100).toFixed(4)}%`,
  ].join(';');
}

function backgroundClass(mode) {
  switch (mode) {
    case 'blur':
      return 'bg-blur';
    case 'mirror':
      return 'bg-mirror';
    case 'solid':
      return 'bg-solid';
    default:
      return 'bg-extend';
  }
}

function backgroundLabel(mode) {
  const match = (state.specs?.ui?.backgroundModes || []).find(item => item.id === mode);
  return match?.label || mode || '-';
}

function sel(current, value) {
  return current === value ? 'selected' : '';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function badge(text, className) {
  return `<span class="badge ${esc(className || '')}">${esc(text)}</span>`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icon(name) {
  const paths = {
    play: 'M8 5v14l11-7z',
    stop: 'M6 6h12v12H6z',
    download: 'M12 3v10m0 0l4-4m-4 4L8 9M5 19h14',
    file: 'M7 3h7l5 5v13H7z M14 3v6h5',
    report: 'M5 4h14v16H5z M8 8h8M8 12h8M8 16h5',
    layers: 'M12 3l9 5-9 5-9-5 9-5 M3 12l9 5 9-5 M3 16l9 5 9-5',
    plus: 'M12 5v14 M5 12h14',
    close: 'M6 6l12 12 M18 6L6 18',
    upload: 'M12 16V4 m0 0l-4 4 m4-4l4 4 M5 19h14',
    copy: 'M9 9h11v11H9z M4 4h11v11',
    edit: 'M4 20h4l10-10-4-4L4 16v4',
    trash: 'M5 7h14 M9 7V4h6v3 M8 7v12 M16 7v12',
    save: 'M5 4h12l2 2v14H5z M8 4v5h8',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
}
