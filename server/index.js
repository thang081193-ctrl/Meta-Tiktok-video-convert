import express from 'express';
import multer from 'multer';
import path from 'path';
import archiver from 'archiver';
import { config, paths } from './config.js';
import { ConverterService } from './lib/converter-service.js';
import { createId, ensureDirs, removeIfExists, sanitizeFilename } from './lib/file-utils.js';

const app = express();
const service = new ConverterService();

await ensureDirs(Object.values(paths));
await service.init();

const upload = multer({
  storage: multer.diskStorage({
    destination: paths.tmp,
    filename: (_req, file, cb) => {
      cb(null, `${createId(8)}_${sanitizeFilename(file.originalname)}`);
    },
  }),
  limits: {
    files: config.maxFilesPerUpload,
    fileSize: config.maxFileSizeBytes,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) {
      cb(new Error(`Invalid video type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

const musicUpload = multer({
  storage: multer.diskStorage({
    destination: paths.tmp,
    filename: (_req, file, cb) => {
      cb(null, `${createId(8)}_${sanitizeFilename(file.originalname)}`);
    },
  }),
  limits: {
    files: 1,
    fileSize: config.maxMusicSizeBytes,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('audio/') && !file.mimetype.startsWith('video/')) {
      cb(new Error(`Invalid music type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(config.publicDir));

app.get('/api/health', (_req, res) => {
  res.json(service.getHealth());
});

app.get('/api/specs', (_req, res) => {
  res.json(service.getSpecs());
});

app.get('/api/profiles', (_req, res) => {
  res.json(service.getProfilesPayload());
});

app.post('/api/profiles', async (req, res, next) => {
  try {
    const profile = await service.createProfile(req.body || {});
    res.status(201).json({ profile });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/profiles/:profileId', async (req, res, next) => {
  try {
    const profile = await service.updateProfile(req.params.profileId, req.body || {});
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/profiles/:profileId', async (req, res, next) => {
  try {
    await service.deleteProfile(req.params.profileId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/profiles/import', async (req, res, next) => {
  try {
    const profiles = await service.importProfiles(req.body || {}, { replace: !!req.body?.replace });
    res.status(201).json({ profiles });
  } catch (err) {
    next(err);
  }
});

app.get('/api/profiles/export', (_req, res) => {
  const payload = service.getProfilesExport();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="meta-tiktok-profiles.json"');
  res.send(JSON.stringify(payload, null, 2));
});

app.post('/api/assets', upload.array('videos', config.maxFilesPerUpload), async (req, res, next) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }
    const assets = await service.createAssets(req.files);
    for (const file of req.files) await removeIfExists(file.path);
    res.status(201).json({ assets });
  } catch (err) {
    next(err);
  }
});

app.post('/api/music', musicUpload.single('music'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No music file uploaded.' });
    }
    const music = await service.createMusic(req.file);
    await removeIfExists(req.file.path);
    res.status(201).json({ music });
  } catch (err) {
    next(err);
  }
});

app.get('/api/assets/:assetId/preview', (req, res) => {
  const asset = service.getAsset(req.params.assetId);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  res.setHeader('Content-Type', asset.mimetype || 'video/mp4');
  res.sendFile(asset.path);
});

app.get('/api/assets/:assetId/thumbnail', (req, res) => {
  const asset = service.getAsset(req.params.assetId);
  if (!asset?.thumbnailPath) return res.status(404).json({ error: 'Thumbnail not found.' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.sendFile(asset.thumbnailPath);
});

app.post('/api/jobs', (req, res, next) => {
  try {
    const job = service.createJob(req.body || {});
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = service.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(job);
});

app.delete('/api/jobs/completed', async (_req, res, next) => {
  try {
    const deletedJobIds = await service.clearTerminalJobs();
    res.json({ ok: true, deletedJobIds, deletedCount: deletedJobIds.length });
  } catch (err) {
    next(err);
  }
});

app.post('/api/jobs/:jobId/cancel', async (req, res, next) => {
  try {
    const ok = await service.cancelJob(req.params.jobId);
    if (!ok) return res.status(404).json({ error: 'Job not found or already terminal.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/jobs/:jobId/files/:fileId', (req, res) => {
  const file = service.getOutputFile(req.params.jobId, req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found or not ready.' });
  res.setHeader('Content-Type', file.contentType);
  res.download(file.path, file.filename);
});

app.get('/api/jobs/:jobId/thumbnails/:fileId', (req, res) => {
  const file = service.getOutputThumbnail(req.params.jobId, req.params.fileId);
  if (!file) return res.status(404).json({ error: 'Thumbnail not found.' });
  res.setHeader('Content-Type', file.contentType);
  res.sendFile(file.path);
});

app.get('/api/jobs/:jobId/report', async (req, res) => {
  const format = req.query.format === 'html' ? 'html' : 'json';
  const report = await service.getReportBody(req.params.jobId, format);
  if (!report) return res.status(404).json({ error: 'Report not ready.' });
  res.setHeader('Content-Type', report.contentType);
  res.send(report.body);
});

app.get('/api/jobs/:jobId/download.zip', (req, res) => {
  const items = service.getZipItems(req.params.jobId);
  if (!items || items.length === 0) {
    return res.status(404).json({ error: 'No completed files to download.' });
  }
  const zipName = `MetaTikTok_${req.params.jobId.slice(0, 8)}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', err => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
  archive.pipe(res);
  for (const item of items) {
    archive.file(item.path, { name: item.name });
  }
  archive.finalize();
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
});

const server = app.listen(config.port, () => {
  console.log(`Meta/TikTok Video Converter running at http://localhost:${config.port}`);
});

async function shutdown() {
  await service.destroy();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
