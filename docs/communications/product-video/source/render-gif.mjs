import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const output = fileURLToPath(new URL('..', import.meta.url));
const build = join(output, '.build');
const filename = 'flowassert-preview.gif';
const temporary = join(build, filename);
const segments = [[1, 5], [8, 12], [16, 20], [24, 28], [32, 36], [40, 44]];
await mkdir(build, { recursive: true });

// Keep four seconds from each scene, at its original speed, without audio.
const selection = segments.map(([start, end]) => `gte(t,${start})*lt(t,${end})`).join('+');
const filter = `[0:v]fps=30,select='${selection}',setpts=N/(30*TB),` +
  'fps=10,scale=960:-1:flags=lanczos,split[a][b];' +
  '[a]palettegen=max_colors=128:stats_mode=diff[p];' +
  '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle[out]';
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', join(output, 'flowassert-introduction.zh-CN.mp4'),
  '-filter_complex', filter, '-map', '[out]', '-an', '-loop', '0', temporary,
], { stdio: 'inherit' });
execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', temporary, '-f', 'null', '-'], { stdio: 'inherit' });
const info = JSON.parse(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration:stream=width,height,nb_frames',
  '-of', 'json', temporary,
], { encoding: 'utf8' }));
const bytes = (await stat(temporary)).size;
const stream = info.streams[0];
if (bytes > 5 * 1024 * 1024 || Number(info.format.duration) !== 24 ||
    stream.width !== 960 || stream.height !== 540 || Number(stream.nb_frames) !== 240) {
  throw new Error(`Unexpected GIF size, duration, dimensions, or frame count: ${JSON.stringify({ bytes, ...info })}`);
}
const sha256 = createHash('sha256').update(await readFile(temporary)).digest('hex');
await rename(temporary, join(output, filename));
console.log(JSON.stringify({ path: filename, sha256, bytes, durationSeconds: 24,
  width: 960, height: 540, fps: 10, frames: 240, audio: false,
  loop: 'infinite', sourceSegmentsSeconds: segments }, null, 2));
