#!/usr/bin/env node
/**
 * Writes `crates/winbox-win16/data/setup.json`: what Windows' own Setup put
 * on C: for each display mode, read off the oracle's installations
 * (`scripts/oracle/install-windows.mjs`) and grounded in `SETUP.INF` -- the
 * composition WinBox's base drive is made from (`src/assets/compose.ts`,
 * `crates/winbox-win16/src/assets.rs`).
 *
 * For each display:
 *
 * - **files**: the files of the installation that are in the asset
 *   bundle's pool (`src/assets/make.ts`, `poolNames`), where Setup put them,
 *   each with the `SETUP.INF` line that names it; on a display changed
 *   after the VGA's installation, the VGA's files Setup left behind too.
 * - **profiles**: `WIN.INI` and `SYSTEM.INI`, line for line as Setup wrote
 *   them, each line with what grounds it: a `SETUP.INF` section, the
 *   templates `WIN.SRC` and `SYSTEM.SRC` from the first disk, or the
 *   oracle's installation itself (Setup given the oracle's answers).
 * - **registry**: `REG.DAT`, made from `SETUP.REG` as Setup makes it
 *   (`SETUP.INF` `[data]` `register`).
 *
 * This is the only writer of `setup.json`: nothing in it is typed in by
 * hand. A display with no installation under `oracle/build` is left out.
 *
 *   pnpm assets && node dist/assets/survey-installs.js
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readFat12 } from '../../src/file-systems/fat12.ts';
import { expandSzdd, expandedName, isSzdd } from '../../src/assets/szdd.ts';
import { diskFile, readInf, section, unquote } from '../../src/assets/setup-inf.ts';
import { poolNames } from '../../src/assets/make.ts';
import { findImages, formatted, ROOT, SVGA256 } from './media.mjs';

const OUT = join(ROOT, 'crates', 'winbox-win16', 'data', 'setup.json');
const PROFILES = ['WINDOWS/WIN.INI', 'WINDOWS/SYSTEM.INI'];

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

/** The first disk's files Setup reads: SETUP.INF and the profiles' templates. */
async function media() {
  const files = new Map();

  for (const image of await findImages()) {
    for (const file of readFat12(new Uint8Array(await readFile(image)))) {
      if (isSzdd(file.data)) {
        const expanded = expandSzdd(file.data);

        files.set(expandedName(file.path, expanded.last), expanded.data);
      } else {
        files.set(file.path, file.data);
      }
    }
  }

  for (const name of ['SETUP.INF', 'WIN.SRC', 'SYSTEM.SRC']) {
    if (!files.has(name)) {
      throw new Error(`no ${name} on the setup disks`);
    }
  }

  return files;
}

/** The lines of a template, by section, as Setup copies them. */
function template(text) {
  const sections = new Map();
  let current = '';

  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]*)\]/.exec(line);

    if (header) {
      current = header[1].toLowerCase();
    }

    if (!sections.has(current)) {
      sections.set(current, new Set());
    }

    sections.get(current).add(normal(line));
  }

  return sections;
}

/** A line as compared with a template's: spaces around its `=` taken out. */
function normal(line) {
  const at = line.indexOf('=');

  return at === -1 ? line.trim() : `${line.slice(0, at).trim()}=${line.slice(at + 1).trim()}`;
}

