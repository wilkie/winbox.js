'use strict';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  GroupFile,
  groupKeys,
  readGroup,
  writeGroup,
  type Group,
  type NewItem,
} from '../../src/layers/groups.js';

/**
 * Program Manager's own group files, read and written again byte for byte
 * (`src/layers/groups.ts`, `kb/formats/grp.md`): the installation's on each
 * display's drive of the oracle's (local; skipped where it is not there,
 * and never committed), and the group files the pm probes recorded whole
 * in hexadecimal -- groups Program Manager made for the probes, and the
 * installation's MAIN.GRP as [[probe:pmfiles]] recorded it. The Rust
 * engine's `crates/winbox-win16/tests/groups.rs` holds the same.
 */

const ROOT = join(__dirname, '..', '..');
const BUILD = join(ROOT, 'oracle', 'build');
const FIXTURES = join(ROOT, 'oracle', 'fixtures');

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/** The drives of the oracle's display installations. */
function drives() {
  if (!existsSync(BUILD)) {
    return [];
  }

  return readdirSync(BUILD)
    .filter((name) => name.startsWith('drive-c'))
    .map((name) => join(BUILD, name, 'WINDOWS'))
    .filter((windows) => existsSync(join(windows, 'PROGMAN.INI')));
}

/** A probe's recorded files: `bytes` records `NAME@offset`, put together, by name. */
function recorded(probe: string) {
  const path = join(FIXTURES, `${probe}.json`);
  const files = new Map<string, Uint8Array>();

  if (!existsSync(path)) {
    return files;
  }

  const records = JSON.parse(readFileSync(path, 'utf8')).records;
  const sizes = new Map<string, number>();
  const chunks = new Map<string, [number, string][]>();

  for (const record of records) {
    if (record.function === 'size') {
      sizes.set(record.args, Number(record.result));
    } else if (record.function === 'bytes') {
      const [, name, offset] = /^(.*)@([0-9a-f]+)$/.exec(record.args)!;

      chunks.set(name, [...(chunks.get(name) ?? []), [parseInt(offset, 16), record.result]]);
    }
  }

  for (const [name, parts] of chunks) {
    const data = new Uint8Array(sizes.get(name)!);

    for (const [offset, text] of parts) {
      data.set(Buffer.from(text, 'hex').subarray(0, data.length - offset), offset);
    }

    files.set(name, data);
  }

  return files;
}

/** The items of a group as `CreateNewItem` was given them, in the order their ITEMDEFs lie. */
function added(group: Group, data: Uint8Array): NewItem[] {
  const def = (slot: number) => data[0x22 + slot * 2] | (data[0x23 + slot * 2] << 8);

  return [...group.items]
    .sort((one, other) => def(one.slot) - def(other.slot))
    .map((item) => {
      const header = new Uint8Array(12);
      const view = new DataView(header.buffer);
      const icon = item.icon!;

      view.setUint16(0, icon.hotX, true);
      view.setUint16(2, icon.hotY, true);
      view.setUint16(4, icon.cx, true);
      view.setUint16(6, icon.cy, true);
      view.setUint16(8, icon.widthBytes, true);
      header[10] = icon.planes;
      header[11] = icon.bitsPixel;

      return {
        name: item.name,
        stored: item.stored,
        iconPath: item.iconPath,
        iconIndex: item.iconIndex,
        header,
        and: icon.and,
        xor: icon.xor,
        x: item.x,
        y: item.y,
        hotKey: item.hotKey,
        minimized: item.minimized,
        programDirectory: item.programDirectory ?? '',
      };
    });
}

