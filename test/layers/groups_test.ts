'use strict';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyIniWrites,
  commandOf,
  deleteGroupWrite,
  GroupFile,
  groupKeys,
  groupsIniWrites,
  groupsOf,
  readGroup,
  storeCommand,
  writeGroup,
  type Group,
  type IniWrite,
} from '../../src/layers/groups.js';
import { type Flat } from '../../src/layers/layer.js';

/**
 * Program Manager's groups (`src/layers/groups.ts`), held to `groups.json`,
 * which the Rust engine's `crates/winbox-win16/tests/groups.rs` is held to
 * as well: groups made by Program Manager's operations, read into the model
 * and written again byte for byte and laid out afresh; commands stored and
 * read back; `PROGMAN.INI` read as start-up reads it and written as
 * `CreateGroup` writes it; and the groups of a stack. With GROUPS_UPDATE=1
 * this writes the fixture's `expected`.
 */

const FIXTURE = join(__dirname, 'groups.json');
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
const hex = (data: Uint8Array) => Buffer.from(data).toString('hex');
const unhex = (text: string) => new Uint8Array(Buffer.from(text, 'hex'));

/** A group's model as JSON both engines give alike. */
function summary(group: Group) {
  return {
    name: group.name,
    show: group.show,
    rcNormal: group.rcNormal,
    ptMin: group.ptMin,
    cxIcon: group.cxIcon,
    cyIcon: group.cyIcon,
    bitsPixel: group.bitsPixel,
    planes: group.planes,
    reserved: group.reserved,
    slots: group.slots,
    items: group.items.map((item) => ({
      slot: item.slot,
      name: item.name,
      command: item.command,
      directory: item.directory,
      stored: item.stored,
      programDirectory: item.programDirectory,
      iconPath: item.iconPath,
      iconIndex: item.iconIndex,
      x: item.x,
      y: item.y,
      hotKey: item.hotKey,
      minimized: item.minimized,
      icon: item.icon && {
        hotX: item.icon.hotX,
        hotY: item.icon.hotY,
        cx: item.icon.cx,
        cy: item.icon.cy,
        widthBytes: item.icon.widthBytes,
        planes: item.icon.planes,
        bitsPixel: item.icon.bitsPixel,
        and: hex(item.icon.and),
        xor: hex(item.icon.xor),
        header: item.icon.header ? hex(item.icon.header) : null,
      },
    })),
    layout:
      group.layout &&
      group.layout.map((block) =>
        block.part === 'name'
          ? 'name'
          : block.part === 'gap'
            ? `gap ${hex(block.bytes)}`
            : `${block.part} ${block.slot}`
      ),
    tags:
      group.tags &&
      group.tags.map((tag) => ({
        id: tag.id,
        item: tag.item,
        data: tag.data ? hex(tag.data) : null,
      })),
  };
}

/** A script's group made, and each step's answer. */
function run(script: any) {
  let file: GroupFile | null = null;
  const results: unknown[] = [];
  const icon = (name: string) => fixture.icons[name];
  const add = (item: any, name = item.name) => {
    const { stored, programDirectory } = storeCommand(item.command, item.directory);

    return file!.addItem({
      name,
      stored,
      iconPath: item.iconPath,
      iconIndex: item.iconIndex,
      header: unhex(icon(item.icon).header),
      and: unhex(icon(item.icon).and),
      xor: unhex(icon(item.icon).xor),
      x: item.x,
      y: item.y,
      hotKey: item.hotKey,
      minimized: item.minimized,
      programDirectory,
    });
  };

  for (const step of script.steps) {
    switch (step[0]) {
      case 'create':
        file = GroupFile.create(step[1], step[2]);
        results.push(null);
        break;
      case 'add':
        results.push(add(step[1]));
        break;
      case 'fill':
        for (let count = 0; count < step[1]; count++) {
          add(step[2], `${step[2].name} ${count}`);
        }

        results.push(null);
        break;
      case 'delete':
        file!.deleteItem(step[1]);
        results.push(null);
        break;
      case 'rename':
        file!.rename(step[1]);
        results.push(null);
        break;
      case 'save':
        results.push(file!.save(step[1], step[2]));
        break;
      case 'refresh': {
        const icons = [...step[2]];

        file!.refreshIcons(step[1], () => {
          const next = icons.shift();

          return (
            next && {
              iconIndex: next.iconIndex,
              header: unhex(icon(next.icon).header),
              and: unhex(icon(next.icon).and),
              xor: unhex(icon(next.icon).xor),
            }
          );
        });
        results.push(null);
        break;
      }
    }
  }

  return { data: file!.bytes(), results };
}

