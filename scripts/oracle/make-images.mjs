#!/usr/bin/env node
/**
 * Makes the small disk and disc images the image probes mount
 * (`oracle/probes/<probe>.mounts`): a floppy, a CD-ROM and a hard disk,
 * each the same bytes every time it is made.
 *
 *   node scripts/oracle/make-images.mjs [name.img ...]
 *
 * With names, only those images are made, the others left as they are.
 *
 * Writes `oracle/probes/images/`, which is committed: the images are ours,
 * made here, and small once compressed.
 *
 * * `imgflop.img`: a 1.44 MB FAT12 floppy (`mformat`, `mcopy`): a label
 *   entry first in the root, files in the order they were copied -- not
 *   sorted -- one with a long name (a VFAT entry before its own), one
 *   hidden, system and read-only, a deleted entry between them, and a
 *   folder with a folder in it. Every entry's creation, access and
 *   modification stamps are set apart from one another (`FLOPPY_STAMPS`),
 *   so a listing shows which of them a drive answers.
 * * `imgwrite.img`: a 1.44 MB FAT12 floppy for `imgwrite` to write to:
 *   files in the order they were copied, a deleted entry between them, a
 *   file with no extension, one of 1,000 bytes, a folder, and a hidden
 *   folder with a file in it.
 * * `imgcd.iso`: an ISO 9660 disc (`xorriso`), its primary volume
 *   descriptor alone -- no Joliet, no Rock Ridge -- names past 8.3 (`-l`),
 *   in mixed case (`-allow-lowercase`), with their `;1` versions, a file
 *   without an extension, one marked hidden (the existence bit of its
 *   record, set here), one whose record's offset from GMT is not nought,
 *   a folder whose name is past 8.3, and an 8.3 one with folders two deep.
 * * `imgcd.bin` and `imgcd.cue`: `imgcd.iso`'s sectors as a raw image, each
 *   2,352 bytes of mode 1 -- sync, header (its place as minutes, seconds
 *   and frames, 150 on), data, EDC; the ECC left nought, which DOSBox
 *   never reads -- and a cue sheet of one MODE1/2352 track.
 * * `imgcd2.bin` and `imgcd2.cue`: the same as mode 2 form 1 (sync, header,
 *   subheader, data, EDC), a MODE2/2352 track.
 * * `imgtrk.cue` and `imgtrk audio.wav`: two files, `imgcd.bin` its data
 *   track and a WAVE file of silence its audio track, after a pregap; a
 *   name with a space, quoted, and a REM, a TITLE and a CATALOG.
 * * `imghdd.img`: a hard disk of 6 cylinders, 16 heads and 63 sectors
 *   (DOSBox's `imgmount -t hdd` takes a size only of whole such cylinders,
 *   `dos_programs.cpp` 1213-1236), with a master boot record of one
 *   partition from sector 63, FAT16 of 512-byte clusters on it.
 * * `imgsw1.iso` and `imgsw2.iso`: two discs mounted as one drive's set for
 *   `imgswap`, swapped while it runs (`swapDisc`).
 * * `imgread.iso`: a disc of one file of 256 KiB, `READ.DAT`, for `cdread`
 *   to time reads of it (`readDisc`).
 *
 * Needs `mtools` and `xorriso`.
 */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'oracle', 'probes', 'images');

function run(command, args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MTOOLS_SKIP_CHECK: '1', TZ: 'UTC', ...env },
    });
    let output = '';

    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolvePromise(output)
        : reject(new Error(`${command} ${args.join(' ')} exited ${code}: ${output}`))
    );
  });
}

/** A file's text: its name, said a number of times, so each is its own. */
function textOf(name, times) {
  return Buffer.from(
    Array.from({ length: times }, (_, i) => `${name} line ${i + 1}\r\n`).join(''),
    'latin1'
  );
}

/* ---------------------------------------------------------------- FAT */

/** A DOS date and time from a year, month, day, hour, minute and second. */
function dosStamp([year, month, day, hour = 0, minute = 0, second = 0]) {
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hour << 11) | (minute << 5) | (second >> 1),
  };
}

/**
 * Each entry's stamps, by its eleven-character name as the directory holds
 * it: created, last accessed (a date) and last written. A deleted entry is
 * named by the byte its first character was replaced with. Everything not
 * named here -- `.` and `..`, the label -- is `OTHER`.
 */