/** Every file below an installation, by its path with `/`. */
async function walk(drive) {
  const files = [];
  const directories = [];

  async function into(at, prefix) {
    for (const entry of (await readdir(at, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const path = `${prefix}${entry.name}`;

      if (entry.isDirectory()) {
        directories.push(path);
        await into(join(at, entry.name), `${path}/`);
      } else {
        files.push(path);
      }
    }
  }

  await into(drive, '');
  return { files, directories };
}

/** The `[display]` line for a display, from `SETUP.INF` or the driver disk's `OEMSETUP.INF`. */
function displayLine(inf, oem, settings) {
  const source = settings.driver ? oem : inf;
  const lines = section(source, 'display');
  const line = settings.change
    ? lines.find((entry) => unquote(entry.fields[1]) === settings.change)
    : lines.find((entry) => entry.key === settings.profile);

  if (!line) {
    throw new Error(`no [display] line for ${settings.change ?? settings.profile}`);
  }

  return { line, file: settings.driver ? 'OEMSETUP.INF' : 'SETUP.INF' };
}

/** The resolution a display's fonts are for: its `[display]` line's third field. */
const resolutionOf = (line) => unquote(line.fields[2]);

/** Where a pool file is named in `SETUP.INF`: the section and the line's text. */
function namedBy(inf, name) {
  const found = [];

  for (const [sectionName, lines] of inf) {
    for (const line of lines) {
      if (line.fields.some((field) => diskFile(field)?.name === name)) {
        found.push({ section: sectionName, line });
      }
    }
  }

  return found;
}

/** What grounds a pool file on a display's drive. */
function groundFile(inf, name, resolution, changed) {
  const names = namedBy(inf, name).filter(({ section: name }) =>
    /^(sysfonts|fixedfonts|oemfonts|fonts|ttfonts|codepages|win\.other|.*\.3gr)$/.test(name)
  );

  if (names.length === 0) {
    throw new Error(`${name} is in no list of SETUP.INF's the pool is made from`);
  }

  const own = names.find(({ line }) => {
    const fields = line.fields.map(unquote);

    return fields.includes(resolution) || !fields.some((field) => /^\d+,\d+,\d+$/.test(field));
  });
  const { section: sectionName, line } = own ?? names[0];
  const ground = `SETUP.INF [${sectionName}] ${line.text.trim().replace(/\s+/g, ' ')}`;

  return own || !changed
    ? ground
    : `${ground} -- left by the VGA's installation the display was changed from`;
}

/** A profile line's ground. */
function groundLine(context, sectionName, text) {
  const { inf, oem, display, work, templates, file } = context;
  const trimmed = text.trim();
  const key = trimmed.includes('=') ? trimmed.slice(0, trimmed.indexOf('=')).trim() : null;
  const value = key === null ? null : trimmed.slice(trimmed.indexOf('=') + 1).trim();
  const lower = (s) => (s ?? '').toLowerCase();
  const sourceName = file === 'WIN.INI' ? 'WIN.SRC' : 'SYSTEM.SRC';
  const template = templates[file];
  const fromTemplate = template.get(lower(sectionName))?.has(normal(trimmed));

  if (trimmed === '') {
    return 'layout: the blank line Setup leaves between sections';
  }

  if (trimmed.startsWith('[')) {
    if (template.has(lower(trimmed.slice(1, trimmed.indexOf(']'))))) {
      return sourceName;
    }

    const named = work.find((line) => lower(unquote(line.fields[3])) === lower(sectionName));

    return named ? `${context.displayFile} [${context.workName}]` : 'oracle';
  }

  if (key === null) {
    return fromTemplate ? sourceName : 'oracle';
  }

  /* WIN.INI's [fonts]: a description and a file from [fonts] or [ttfonts]. */
  if (file === 'WIN.INI' && lower(sectionName) === 'fonts') {
    for (const [fonts, column] of [
      ['fonts', 0],
      ['ttfonts', 0],
    ]) {
      const line = section(inf, fonts).find(
        (entry) =>
          diskFile(entry.fields[column])?.name === value.toUpperCase() &&
          unquote(entry.fields[1]) === key
      );

      if (line) {
        return `SETUP.INF [${fonts}] ${diskFile(line.fields[column]).name}`;
      }
    }
  }

  /* SYSTEM.INI's [boot] fonts: the resolution's line. */
  const bootFonts = {
    'fonts.fon': 'sysfonts',
    'fixedfon.fon': 'fixedfonts',
    'oemfonts.fon': 'oemfonts',
  };

  if (file === 'SYSTEM.INI' && bootFonts[lower(key)]) {
    const fonts = bootFonts[lower(key)];
    const line = section(inf, fonts).find(
      (entry) =>
        diskFile(entry.fields[0])?.name === value.toUpperCase() &&
        unquote(entry.fields[2]) === resolutionOf(display.line)
    );

    if (line) {
      return `SETUP.INF [${fonts}] ${diskFile(line.fields[0]).name} "${unquote(line.fields[2])}"`;
    }
  }

  /* The display's own line: its driver, description, resolution, grabbers, VDD. */
  const fields = display.line.fields.map((field) => lower(diskFile(field)?.name ?? unquote(field)));
  const vdd = lower(display.line.fields[5]).replace(/^x:/, '');

  if (
    (value !== '' && fields.includes(lower(value))) ||
    (vdd && lower(value) === vdd) ||
    lower(value) === lower(unquote(display.line.fields[1]))
  ) {
    return `${display.file} [display] ${display.line.key}`;
  }

  /* The display's work section: a line it puts in. */
  if (work.some((line) => lower(unquote(line.fields[5])) === lower(trimmed))) {
    return `${display.file} [${context.workName}]`;
  }

  /* The grabber's fonts. */
  const grabber = diskFile(display.line.fields[6])?.name;
  const woa = grabber ? section(display.file === 'SETUP.INF' ? inf : oem, grabber) : [];

  if (woa.some((line) => diskFile(line.fields[0])?.name === key.toUpperCase())) {
    return `${display.file} [${grabber}]`;
  }

  /* The code page, 437, and its DOS-window font. */
  const codepage = section(inf, 'codepages').find((line) => line.key === '437');

  if (
    codepage &&
    (lower(value) === '437' ||
      lower(value) === lower(unquote(codepage.fields[3])) ||
      lower(value) === lower(diskFile(codepage.fields[2])?.name))
  ) {
    return 'SETUP.INF [codepages] 437';
  }

  /* A line SETUP.INF writes into the profile itself. */
  for (const [sectionName, lines] of inf) {
    for (const line of lines) {
      if (
        lower(unquote(line.fields[0])) === lower(file) &&
        line.fields.some((field) => unquote(field) === trimmed)
      ) {
        return `SETUP.INF [${sectionName}]`;
      }
    }
  }

  if (fromTemplate) {
    return sourceName;
  }

  /* A choice the oracle's answers made: a field of the line the answer
   * names, in whichever list has it -- [machine] ibm_compatible,
   * [pointing.device] ps2mouse, [network] nonet, [language] enu -- or the
   * keyboard's type, the digit after `t` in its name (t4s0enha). */
  const token = (field) => lower(diskFile(field)?.name ?? unquote(field)).replace(/^[x?]:/, '');

  for (const [sectionName, lines] of inf) {
    for (const line of lines) {
      if (!line.key || !context.answers.has(lower(line.key))) {
        continue;
      }

      const tokens = line.fields.map(token).filter(Boolean);
      const typed =
        sectionName === 'keyboard.types' &&
        lower(key) === 'type' &&
        lower(line.key).startsWith(`t${value}s`);

      if (typed || (value && tokens.some((field) => field === lower(value).replace(/^\*/, '')))) {
        return `SETUP.INF [${sectionName}] ${line.key}, the oracle's answer`;
      }
    }
  }

  return oem &&
    display.file === 'OEMSETUP.INF' &&
    [...oem.values()].some((lines) =>
      lines.some((line) => line.fields.some((field) => unquote(field) === trimmed))
    )
    ? 'OEMSETUP.INF'
    : 'oracle';
}

/** A profile's lines, each with its ground, and how the file ends. */
function profileOf(context, file, bytes) {
  const text = latin1(bytes);
  const lines = text.split('\r\n');
  const ends = lines[lines.length - 1] === '' ? '\r\n' : '';

  if (ends) {
    lines.pop();
  }

  if (lines.some((line) => /[\r\n]/.test(line))) {
    throw new Error(`${file} has a line not ended CR LF`);
  }

  let sectionName = '';

  const grounded = lines.map((line) => {
    const header = /^\s*\[([^\]]*)\]/.exec(line);

    if (header) {
      sectionName = header[1];
    }

    return [line, groundLine({ ...context, file }, sectionName, line)];
  });

  if (grounded.map(([line]) => line).join('\r\n') + ends !== text) {
    throw new Error(`${file} does not read back as it is`);
  }

  return { end: ends, lines: grounded };
}

async function main() {
  const { ANSWERS, DISPLAYS, driveFor } = await import(
    pathToFileURL(join(ROOT, 'scripts', 'oracle', 'install-windows.mjs')).href
  );
  const modes = Object.keys(
    JSON.parse(
      await readFile(join(ROOT, 'crates', 'winbox-win16', 'data', 'displays.json'), 'utf8')
    )
  );
  const files = await media();
  const inf = readInf(latin1(files.get('SETUP.INF')));
  const oemText = await readFile(join(SVGA256, 'OEMSETUP.INF'), 'latin1').catch(() => null);
  const oem = oemText ? readInf(oemText) : null;
  const pool = new Set(poolNames(inf));
  const templates = {
    'WIN.INI': template(latin1(files.get('WIN.SRC'))),
    'SYSTEM.INI': template(latin1(files.get('SYSTEM.SRC'))),
  };
  const register = section(inf, 'data').find((line) => line.key === 'register');
  /* The profiles the oracle's answer file names: `mouse = ps2mouse`. */
  const answers = new Set(
    ANSWERS.filter((line) => line.includes('=')).map((line) =>
      line
        .slice(line.indexOf('=') + 1)
        .trim()
        .toLowerCase()
    )
  );
  const out = { about: '', displays: {}, profiles: {} };
  const texts = new Map();

  for (const mode of modes) {
    const settings = DISPLAYS[mode];

    if (!settings) {
      continue;
    }

    const drive = driveFor(mode);
    const listed = await walk(drive).catch(() => null);

    if (!listed || (settings.driver && !oem)) {
      console.log(`${mode}: no installation, left out`);
      continue;
    }

    const display = displayLine(inf, oem, settings);
    const workName = display.line.fields[9] ? unquote(display.line.fields[9]).toLowerCase() : null;
    const work = workName ? section(display.file === 'SETUP.INF' ? inf : oem, workName) : [];
    const changed = Boolean(settings.change);
    const resolution = resolutionOf(display.line);
    const context = {
      inf,
      oem,
      display,
      displayFile: display.file,
      work,
      workName,
      templates,
      answers,
    };
    const placed = listed.files
      .filter((path) => pool.has(path.split('/').pop()))
      .map((path) => [path, groundFile(inf, path.split('/').pop(), resolution, changed)]);
    const profiles = {};

    for (const path of PROFILES) {
      const bytes = await readFile(join(drive, path));
      const text = latin1(bytes);
      let key = texts.get(text);

      if (!key) {
        key = `${path.split('/').pop()} ${mode}`;
        texts.set(text, key);
        out.profiles[key] = profileOf(context, path.split('/').pop(), bytes);
      }

      profiles[path] = key;
    }

    out.displays[mode] = {
      drive: drive.slice(drive.lastIndexOf('/') + 1),
      profile: display.line.key,
      ...(settings.driver ? { oem: true } : {}),
      driver: diskFile(display.line.fields[0]).name,
      ...(changed
        ? {
            changed: `Setup run again on the VGA's installation, ${settings.change} chosen (install-windows.mjs, changeDisplay): the order of SYSTEM.INI's lines and the VGA's files it left are that run's`,
          }
        : {}),
      directories: listed.directories,
      files: placed,
      profiles,
      ...(listed.files.includes('WINDOWS/REG.DAT') &&
      listed.files.includes('WINDOWS/SYSTEM/SETUP.REG')
        ? {
            registry: {
              path: 'WINDOWS/REG.DAT',
              script: 'SETUP.REG',
              ground: `SETUP.INF [data] register = ${register.fields.join(', ')}`,
            },
          }
        : {}),
    };
    console.log(`${mode}: ${placed.length} files, ${listed.directories.length} folders`);
  }

  out.about =
    "What Windows 3.1's Setup put on C: for each display, read off the oracle's installations and grounded in SETUP.INF: written by scripts/assets/survey-installs.mjs, never by hand.";
  await writeFile(OUT, await formatted(OUT, out));
  console.log(`-> ${OUT}`);
}

main().catch((error) => {
  console.error(`survey-installs: ${error.stack}`);
  process.exitCode = 1;
});
