import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { serializeProfileForClient } from '../../public/layout-core.js';
import {
  analyzeVideo,
  buildConversionCommand,
  checkTool,
  detectEncoders,
  generateThumbnail,
  getToolVersion,
  startConversion,
} from './ffmpeg.js';
import { classifyAssetForTargets, shouldConvert } from './classifier.js';
import { config, paths } from '../config.js';
import {
  CLASSIFICATION,
  DEFAULT_SETTINGS,
  getDefaultTargetIds,
  getSpecsPayload,
  getTargetProfiles,
  isStrictComplianceMode,
  QA_STATUS,
} from './specs.js';
import {
  assertInside,
  copyOrReplace,
  createId,
  ensureDir,
  ensureDirs,
  formatBytes,
  removeDirIfExists,
  sanitizeFilename,
  safeStem,
  sweepOldFiles,
  writeJson,
} from './file-utils.js';
import { ProfileStore } from './profile-store.js';
import { verifyOutput } from './verifier.js';
import { writeReports } from './report.js';

const TERMINAL_JOB_STATUSES = new Set(['complete', 'failed', 'cancelled']);

export class ConverterService {
  constructor() {
    this.assets = new Map();
    this.musicAssets = new Map();
    this.jobs = new Map();
    this.profileStore = new ProfileStore();
    this.ffmpegVersion = null;
    this.ffprobeVersion = null;
    this.ffmpegAvailable = false;
    this.ffprobeAvailable = false;
    this.encoders = ['libx264'];
    this.cleanupTimer = null;
  }