const FLOPPY_STAMPS = {
  'README  TXT': {
    created: [1993, 4, 5, 6, 7, 8],
    accessed: [1993, 5, 6],
    written: [1992, 3, 10, 3, 10, 0],
  },
  'ZEBRA   TXT': {
    created: [1991, 1, 2, 3, 4, 6],
    accessed: [1991, 2, 3],
    written: [1994, 7, 8, 9, 10, 12],
  },
  '\xe5ELETED TXT': {
    created: [1990, 6, 6, 6, 6, 6],
    accessed: [1990, 6, 6],
    written: [1990, 6, 6, 6, 6, 6],
  },
  'APPLE   TXT': {
    created: [1995, 12, 31, 23, 59, 58],
    accessed: [1996, 1, 1],
    written: [1992, 6, 15, 12, 0, 0],
  },
  'LONGFI~1TXT': {
    created: [1996, 8, 9, 10, 11, 12],
    accessed: [1996, 9, 10],
    written: [1993, 10, 11, 14, 15, 16],
  },
  'SUBDIR     ': {
    created: [1992, 2, 29, 1, 2, 4],
    accessed: [1992, 3, 1],
    written: [1992, 4, 30, 5, 6, 8],
  },
  'HIDDEN  SYS': {
    created: [1989, 9, 9, 9, 9, 10],
    accessed: [1989, 9, 9],
    written: [1992, 1, 1, 0, 0, 0],
  },
  'INNER   TXT': {
    created: [1994, 3, 3, 3, 3, 4],
    accessed: [1994, 4, 4],
    written: [1993, 2, 2, 2, 2, 2],
  },
  'NESTED     ': {
    created: [1990, 1, 1, 1, 1, 2],
    accessed: [1990, 1, 2],
    written: [1990, 2, 2, 2, 2, 2],
  },
  'DEEP    TXT': {
    created: [1991, 5, 5, 5, 5, 6],
    accessed: [1991, 6, 6],
    written: [1991, 7, 7, 7, 7, 8],
  },
  'DATA    BIN': {
    created: [1992, 8, 8, 8, 8, 8],
    accessed: [1992, 9, 9],
    written: [1993, 9, 9, 9, 9, 10],
  },
  'FIRST   TXT': {
    created: [1988, 1, 1, 1, 1, 2],
    accessed: [1988, 2, 2],
    written: [1993, 3, 3, 3, 3, 4],
  },
  'SECOND  TXT': {
    created: [1988, 3, 3, 3, 3, 4],
    accessed: [1988, 4, 4],
    written: [1993, 5, 5, 5, 5, 6],
  },
  'HARDSUB    ': {
    created: [1988, 5, 5, 5, 5, 6],
    accessed: [1988, 6, 6],
    written: [1993, 7, 7, 7, 7, 8],
  },
  'HARDIN  TXT': {
    created: [1988, 7, 7, 7, 7, 8],
    accessed: [1988, 8, 8],
    written: [1993, 9, 9, 9, 9, 10],
  },
};

const OTHER = {
  created: [1980, 1, 1, 0, 0, 0],
  accessed: [1980, 1, 1],
  written: [1992, 3, 10, 3, 10, 0],
};

/** A FAT volume's layout from its boot sector, `at` bytes into the image. */
function fatLayout(image, at) {
  const word = (offset) => image.readUInt16LE(at + offset);
  const bytesPerSector = word(11);
  const sectorsPerCluster = image[at + 13];
  const reserved = word(14);
  const fats = image[at + 16];
  const rootEntries = word(17);
  const sectors = word(19) || image.readUInt32LE(at + 32);
  const perFat = word(22);
  const root = at + (reserved + fats * perFat) * bytesPerSector;
  const data = root + rootEntries * 32;
  const clusters = Math.floor((sectors - (data - at) / bytesPerSector) / sectorsPerCluster);

  return {
    fat: at + reserved * bytesPerSector,
    root,
    rootEntries,
    data,
    clusterBytes: bytesPerSector * sectorsPerCluster,
    twelve: clusters < 4085,
  };
}

/** The next cluster of a chain. */
function nextCluster(image, layout, cluster) {
  if (!layout.twelve) {
    return image.readUInt16LE(layout.fat + cluster * 2);
  }

  const pair = image.readUInt16LE(layout.fat + Math.floor((cluster * 3) / 2));

  return cluster & 1 ? pair >> 4 : pair & 0xfff;
}

