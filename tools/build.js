/**
 * Release build: bundle the JS, bundle the CSS with the fonts inlined as data
 * URLs, then fold both into one `dist/index.html`.
 *
 * The manifest, service worker, and icons stay as separate files, because an
 * installable app needs real URLs for them; everything the page itself needs is
 * inside the single HTML file (00-build-outline.md, "Tech stack").
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** Escapes a string for safe insertion inside a <script> or <style> element. */
function forInlineTag(code) {
  return code.replace(/<\/(script|style)/gi, '<\\/$1');
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const js = await build({
    entryPoints: [join(ROOT, 'src', 'main.js')],
    bundle: true,
    format: 'esm',
    target: ['es2022', 'safari16', 'chrome110'],
    minify: true,
    write: false,
    loader: { '.json': 'json' },
  });

  const css = await build({
    entryPoints: [join(ROOT, 'src', 'styles', 'index.css')],
    bundle: true,
    minify: true,
    write: false,
    // Fonts become data: URLs, so the released page needs no network at all.
    loader: { '.woff2': 'dataurl' },
  });

  const jsCode = js.outputFiles[0].text;
  const cssCode = css.outputFiles[0].text;

  let html = await readFile(join(ROOT, 'index.html'), 'utf8');
  // The replacements are functions, not strings: minified code contains
  // sequences like `$&` and `$<`, which String.replace would read as
  // replacement patterns and paste the surrounding HTML back into the page.
  html = html
    .replace('data-build="0"', 'data-build="1"')
    .replace(
      '<link rel="stylesheet" href="./src/styles/index.css" />',
      () => `<style>${forInlineTag(cssCode)}</style>`,
    )
    .replace(
      '<script type="module" src="./src/main.js"></script>',
      () => `<script type="module">${forInlineTag(jsCode)}</script>`,
    );

  if (html.includes('src/main.js') || html.includes('src/styles/index.css')) {
    throw new Error('build: index.html still references a source file; inlining failed');
  }

  await writeFile(join(DIST, 'index.html'), html);

  // The service worker's cache key is the hash of the page it caches, so a new
  // build always replaces the old cache.
  const version = createHash('sha256').update(html).digest('hex').slice(0, 12);
  const sw = await readFile(join(ROOT, 'public', 'sw.js'), 'utf8');
  await writeFile(join(DIST, 'sw.js'), sw.replace('__UK_VERSION__', version));

  await cp(join(ROOT, 'public', 'manifest.webmanifest'), join(DIST, 'manifest.webmanifest'));
  await cp(join(ROOT, 'public', 'icons'), join(DIST, 'icons'), { recursive: true });

  const size = Buffer.byteLength(html);
  console.log(`  dist/index.html  ${(size / 1024).toFixed(1)} KB  (build ${version})`);
  console.log(`  dist/sw.js, dist/manifest.webmanifest, dist/icons/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
