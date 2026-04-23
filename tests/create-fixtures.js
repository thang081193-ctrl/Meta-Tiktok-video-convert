import { execFile } from 'child_process';
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tests', 'fixtures');

await mkdir(dir, { recursive: true });

const fixtures = [
  ['landscape_16x9_30fps_h264_aac.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']],
  ['vertical_9x16_ready_tiktok_meta.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest']],
  ['square_1x1_ready_meta.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1080:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest']],
  ['feed_4x5_ready_meta.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1350:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=550:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest']],
  ['high_fps_60fps.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=60:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
  ['no_audio.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']],
  ['unsupported_codec_hevc.mov', ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=3', '-c:v', 'libx265', '-pix_fmt', 'yuv420p']],
];

for (const [name, args] of fixtures) {
  const output = path.join(dir, name);
  await run('ffmpeg', ['-hide_banner', '-y', ...args, output]);
  console.log(`created ${output}`);
}

async function run(bin, args) {
  await new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120_000 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve();
    });
  });
}