/** Every directory's entries' offsets in the image, the root first. */
function directoryEntries(image, layout) {
  const offsets = [];
  const walk = (slots) => {
    for (const at of slots) {
      const first = image[at];

      if (first === 0) {
        return;
      }

      offsets.push(at);

      const name = image.toString('latin1', at, at + 11);
      const attributes = image[at + 11];

      if (first !== 0xe5 && attributes !== 0x0f && attributes & 0x10 && !name.startsWith('.')) {
        walk(chainSlots(image, layout, image.readUInt16LE(at + 26)));
      }
    }
  };

  walk(Array.from({ length: layout.rootEntries }, (_, i) => layout.root + i * 32));

  return offsets;
}

function chainSlots(image, layout, start) {
  const slots = [];

  for (let cluster = start; cluster >= 2 && cluster < (layout.twelve ? 0xff8 : 0xfff8);) {
    const at = layout.data + (cluster - 2) * layout.clusterBytes;

    for (let i = 0; i < layout.clusterBytes; i += 32) {
      slots.push(at + i);
    }

    cluster = nextCluster(image, layout, cluster);
  }

  return slots;
}

/**
 * Every entry's stamps set as `FLOPPY_STAMPS` says, over what `mtools`
 * wrote from the host's clock; `.` and `..` take their folder's.
 */
function setFatStamps(image, at) {
  const layout = fatLayout(image, at);
  let folder = OTHER;

  for (const offset of directoryEntries(image, layout)) {
    const attributes = image[offset + 11];

    if (attributes === 0x0f) {
      continue;
    }

    const name = image.toString('latin1', offset, offset + 11);
    const stamps = name.startsWith('.') ? folder : (FLOPPY_STAMPS[name] ?? OTHER);

    if (attributes & 0x10 && !name.startsWith('.') && FLOPPY_STAMPS[name]) {
      folder = stamps;
    }

    const created = dosStamp(stamps.created);
    const accessed = dosStamp(stamps.accessed);
    const written = dosStamp(stamps.written);

    image[offset + 13] = attributes & 0x08 ? 0 : (stamps.created[5] & 1) * 100;
    image.writeUInt16LE(attributes & 0x08 ? 0 : created.time, offset + 14);
    image.writeUInt16LE(attributes & 0x08 ? 0 : created.date, offset + 16);
    image.writeUInt16LE(attributes & 0x08 ? 0 : accessed.date, offset + 18);
    image.writeUInt16LE(written.time, offset + 22);
    image.writeUInt16LE(written.date, offset + 24);
  }
}

/** Files to copy, by their DOS path, and the host file each is made from. */
async function hostFiles(into, files) {
  const made = [];

  for (const [path, bytes] of files) {
    const host = join(into, path.replace(/[\\/]/g, '_'));

    await writeFile(host, bytes);
    made.push([path, host]);
  }

  return made;
}

async function makeFloppy(scratch) {
  const image = join(scratch, 'imgflop.img');
  const on = image;

  /* Made here, zeroed: `mformat -C` leaves the last sector's end as it
   * found its buffer. */
  await writeFile(image, Buffer.alloc(1440 * 1024));
  await run('mformat', ['-i', on, '-f', '1440', '-v', 'WBFLOPPY', '-N', '19920310', '::']);

  /* In this order, which a drive that lists as stored lists them in:
   * `ZEBRA.TXT` before `APPLE.TXT`, the deleted entry between. */
  const files = await hostFiles(scratch, [
    ['README.TXT', textOf('README.TXT', 3)],
    ['ZEBRA.TXT', textOf('ZEBRA.TXT', 2)],
    ['DELETED.TXT', textOf('DELETED.TXT', 1)],
    ['APPLE.TXT', textOf('APPLE.TXT', 1)],
    ['Long File Name.txt', textOf('Long File Name.txt', 2)],
    ['DATA.BIN', Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7) & 0xff))],
  ]);

  for (const [path, host] of files) {
    await run('mcopy', ['-i', on, host, `::${path}`]);
  }

  await run('mmd', ['-i', on, '::SUBDIR']);
  await run('mmd', ['-i', on, '::SUBDIR/NESTED']);

  for (const [path, host] of await hostFiles(scratch, [
    ['SUBDIR/INNER.TXT', textOf('SUBDIR\\INNER.TXT', 4)],
    ['SUBDIR/NESTED/DEEP.TXT', textOf('SUBDIR\\NESTED\\DEEP.TXT', 1)],
    ['HIDDEN.SYS', textOf('HIDDEN.SYS', 1)],
  ])) {
    await run('mcopy', ['-i', on, host, `::${path}`]);
  }

  await run('mattrib', ['-i', on, '+h', '+s', '+r', '::HIDDEN.SYS']);
  await run('mdel', ['-i', on, '::DELETED.TXT']);

  const bytes = await readFile(image);

  setFatStamps(bytes, 0);

  return bytes;
}

