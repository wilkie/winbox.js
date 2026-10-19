#!/usr/bin/env node
/**
 * Makes WinBox's asset bundle from the user's own Windows 3.1 media
 * (`src/assets/make.ts`, `kb/topics/asset-bundle.md`): the six setup disks'
 * images `scripts/oracle/fetch-windows.mjs` fetched, and the Driver
 * Library's Super VGA 256-colour driver `fetch-svga256.mjs` unpacked, where
 * it was.
 *
 * Writes `oracle/build/winbox-assets.zip` and the same files unpacked in
 * `oracle/build/assets/`. Both are gitignored: the bundle is Microsoft's
 * files, and is never committed or shipped.
 *
 *   pnpm assets
 *   pnpm assets -- --from <image, zip or folder> ... [--out <dir>]
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { makeAssets } from '../../src/assets/make.ts';
import {
  BUILD,
  driverFiles,
  filesBelow,
  findImages,
  FLOPPIES,
  inputsOf,
  ROOT,
  SVGA256,
} from './media.mjs';

async function made() {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  let commit;

  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    commit = undefined;
  }

  return { by: 'WinBox make-assets', version: pkg.version, ...(commit ? { commit } : {}) };
}

async function inputs(args) {
  const from = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from') {
      from.push(args[++i]);
    }
  }

  if (from.length === 0) {
    return [
      ...(await inputsOf(await findImages(), FLOPPIES)),
      ...(await inputsOf(await driverFiles(), SVGA256)),
    ];
  }

  const all = [];

  for (const path of from) {
    const info = await stat(path);

    all.push(
      ...(info.isDirectory()
        ? await inputsOf(await filesBelow(path), path)
        : await inputsOf([path], dirname(path)))
    );
  }

  return all;
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const out = at === -1 ? BUILD : args[at + 1];
  const known = JSON.parse(
    await readFile(join(ROOT, 'scripts', 'assets', 'known-media.json'), 'utf8')
  );
  const bundle = await makeAssets(await inputs(args), { known, made: await made() });
  const folder = join(out, 'assets');

  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'winbox-assets.zip'), bundle.zip);
  await rm(folder, { recursive: true, force: true });

  for (const file of bundle.files) {
    const path = join(folder, file.path);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.data);
  }

  const { manifest } = bundle;
  const unknown = manifest.sources.filter((source) => !source.known);

  console.log(`bundle ${manifest.id}`);
  console.log(
    `  ${manifest.files.length} files, ${bundle.zip.length} bytes -> ${join(out, 'winbox-assets.zip')}`
  );
  console.log(`  displays: ${manifest.displays.join(', ')}`);
  console.log(
    unknown.length === 0
      ? `  every one of ${manifest.sources.length} sources is known media`
      : `  ${unknown.length} sources are not known media: ${unknown.map((s) => s.name).join(', ')}`
  );
}

main().catch((error) => {
  console.error(`make-assets: ${error.message}`);
  process.exitCode = 1;
});