function scriptBytes(name: string) {
  return run(fixture.scripts.find((script: any) => script.name === name)).data;
}

/** The fixture's stack, flattened. */
function stack(): Flat {
  const files = Object.entries(fixture.stack.files).map(([path, content]: [string, any]) => {
    let data = typeof content === 'string' ? bytes(content) : scriptBytes(content.script);

    if (typeof content !== 'string' && content.damage !== undefined) {
      data = data.slice();
      data[content.damage] ^= 0xff;
    }

    return { path, sha256: '', size: data.length, modified: 0, data };
  });

  files.sort((one, other) => (one.path < other.path ? -1 : 1));

  return { folders: [], files };
}

function writesJson(writes: IniWrite[]) {
  return writes.map((write) => [write.section, write.entry, write.value]);
}

function computed() {
  return {
    scripts: fixture.scripts.map((script: any) => {
      const { data, results } = run(script);
      const group = readGroup(data);

      return {
        name: script.name,
        results,
        bytes: hex(data),
        model: summary(group),
        again: hex(writeGroup(group)),
        fresh: hex(writeGroup({ ...group, layout: null, tags: null })),
      };
    }),
    commands: fixture.commands.map(([command, directory]: [string, string | null]) => {
      const stored = storeCommand(command, directory);

      return { ...stored, ...commandOf(stored.stored, stored.programDirectory) };
    }),
    inis: fixture.inis.map((ini: string) => groupKeys(ini)),
    writes: fixture.writes.map((write: any) => {
      const writes = [
        ...groupsIniWrites(write.groups),
        ...write.deleted.map((n: number) => deleteGroupWrite(n)),
      ];

      return { writes: writesJson(writes), ini: applyIniWrites(write.ini, writes) };
    }),
    stack: groupsOf(stack()).groups.map((group) => ({
      key: group.key,
      n: group.n,
      path: group.path,
      file: group.file,
      refusal: group.refusal,
      name: group.group?.name ?? null,
      items: group.group?.items.map((item) => item.name) ?? null,
    })),
  };
}

describe('groups.json', () => {
  const now = computed();

  if (process.env.GROUPS_UPDATE) {
    fixture.expected = now;
    writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  }

  it("makes the scripts' groups as the fixture has them", () => {
    expect(now.scripts.map((script: any) => [script.name, script.results, script.bytes])).toEqual(
      fixture.expected.scripts.map((script: any) => [script.name, script.results, script.bytes])
    );
  });

  it('reads them into the model and writes them again byte for byte', () => {
    for (const script of now.scripts) {
      expect(script.again).toBe(script.bytes);
    }

    expect(now.scripts.map((script: any) => script.model)).toEqual(
      fixture.expected.scripts.map((script: any) => script.model)
    );
  });

  it('lays a model out afresh as a group filled in slot order', () => {
    expect(now.scripts.map((script: any) => script.fresh)).toEqual(
      fixture.expected.scripts.map((script: any) => script.fresh)
    );

    /* A group only ever added to is already laid out so. */
    const made = now.scripts.find((script: any) => script.name === 'made');

    expect(made.fresh).toBe(made.bytes);
  });

  it('stores commands and reads them back', () => {
    expect(now.commands).toEqual(fixture.expected.commands);
  });

  it("reads PROGMAN.INI's groups as start-up does", () => {
    expect(now.inis).toEqual(fixture.expected.inis);
  });

  it('writes them as CreateGroup and DeleteGroup do', () => {
    expect(now.writes).toEqual(fixture.expected.writes);
  });

  it("gives a stack's groups", () => {
    expect(now.stack).toEqual(fixture.expected.stack);
  });
});