/** `imgwrite`'s floppy, made as `imgflop`'s is; every stamp `OTHER`'s. */
async function makeWriteFloppy(scratch) {
  const image = join(scratch, 'imgwrite.img');

  await writeFile(image, Buffer.alloc(1440 * 1024));
  await run('mformat', ['-i', image, '-f', '1440', '-v', 'WBWRITE', '-N', '19940404', '::']);

  for (const [path, host] of await hostFiles(scratch, [
    ['ONE.TXT', textOf('ONE.TXT', 2)],
    ['TWO.TXT', textOf('TWO.TXT', 1)],
    ['GONE.TXT', textOf('GONE.TXT', 1)],
    ['THREE.TXT', textOf('THREE.TXT', 3)],
    ['NOEXT', textOf('NOEXT', 1)],
    ['BIG.TXT', Buffer.from(Array.from({ length: 1000 }, (_, i) => 0x41 + (i % 26)))],
  ])) {
    await run('mcopy', ['-i', image, host, `::${path}`]);
  }

  await run('mmd', ['-i', image, '::SUBDIR']);
  await run('mmd', ['-i', image, '::HIDDIR']);

  for (const [path, host] of await hostFiles(scratch, [
    ['HIDDIR/INSIDE.TXT', textOf('HIDDIR\\INSIDE.TXT', 1)],
  ])) {
    await run('mcopy', ['-i', image, host, `::${path}`]);
  }

  await run('mattrib', ['-i', image, '+h', '::HIDDIR']);
  await run('mdel', ['-i', image, '::GONE.TXT']);

  const bytes = await readFile(image);

  setFatStamps(bytes, 0);

  return bytes;
}

/* ---------------------------------------------------------- hard disk */

const CYLINDERS = 6;
const HEADS = 16;
const SECTORS = 63;

/** A CHS address as a partition entry holds it: head, sector and cylinder. */
function chs(lba) {
  const cylinder = Math.floor(lba / (HEADS * SECTORS));
  const head = Math.floor(lba / SECTORS) % HEADS;
  const sector = (lba % SECTORS) + 1;

  return [head, sector | ((cylinder >> 2) & 0xc0), cylinder & 0xff];
}

async function makeHardDisk(scratch) {
  const total = CYLINDERS * HEADS * SECTORS;
  const start = SECTORS;
  const image = join(scratch, 'imghdd.img');
  const disk = Buffer.alloc(total * 512);

  /* The master boot record: no code, one partition, FAT16 of fewer than
   * 32 MB (type 04h), from the first track's end. */
  const entry = 446;

  disk[entry] = 0x80;
  disk.set(chs(start), entry + 1);
  disk[entry + 4] = 0x04;
  disk.set(chs(total - 1), entry + 5);
  disk.writeUInt32LE(start, entry + 8);
  disk.writeUInt32LE(total - start, entry + 12);
  disk[510] = 0x55;
  disk[511] = 0xaa;
  await writeFile(image, disk);

  const on = `${image}@@${start * 512}`;

  await run('mformat', [
    '-i',
    on,
    '-T',
    String(total - start),
    '-h',
    String(HEADS),
    '-s',
    String(SECTORS),
    '-H',
    String(start),
    '-c',
    '1',
    '-v',
    'WBHARD',
    '-N',
    '19930303',
    '::',
  ]);

  for (const [path, host] of await hostFiles(scratch, [
    ['FIRST.TXT', textOf('FIRST.TXT', 2)],
    ['SECOND.TXT', textOf('SECOND.TXT', 3)],
  ])) {
    await run('mcopy', ['-i', on, host, `::${path}`]);
  }

  await run('mmd', ['-i', on, '::HARDSUB']);

  for (const [path, host] of await hostFiles(scratch, [
    ['HARDSUB/HARDIN.TXT', textOf('HARDSUB\\HARDIN.TXT', 2)],
  ])) {
    await run('mcopy', ['-i', on, host, `::${path}`]);
  }

  const bytes = await readFile(image);

  setFatStamps(bytes, start * 512);

  return bytes;
}

