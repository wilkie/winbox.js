/**
 * The trace example (`crates/winbox-win16/examples/trace.rs`) on the Rust
 * engine built for WebAssembly (`crates/winbox-web`), in Node: the same
 * arguments, the same drives, the same survey on the virtual clock, and the
 * same report printed, to the byte; the same screens saved.
 *
 *   pnpm build:web
 *   node scripts/web/trace.mjs PROGRAM.EXE [--path C:\PROGRAM.EXE]
 *     [--windows DIR] [--drive DIR] [--oracle-drives] [--display MODE]
 *     [--budget N] [--seconds N] [--calls N] [--boxes N] [--screen FILE]
 *     [--marks REPORT.json] [--input SEED] [--summary]
 *
 * The drives are held in the module's memory, as a page holds them: C:
 * `--drive`'s folder, else one with a copy of the program's folder where
 * `--path` puts it, made now, as a copy is; over `--windows`, an
 * installation, read and never written. Each file and folder of a host's is
 * last written when the host's was. What the program writes stays in
 * memory: unlike the trace example's `--drive`, nothing reaches the host's
 * folder. `WINBOX_TRACE_INSTRUCTIONS` prints the instructions run at each
 * call, as the trace example does.
 *
 * The corpus runs it in the trace example's place:
 * `WINBOX_TRACE="node scripts/web/trace.mjs" target/release/examples/corpus`.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'target', 'winbox-web');

/** What the command line asks for, as the trace example reads it. */
function options(argv) {
  const asked = {
    file: undefined,
    drive: undefined,
    path: undefined,
    windows: undefined,
    oracleDrives: false,
    screen: undefined,
    marks: undefined,
    survey: {
      display: 'vga',
      seconds: 10,
      budget: 100_000_000,
      calls: null,
      boxes: 0,
      marks: null,
      input: null,
      summary: false,
      counts: false,
      screens: false,
    },
  };
  const survey = asked.survey;
  const number = (text, otherwise) => {
    const value = Number(text);

    return text !== undefined && text.trim() !== '' && Number.isFinite(value) ? value : otherwise;
  };
  const whole = (text, otherwise) => {
    const value = number(text, NaN);

    return Number.isInteger(value) && value >= 0 ? value : otherwise;
  };

  for (let at = 0; at < argv.length; at++) {
    const argument = argv[at];
    const next = () => argv[++at];

    switch (argument) {
      case '--drive':
        asked.drive = next();
        break;
      case '--path':
        asked.path = next();
        break;
      case '--windows':
        asked.windows = next();
        break;
      case '--oracle-drives':
        asked.oracleDrives = true;
        break;
      case '--screen':
        asked.screen = next();
        break;
      case '--calls':
        survey.calls = whole(next(), null);
        break;
      case '--marks':
        asked.marks = next();
        break;
      case '--input':
        survey.input = whole(next(), null);
        break;
      case '--summary':
        survey.summary = true;
        break;
      case '--boxes':
        survey.boxes = whole(next(), survey.boxes);
        break;
      case '--budget':
        survey.budget = whole(next(), survey.budget);
        break;
      case '--seconds':
        survey.seconds = number(next(), survey.seconds);
        break;
      case '--display': {
        const display = next();

        if (display !== undefined) {
          survey.display = display;
        }
        break;
      }
      default:
        asked.file = argument;
    }
  }

  return asked;
}

/** When a host's file or folder was last written, in seconds since 1970. */
function modified(path) {
  return Math.floor(statSync(path).mtimeMs / 1000);
}

/**
 * A host's folder put on a drive at `dos`, and everything in it: each last
 * written when the host's was, or at `at`, where given, as a copy made then
 * is.
 */
function hold(machine, drive, folder, dos, at) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    const named = dos === '' ? entry.name : `${dos}\\${entry.name}`;
    const when = at ?? modified(path);

    if (entry.isDirectory()) {
      machine.add_folder(drive, named, when);
      hold(machine, drive, path, named, at);
    } else {
      machine.add_file(drive, named, readFileSync(path), when);
    }
  }
}

/** A table of every byte's CRC, as PNG's chunks are checked. */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;

  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }

  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;

  for (const byte of bytes) {
    c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  }

  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);

  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A screen saved as a PNG, eight bits each of red, green and blue. */
function savePng(file, screen) {
  const { width, height } = screen;
  const rgb = screen.rgb();
  const rows = Buffer.alloc((width * 3 + 1) * height);

  for (let row = 0; row < height; row++) {
    // Each row unfiltered.
    rows[row * (width * 3 + 1)] = 0;
    rows.set(rgb.subarray(row * width * 3, (row + 1) * width * 3), row * (width * 3 + 1) + 1);
  }

  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;

  try {
    writeFileSync(
      file,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(rows)),
        chunk('IEND', Buffer.alloc(0)),
      ])
    );
  } catch {
    process.stderr.write(`cannot write ${file}\n`);
  }
}

/**
 * The screens as the trace example names them: the first as asked, the
 * rest `-2`, `-3` and on, each box `.box1.png` and on.
 */
function saveScreens(screen, kept) {
  const screens = kept.filter((each) => !each.is_box);
  const boxes = kept.filter((each) => each.is_box);
  const extension = extname(screen);
  const stem = basename(screen, extension);
  const folder = dirname(screen);
  const bare = extension === '' ? screen : screen.slice(0, -extension.length);

  screens.forEach((each, at) => {
    savePng(at === 0 ? screen : join(folder, `${stem}-${at + 1}.png`), each);
  });
  boxes.forEach((each, at) => savePng(`${bare}.box${at + 1}.png`, each));
}

async function main() {
  const asked = options(process.argv.slice(2));

  if (asked.file === undefined) {
    process.stderr.write("a program's file\n");
    process.exit(2);
  }

  const { default: init, Machine } = await import(join(OUT, 'winbox_web.js'));

  await init({ module_or_path: readFileSync(join(OUT, 'winbox_web_bg.wasm')) });

  const bytes = readFileSync(asked.file);
  const name = basename(asked.file).toUpperCase();
  const path = asked.path ?? `C:\\${name}`;
  const survey = asked.survey;

  survey.marks = asked.marks === undefined ? null : readText(asked.marks);
  survey.screens = asked.screen !== undefined;
  survey.counts = process.env.WINBOX_TRACE_INSTRUCTIONS !== undefined;

  const machine = new Machine(survey.display, true);

  machine.add_drive('C');

  // Windows installed beneath drive C:, where an installation is given.
  if (asked.windows !== undefined) {
    hold(machine, 'C', asked.windows, '');
  }

  if (asked.drive !== undefined) {
    hold(machine, 'C', asked.drive, '');
  } else {
    // The program's own folder where its path puts it, for its
    // libraries: copied now, as the trace example copies it.
    const now = Math.floor(Date.now() / 1000);
    const folders = path.split('\\').slice(1, -1);

    if (folders.length > 0) {
      folders.forEach((_, at) => machine.add_folder('C', folders.slice(0, at + 1).join('\\'), now));
      hold(machine, 'C', dirname(asked.file), folders.join('\\'), now);
    }
  }

  // The machine the oracle recorded on: A:, a floppy, and Z:, DOSBox's.
  if (asked.oracleDrives) {
    machine.add_drive('A');
    machine.add_drive('Z');
  }

  const report = machine.survey(JSON.stringify(survey), path, bytes);

  if (asked.screen !== undefined) {
    saveScreens(asked.screen, machine.survey_screens());
  }

  process.stdout.write(report);
}

/** A file's text, or none where it cannot be read, as `unwrap_or_default`. */
function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

await main();
