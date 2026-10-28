import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const media = join(repo, 'docs/communications/product-video');

export async function buildSite(output = join(repo, 'dist/site')) {
  await rm(output, { recursive: true, force: true });
  await mkdir(join(output, 'assets'), { recursive: true });
  await mkdir(join(output, 'vendor'), { recursive: true });
  for (const file of ['index.html', 'styles.css', 'app.js', 'copy.js', 'playground.js']) {
    await copyFile(join(repo, 'site', file), join(output, file));
  }
  // Publish only the reviewed media and browser YAML parser, never the repository.
  for (const file of ['cover.png', 'flowassert-introduction.zh-CN.mp4']) {
    await copyFile(join(media, file), join(output, 'assets', file));
  }
  await copyFile(join(media, 'source/assets/live-after.png'), join(output, 'assets/workbench.png'));
  const yaml = dirname(require.resolve('yaml/package.json'));
  await cp(join(yaml, 'browser'), join(output, 'vendor/yaml'), { recursive: true });
  await copyFile(join(yaml, 'LICENSE'), join(output, 'vendor/yaml/LICENSE'));
  const captions = await readFile(join(media, 'flowassert-introduction.zh-CN.srt'), 'utf8');
  await writeFile(join(output, 'assets/subtitles.zh-CN.vtt'), 'WEBVTT\n\n' + captions.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'));
  await copyFile(join(repo, 'site/subtitles.en.vtt'), join(output, 'assets/subtitles.en.vtt'));
  await writeFile(join(output, '.nojekyll'), '');
  return output;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(`Built GitHub Pages site: ${await buildSite()}`);
}
