import { execFile, spawn } from 'child_process';
import { open, readFile, stat } from 'fs/promises';
import path from 'path';
import { calculateLayout } from '../../public/layout-core.js';

function execFileText(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 30_000, maxBuffer: 20 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || err.message || '').trim();
        reject(new Error(detail || `${bin} failed`));
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

export async function getToolVersion(bin) {
  try {
    const output = await execFileText(bin, ['-version'], { timeout: 5_000 });
    return output.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

export async function checkTool(bin) {
  return !!(await getToolVersion(bin));
}

export async function detectEncoders() {
  const encodersText = await execFileText('ffmpeg', ['-hide_banner', '-encoders'], { timeout: 10_000 }).catch(() => '');
  const encoders = ['libx264'];
  for (const candidate of ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox']) {
    if (encodersText.includes(candidate)) encoders.push(candidate);
  }
  return encoders;
}

export async function analyzeVideo(filePath) {
  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ];

  const stdout = await execFileText('ffprobe', args, { timeout: 60_000 });
  const data = JSON.parse(stdout);
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const format = data.format || {};
  const videoStream = streams.find(stream => stream.codec_type === 'video');
  const audioStream = streams.find(stream => stream.codec_type === 'audio');
  if (!videoStream) {
    const err = new Error('No video stream found.');
    err.code = 'NO_VIDEO_STREAM';
    throw err;
  }

  const fileStat = await stat(filePath);
  const rotation = readRotation(videoStream);
  const rawWidth = Number(videoStream.width || 0);
  const rawHeight = Number(videoStream.height || 0);
  const displayWidth = Math.abs(rotation) % 180 === 90 ? rawHeight : rawWidth;
  const displayHeight = Math.abs(rotation) % 180 === 90 ? rawWidth : rawHeight;
  const fps = parseRate(videoStream.avg_frame_rate) || parseRate(videoStream.r_frame_rate) || 0;
  const bitrate = Number(format.bit_rate || videoStream.bit_rate || 0);
  const duration = Number(videoStream.duration || format.duration || 0);
  const sampleAspectRatio = parseSar(videoStream.sample_aspect_ratio || '1:1');
  const container = detectContainer(format.format_name, path.extname(filePath));

  return {
    filePath,
    filename: path.basename(filePath),
    extension: path.extname(filePath).replace('.', '').toLowerCase(),
    container,
    formatName: format.format_name || '',
    sizeBytes: fileStat.size,
    durationSec: duration,
    bitrateBps: bitrate,
    video: {
      codec: videoStream.codec_name || 'unknown',
      profile: videoStream.profile || null,
      level: videoStream.level || null,
      pixelFormat: videoStream.pix_fmt || null,
      rawWidth,
      rawHeight,
      displayWidth,
      displayHeight,
      aspectRatio: displayHeight > 0 ? displayWidth / displayHeight : 0,
      fps,
      sampleAspectRatio,
      hasSquarePixels: Math.abs(sampleAspectRatio - 1) < 0.01,
      rotation,
      hasRotationMetadata: Math.abs(rotation) > 0.01,
    },
    audio: audioStream ? {
      codec: audioStream.codec_name || 'unknown',
      channels: Number(audioStream.channels || 0),
      channelLayout: audioStream.channel_layout || null,
      sampleRate: Number(audioStream.sample_rate || 0),
      bitrateBps: Number(audioStream.bit_rate || 0),
    } : null,
    hasAudio: !!audioStream,
    faststart: await hasFaststart(filePath),
  };
}

export function buildConversionCommand({
  inputPath,
  outputPath,
  target,
  source,
  layoutMode = 'content-safe',
  layoutOverride = null,
  qualityMode = 'high',
  audioMode = 'keep',
  encoder = 'libx264',
  musicPath = null,
  useFallbackBitrate = false,
}) {
  if (layoutMode !== 'content-safe') {
    throw new Error(`Unsupported layout mode: ${layoutMode}`);
  }

  const layout = calculateLayout({
    sourceWidth: source?.video?.displayWidth || 0,
    sourceHeight: source?.video?.displayHeight || 0,
    target,
    override: layoutOverride || null,
  });

  const args = [
    '-hide_banner',
    '-y',
    '-i', inputPath,
  ];
  const useMusic = musicPath && ['replace', 'mix'].includes(audioMode);
  if (useMusic) {
    args.push('-stream_loop', '-1', '-i', musicPath);
  }

  let filterComplex = buildVideoFilter(target, layout);
  args.push('-filter_complex', filterComplex, '-map', '[vout]');

  if (audioMode === 'mute') {
    args.push('-an');
  } else if (audioMode === 'replace' && useMusic) {
    args.push('-map', '1:a:0', '-t', String(Math.max(source.durationSec || 0, 0.1)));
    args.push(...audioFlags(target));
  } else if (audioMode === 'mix' && useMusic && source.hasAudio) {
    filterComplex = `${filterComplex};[0:a]volume=1.0[a0];[1:a]volume=0.75[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]`;
    args.splice(args.indexOf('-filter_complex') + 1, 1, filterComplex);
    args.push('-map', '[aout]');
    args.push(...audioFlags(target));
  } else if (audioMode === 'mix' && useMusic) {
    args.push('-map', '1:a:0', '-t', String(Math.max(source.durationSec || 0, 0.1)));
    args.push(...audioFlags(target));
  } else {
    args.push('-map', '0:a:0?');
    args.push(...audioFlags(target));
  }

  args.push(...videoFlags({ target, qualityMode, encoder, useFallbackBitrate }));
  args.push(
    '-r', String(target.fps),
    '-fps_mode', 'cfr',
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    '-metadata:s:v:0', 'rotate=0',
    outputPath,
  );

  return {
    bin: 'ffmpeg',
    args,
    display: ['ffmpeg', ...args],
    filterComplex,
    layoutMode,
    layout,
    backgroundMode: layout.layout.backgroundMode,
  };
}

export function startConversion(command, durationSec, onProgress = null) {
  let childProcess;
  try {
    childProcess = spawn(command.bin, command.args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    return {
      childProcess: null,
      resultPromise: Promise.resolve({
        success: false,
        error: err.code === 'ENOENT' ? 'ffmpeg not found in PATH.' : err.message,
      }),
    };
  }

  let buffer = '';
  let stderrTail = '';
  const resultPromise = new Promise((resolve) => {
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timeout = setTimeout(() => {
      try {
        childProcess.kill('SIGTERM');
      } catch {
        // Best effort.
      }
      done({ success: false, error: 'ffmpeg timed out after 90 minutes.' });
    }, 90 * 60 * 1000);

    childProcess.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      stderrTail = (stderrTail + text).slice(-3000);
      buffer += text;
      const parts = buffer.split(/[\r\n]/);
      buffer = parts.pop() || '';
      for (const line of parts) {
        const time = parseProgressTime(line);
        if (onProgress && durationSec > 0 && Number.isFinite(time)) {
          const progress = Math.max(0, Math.min(time / durationSec, 0.99));
          onProgress(progress, `Encoding ${(progress * 100).toFixed(1)}%`);
        }
      }
    });

    childProcess.on('error', err => {
      clearTimeout(timeout);
      done({
        success: false,
        error: err.code === 'ENOENT' ? 'ffmpeg not found in PATH.' : err.message,
      });
    });

    childProcess.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        done({ success: false, error: `ffmpeg exited with code ${code}: ${stderrTail.trim().slice(-1000)}` });
        return;
      }
      if (onProgress) onProgress(1, 'Done');
      done({ success: true, error: '' });
    });
  });

  return { childProcess, resultPromise };
}