describe("the installation's groups on each display", () => {
  const windows = drives();

  (windows.length ? it : it.skip)('read and written again byte for byte', () => {
    let checked = 0;

    for (const folder of windows) {
      for (const name of ['MAIN.GRP', 'ACCESSOR.GRP', 'STARTUP.GRP', 'GAMES.GRP']) {
        const path = join(folder, name);

        if (!existsSync(path)) {
          continue;
        }

        const data = new Uint8Array(readFileSync(path));
        const group = readGroup(data);

        expect(group.layout).not.toBeNull();
        expect(hex(writeGroup(group))).toBe(hex(data));
        expect(hex(new GroupFile(data).bytes())).toBe(hex(data));
        checked++;
      }
    }

    expect(checked).toBeGreaterThanOrEqual(windows.length * 3);
  });

  (windows.length ? it : it.skip)("PROGMAN.INI's groups in the order start-up loads them", () => {
    for (const folder of windows) {
      const ini = readFileSync(join(folder, 'PROGMAN.INI'), 'latin1');

      expect(groupKeys(ini).keys.map((key) => key.key)).toEqual(['GROUP2', 'GROUP3', 'GROUP1']);
    }
  });
});

describe('the group files the pm probes recorded', () => {
  for (const probe of ['pmbare-vga', 'pmbare-ega', 'pmfiles', 'pmsyntax']) {
    const files = recorded(probe);

    (files.size ? it : it.skip)(`${probe}: read and written again byte for byte`, () => {
      for (const [, data] of files) {
        const group = readGroup(data);

        expect(group.layout).not.toBeNull();
        expect(hex(writeGroup(group))).toBe(hex(data));
        expect(hex(new GroupFile(data).bytes())).toBe(hex(data));
      }
    });
  }

  for (const probe of ['pmbare-vga', 'pmbare-ega']) {
    const files = recorded(probe);

    (files.size ? it : it.skip)(`${probe}: made again as CreateGroup and AddItem make them`, () => {
      for (const name of ['WINBOXGA.GRP', 'GAMES.GRP', 'ROWS.GRP']) {
        const data = files.get(name)!;
        const group = readGroup(data);
        const made = GroupFile.create(group.name, {
          cx: group.cxIcon,
          cy: group.cyIcon,
          bitsPixel: group.bitsPixel,
          planes: group.planes,
        });

        for (const item of added(group, data)) {
          expect(made.addItem(item)).not.toHaveProperty('error');
        }

        expect(hex(made.bytes())).toBe(hex(data));
      }
    });

    (files.size ? it : it.skip)(
      `${probe}: saved by ExitProgman(1) as Program Manager saves it`,
      () => {
        const before = files.get('WINBOXGA.GRP')!;
        const after = files.get('WINBOXGA.GRP after')!;
        const saved = readGroup(after);
        const old = readGroup(before);
        const file = new GroupFile(before);

        /* The window's items in their order: the slots as saved, each found
         * by its name among the items before. */
        const items = saved.items.map((item) => ({
          slot: old.items.find((one) => one.name === item.name)!.slot,
          x: item.x,
          y: item.y,
        }));

        file.save({ show: saved.show, rcNormal: saved.rcNormal, ptMin: saved.ptMin }, items);
        expect(hex(file.bytes())).toBe(hex(after));
      }
    );
  }

  const pmfiles = recorded('pmfiles');

  (pmfiles.size ? it : it.skip)(
    "pmfiles: MAIN.GRP's icons made again for another display driver",
    () => {
      const before = pmfiles.get('MAIN.GRP before')!;
      const after = pmfiles.get('MAIN.GRP after')!;
      const old = readGroup(before);
      const file = new GroupFile(before);

      /* Each item's icon extracted again is the icon it had. */
      expect(hex(before)).not.toBe(hex(after));
      file.refreshIcons(
        { cx: old.cxIcon, cy: old.cyIcon, bitsPixel: old.bitsPixel, planes: old.planes },
        (iconPath, iconIndex) => {
          const item = old.items.find(
            (one) => one.iconPath === iconPath && one.iconIndex === iconIndex
          )!;
          const made = added({ ...old, items: [item] }, before)[0];

          return { iconIndex, header: made.header, and: made.and, xor: made.xor };
        }
      );

      expect(hex(file.bytes())).toBe(hex(after));
    }
  );
});