  async init() {
    await ensureDirs(Object.values(paths));
    this.ffmpegVersion = await getToolVersion('ffmpeg');
    this.ffprobeVersion = await getToolVersion('ffprobe');
    this.ffmpegAvailable = await checkTool('ffmpeg');
    this.ffprobeAvailable = await checkTool('ffprobe');
    if (this.ffmpegAvailable) {
      this.encoders = await detectEncoders();
    }
    await this.profileStore.load();
    await this.loadPersistedState();
    await this.reclassifyAllAssets();
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(err => console.warn('[cleanup]', err.message));
    }, config.cleanupIntervalMs);
  }

  async loadPersistedState() {
    await this.loadPersistedAssets();
    await this.loadPersistedMusic();
    await this.loadPersistedJobs();
  }

  async loadPersistedAssets() {
    try {
      const entries = await readdir(paths.uploads, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('music-')) continue;
        const manifestPath = path.join(paths.uploads, entry.name, 'asset.json');
        try {
          const asset = JSON.parse(await readFile(manifestPath, 'utf8'));
          if (asset?.id && asset.path && existsSync(asset.path)) {
            this.assets.set(asset.id, asset);
          }
        } catch {
          // Ignore partial manifests.
        }
      }
    } catch {
      // Directory may not exist yet.
    }
  }

  async loadPersistedMusic() {
    try {
      const entries = await readdir(paths.uploads, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('music-')) continue;
        const manifestPath = path.join(paths.uploads, entry.name, 'music.json');
        try {
          const music = JSON.parse(await readFile(manifestPath, 'utf8'));
          if (music?.id && music.path && existsSync(music.path)) {
            this.musicAssets.set(music.id, music);
          }
        } catch {
          // Ignore partial manifests.
        }
      }
    } catch {
      // Directory may not exist yet.
    }
  }

  async loadPersistedJobs() {
    try {
      const entries = await readdir(paths.jobs, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(paths.jobs, entry.name, 'job.json');
        try {
          const stored = JSON.parse(await readFile(manifestPath, 'utf8'));
          if (!stored?.id || !Array.isArray(stored.outputs)) continue;
          const job = {
            ...stored,
            jobDir: stored.internal?.jobDir || path.join(paths.jobs, stored.id),
            outputDir: stored.internal?.outputDir || path.join(paths.outputs, stored.id),
            reportDir: stored.internal?.reportDir || path.join(paths.reports, stored.id),
            assets: (stored.assets || []).map(asset => this.assets.get(asset.id) || asset).filter(asset => asset?.path),
            outputs: stored.outputs.map(output => ({
              ...output,
              target: this.getProfile(output.targetId) || output.target || null,
            })),
            currentChildProcess: null,
          };
          if (['queued', 'running'].includes(job.status)) {
            job.status = 'failed';
            job.error = 'Server restarted before this job completed.';
            job.completedAt = job.completedAt || new Date().toISOString();
          }
          this.jobs.set(job.id, job);
        } catch {
          // Ignore partial manifests.
        }
      }
    } catch {
      // Directory may not exist yet.
    }
  }

  async cleanup() {
    await Promise.all([
      sweepOldFiles(paths.uploads, config.jobTtlMs),
      sweepOldFiles(paths.tmp, config.jobTtlMs),
      sweepOldFiles(paths.jobs, config.jobTtlMs),
    ]);
  }

  getHealth() {
    return {
      ok: this.ffmpegAvailable && this.ffprobeAvailable,
      ffmpegAvailable: this.ffmpegAvailable,
      ffprobeAvailable: this.ffprobeAvailable,
      ffmpegVersion: this.ffmpegVersion,
      ffprobeVersion: this.ffprobeVersion,
      encoders: this.encoders,
      workspace: paths,
      limits: {
        maxFilesPerUpload: config.maxFilesPerUpload,
        maxFileSizeBytes: config.maxFileSizeBytes,
        maxMusicSizeBytes: config.maxMusicSizeBytes,
      },
    };
  }

  getSpecs() {
    return getSpecsPayload({ profiles: this.profileStore.listProfiles() });
  }

  getProfilesPayload() {
    const profiles = this.profileStore.listProfiles().map(profile => serializeProfileForClient(profile));
    return {
      profiles,
      enabledTargetIds: getDefaultTargetIds(this.profileStore.listProfiles()),
    };
  }

  getProfilesExport() {
    return this.profileStore.exportProfiles();
  }

  async createProfile(input) {
    const profile = await this.profileStore.createProfile(input);
    await this.reclassifyAllAssets();
    return serializeProfileForClient(profile);
  }

  async updateProfile(id, patch) {
    const profile = await this.profileStore.updateProfile(id, patch);
    await this.reclassifyAllAssets();
    return serializeProfileForClient(profile);
  }

  async deleteProfile(id) {
    await this.profileStore.deleteProfile(id);
    await this.reclassifyAllAssets();
  }

  async importProfiles(payload, { replace = false } = {}) {
    const profiles = await this.profileStore.importProfiles(payload, { replace });
    await this.reclassifyAllAssets();
    return profiles.map(profile => serializeProfileForClient(profile));
  }

  getProfile(id) {
    return this.profileStore.getProfile(id);
  }

  getAllProfiles() {
    return this.profileStore.listProfiles();
  }

  getEnabledProfiles() {
    return this.profileStore.getEnabledProfiles();
  }

  async createAssets(files = []) {
    if (!this.ffmpegAvailable || !this.ffprobeAvailable) {
      const err = new Error('FFmpeg/FFprobe chua san sang.');
      err.status = 503;
      throw err;
    }
    const assets = [];
    for (const file of files) {
      const asset = await this.createAsset(file);
      assets.push(this.publicAsset(asset));
    }
    return assets;
  }

  async createAsset(file) {
    const id = createId();
    const originalName = sanitizeFilename(file.originalname);
    const assetDir = path.join(paths.uploads, id);
    await ensureDir(assetDir);
    const finalPath = path.join(assetDir, originalName);
    await copyOrReplace(file.path, finalPath);
    const asset = {
      id,
      type: 'video',
      originalName,
      path: finalPath,
      sizeBytes: file.size,
      mimetype: file.mimetype,
      createdAt: new Date().toISOString(),
      analysis: null,
      classifications: null,
      error: null,
      thumbnailPath: path.join(assetDir, `${safeStem(originalName)}__thumb.jpg`),
    };

    try {
      asset.analysis = await analyzeVideo(finalPath);
      asset.classifications = classifyAssetForTargets(asset, this.getAllProfiles());
      try {
        await generateThumbnail(finalPath, asset.thumbnailPath, Math.min(1, Math.max(0, asset.analysis.durationSec / 4)));
      } catch (thumbErr) {
        asset.thumbnailError = thumbErr.message;
      }
    } catch (err) {
      asset.error = err.message;
      asset.classifications = classifyAssetForTargets(asset, this.getAllProfiles());
    }

    this.assets.set(id, asset);
    await this.persistAsset(asset);
    return asset;
  }

  async persistAsset(asset) {
    const assetDir = path.join(paths.uploads, asset.id);
    await writeJson(path.join(assetDir, 'asset.json'), this.persistableAsset(asset));
  }

  async reclassifyAllAssets() {
    const profiles = this.getAllProfiles();
    for (const asset of this.assets.values()) {
      asset.classifications = classifyAssetForTargets(asset, profiles);
      await this.persistAsset(asset).catch(() => {});
    }
  }

  async createMusic(file) {
    const id = createId();
    const originalName = sanitizeFilename(file.originalname);
    const assetDir = path.join(paths.uploads, `music-${id}`);
    await ensureDir(assetDir);
    const finalPath = path.join(assetDir, originalName);
    await copyOrReplace(file.path, finalPath);
    const music = {
      id,
      type: 'music',
      originalName,
      path: finalPath,
      sizeBytes: file.size,
      mimetype: file.mimetype,
      createdAt: new Date().toISOString(),
    };
    this.musicAssets.set(id, music);
    await writeJson(path.join(assetDir, 'music.json'), music);
    return {
      id,
      originalName,
      sizeBytes: file.size,
    };
  }

  getAsset(id) {
    return this.assets.get(id) || null;
  }

  getMusic(id) {
    return this.musicAssets.get(id) || null;
  }

  createJob({
    assetIds = [],
    targetIds = null,
    smartSkip = DEFAULT_SETTINGS.smartSkip,
    forceConvert = DEFAULT_SETTINGS.forceConvert,
    layoutMode = DEFAULT_SETTINGS.layoutMode,
    qualityMode = DEFAULT_SETTINGS.qualityMode,
    audioMode = DEFAULT_SETTINGS.audioMode,
    musicAssetId = null,
    useOriginalKeys = [],
    layoutOverrides = [],
  } = {}) {
    if (!this.ffmpegAvailable || !this.ffprobeAvailable) {
      const err = new Error('FFmpeg/FFprobe chua san sang.');
      err.status = 503;
      throw err;
    }
    if (!Array.isArray(assetIds) || !assetIds.length) {
      const err = new Error('Can it nhat mot video da upload.');
      err.status = 400;
      throw err;
    }

    const assets = assetIds.map(id => this.assets.get(id)).filter(Boolean);
    if (!assets.length) {
      const err = new Error('Khong tim thay video hop le.');
      err.status = 400;
      throw err;
    }

    if (['replace', 'mix'].includes(audioMode) && !this.getMusic(musicAssetId)) {
      const err = new Error('Replace/Mix audio can upload file nhac.');
      err.status = 400;
      throw err;
    }

    const resolvedTargetIds = Array.isArray(targetIds) && targetIds.length
      ? targetIds
      : getDefaultTargetIds(this.getEnabledProfiles());
    const targets = getTargetProfiles(resolvedTargetIds, this.getAllProfiles());
    if (!targets.length) {
      const err = new Error('Khong co profile output nao duoc chon.');
      err.status = 400;
      throw err;
    }

    const id = createId();
    const jobDir = path.join(paths.jobs, id);
    const outputDir = path.join(paths.outputs, id);
    const reportDir = path.join(paths.reports, id);
    const requestedUseOriginalSet = new Set(Array.isArray(useOriginalKeys) ? useOriginalKeys : []);
    const targetsById = new Map(targets.map(target => [target.id, target]));
    const useOriginalSet = new Set(
      Array.from(requestedUseOriginalSet).filter(key => {
        const [, targetId] = String(key || '').split(':');
        return targetsById.get(targetId)?.allowUseOriginal !== false;
      }),
    );
    const layoutMap = new Map((Array.isArray(layoutOverrides) ? layoutOverrides : []).map(item => [`${item.assetId}:${item.targetId}`, item]));
    const hasMusic = !!this.getMusic(musicAssetId);

    const outputs = [];
    for (const asset of assets) {
      for (const target of targets) {
        const classification = asset.classifications?.[target.id];
        const key = `${asset.id}:${target.id}`;
        const blockReason = resolveOutputBlockReason({
          asset,
          target,
          classification,
          audioMode,
          hasMusic,
        });
        const manualOriginal = target.allowUseOriginal !== false
          && useOriginalSet.has(key)
          && classification?.status !== CLASSIFICATION.CONVERT_REQUIRED
          && classification?.status !== CLASSIFICATION.UNSUPPORTED;
        const blocked = !!blockReason;
        const convert = blocked ? false : (!manualOriginal && shouldConvert(classification, { smartSkip, forceConvert }));
        const decision = blocked ? 'blocked' : (convert ? 'converted' : 'skipped');
        const ext = decision === 'skipped' && asset.analysis?.container === 'mov' ? 'mov' : 'mp4';
        const outputName = `${safeStem(asset.originalName)}__${target.outputLabel}__${decision === 'skipped' ? 'ready' : 'converted'}.${ext}`;
        const outputId = createId(8);
        outputs.push({
          id: outputId,
          assetId: asset.id,
          assetName: asset.originalName,
          targetId: target.id,
          targetLabel: target.label,
          target,
          classification,
          decision,
          state: blocked ? 'blocked' : 'queued',
          progress: 0,
          progressMsg: blocked ? 'Blocked' : '',
          outputName,
          outputPath: path.join(outputDir, outputName),
          thumbnailPath: path.join(outputDir, `${path.parse(outputName).name}__thumb.jpg`),
          qa: null,
          error: blocked ? blockReason : null,
          command: null,
          layoutOverride: layoutMap.get(key) || null,
          layoutResult: classification?.autoLayout || null,
        });
      }
    }

    const job = {
      id,
      status: outputs.every(output => output.state === 'blocked') ? 'failed' : 'queued',
      createdAt: new Date().toISOString(),
      completedAt: outputs.every(output => output.state === 'blocked') ? new Date().toISOString() : null,
      jobDir,
      outputDir,
      reportDir,
      options: {
        smartSkip,
        forceConvert,
        layoutMode,
        qualityMode,
        audioMode,
        musicAssetId,
        targetIds: targets.map(target => target.id),
        useOriginalKeys: Array.from(useOriginalSet),
        layoutOverrides: Array.from(layoutMap.values()),
      },
      assets,
      outputs,
      error: outputs.every(output => output.state === 'blocked')
        ? 'All selected outputs were blocked before encode.'
        : null,
      currentChildProcess: null,
      reportJsonPath: null,
      reportHtmlPath: null,
    };

    this.jobs.set(id, job);
    ensureDirs([jobDir, outputDir, reportDir])
      .then(async () => {
        if (job.status === 'failed') {
          await writeReports(job, job.reportDir).catch(() => {});
          await this.persistJob(job);
          return;
        }
        await this.persistJob(job);
        this.processJob(job).catch(err => {
          job.status = 'failed';
          job.error = err.message;
          job.completedAt = new Date().toISOString();
          this.persistJob(job).catch(() => {});
        });
      })
      .catch(err => {
        job.status = 'failed';
        job.error = err.message;
      });

    return this.publicJob(job);
  }

  getJob(id) {
    const job = this.jobs.get(id);
    return job ? this.publicJob(job) : null;
  }

  async cancelJob(id) {
    const job = this.jobs.get(id);
    if (!job || isTerminalJobStatus(job.status)) return false;
    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    if (job.currentChildProcess?.pid) {
      await killProcessTree(job.currentChildProcess.pid);
    }
    for (const output of job.outputs) {
      if (['queued', 'copying', 'encoding', 'verifying'].includes(output.state)) {
        output.state = 'cancelled';
        output.error = 'Cancelled';
      }
    }
    await writeReports(job, job.reportDir).catch(() => {});
    await this.persistJob(job);
    return true;
  }

  async clearTerminalJobs() {
    const deletedJobIds = [];

    for (const job of Array.from(this.jobs.values())) {
      if (!isTerminalJobStatus(job.status)) continue;
      await this.deleteTerminalJob(job);
      deletedJobIds.push(job.id);
    }

    return deletedJobIds;
  }

  async processJob(job) {
    job.status = 'running';
    await this.persistJob(job);
    for (const output of job.outputs) {
      if (job.status === 'cancelled') break;
      if (output.state === 'blocked') continue;
      await this.processOutput(job, output);
      await this.persistJob(job);
    }

    if (job.status !== 'cancelled') {
      const failed = job.outputs.some(output => ['failed', 'blocked'].includes(output.state));
      const qaFailed = job.outputs.some(output => output.qa?.status === QA_STATUS.FAIL);
      job.status = failed || qaFailed ? 'failed' : 'complete';
      job.completedAt = new Date().toISOString();
      if (job.status === 'failed') {
        job.error = 'Mot so output khong dat QA hoac bi chan.';
      }
    }
    await writeReports(job, job.reportDir);
    await this.persistJob(job);
  }

  async processOutput(job, output) {
    const asset = job.assets.find(item => item.id === output.assetId);
    const target = output.target || this.getProfile(output.targetId);
    if (!asset || !target) {
      output.state = 'failed';
      output.error = 'Khong tim thay asset hoac target.';
      return;
    }

    try {
      if (output.decision === 'skipped') {
        output.state = 'copying';
        output.progress = 0.1;
        output.progressMsg = 'Copy original';
        await copyOrReplace(asset.path, output.outputPath);
        output.progress = 0.65;
      } else {
        output.state = 'encoding';
        output.progress = 0.02;
        output.progressMsg = 'Encoding';
        await this.runEncode(job, output, asset, target, false);
        const st = await stat(output.outputPath);
        if (st.size > target.maxBytes) {
          output.progressMsg = 'Retry fallback bitrate';
          await this.runEncode(job, output, asset, target, true);
        }
      }

      output.state = 'verifying';
      output.progress = 0.9;
      output.qa = await verifyOutput(output.outputPath, target, {
        decision: output.decision,
        command: output.command,
        layout: output.layoutResult,
      });
      try {
        await generateThumbnail(output.outputPath, output.thumbnailPath, 1);
      } catch (thumbErr) {
        output.thumbnailError = thumbErr.message;
      }
      output.state = output.qa.status === QA_STATUS.FAIL ? 'failed' : 'done';
      output.progress = 1;
      output.progressMsg = output.qa.status === QA_STATUS.FAIL ? 'QA fail' : 'Done';
      if (output.qa.status === QA_STATUS.FAIL) {
        output.error = output.qa.issues.join(' ');
      }
    } catch (err) {
      output.state = job.status === 'cancelled' ? 'cancelled' : 'failed';
      output.error = err.message;
      output.progressMsg = 'Failed';
    }
  }

  async runEncode(job, output, asset, target, useFallbackBitrate) {
    const music = this.getMusic(job.options.musicAssetId);
    const command = buildConversionCommand({
      inputPath: asset.path,
      outputPath: output.outputPath,
      target,
      source: asset.analysis,
      layoutMode: job.options.layoutMode,
      layoutOverride: output.layoutOverride || target.layoutDefaults,
      qualityMode: job.options.qualityMode,
      audioMode: job.options.audioMode,
      encoder: 'libx264',
      musicPath: music?.path || null,
      useFallbackBitrate,
    });
    output.command = {
      bin: command.bin,
      args: command.args,
      filterComplex: command.filterComplex,
      fallbackBitrate: useFallbackBitrate,
      layoutMode: command.layoutMode,
      backgroundMode: command.backgroundMode,
    };
    output.layoutResult = command.layout;
    const { childProcess, resultPromise } = startConversion(command, asset.analysis?.durationSec || 0, (progress, msg) => {
      output.progress = progress;
      output.progressMsg = msg;
    });
    job.currentChildProcess = childProcess;
    const result = await resultPromise;
    job.currentChildProcess = null;
    if (!result.success) {
      throw new Error(result.error || 'FFmpeg conversion failed.');
    }
  }

  async persistJob(job) {
    await writeJson(path.join(job.jobDir, 'job.json'), this.persistableJob(job));
  }

  persistableJob(job) {
    return {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      options: job.options,
      error: job.error,
      reportJsonPath: job.reportJsonPath,
      reportHtmlPath: job.reportHtmlPath,
      assets: job.assets.map(asset => this.persistableAsset(asset)),
      outputs: job.outputs.map(output => ({
        id: output.id,
        assetId: output.assetId,
        assetName: output.assetName,
        targetId: output.targetId,
        targetLabel: output.targetLabel,
        target: output.target,
        classification: output.classification,
        decision: output.decision,
        state: output.state,
        progress: output.progress,
        progressMsg: output.progressMsg,
        outputName: output.outputName,
        outputPath: output.outputPath,
        thumbnailPath: output.thumbnailPath,
        qa: output.qa,
        error: output.error,
        command: output.command,
        layoutOverride: output.layoutOverride,
        layoutResult: output.layoutResult,
      })),
      internal: {
        jobDir: job.jobDir,
        outputDir: job.outputDir,
        reportDir: job.reportDir,
      },
    };
  }

  persistableAsset(asset) {
    return {
      id: asset.id,
      type: asset.type,
      originalName: asset.originalName,
      path: asset.path,
      sizeBytes: asset.sizeBytes,
      mimetype: asset.mimetype,
      createdAt: asset.createdAt,
      analysis: asset.analysis,
      classifications: asset.classifications,
      error: asset.error,
      thumbnailPath: asset.thumbnailPath,
    };
  }

  publicAsset(asset) {
    return {
      id: asset.id,
      type: asset.type,
      originalName: asset.originalName,
      sizeBytes: asset.sizeBytes,
      sizeLabel: formatBytes(asset.sizeBytes),
      mimetype: asset.mimetype,
      createdAt: asset.createdAt,
      analysis: asset.analysis,
      classifications: asset.classifications,
      error: asset.error,
      previewUrl: `/api/assets/${asset.id}/preview`,
      thumbnailUrl: asset.thumbnailPath && existsSync(asset.thumbnailPath) ? `/api/assets/${asset.id}/thumbnail` : null,
    };
  }

  publicJob(job) {
    return {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      options: job.options,
      error: job.error,
      reportUrl: `/api/jobs/${job.id}/report`,
      reportHtmlUrl: `/api/jobs/${job.id}/report?format=html`,
      zipUrl: `/api/jobs/${job.id}/download.zip`,
      assets: job.assets.map(asset => this.publicAsset(asset)),
      outputs: job.outputs.map(output => ({
        id: output.id,
        assetId: output.assetId,
        assetName: output.assetName,
        targetId: output.targetId,
        targetLabel: output.targetLabel,
        classification: output.classification,
        decision: output.decision,
        state: output.state,
        progress: output.progress,
        progressMsg: output.progressMsg,
        outputName: output.outputName,
        layoutOverride: output.layoutOverride,
        layoutResult: output.layoutResult,
        qa: output.qa ? {
          status: output.qa.status,
          decision: output.qa.decision,
          issues: output.qa.issues,
          warnings: output.qa.warnings,
          analysis: output.qa.analysis,
        } : null,
        error: output.error,
        downloadUrl: output.state === 'done' ? `/api/jobs/${job.id}/files/${output.id}` : null,
        thumbnailUrl: output.thumbnailPath && existsSync(output.thumbnailPath) ? `/api/jobs/${job.id}/thumbnails/${output.id}` : null,
      })),
    };
  }

  getOutputFile(jobId, outputId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const output = job.outputs.find(item => item.id === outputId);
    if (!output?.outputPath || output.state !== 'done' || !existsSync(output.outputPath)) return null;
    return {
      path: assertInside(job.outputDir, output.outputPath),
      filename: output.outputName,
      contentType: output.outputName.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4',
    };
  }

  getOutputThumbnail(jobId, outputId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const output = job.outputs.find(item => item.id === outputId);
    if (!output?.thumbnailPath || !existsSync(output.thumbnailPath)) return null;
    return {
      path: assertInside(job.outputDir, output.thumbnailPath),
      filename: path.basename(output.thumbnailPath),
      contentType: 'image/jpeg',
    };
  }

  getReport(jobId, format = 'json') {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const filePath = format === 'html' ? job.reportHtmlPath : job.reportJsonPath;
    if (!filePath || !existsSync(filePath)) return null;
    return {
      path: filePath,
      filename: path.basename(filePath),
      contentType: format === 'html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    };
  }

  async getReportBody(jobId, format = 'json') {
    const report = this.getReport(jobId, format);
    if (!report) return null;
    return {
      ...report,
      body: await readFile(report.path, 'utf8'),
    };
  }

  getZipItems(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const items = [];
    for (const output of job.outputs) {
      if (output.state === 'done' && existsSync(output.outputPath)) {
        items.push({ path: output.outputPath, name: output.outputName });
      }
    }
    for (const reportPath of [job.reportJsonPath, job.reportHtmlPath]) {
      if (reportPath && existsSync(reportPath)) {
        items.push({ path: reportPath, name: path.basename(reportPath) });
      }
    }
    return items;
  }

  async destroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const job of this.jobs.values()) {
      if (job.currentChildProcess?.pid) await killProcessTree(job.currentChildProcess.pid);
    }
  }

  async deleteTerminalJob(job) {
    const jobDir = assertInside(paths.jobs, job.jobDir || path.join(paths.jobs, job.id));
    const outputDir = assertInside(paths.outputs, job.outputDir || path.join(paths.outputs, job.id));
    const reportDir = assertInside(paths.reports, job.reportDir || path.join(paths.reports, job.id));

    await Promise.all([
      removeDirIfExists(jobDir),
      removeDirIfExists(outputDir),
      removeDirIfExists(reportDir),
    ]);
    this.jobs.delete(job.id);
  }
}