/* ---------------------------------------------------------------- ISO */

/** Seconds since 1970, UTC. */
const utc = (year, month, day, hour = 0, minute = 0, second = 0) =>
  Date.UTC(year, month - 1, day, hour, minute, second) / 1000;

/** The disc's files, by their path on it, each with when it was written. */
const DISC = [
  ['README.TXT', utc(1994, 2, 3, 4, 5, 6), textOf('README.TXT', 2)],
  ['A_Very_Long_File_Name.Text', utc(1995, 3, 4, 5, 6, 7), textOf('A_Very_Long_File_Name.Text', 1)],
  ['NOEXT', utc(1995, 4, 5, 6, 7, 8), textOf('NOEXT', 1)],
  ['HIDDEN.TXT', utc(1996, 5, 6, 7, 8, 9), textOf('HIDDEN.TXT', 1)],
  ['ZONE.TXT', utc(1997, 6, 7, 8, 9, 10), textOf('ZONE.TXT', 1)],
  ['MixedCase.Txt', utc(1998, 7, 8, 9, 10, 11), textOf('MixedCase.Txt', 1)],
  ['LONGNAMEDFOLDER/INNER.TXT', utc(1999, 8, 9, 10, 11, 12), textOf('INNER.TXT', 3)],
  ['SUBDIR/INNER.TXT', utc(1992, 1, 2, 3, 4, 6), textOf('SUBDIR/INNER.TXT', 2)],
  ['SUBDIR/Long_Inner_Name.Txt', utc(1992, 2, 3, 4, 5, 6), textOf('Long_Inner_Name.Txt', 1)],
  ['SUBDIR/DEEPER/DEEP.TXT', utc(1993, 9, 10, 11, 12, 13), textOf('DEEP.TXT', 1)],
];

/** Folders' stamps. */
const DISC_FOLDERS = [
  ['SUBDIR/DEEPER', utc(1993, 10, 11, 12, 13, 14)],
  ['SUBDIR', utc(1993, 3, 4, 5, 6, 8)],
  ['LONGNAMEDFOLDER', utc(1993, 11, 12, 13, 14, 15)],
  ['', utc(1993, 12, 13, 14, 15, 16)],
];

/** The volume's name: twelve characters, which DOSBox makes 8.3. */
const DISC_LABEL = 'WINBOXCD2026';

/** Every directory record's offset, below the root's. */
function isoRecords(image) {
  const offsets = [];
  const pvd = 16 * 2048;
  const walk = (extent, length) => {
    for (let at = extent * 2048; at < extent * 2048 + length;) {
      const size = image[at];

      if (size === 0) {
        at = (Math.floor(at / 2048) + 1) * 2048;
        continue;
      }

      const nameLength = image[at + 32];
      const first = image[at + 33];

      if (!(nameLength === 1 && first <= 1)) {
        offsets.push(at);

        if (image[at + 25] & 0x02) {
          walk(image.readUInt32LE(at + 2), image.readUInt32LE(at + 10));
        }
      }

      at += size;
    }
  };

  walk(image.readUInt32LE(pvd + 156 + 2), image.readUInt32LE(pvd + 156 + 10));

  return offsets;
}

/**
 * An ISO 9660 disc of files and folders, each written when it says, its
 * primary volume descriptor alone (`xorriso`), named `label`; written to
 * `name` in `scratch`, its bytes answered.
 */
async function isoOf(scratch, name, files, folders, label, written) {
  const tree = join(scratch, `${name}-tree`);

  for (const [path, seconds, bytes] of files) {
    const host = join(tree, ...path.split('/'));

    await mkdir(dirname(host), { recursive: true });
    await writeFile(host, bytes);
    await utimes(host, seconds, seconds);
  }

  for (const [path, seconds] of folders) {
    await utimes(join(tree, ...path.split('/').filter(Boolean)), seconds, seconds);
  }

  const image = join(scratch, name);
  const at = new Date(written * 1000);
  const digits = (n, width = 2) => String(n).padStart(width, '0');

  await run(
    'xorriso',
    [
      '-as',
      'mkisofs',
      '-quiet',
      '-l',
      '-allow-lowercase',
      '-V',
      label,
      '-sysid',
      'WINBOX',
      '-publisher',
      '',
      '-p',
      '',
      '-A',
      '',
      `--modification-date=${digits(at.getUTCFullYear(), 4)}${digits(at.getUTCMonth() + 1)}` +
        `${digits(at.getUTCDate())}${digits(at.getUTCHours())}${digits(at.getUTCMinutes())}` +
        `${digits(at.getUTCSeconds())}00`,
      '-o',
      image,
      tree,
    ],
    { SOURCE_DATE_EPOCH: String(written) }
  );

  return readFile(image);
}

