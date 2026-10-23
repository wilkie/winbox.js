#!/usr/bin/env node
/**
 * Makes the small disk and disc images the image probes mount
 * (`oracle/probes/<probe>.mounts`): a floppy, a CD-ROM and a hard disk,
 * each the same bytes every time it is made.
 *
 *   node scripts/oracle/make-images.mjs
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
 * * `imgcd.iso`: an ISO 9660 disc (`xorriso`), its primary volume
 *   descriptor alone -- no Joliet, no Rock Ridge -- names past 8.3 (`-l`),
 *   in mixed case (`-allow-lowercase`), with their `;1` versions, a file
 *   without an extension, one marked hidden (the existence bit of its
 *   record, set here), one whose record's offset from GMT is not nought,
 *   a folder whose name is past 8.3, and an 8.3 one with folders two deep.
 * * `imghdd.img`: a hard disk of 6 cylinders, 16 heads and 63 sectors
 *   (DOSBox's `imgmount -t hdd` takes a size only of whole such cylinders,
 *   `dos_programs.cpp` 1213-1236), with a master boot record of one
 *   partition from sector 63, FAT16 of 512-byte clusters on it.
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

async function makeDisc(scratch) {
  const tree = join(scratch, 'disc');

  for (const [path, seconds, bytes] of DISC) {
    const host = join(tree, ...path.split('/'));

    await mkdir(dirname(host), { recursive: true });
    await writeFile(host, bytes);
    await utimes(host, seconds, seconds);
  }

  for (const [path, seconds] of DISC_FOLDERS) {
    await utimes(join(tree, ...path.split('/').filter(Boolean)), seconds, seconds);
  }

  const image = join(scratch, 'imgcd.iso');

  await run(
    'xorriso',
    [
      '-as',
      'mkisofs',
      '-quiet',
      '-l',
      '-allow-lowercase',
      '-V',
      DISC_LABEL,
      '-sysid',
      'WINBOX',
      '-publisher',
      '',
      '-p',
      '',
      '-A',
      '',
      '--modification-date=1993121314151600',
      '-o',
      image,
      tree,
    ],
    { SOURCE_DATE_EPOCH: String(utc(1993, 12, 13, 14, 15, 16)) }
  );

  const bytes = await readFile(image);

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

async function main() {
  const scratch = await mkdtemp(join(tmpdir(), 'winbox-images-'));

  try {
    await mkdir(OUT, { recursive: true });

    for (const [name, make] of [
      ['imgflop.img', makeFloppy],
      ['imghdd.img', makeHardDisk],
      ['imgcd.iso', makeDisc],
    ]) {
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