export async function generateThumbnail(inputPath, outputPath, seconds = 1) {
  const args = [
    '-hide_banner',
    '-y',
    '-ss', String(Math.max(0, seconds)),
    '-i', inputPath,
    '-frames:v', '1',
    '-vf', 'scale=640:-2',
    outputPath,
  ];
  await execFileText('ffmpeg', args, { timeout: 45_000 });
}

export async function hasFaststart(filePath) {
  try {
    const fh = await open(filePath, 'r');
    try {
      const st = await fh.stat();
      const len = Math.min(st.size, 2 * 1024 * 1024);
      const buffer = Buffer.alloc(len);
      await fh.read(buffer, 0, len, 0);
      const head = buffer.toString('latin1');
      const moov = head.indexOf('moov');
      const mdat = head.indexOf('mdat');
      return moov >= 0 && (mdat < 0 || moov < mdat);
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

export async function containsMoovAtom(filePath) {
  try {
    const bytes = await readFile(filePath);
    return bytes.includes(Buffer.from('moov', 'latin1'));
  } catch {
    return false;
  }
}

function buildVideoFilter(target, layout) {
  const width = target.width;
  const height = target.height;
  const rect = layout.foregroundRect;
  const mode = layout.layout.backgroundMode;
  const backgroundColor = normalizeColor(layout.layout.backgroundColor);
  const left = rect.x;
  const right = Math.max(0, width - rect.width - rect.x);
  const top = rect.y;
  const bottom = Math.max(0, height - rect.height - rect.y);
  const scaled = `scale=${rect.width}:${rect.height}:flags=lanczos,setsar=1`;
  const pad = `pad=${width}:${height}:${rect.x}:${rect.y}:color=${backgroundColor}`;

  if (mode === 'solid') {
    return `[0:v]${scaled},${pad},format=yuv420p[vout]`;
  }

  if (mode === 'blur') {
    return `[0:v]${scaled},split=2[fg][bgsrc];[bgsrc]${pad},boxblur=42:10[bg];[bg][fg]overlay=${rect.x}:${rect.y},format=yuv420p[vout]`;
  }

  const fillMode = mode === 'mirror' ? 'mirror' : 'smear';
  return `[0:v]${scaled},split=2[fg][bgsrc];[bgsrc]${pad},fillborders=left=${left}:right=${right}:top=${top}:bottom=${bottom}:mode=${fillMode}[bg];[bg][fg]overlay=${rect.x}:${rect.y},format=yuv420p[vout]`;
}

function normalizeColor(color) {
  const value = String(color || '#101514').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value) || /^#[0-9a-fA-F]{8}$/.test(value)) return value;
  return '#101514';
}

function videoFlags({ target, qualityMode, encoder, useFallbackBitrate }) {
  const selectedCrf = target.crf?.[qualityMode] ?? target.crf?.high ?? 18;
  if (encoder !== 'libx264' && qualityMode === 'preview') {
    return [
      '-c:v', encoder,
      '-b:v', target.fallbackVideoBitrate,
      '-maxrate', target.preferredVideoBitrate,
      '-bufsize', target.preferredVideoBitrate,
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
    ];
  }

  if (useFallbackBitrate) {
    return [
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-b:v', target.fallbackVideoBitrate,
      '-maxrate', target.preferredVideoBitrate,
      '-bufsize', target.preferredVideoBitrate,
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
    ];
  }

  return [
    '-c:v', 'libx264',
    '-preset', qualityMode === 'preview' ? 'veryfast' : 'slow',
    '-crf', String(selectedCrf),
    '-maxrate', target.preferredVideoBitrate,
    '-bufsize', target.preferredVideoBitrate,
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
  ];
}

function audioFlags(target) {
  return [
    '-c:a', target.audioCodec,
    '-b:a', '160k',
    '-ac', '2',
    '-ar', '48000',
  ];
}

function parseRate(raw) {
  if (!raw || raw === '0/0') return 0;
  if (String(raw).includes('/')) {
    const [num, den] = String(raw).split('/').map(Number);
    return den ? num / den : 0;
  }
  return Number(raw) || 0;
}

function parseSar(raw) {
  if (!raw || raw === '0:1') return 1;
  const [num, den] = String(raw).split(':').map(Number);
  return den ? num / den : 1;
}

function readRotation(stream) {
  const tagRotation = Number(stream.tags?.rotate || 0);
  if (Number.isFinite(tagRotation) && Math.abs(tagRotation) > 0.01) return normalizeRotation(tagRotation);
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  for (const item of sideData) {
    const rotation = Number(item.rotation);
    if (Number.isFinite(rotation) && Math.abs(rotation) > 0.01) return normalizeRotation(rotation);
  }
  return 0;
}

function normalizeRotation(rotation) {
  let value = rotation % 360;
  if (value > 180) value -= 360;
  if (value < -180) value += 360;
  return value;
}

function detectContainer(formatName, extension) {
  const fmt = String(formatName || '').toLowerCase();
  const ext = String(extension || '').replace('.', '').toLowerCase();
  if (['mp4', 'm4v'].includes(ext)) return 'mp4';
  if (['mov', 'qt'].includes(ext)) return 'mov';
  if (fmt.includes('mp4')) return 'mp4';
  if (fmt.includes('mov')) return 'mov';
  if (fmt.includes('matroska') || ext === 'mkv') return 'mkv';
  if (fmt.includes('avi') || ext === 'avi') return 'avi';
  if (fmt.includes('mpeg') || ['mpeg', 'mpg'].includes(ext)) return 'mpeg';
  return ext || fmt.split(',')[0] || 'unknown';
}

function parseProgressTime(line) {
  const match = /time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}
