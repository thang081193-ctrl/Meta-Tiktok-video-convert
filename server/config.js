import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  rootDir: ROOT_DIR,
  port: Number(process.env.PORT || 4173),
  publicDir: path.join(ROOT_DIR, 'public'),
  workspaceDir: process.env.CONVERTER_WORKSPACE_DIR
    ? path.resolve(process.env.CONVERTER_WORKSPACE_DIR)
    : path.join(ROOT_DIR, 'workspace'),
  maxFilesPerUpload: Number(process.env.MAX_FILES_PER_UPLOAD || 30),
  maxFileSizeBytes: Number(process.env.MAX_FILE_SIZE_BYTES || 500 * 1024 * 1024),
  maxMusicSizeBytes: Number(process.env.MAX_MUSIC_SIZE_BYTES || 200 * 1024 * 1024),
  jobTtlMs: Number(process.env.JOB_TTL_MS || 24 * 60 * 60 * 1000),
  cleanupIntervalMs: Number(process.env.CLEANUP_INTERVAL_MS || 10 * 60 * 1000),
};

export const paths = {
  uploads: path.join(config.workspaceDir, 'uploads'),
  jobs: path.join(config.workspaceDir, 'jobs'),
  outputs: path.join(config.workspaceDir, 'outputs'),
  reports: path.join(config.workspaceDir, 'reports'),
  profiles: path.join(config.workspaceDir, 'profiles'),
  tmp: path.join(config.workspaceDir, 'tmp'),
};
