import { createHash, randomBytes } from 'crypto';
import { createReadStream } from 'fs';
import { copyFile, mkdir, readdir, rm, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function ensureDirs(dirs) {
  await Promise.all(dirs.map(dir => ensureDir(dir)));
}

export function createId(bytes = 12) {
  return randomBytes(bytes).toString('hex');
}

export function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'file';
}

export function safeStem(name) {
  const stem = path.parse(sanitizeFilename(name)).name || 'video';
  return stem.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'video';
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function copyOrReplace(src, dest) {
  await ensureDir(path.dirname(dest));
  await copyFile(src, dest);
}

export async function removeIfExists(filePath) {
  try {
    await unlink(filePath);
  } catch {
    // Best-effort cleanup.
  }
}

export async function removeDirIfExists(dirPath) {
  try {
    await rm(dirPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}

export async function sweepOldFiles(dirPath, ttlMs) {
  let swept = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        const st = await stat(fullPath);
        if (now - st.mtimeMs <= ttlMs) continue;
        if (entry.isDirectory()) {
          await rm(fullPath, { recursive: true, force: true });
        } else {
          await unlink(fullPath);
        }
        swept++;
      } catch {
        // Ignore races.
      }
    }
  } catch {
    // Directory may not exist yet.
  }
  return swept;
}

export function assertInside(baseDir, candidatePath) {
  const base = path.resolve(baseDir);
  const candidate = path.resolve(candidatePath);
  if (candidate !== base && !candidate.startsWith(base + path.sep)) {
    const err = new Error('Path is outside of allowed workspace.');
    err.status = 403;
    throw err;
  }
  return candidate;
}