async function makeDisc(scratch) {
  const bytes = await isoOf(
    scratch,
    'imgcd.iso',
    DISC,
    DISC_FOLDERS,
    DISC_LABEL,
    utc(1993, 12, 13, 14, 15, 16)
  );

  for (const at of isoRecords(bytes)) {
    const name = bytes.toString('latin1', at + 33, at + 33 + bytes[at + 32]);

    /* Hidden: the existence bit of the record's flags. */
    if (name.startsWith('HIDDEN.TXT')) {
      bytes[at + 25] |= 0x01;
    }

    /* Written at 08:09:10 in a zone two hours east of GMT: eight
     * quarter-hours. */
    if (name.startsWith('ZONE.TXT')) {
      bytes[at + 24] = 8;
    }
  }

  return bytes;
}

/**
 * A file of whole sectors, each 2,048 bytes of one 16-byte line naming the
 * disc and the sector, so that a read shows which disc and sector it came
 * from: `disc1 sector 0\r\n`.
 */
function sectorsOf(disc, count) {
  return Buffer.from(
    Array.from({ length: count }, (_, sector) =>
      `disc${disc} sector ${sector}\r\n`.repeat(2048 / 16)
    ).join(''),
    'latin1'
  );
}

/**
 * The two discs `imgswap` swaps between (`imgswap.mounts`): each a
 * `BIG.DAT` of four sectors naming its disc, at the same place on both; a
 * file of its own; a `SHARED` folder on both, and a `SUB1` folder on the
 * first alone, made current before the swap.
 */
function swapDisc(disc) {
  const files = [
    ['BIG.DAT', utc(1994, 1, disc, 1, 2, 4), sectorsOf(disc, 4)],
    [`ONLY${disc}.TXT`, utc(1994, 2, disc, 2, 3, 4), textOf(`ONLY${disc}.TXT`, 2)],
    ['SHARED/S.TXT', utc(1994, 3, disc, 3, 4, 6), textOf(`disc${disc} SHARED/S.TXT`, 1)],
    ...(disc === 1 ? [['SUB1/IN1.TXT', utc(1994, 4, 1, 4, 5, 6), textOf('SUB1/IN1.TXT', 1)]] : []),
  ];
  const folders = [
    ['SHARED', utc(1994, 5, disc, 5, 6, 8)],
    ...(disc === 1 ? [['SUB1', utc(1994, 6, 1, 6, 7, 8)]] : []),
    ['', utc(1994, 7, disc, 7, 8, 10)],
  ];

  return (scratch) =>
    isoOf(scratch, `imgsw${disc}.iso`, files, folders, `SWAPDISC${disc}`, utc(1994, 7, disc));
}

/**
 * The disc `cdread` reads (`cdread.mounts`): one file, `READ.DAT`, of 128
 * sectors, each its number in hexadecimal as a line of eight characters
 * repeated, so a read's bytes say where they came from.
 */
function readDisc(scratch) {
  const data = Buffer.from(
    Array.from({ length: 128 }, (_, sector) =>
      `R${sector.toString(16).padStart(5, '0')}\r\n`.repeat(2048 / 8)
    ).join(''),
    'latin1'
  );

  return isoOf(
    scratch,
    'imgread.iso',
    [['READ.DAT', utc(1994, 8, 9, 10, 11, 12), data]],
    [['', utc(1994, 8, 9, 10, 11, 14)]],
    'WINBOXREAD',
    utc(1994, 8, 9)
  );
}

/* ------------------------------------------------------------ CUE/BIN */

/** A number as two binary-coded decimal digits. */
const bcd = (n) => ((Math.floor(n / 10) << 4) | (n % 10)) & 0xff;

/** The CD-ROM EDC's table: CRC-32 of polynomial 8001801Bh, bits reversed (D8018001h). */
const EDC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let edc = i;

  for (let bit = 0; bit < 8; bit++) {
    edc = (edc >>> 1) ^ (edc & 1 ? 0xd8018001 : 0);
  }

  return edc >>> 0;
});