function isTerminalJobStatus(status) {
  return TERMINAL_JOB_STATUSES.has(status);
}

function resolveOutputBlockReason({ asset, target, classification, audioMode, hasMusic }) {
  if (asset?.error) return asset.error;
  if (!classification) return 'Target could not be classified.';
  if (classification.status === CLASSIFICATION.UNSUPPORTED) {
    return classification.reasons?.[0] || classification.summary || 'Target cannot be exported.';
  }
  if (target?.requireAudio && !willOutputHaveAudio(asset, audioMode, hasMusic)) {
    if (audioMode === 'mute') {
      return 'Strict ads-safe target requires an audio stream. Mute mode is not allowed.';
    }
    return 'Strict ads-safe target requires audio. Keep source audio or add music before exporting.';
  }
  if (isStrictComplianceMode(target) && (asset?.analysis?.durationSec || 0) > target.maxDurationSec) {
    return `Duration ${Math.round(asset.analysis.durationSec)}s exceeds strict target limit ${target.maxDurationSec}s. Trim outside app before exporting.`;
  }
  return '';
}

function willOutputHaveAudio(asset, audioMode, hasMusic) {
  switch (audioMode) {
    case 'mute':
      return false;
    case 'replace':
      return hasMusic;
    case 'mix':
      return hasMusic || !!asset?.analysis?.hasAudio;
    default:
      return !!asset?.analysis?.hasAudio;
  }
}

async function killProcessTree(pid) {
  if (!pid) return;
  await new Promise(resolve => {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/F', '/T', '/PID', String(pid)], () => resolve());
      return;
    }
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already dead.
      }
    }
    resolve();
  });
}
