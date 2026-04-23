import path from 'path';
import { existsSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { paths } from '../server/config.js';
import { classifyForTarget } from '../server/lib/classifier.js';
import { ConverterService } from '../server/lib/converter-service.js';

const cleanupDirs = [];

afterEach(async () => {
  while (cleanupDirs.length) {
    const dir = cleanupDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('converter service terminal cleanup', () => {
  it('deletes terminal jobs and keeps active jobs intact', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const terminalJob = await createJobFixture(`job-complete-${suffix}`, 'complete');
    const runningJob = await createJobFixture(`job-running-${suffix}`, 'running');

    const service = new ConverterService();
    service.jobs.set(terminalJob.id, terminalJob);
    service.jobs.set(runningJob.id, runningJob);

    const deletedJobIds = await service.clearTerminalJobs();

    expect(deletedJobIds).toEqual([terminalJob.id]);
    expect(service.jobs.has(terminalJob.id)).toBe(false);
    expect(service.jobs.has(runningJob.id)).toBe(true);
    expect(existsSync(terminalJob.jobDir)).toBe(false);
    expect(existsSync(terminalJob.outputDir)).toBe(false);
    expect(existsSync(terminalJob.reportDir)).toBe(false);
    expect(existsSync(runningJob.jobDir)).toBe(true);
    expect(existsSync(runningJob.outputDir)).toBe(true);
    expect(existsSync(runningJob.reportDir)).toBe(true);
  });
});

describe('converter service strict ad jobs', () => {
  it('always converts exact-ready built-in targets to fresh MP4 outputs', async () => {
    const service = createServiceHarness();
    const asset = buildAssetFixture('asset-strict', {
      classifications: {
        tiktok_vertical_9x16: classifyForTarget(buildAnalysis(), service.getProfile('tiktok_vertical_9x16')),
      },
    });
    service.assets.set(asset.id, asset);

    const job = service.createJob({
      assetIds: [asset.id],
      targetIds: ['tiktok_vertical_9x16'],
      smartSkip: true,
      audioMode: 'keep',
      useOriginalKeys: [`${asset.id}:tiktok_vertical_9x16`],
    });
    await waitForJobSetup();
    trackCreatedJob(service, job.id);

    expect(job.outputs).toHaveLength(1);
    expect(job.outputs[0].decision).toBe('converted');
    expect(job.outputs[0].outputName.endsWith('.mp4')).toBe(true);
    expect(service.jobs.get(job.id).options.useOriginalKeys).toEqual([]);
  });

  it('blocks strict built-ins without audio when no music is provided', async () => {
    const service = createServiceHarness();
    const asset = buildAssetFixture('asset-silent', {
      analysis: buildAnalysis({ hasAudio: false, audio: null }),
      classifications: {
        tiktok_vertical_9x16: classifyForTarget(buildAnalysis({ hasAudio: false, audio: null }), service.getProfile('tiktok_vertical_9x16')),
      },
    });
    service.assets.set(asset.id, asset);

    const job = service.createJob({
      assetIds: [asset.id],
      targetIds: ['tiktok_vertical_9x16'],
      smartSkip: true,
      audioMode: 'keep',
    });
    await waitForJobSetup();
    trackCreatedJob(service, job.id);

    expect(job.status).toBe('failed');
    expect(job.outputs[0].state).toBe('blocked');
    expect(job.outputs[0].error).toContain('requires audio');
  });

  it('keeps custom profiles on smart-skip and allows original passthrough', async () => {
    const service = createServiceHarness();
    const customTarget = {
      ...service.getProfile('tiktok_vertical_9x16'),
      id: 'custom_vertical_9x16',
      label: 'Custom Vertical 9:16',
      isBuiltIn: false,
      complianceMode: 'standard',
      allowUseOriginal: true,
      requireAudio: false,
      container: ['mp4', 'mov'],
      layoutBounds: {
        minScale: 0.7,
        maxScale: 2.5,
        step: 0.05,
      },
    };
    service.profileStore.customProfiles = [customTarget];
    const asset = buildAssetFixture('asset-custom', {
      classifications: {
        custom_vertical_9x16: classifyForTarget(buildAnalysis(), customTarget),
      },
    });
    service.assets.set(asset.id, asset);

    const job = service.createJob({
      assetIds: [asset.id],
      targetIds: ['custom_vertical_9x16'],
      smartSkip: true,
      audioMode: 'keep',
      useOriginalKeys: [`${asset.id}:custom_vertical_9x16`],
    });
    await waitForJobSetup();
    trackCreatedJob(service, job.id);

    expect(job.outputs[0].decision).toBe('skipped');
    expect(service.jobs.get(job.id).options.useOriginalKeys).toEqual([`${asset.id}:custom_vertical_9x16`]);
  });
});

async function createJobFixture(id, status) {
  const jobDir = path.join(paths.jobs, id);
  const outputDir = path.join(paths.outputs, id);
  const reportDir = path.join(paths.reports, id);

  await mkdir(jobDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(jobDir, 'job.json'), '{}', 'utf8');
  await writeFile(path.join(outputDir, 'output.mp4'), 'video', 'utf8');
  await writeFile(path.join(reportDir, 'report.json'), '{}', 'utf8');
  cleanupDirs.push(jobDir, outputDir, reportDir);

  return {
    id,
    status,
    jobDir,
    outputDir,
    reportDir,
    outputs: [],
    currentChildProcess: null,
  };
}

function createServiceHarness() {
  const service = new ConverterService();
  service.ffmpegAvailable = true;
  service.ffprobeAvailable = true;
  service.persistJob = async () => {};
  service.processJob = async () => {};
  return service;
}

function buildAnalysis(overrides = {}) {
  return {
    container: 'mp4',
    sizeBytes: 8 * 1024 * 1024,
    durationSec: 20,
    bitrateBps: 4_000_000,
    faststart: true,
    video: {
      codec: 'h264',
      pixelFormat: 'yuv420p',
      displayWidth: 1080,
      displayHeight: 1920,
      aspectRatio: 1080 / 1920,
      fps: 30,
      hasSquarePixels: true,
      hasRotationMetadata: false,
      rotation: 0,
      ...(overrides.video || {}),
    },
    audio: overrides.audio === null ? null : {
      codec: 'aac',
      channels: 2,
      sampleRate: 48000,
      ...(overrides.audio || {}),
    },
    hasAudio: overrides.hasAudio ?? true,
    ...overrides,
  };
}

function buildAssetFixture(id, overrides = {}) {
  return {
    id,
    originalName: `${id}.mp4`,
    path: path.join(paths.uploads, `${id}.mp4`),
    error: null,
    analysis: buildAnalysis(),
    classifications: {},
    ...overrides,
  };
}

function trackCreatedJob(service, jobId) {
  const job = service.jobs.get(jobId);
  if (!job) return;
  cleanupDirs.push(job.jobDir, job.outputDir, job.reportDir);
}

async function waitForJobSetup() {
  await new Promise(resolve => setTimeout(resolve, 0));
}