function edc(bytes) {
  let value = 0;

  for (const byte of bytes) {
    value = (EDC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)) >>> 0;
  }

  return value;
}

/**
 * A 2,048-byte image's sectors as raw 2,352-byte ones: sync, a header of
 * the sector's place (150 frames on) and its mode, then for mode 1 the data
 * and its EDC; for mode 2 form 1 a subheader twice, the data and the EDC
 * over both. ECC left nought.
 */
function rawSectors(cooked, mode) {
  const count = cooked.length / 2048;
  const raw = Buffer.alloc(count * 2352);

  for (let sector = 0; sector < count; sector++) {
    const out = raw.subarray(sector * 2352, (sector + 1) * 2352);
    const frames = sector + 150;
    const data = cooked.subarray(sector * 2048, (sector + 1) * 2048);

    out.fill(0xff, 1, 11);
    out[12] = bcd(Math.floor(frames / 4500));
    out[13] = bcd(Math.floor(frames / 75) % 60);
    out[14] = bcd(frames % 75);
    out[15] = mode;

    if (mode === 1) {
      data.copy(out, 16);
      out.writeUInt32LE(edc(out.subarray(0, 2064)), 2064);
    } else {
      out.set([0, 0, 0x08, 0, 0, 0, 0x08, 0], 16);
      data.copy(out, 24);
      out.writeUInt32LE(edc(out.subarray(16, 2072)), 2072);
    }
  }

  return raw;
}

const discBytes = () => readFile(join(OUT, 'imgcd.iso'));

/** A cue sheet's text, its lines ended CR LF as a DOS program writes one. */
const cueText = (lines) => Buffer.from(lines.map((line) => `${line}\r\n`).join(''), 'latin1');

/** A WAVE file of silence: 44.1 kHz, 16-bit stereo, a number of CD frames long. */
function silence(frames) {
  const data = frames * 2352;
  const wave = Buffer.alloc(44 + data);

  wave.write('RIFF', 0, 'latin1');
  wave.writeUInt32LE(36 + data, 4);
  wave.write('WAVEfmt ', 8, 'latin1');
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(2, 22);
  wave.writeUInt32LE(44100, 24);
  wave.writeUInt32LE(44100 * 4, 28);
  wave.writeUInt16LE(4, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36, 'latin1');
  wave.writeUInt32LE(data, 40);
  return wave;
}

async function main() {
  const scratch = await mkdtemp(join(tmpdir(), 'winbox-images-'));
  const only = process.argv.slice(2);

  try {
    await mkdir(OUT, { recursive: true });

    for (const [name, make] of [
      ['imgflop.img', makeFloppy],
      ['imghdd.img', makeHardDisk],
      ['imgcd.iso', makeDisc],
      ['imgwrite.img', makeWriteFloppy],
      ['imgsw1.iso', swapDisc(1)],
      ['imgsw2.iso', swapDisc(2)],
      ['imgread.iso', readDisc],
      ['imgcd.bin', async () => rawSectors(await discBytes(), 1)],
      [
        'imgcd.cue',
        async () =>
          cueText(['FILE "imgcd.bin" BINARY', '  TRACK 01 MODE1/2352', '    INDEX 01 00:00:00']),
      ],
      ['imgcd2.bin', async () => rawSectors(await discBytes(), 2)],
      [
        'imgcd2.cue',
        async () =>
          cueText(['FILE imgcd2.bin BINARY', '  TRACK 01 MODE2/2352', '    INDEX 01 00:00:00']),
      ],
      ['imgtrk audio.wav', async () => silence(30)],
      [
        'imgtrk.cue',
        async () =>
          cueText([
            'REM a data track and an audio track, each its own file',
            'CATALOG 0000000000000',
            'TITLE "WinBox CD"',
            'FILE "imgcd.bin" BINARY',
            '  TRACK 01 MODE1/2352',
            '    INDEX 01 00:00:00',
            'FILE "imgtrk audio.wav" WAVE',
            '  TRACK 02 AUDIO',
            '    PREGAP 00:02:00',
            '    INDEX 01 00:00:00',
          ]),
      ],
    ].filter(([name]) => !only.length || only.includes(name))) {
      const bytes = await make(scratch);

      await writeFile(join(OUT, name), bytes);
      console.log(`${name}: ${bytes.length} bytes`);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`make-images: ${error.message}`);
  process.exitCode = 1;
});
