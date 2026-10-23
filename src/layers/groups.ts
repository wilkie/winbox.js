/**
 * Program Manager's groups (`kb/formats/grp.md`): its `.GRP` files and
 * `PROGMAN.INI`'s `[Groups]` and `Order=`, read and written as
 * `PROGMAN.EXE` reads and writes them, as pure code -- no task, no disk.
 *
 * Three parts:
 *
 * - `readGroup` / `writeGroup`: a group file as a model (`Group`, `Item`)
 *   and back, byte for byte, the checksum included. The model keeps where
 *   each block lay (`layout`) and the order of the tags (`tags`), so a file
 *   Program Manager wrote comes back as it was; a model made fresh is laid
 *   out as Program Manager lays out a group made and filled in slot order.
 * - `GroupFile`: the group's block as Program Manager keeps it in memory,
 *   and its own operations on it (seg4 `0741` new slot, `0899` add data,
 *   `081e` delete data, `0ae6` add tag, `1061` an item made, `15a8` deleted,
 *   `248f` renamed, `2518` saved, `17ae` icons refreshed, `04a5` written):
 *   what a stand-in changes a group with, so its files are Program Manager's.
 * - `groupKeys` / `groupsIniWrites`: `PROGMAN.INI` read as start-up reads it
 *   (seg3 `06c1`-`08a3`) and written as `CreateGroup` and saving write it
 *   (seg4 `2662`-`2826`); `groupsOf` the groups on a flattened stack.
 *
 * Strings are bytes, one character to a byte (Latin-1), as `Profile` has
 * them. The Rust engine's twin is `crates/winbox-win16/src/groups.rs`; the
 * two are held to `test/layers/groups.json`.
 */

import { Profile } from '../win16/profile.js';
import { type Flat } from './layer.js';

/** `PMCC`, the first four bytes of a group file and of its tag section. */
const MAGIC = [0x50, 0x4d, 0x43, 0x43];

/** The header's size before `rgiItems`. */
const HEADER = 0x22;

/** An item's `ITEMDEF`. */
const ITEMDEF = 0x18;

/** The first tag, `PMCC` after it (seg4 `00fd`-`0120`). */
export const TAG_START = 0x8000;
/** The program's directory, a string. */
export const TAG_DIRECTORY = 0x8101;
/** The hot key, a word. */
export const TAG_HOTKEY = 0x8102;
/** Run minimized, no data. */
export const TAG_MINIMIZED = 0x8103;
/** The end of the tags. */
export const TAG_END = 0xffff;

/** Slots a group may hold: slot 32h is refused with message 73h (seg4 `1263`). */
export const MAX_SLOTS = 0x32;

/** Message 4Ah, out of memory: a group past 64K (seg4 `0793`, `08da`). */
export const ERROR_MEMORY = 0x4a;
/** Message 73h, "already contains the maximum number of items" (seg4 `1268`). */
export const ERROR_FULL = 0x73;

/** The screen's icon: `SM_CXICON`, `SM_CYICON`, `BITSPIXEL`, `PLANES`. */
export interface IconMetrics {
  cx: number;
  cy: number;
  bitsPixel: number;
  planes: number;
}

/**
 * An item's icon as `DumpIcon` gave it (`CURSORICONINFO`, then the AND
 * plane, then the XOR plane). `header` is kept only where the header is
 * not the 12 bytes these fields are.
 */
export interface Icon {
  hotX: number;
  hotY: number;
  cx: number;
  cy: number;
  widthBytes: number;
  planes: number;
  bitsPixel: number;
  and: Uint8Array;
  xor: Uint8Array;
  header?: Uint8Array;
}

/** An item of a group. */
export interface Item {
  /** Its slot in `rgiItems`. */
  slot: number;
  name: string;
  /** The command as Program Manager runs it: the program's directory, its file name and arguments (seg4 `2967`). */
  command: string;
  /** The working directory, as read back (seg4 `2a52`-`2a70`). */
  directory: string;
  /** `pCommand` as stored: the working directory, the file name and arguments (seg4 `1071`-`116b`). */
  stored: string;
  /** Tag `8101h`: the program's directory, its trailing `\` kept; null without the tag. */
  programDirectory: string | null;
  iconPath: string;
  iconIndex: number;
  /** The icon's top left in the group's window, as last written. */
  x: number;
  y: number;
  /** Tag `8102h`, 0 without it. */
  hotKey: number;
  /** Tag `8103h`. */
  minimized: boolean;
  /** Null where the item has no icon blocks (pointers and sizes nought). */
  icon: Icon | null;
}

/** A block of a group's data, in the order the file has them. */
export type Block =
  | { part: 'name' }
  | { part: 'item' | 'itemName' | 'command' | 'iconPath' | 'header' | 'and' | 'xor'; slot: number }
  | { part: 'gap'; bytes: Uint8Array };

/**
 * A tag record in the file's order. `data` is kept where it is not what
 * the item's field would make (a second record of the same tag, an id
 * Program Manager does not write, a size it does not use); otherwise the
 * record is made from the item.
 */
export interface Tag {
  id: number;
  item: number;
  data?: Uint8Array;
}

/** A group file's contents. */
export interface Group {
  name: string;
  /** `nCmdShow`: nought until settings are saved. */
  show: number;
  rcNormal: [number, number, number, number];
  ptMin: [number, number];
  cxIcon: number;
  cyIcon: number;
  bitsPixel: number;
  planes: number;
  /** The word at `1Eh`. */
  reserved: number;
  /** `cItems`: slots, not items. */
  slots: number;
  /** In slot order. */
  items: Item[];
  /** Where the blocks lie; null to lay them out as a group filled in slot order does. */
  layout: Block[] | null;
  /** The tags between the first and the end; null where the file has no tag section. */
  tags: Tag[] | null;
}

/** A string's bytes and its nought. */
function sz(text: string) {
  const bytes = new Uint8Array(text.length + 1);

  for (let at = 0; at < text.length; at++) {
    bytes[at] = text.charCodeAt(at) & 0xff;
  }

  return bytes;
}

function word(data: Uint8Array, at: number) {
  return (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
}

function setWord(data: Uint8Array, at: number, value: number) {
  data[at] = value & 0xff;
  data[at + 1] = (value >> 8) & 0xff;
}

function signed(value: number) {
  return (value << 16) >> 16;
}

/** Bytes as a string, one character to a byte. */
function text(bytes: Uint8Array) {
  let result = '';

  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }

  return result;
}

/** The string at an offset, to its nought or the end of the data. */
function cString(data: Uint8Array, at: number) {
  let end = at;

  while (end < data.length && data[end] !== 0) {
    end++;
  }

  return text(data.subarray(at, end));
}

/** Whether the tag section begins as Program Manager's must (seg4 `00e6`-`0120`). */
function tagsBegin(data: Uint8Array) {
  const at = word(data, 6);

  return (
    at + 10 <= data.length &&
    word(data, at) === TAG_START &&
    word(data, at + 2) === 0xffff &&
    word(data, at + 4) === 10 &&
    MAGIC.every((byte, index) => data[at + 6 + index] === byte)
  );
}

/**
 * How much of the block is the file (seg4 `00d5`): through the end tag
 * where the tag section is valid, else `cbGroup`. Program Manager walks to
 * its block's `GlobalSize`; here the block is as long as its bytes. A tag
 * of size nought, which Program Manager would walk forever, ends the walk.
 */
export function groupLength(data: Uint8Array) {
  const cbGroup = word(data, 6);

  if (!tagsBegin(data)) {
    return cbGroup;
  }

  let at = cbGroup;

  while (at + 6 <= data.length) {
    if (word(data, at) === TAG_END) {
      return at + 6;
    }

    const size = word(data, at + 4);

    if (size === 0) {
      break;
    }

    at += size;
  }

  return cbGroup;
}

/** The 16-bit sum of the file's words (seg4 `014c`); an odd last byte is left out. */
export function groupSum(data: Uint8Array) {
  const words = groupLength(data) >> 1;
  let sum = 0;

  for (let at = 0; at < words; at++) {
    sum = (sum + word(data, at * 2)) & 0xffff;
  }

  return sum;
}

/**
 * Why Program Manager would not load a file, or null: message 4Bh, "invalid
 * or damaged", for a file shorter than `24h`, `cbGroup` past its end, a sum
 * not nought, no `PMCC` (seg4 `0389`-`03b3`), no slots or an item's offset
 * past `cbGroup` (`1c95`-`1d1e`). An item whose `ITEMDEF` runs past the
 * file, which Program Manager would read beyond its block, is refused too.
 */
export function groupRefusal(data: Uint8Array): string | null {
  if (data.length < 0x24) {
    return 'shorter than its header';
  }

  const cbGroup = word(data, 6);

  if (cbGroup > data.length) {
    return 'cbGroup past the end';
  }

  if (groupSum(data) !== 0) {
    return 'checksum';
  }

  if (!MAGIC.every((byte, index) => data[index] === byte)) {
    return 'not PMCC';
  }

  const slots = word(data, 0x20);

  if (slots === 0) {
    return 'no slots';
  }

  for (let slot = 0; slot < slots; slot++) {
    const def = word(data, HEADER + slot * 2);

    if (def === 0) {
      continue;
    }

    if (def + ITEMDEF > data.length) {
      return `item ${slot} past the end`;
    }

    for (const field of [0x12, 0x14, 0x16, 0x0c, 0x0e, 0x10]) {
      if (word(data, def + field) > cbGroup) {
        return `item ${slot} past cbGroup`;
      }
    }
  }

  return null;
}

/** A tag's value as `GetTagValue` reads one (seg4 `0c5a`): size 6 is 1, 7 a byte, 8 a word, else nought. */
function tagValue(data: Uint8Array) {
  switch (data.length) {
    case 0:
      return 1;
    case 1:
      return data[0];
    case 2:
      return word(data, 0);
    default:
      return 0;
  }
}

/**
 * The stored command and the program's directory tag for a command and a
 * working directory, as `CreateNewItem` makes them (seg4 `1071`-`116b`):
 * with a directory (its leading spaces dropped and cut at a space, seg6
 * `0000`; a `\` added where the directory as given does not end in one),
 * the directory, the program's file name and its arguments; without, the
 * command as given. The tag is the command's path up to its last `:` or
 * `\`, empty where there is none.
 */
export function storeCommand(command: string, directory: string | null) {
  let end = 0;
  let file = 0;

  while (end < command.length && command[end] !== ' ' && command[end] !== '\0') {
    end++;

    if (command[end - 1] === ':' || command[end - 1] === '\\') {
      file = end;
    }
  }

  const programDirectory = command.slice(0, file);
  let stored = command;

  if (directory !== null) {
    stored = directory.replace(/^ +/, '').split(' ')[0];

    if (directory.length && directory[directory.length - 1] !== '\\') {
      stored += '\\';
    }

    stored += command.slice(file, end) + command.slice(end);
  }

  return { stored, programDirectory };
}

/**
 * The command and working directory an item runs with, from its stored
 * command and directory tag (seg4 `2967`-`2a85`): the tag, then the stored
 * command's file name and arguments; the stored command's path, its last
 * `\` dropped unless it follows a `:`.
 */
export function commandOf(stored: string, programDirectory: string | null) {
  let end = 0;
  let file = 0;

  while (end < stored.length && stored[end] !== ' ') {
    end++;

    if (stored[end - 1] === ':' || stored[end - 1] === '\\') {
      file = end;
    }
  }

  const command = (programDirectory ?? '') + stored.slice(file, end) + stored.slice(end);
  let directory = stored.slice(0, file);

  if (file > 0 && directory[file - 1] === '\\' && directory[file - 2] !== ':') {
    directory = directory.slice(0, file - 1);
  }

  return { command, directory };
}

/** An icon's header, the 12 bytes of `CURSORICONINFO`. */
function iconHeader(icon: Icon) {
  if (icon.header) {
    return icon.header;
  }

  const header = new Uint8Array(12);

  setWord(header, 0, icon.hotX);
  setWord(header, 2, icon.hotY);
  setWord(header, 4, icon.cx);
  setWord(header, 6, icon.cy);
  setWord(header, 8, icon.widthBytes);
  header[10] = icon.planes;
  header[11] = icon.bitsPixel;

  return header;
}

function iconOf(header: Uint8Array, and: Uint8Array, xor: Uint8Array): Icon {
  const icon: Icon = {
    hotX: word(header, 0),
    hotY: word(header, 2),
    cx: word(header, 4),
    cy: word(header, 6),
    widthBytes: word(header, 8),
    planes: header[10] ?? 0,
    bitsPixel: header[11] ?? 0,
    and,
    xor,
  };

  if (header.length !== 12) {
    icon.header = header;
  }

  return icon;
}

type ItemPart = Exclude<Block['part'], 'name' | 'gap'>;

/** The parts of an item in the order `CreateNewItem` adds them (seg4 `127f`-`1387`). */
const ITEM_PARTS: ItemPart[] = ['item', 'itemName', 'command', 'iconPath', 'header', 'and', 'xor'];

/** A block's bytes, made from the model. */
function blockBytes(group: Group, block: Block, items: Map<number, Item>) {
  if (block.part === 'gap') {
    return block.bytes;
  }

  if (block.part === 'name') {
    return sz(group.name);
  }

  const item = items.get(block.slot);

  if (!item) {
    throw new Error(`a block of slot ${block.slot}, which has no item`);
  }

  switch (block.part) {
    case 'item':
      return new Uint8Array(ITEMDEF);
    case 'itemName':
      return sz(item.name);
    case 'command':
      return sz(item.stored);
    case 'iconPath':
      return sz(item.iconPath);
    case 'header':
      return iconHeader(item.icon!);
    case 'and':
      return item.icon!.and;
    case 'xor':
      return item.icon!.xor;
  }
}

/**
 * A group file read into the model. Throws where Program Manager would not
 * load it (`groupRefusal`).
 */
export function readGroup(data: Uint8Array): Group {
  const refusal = groupRefusal(data);

  if (refusal) {
    throw new Error(`not a group file Program Manager loads: ${refusal}`);
  }

  const cbGroup = word(data, 6);
  const slots = word(data, 0x20);
  const pName = word(data, 0x16);
  const items: Item[] = [];
  const spans: { at: number; size: number; block: Block }[] = [];
  let laidOut = true;

  spans.push({ at: pName, size: cString(data, pName).length + 1, block: { part: 'name' } });

  for (let slot = 0; slot < slots; slot++) {
    const def = word(data, HEADER + slot * 2);

    if (def === 0) {
      continue;
    }

    const at = (field: number) => word(data, def + field);
    const name = cString(data, at(0x12));
    const stored = cString(data, at(0x14));
    const iconPath = cString(data, at(0x16));
    const sizes = [at(0x06), at(0x08), at(0x0a)];
    const places = [at(0x0c), at(0x0e), at(0x10)];
    const hasIcon = places.every((place) => place !== 0);

    if (!hasIcon && (places.some((place) => place !== 0) || sizes.some((size) => size !== 0))) {
      laidOut = false;
    }

    const icon = hasIcon
      ? iconOf(
          data.slice(places[0], places[0] + sizes[0]),
          data.slice(places[1], places[1] + sizes[1]),
          data.slice(places[2], places[2] + sizes[2])
        )
      : null;

    items.push({
      slot,
      name,
      command: '',
      directory: '',
      stored,
      programDirectory: null,
      iconPath,
      iconIndex: at(0x04),
      x: signed(at(0x00)),
      y: signed(at(0x02)),
      hotKey: 0,
      minimized: false,
      icon,
    });

    spans.push({ at: def, size: ITEMDEF, block: { part: 'item', slot } });
    spans.push({ at: at(0x12), size: name.length + 1, block: { part: 'itemName', slot } });
    spans.push({ at: at(0x14), size: stored.length + 1, block: { part: 'command', slot } });
    spans.push({ at: at(0x16), size: iconPath.length + 1, block: { part: 'iconPath', slot } });

    if (hasIcon) {
      spans.push({ at: places[0], size: sizes[0], block: { part: 'header', slot } });
      spans.push({ at: places[1], size: sizes[1], block: { part: 'and', slot } });
      spans.push({ at: places[2], size: sizes[2], block: { part: 'xor', slot } });
    }
  }

  /* Program Manager's blocks lie end to end after the table: each added at
   * cbGroup, each deleted closed up (seg4 `0899`, `081e`). Bytes between
   * them, which it never leaves, are kept as they are; blocks that overlap
   * cannot be laid out again, and the model is laid out afresh. */
  spans.sort((one, other) => one.at - other.at);

  const layout: Block[] = [];
  let next = HEADER + slots * 2;

  for (const span of spans) {
    if (span.at < next || span.size === 0) {
      laidOut = false;
      break;
    }

    if (span.at > next) {
      layout.push({ part: 'gap', bytes: data.slice(next, span.at) });
    }

    layout.push(span.block);
    next = span.at + span.size;
  }

  if (next > cbGroup) {
    laidOut = false;
  } else if (next < cbGroup) {
    layout.push({ part: 'gap', bytes: data.slice(next, cbGroup) });
  }

  const tags = readTags(data, items);

  for (const item of items) {
    Object.assign(item, commandOf(item.stored, item.programDirectory));
  }

  return {
    name: cString(data, pName),
    show: word(data, 0x08),
    rcNormal: [
      signed(word(data, 0x0a)),
      signed(word(data, 0x0c)),
      signed(word(data, 0x0e)),
      signed(word(data, 0x10)),
    ],
    ptMin: [signed(word(data, 0x12)), signed(word(data, 0x14))],
    cxIcon: word(data, 0x18),
    cyIcon: word(data, 0x1a),
    bitsPixel: data[0x1c],
    planes: data[0x1d],
    reserved: word(data, 0x1e),
    slots,
    items,
    layout: laidOut ? layout : null,
    tags,
  };
}

/**
 * The tag records between the first and the end, the items' tag fields set
 * from the first record of each (`FindTag` seg4 `096d` takes the first).
 * Null without a valid section that reaches its end tag (seg4 `00d5`).
 */
function readTags(data: Uint8Array, items: Item[]): Tag[] | null {
  if (!tagsBegin(data) || groupLength(data) === word(data, 6)) {
    return null;
  }

  const bySlot = new Map(items.map((item) => [item.slot, item]));
  const seen = new Set<string>();
  const tags: Tag[] = [];
  let at = word(data, 6) + 10;

  while (word(data, at) !== TAG_END) {
    const size = word(data, at + 4);
    const tag: Tag = { id: word(data, at), item: word(data, at + 2) };
    const bytes = data.slice(at + 6, at + Math.max(size, 6));
    const item = bySlot.get(tag.item);
    const key = `${tag.id}:${tag.item}`;
    let made = false;

    if (item && !seen.has(key)) {
      seen.add(key);

      switch (tag.id) {
        case TAG_DIRECTORY: {
          const text = cString(bytes, 0);

          item.programDirectory = text;
          made = bytes.length === text.length + 1;
          break;
        }
        case TAG_HOTKEY:
          item.hotKey = tagValue(bytes);
          made = bytes.length === 2;
          break;
        case TAG_MINIMIZED:
          item.minimized = tagValue(bytes) !== 0;
          made = bytes.length === 0;
          break;
      }
    }

    if (!made) {
      tag.data = bytes;
    }

    tags.push(tag);
    at += size;
  }

  return tags;
}

/** A tag record's data made from its item. */
function tagData(id: number, item: Item) {
  switch (id) {
    case TAG_DIRECTORY:
      return sz(item.programDirectory ?? '');
    case TAG_HOTKEY: {
      const data = new Uint8Array(2);

      setWord(data, 0, item.hotKey);
      return data;
    }
    default:
      return new Uint8Array(0);
  }
}

/** Whether an item has a value for a tag, as `CreateNewItem` adds them (seg4 `13f5`-`1450`). */
function hasTag(id: number, item: Item) {
  switch (id) {
    case TAG_HOTKEY:
      return item.hotKey !== 0;
    case TAG_MINIMIZED:
      return item.minimized;
    default:
      return !!item.programDirectory;
  }
}

/**
 * A group file from the model, as Program Manager writes it (seg4 `04a5`):
 * the header, the table, the blocks in `layout`'s order (a group filled in
 * slot order's where it is null: its name, then each item's `ITEMDEF`,
 * name, command, icon path, icon header, AND and XOR planes), the tags in
 * `tags`' order and then any an item has that are not listed (in slot
 * order, `8102h`, `8103h`, `8101h`, as `CreateNewItem` adds them), and the
 * checksum.
 */
export function writeGroup(group: Group): Uint8Array {
  const items = new Map<number, Item>();
  let slots = Math.max(group.slots, 1);

  for (const item of group.items) {
    items.set(item.slot, item);
    slots = Math.max(slots, item.slot + 1);
  }

  const ordered = [...items.values()].sort((one, other) => one.slot - other.slot);
  const layout =
    group.layout ??
    ([{ part: 'name' }] as Block[]).concat(
      ordered.flatMap((item) =>
        ITEM_PARTS.filter((part) => item.icon || !['header', 'and', 'xor'].includes(part)).map(
          (part) => ({ part, slot: item.slot }) as Block
        )
      )
    );

  const blocks = layout.map((block) => blockBytes(group, block, items));
  const cbGroup = blocks.reduce((sum, bytes) => sum + bytes.length, HEADER + slots * 2);
  const records: Uint8Array[] = [];

  if (
    group.tags ||
    ordered.some((item) =>
      [TAG_HOTKEY, TAG_MINIMIZED, TAG_DIRECTORY].some((id) => hasTag(id, item))
    )
  ) {
    const listed = new Set<string>();

    for (const tag of group.tags ?? []) {
      const item = items.get(tag.item);

      if (item) {
        listed.add(`${tag.id}:${tag.item}`);
      }

      if (tag.data) {
        records.push(tagRecord(tag.id, tag.item, tag.data));
      } else if (item) {
        records.push(tagRecord(tag.id, tag.item, tagData(tag.id, item)));
      }
    }

    for (const item of ordered) {
      for (const id of [TAG_HOTKEY, TAG_MINIMIZED, TAG_DIRECTORY]) {
        if (hasTag(id, item) && !listed.has(`${id}:${item.slot}`)) {
          records.push(tagRecord(id, item.slot, tagData(id, item)));
        }
      }
    }

    records.unshift(tagRecord(TAG_START, 0xffff, new Uint8Array(MAGIC)));
    records.push(tagRecord(TAG_END, 0xffff, new Uint8Array(0), 0));
  }

  const length = records.reduce((sum, bytes) => sum + bytes.length, cbGroup);

  if (length > 0x10000) {
    throw new Error('a group past 64K');
  }

  const data = new Uint8Array(length);

  data.set(MAGIC, 0);
  setWord(data, 0x06, cbGroup);
  setWord(data, 0x08, group.show);
  group.rcNormal.forEach((value, index) => setWord(data, 0x0a + index * 2, value));
  group.ptMin.forEach((value, index) => setWord(data, 0x12 + index * 2, value));
  setWord(data, 0x18, group.cxIcon);
  setWord(data, 0x1a, group.cyIcon);
  data[0x1c] = group.bitsPixel;
  data[0x1d] = group.planes;
  setWord(data, 0x1e, group.reserved);
  setWord(data, 0x20, slots);

  /* An ITEMDEF may lie after its own blocks, so its pointers are set once
   * every block has its place. */
  const places: { slot: number; field: number; at: number }[] = [];
  let at = HEADER + slots * 2;

  layout.forEach((block, index) => {
    data.set(blocks[index], at);

    if (block.part === 'name') {
      setWord(data, 0x16, at);
    } else if (block.part === 'item') {
      const item = items.get(block.slot)!;

      setWord(data, HEADER + block.slot * 2, at);
      setWord(data, at + 0x00, item.x);
      setWord(data, at + 0x02, item.y);
      setWord(data, at + 0x04, item.iconIndex);
      setWord(data, at + 0x06, item.icon ? iconHeader(item.icon).length : 0);
      setWord(data, at + 0x08, item.icon ? item.icon.and.length : 0);
      setWord(data, at + 0x0a, item.icon ? item.icon.xor.length : 0);
    } else if (block.part !== 'gap') {
      places.push({ slot: block.slot, field: FIELDS[block.part], at });
    }

    at += blocks[index].length;
  });

  for (const place of places) {
    setWord(data, word(data, HEADER + place.slot * 2) + place.field, place.at);
  }

  for (const record of records) {
    data.set(record, at);
    at += record.length;
  }

  setWord(data, 4, -groupSum(data) & 0xffff);

  return data;
}

/** Each block's pointer within the ITEMDEF. */
const FIELDS: Record<Exclude<ItemPart, 'item'>, number> = {
  itemName: 0x12,
  command: 0x14,
  iconPath: 0x16,
  header: 0x0c,
  and: 0x0e,
  xor: 0x10,
};

/** A tag record: id, item, size counting its own six bytes (nought for the end), data. */
function tagRecord(id: number, item: number, data: Uint8Array, size = data.length + 6) {
  const record = new Uint8Array(6 + data.length);

  setWord(record, 0, id);
  setWord(record, 2, item);
  setWord(record, 4, size);
  record.set(data, 6);

  return record;
}

/** What `CreateNewItem` puts in a group for an item (seg4 `1254`-`1450`). */
export interface NewItem {
  name: string;
  /** As stored (`storeCommand`). */
  stored: string;
  iconPath: string;
  /** As `ExtractAssociatedIcon` wrote it back. */
  iconIndex: number;
  /** `DumpIcon`'s three blocks. */
  header: Uint8Array;
  and: Uint8Array;
  xor: Uint8Array;
  /** Where the item was placed: its icon's top left. */
  x: number;
  y: number;
  hotKey: number;
  minimized: boolean;
  /** Tag `8101h`'s string; none where empty. */
  programDirectory: string;
}

/**
 * A group's block as Program Manager keeps it in memory, and its operations
 * on it, each as read out of seg4. Program Manager writes the block after
 * each change (`bytes()` is what it writes); where a change fails it lets
 * the block go and reads the file again (seg4 `157c`-`1589`), which here
 * is the block as it was before.
 */
export class GroupFile {
  data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = Uint8Array.from(data);
  }

  /** A new group (seg4 `2178`-`229e`): the header, one empty slot, the name. */
  static create(name: string, metrics: IconMetrics) {
    const data = new Uint8Array(name.length + 0x25);

    data.set(MAGIC, 0);
    setWord(data, 0x06, data.length);
    setWord(data, 0x16, 0x24);
    setWord(data, 0x18, metrics.cx);
    setWord(data, 0x1a, metrics.cy);
    data[0x1c] = metrics.bitsPixel;
    data[0x1d] = metrics.planes;
    setWord(data, 0x20, 1);
    data.set(sz(name), 0x24);

    const group = new GroupFile(data);

    setWord(group.data, 4, -groupSum(group.data) & 0xffff);

    return group;
  }

  word(at: number) {
    return word(this.data, at);
  }

  setWord(at: number, value: number) {
    setWord(this.data, at, value);
  }

  get cbGroup() {
    return this.word(6);
  }

  get slots() {
    return this.word(0x20);
  }

  /** The offset of a slot's ITEMDEF, nought for an empty slot. */
  def(slot: number) {
    return this.word(HEADER + slot * 2);
  }

  length() {
    return groupLength(this.data);
  }

  /** What `WriteGroup` writes (seg4 `04ed`-`05e4`): the checksum set, the file's length of the block. */
  bytes() {
    this.setWord(4, 0);
    this.setWord(4, -groupSum(this.data) & 0xffff);

    return this.data.slice(0, this.length());
  }

  private resize(size: number) {
    const data = new Uint8Array(size);

    data.set(this.data.subarray(0, Math.min(size, this.data.length)));
    this.data = data;
  }

  /** Every offset at or past `threshold` moved by `delta` (seg4 `066d`): `pName`, the table, each item's six pointers. */
  fixup(threshold: number, delta: number) {
    if (this.word(0x16) >= threshold) {
      this.setWord(0x16, this.word(0x16) + delta);
    }

    for (let slot = 0; slot < this.slots; slot++) {
      if (this.def(slot) === 0) {
        continue;
      }

      if (this.def(slot) >= threshold) {
        this.setWord(HEADER + slot * 2, this.def(slot) + delta);
      }

      const def = this.def(slot);

      for (const field of [0x0c, 0x0e, 0x10, 0x12, 0x14, 0x16]) {
        if (this.word(def + field) >= threshold) {
          this.setWord(def + field, this.word(def + field) + delta);
        }
      }
    }
  }

  /**
   * A slot for an item (seg4 `0741`): the first empty one; else the table
   * grows by a word, everything after it moved up two and every offset
   * mended. -1 past 64K.
   */
  newSlot() {
    for (let slot = 0; slot < this.slots; slot++) {
      if (this.def(slot) === 0) {
        return slot;
      }
    }

    const length = this.length();

    if (length + 2 > 0x10000) {
      return -1;
    }

    const slot = this.slots;
    const end = HEADER + slot * 2;

    this.resize(length + 2);
    this.setWord(6, this.cbGroup + 2);
    this.data.copyWithin(end + 2, end, length);
    this.setWord(end, 0);
    this.setWord(0x20, slot + 1);
    this.fixup(1, 2);

    return slot;
  }

  /**
   * Bytes added at `cbGroup` (seg4 `0899`), the tags moved up after them:
   * `size` bytes of `source`, or `source`'s string and nought where `size`
   * is nought, or noughts without a source. Its offset; nought past 64K.
   */
  addData(source: Uint8Array | null, size: number) {
    if (size === 0 && source) {
      size = source.indexOf(0) + 1 || source.length + 1;
    }

    const length = this.length();

    if (length + size > 0x10000) {
      return 0;
    }

    const at = this.cbGroup;

    this.resize(length + size);
    this.data.copyWithin(at + size, at, length);
    this.setWord(6, at + size);

    this.data.fill(0, at, at + size);

    if (source) {
      this.data.set(source.subarray(0, size), at);
    }

    return at;
  }

  /**
   * The block a pointer at `field` names taken out (seg4 `081e`): the
   * pointer set nought, everything after the block moved down, `cbGroup`
   * less, every offset past it mended. `size` nought is the string's.
   */
  deleteData(field: number, size: number) {
    const at = this.word(field);

    if (at === 0) {
      return;
    }

    this.setWord(field, 0);

    if (size === 0) {
      size = cString(this.data, at).length + 1;
    }

    const length = this.length();

    this.data.copyWithin(at, at + size, length);
    this.setWord(6, this.cbGroup - size);
    this.fixup(at, -size);
  }

  /** The first tag of `item` (and of `id`, unless nought) from the section's start (seg4 `096d`); -1 for none. */
  findTag(id: number, item: number) {
    if (!tagsBegin(this.data)) {
      return -1;
    }

    let at = this.cbGroup;

    while (at + 6 <= this.data.length) {
      if (this.word(at + 2) === item && (id === 0 || this.word(at) === id)) {
        return at;
      }

      if (this.word(at) === TAG_END || this.word(at + 4) === 0) {
        return -1;
      }

      at += this.word(at + 4);
    }

    return -1;
  }

  /** The first tag of `id` and `item` taken out, the rest moved down (seg4 `0a69`). */
  deleteTag(id: number, item: number) {
    const at = this.findTag(id, item);

    if (at < 0) {
      return;
    }

    const length = this.length();
    const size = this.word(at + 4);

    this.data.copyWithin(at, at + size, length);
    this.resize(length - size);
  }

  /**
   * A tag added (seg4 `0ae6`): any of the same id and item taken out, the
   * record put where the end tag was and the end after it; the first and
   * the end written at `cbGroup` where there is no end tag. False past 64K.
   */
  addTag(id: number, item: number, data: Uint8Array | null) {
    this.deleteTag(id, item);

    const end = this.findTag(TAG_END, 0xffff);
    const first = end < 0;
    let at = first ? this.cbGroup : end;
    const need = (data?.length ?? 0) + (first ? 0x16 : 0x0c);

    if (at + need > 0xffff) {
      return false;
    }

    this.resize(at + need);

    if (first) {
      this.data.set(tagRecord(TAG_START, 0xffff, new Uint8Array(MAGIC)), at);
      at += 10;
    }

    this.data.set(tagRecord(id, item, data ?? new Uint8Array(0)), at);
    at += (data?.length ?? 0) + 6;
    this.data.set(tagRecord(TAG_END, 0xffff, new Uint8Array(0), 0), at);

    return true;
  }

  /** Every tag of item `from` made item `to` (seg4 `0d62`). */
  retag(from: number, to: number) {
    for (let at = this.findTag(0, from); at >= 0; at = this.findTag(0, from)) {
      this.setWord(at + 2, to);
    }
  }

  /**
   * An item put in the group as `CreateNewItem` puts it (seg4 `1254`-`1450`):
   * a slot, its ITEMDEF, name, command, icon path, icon header, AND and XOR
   * planes, then its tags `8102h`, `8103h`, `8101h`. The slot, or the
   * message Program Manager gives (`ERROR_MEMORY`, `ERROR_FULL`), the
   * block then as it was.
   */
  addItem(item: NewItem): { slot: number } | { error: number } {
    const before = this.data.slice();
    const failed = (error: number) => {
      this.data = before;
      return { error };
    };
    const slot = this.newSlot();

    if (slot < 0) {
      return failed(ERROR_MEMORY);
    }

    if (slot >= MAX_SLOTS) {
      return failed(ERROR_FULL);
    }

    const def = this.addData(null, ITEMDEF);

    if (!def) {
      return failed(ERROR_MEMORY);
    }

    this.setWord(HEADER + slot * 2, def);

    for (const [field, source, size] of [
      [0x12, sz(item.name), 0],
      [0x14, sz(item.stored), 0],
      [0x16, sz(item.iconPath), 0],
      [0x0c, item.header, item.header.length],
      [0x0e, item.and, item.and.length],
      [0x10, item.xor, item.xor.length],
    ] as [number, Uint8Array, number][]) {
      const at = this.addData(source, size);

      if (!at) {
        return failed(ERROR_MEMORY);
      }

      this.setWord(def + field, at);
    }

    this.setWord(def + 0x00, item.x);
    this.setWord(def + 0x02, item.y);
    this.setWord(def + 0x04, item.iconIndex);
    this.setWord(def + 0x06, item.header.length);
    this.setWord(def + 0x08, item.and.length);
    this.setWord(def + 0x0a, item.xor.length);

    if (item.hotKey) {
      const data = new Uint8Array(2);

      setWord(data, 0, item.hotKey);
      this.addTag(TAG_HOTKEY, slot, data);
    }

    if (item.minimized) {
      this.addTag(TAG_MINIMIZED, slot, null);
    }

    if (item.programDirectory) {
      this.addTag(TAG_DIRECTORY, slot, sz(item.programDirectory));
    }

    return { slot };
  }

  /**
   * An item taken out (seg4 `15e6`-`16d0`): its name, command, icon path,
   * AND, XOR and header, then its ITEMDEF, the slot left nought; then every
   * tag of its slot.
   */
  deleteItem(slot: number) {
    const def = this.def(slot);

    this.deleteData(def + 0x12, 0);
    this.deleteData(def + 0x14, 0);
    this.deleteData(def + 0x16, 0);
    this.deleteData(def + 0x0e, this.word(def + 0x08));
    this.deleteData(def + 0x10, this.word(def + 0x0a));
    this.deleteData(def + 0x0c, this.word(def + 0x06));
    this.deleteData(HEADER + slot * 2, ITEMDEF);

    for (let at = this.findTag(0, slot); at >= 0; at = this.findTag(0, slot)) {
      this.deleteTag(this.word(at), this.word(at + 2));
    }
  }

  /** The group's name taken out and added again, at the end of its data (seg4 `24cc`-`24fa`). */
  rename(name: string) {
    this.deleteData(0x16, 0);
    this.setWord(0x16, this.addData(sz(name), 0));
  }

  /**
   * Settings saved into the group (seg4 `2518`-`2651`): its window's
   * placement into the header; each item's place, from the window's items
   * in their order; the slots made that order, the tags renumbered through
   * the ITEMDEFs' offsets as keys, the slots after them nought. The new
   * slot of each item given, in that order.
   */
  save(
    placement: {
      show: number;
      rcNormal: [number, number, number, number];
      ptMin: [number, number];
    },
    items: { slot: number; x: number; y: number }[]
  ) {
    this.setWord(0x08, placement.show);
    placement.rcNormal.forEach((value, index) => this.setWord(0x0a + index * 2, value));
    placement.ptMin.forEach((value, index) => this.setWord(0x12 + index * 2, value));

    const keys = items.map((item) => {
      const def = this.def(item.slot);

      this.setWord(def, item.x);
      this.setWord(def + 2, item.y);
      this.retag(item.slot, def);

      return def;
    });

    keys.forEach((def, slot) => {
      this.retag(def, slot);
      this.setWord(HEADER + slot * 2, def);
    });

    for (let slot = keys.length; slot < this.slots; slot++) {
      this.setWord(HEADER + slot * 2, 0);
    }

    return keys.map((_, slot) => slot);
  }

  /**
   * The icons made again for another display (seg4 `18b6`-`1aef`): the
   * header's icon format and size; each item's header, AND and XOR taken
   * out and its icon extracted again (`extract` gives the index written
   * back and the three blocks, or null where there are none) and added at
   * the end, in slot order. An item left without all three has none, its
   * sizes nought.
   */
  refreshIcons(
    metrics: IconMetrics,
    extract: (
      iconPath: string,
      iconIndex: number
    ) => { iconIndex: number; header: Uint8Array; and: Uint8Array; xor: Uint8Array } | null
  ) {
    this.data[0x1c] = metrics.bitsPixel;
    this.data[0x1d] = metrics.planes;
    this.setWord(0x18, metrics.cx);
    this.setWord(0x1a, metrics.cy);

    for (let slot = 0; slot < this.slots; slot++) {
      const def = this.def(slot);

      if (def === 0) {
        continue;
      }

      this.deleteData(def + 0x0c, this.word(def + 0x06));
      this.deleteData(def + 0x0e, this.word(def + 0x08));
      this.deleteData(def + 0x10, this.word(def + 0x0a));

      const icon = extract(cString(this.data, this.word(def + 0x16)), this.word(def + 0x04));
      let places = [0, 0, 0];

      if (icon) {
        this.setWord(def + 0x04, icon.iconIndex);
        places = [icon.header, icon.and, icon.xor].map((block) =>
          block.length ? this.addData(block, block.length) : 0
        );
        this.setWord(def + 0x0c, places[0]);
        this.setWord(def + 0x0e, places[1]);
        this.setWord(def + 0x10, places[2]);
        this.setWord(def + 0x06, icon.header.length);
        this.setWord(def + 0x08, icon.and.length);
        this.setWord(def + 0x0a, icon.xor.length);
      }

      if (places.some((place) => place === 0)) {
        this.deleteData(def + 0x0c, this.word(def + 0x06));
        this.deleteData(def + 0x0e, this.word(def + 0x08));
        this.deleteData(def + 0x10, this.word(def + 0x0a));
        this.setWord(def + 0x06, 0);
        this.setWord(def + 0x08, 0);
        this.setWord(def + 0x0a, 0);
      }
    }
  }
}

/** A `[Groups]` key as start-up loads it. */
export interface GroupKey {
  /** The key, upper case as start-up makes it (`AnsiUpper`, seg3 `0715`). */
  key: string;
  /** Its number: the digits after `GROUP`; nought for none, which `LoadGroup` replaces. */
  n: number;
  /** The value: the group file's path. */
  path: string;
}

/**
 * A list of names as `GetPrivateProfileString` with no entry gives them
 * into a buffer of `size` bytes (`copyOutList`): two bytes held back, the
 * last name cut and ended.
 */
function keyList(names: string[], size: number) {
  const text = names.map((name) => `${name}\0`).join('');
  const count = Math.min(text.length, size - 2);
  const list: string[] = [];

  /* The buffer holds the text to `count`, its last byte made nought, and a
   * nought after: read as start-up reads it, to the first empty name. */
  for (const name of text.slice(0, Math.max(count - 1, 0)).split('\0')) {
    if (!name) {
      break;
    }

    list.push(name);
  }

  return list;
}

/** Whether a key is `GROUP`, then no nought, then only digits (seg3 `05e2`). */
function groupKey(key: string) {
  return key.startsWith('GROUP') && key[5] !== '0' && /^[0-9]*$/.test(key.slice(5));
}

/**
 * `PROGMAN.INI`'s groups in the order start-up loads them (seg3 `06c1`-
 * `08a3`): `[Groups]`' keys (a buffer of 140h), upper case, those of
 * `GROUP` and digits not beginning with nought; those `Order=` (a buffer of
 * 7Fh) names, in its order -- each moved to the end as it is found, the
 * rest then moved after them one by one in the file's order; each with a
 * value (a buffer of 78h) loaded, its number the digits'.
 */
export function groupKeys(ini: string) {
  const profile = new Profile(ini);
  const keys = keyList(profile.entries('Groups'), 0x140)
    .map((key) => key.replace(/[a-z]/g, (letter) => letter.toUpperCase()))
    .filter(groupKey);
  const order = (profile.get('Settings', 'Order') ?? '').slice(0, 0x7e);
  let unmatched = keys.length;
  let at = 0;

  const rotate = (index: number) => {
    keys.push(...keys.splice(index, 1));
  };

  for (;;) {
    while (order[at] === ' ') {
      at++;
    }

    if (!(order[at] >= '0' && order[at] <= '9')) {
      break;
    }

    let digits = '';

    while (order[at] >= '0' && order[at] <= '9') {
      digits += order[at++];
    }

    const index = keys.findIndex((key) => key === `GROUP${digits}`);

    if (index >= 0) {
      rotate(index);
      unmatched = (unmatched - 1) & 0xffff;
    }
  }

  for (let turn = 0; turn < unmatched && keys.length; turn++) {
    rotate(0);
  }

  const loaded: GroupKey[] = [];

  for (const key of keys) {
    const path = (profile.get('Groups', key) ?? '').slice(0, 0x77);

    if (!path) {
      continue;
    }

    let n = 0;

    for (const digit of key.slice(5)) {
      n = (n * 10 + digit.charCodeAt(0) - 0x30) & 0xffff;
    }

    loaded.push({ key, n, path });
  }

  return { order, keys: loaded };
}

/** A profile write: `[section]` `entry=value`, a null value taking the entry out. */
export interface IniWrite {
  section: string;
  entry: string;
  value: string | null;
}

/**
 * What `CreateGroup` and saving write of the groups (seg4 `2662`-`2826`):
 * for each group window from the bottom of the MDI client's children up
 * (icon titles left out, and those whose path `OpenFile`'s `OF_PARSE`
 * refuses), `[Groups]` `GroupN=` its parsed path; then `[Settings]`
 * `Order=` a space and N for each. A 41st stops it.
 */
export function groupsIniWrites(groups: { n: number; path: string }[]): IniWrite[] {
  const writes: IniWrite[] = [];
  let order = '';

  for (const [count, group] of groups.entries()) {
    if (count > 40) {
      break;
    }

    const n = signed(group.n);

    writes.push({ section: 'Groups', entry: `Group${n}`, value: group.path });
    order += ` ${n}`;
  }

  writes.push({ section: 'Settings', entry: 'Order', value: order });

  return writes;
}

/** What `DeleteGroup` writes (seg4 `23af`-`2417`): its key, and not `Order=`. */
export function deleteGroupWrite(n: number): IniWrite {
  return { section: 'Groups', entry: `Group${signed(n)}`, value: null };
}

/**
 * Profile writes applied to a file's text as `WritePrivateProfileString`
 * applies them: a value's trailing spaces and tabs dropped, one the same as
 * the file's left alone.
 */
export function applyIniWrites(ini: string, writes: IniWrite[]) {
  const profile = new Profile(ini);

  for (const write of writes) {
    const value = write.value === null ? null : write.value.replace(/[ \t]+$/, '');

    if (value !== null && profile.get(write.section, write.entry, false) === value) {
      continue;
    }

    profile.set(write.section, write.entry, value);
  }

  return profile.text;
}

/** The Windows directory on a stack, Program Manager's current directory. */
const WINDOWS = 'WINDOWS';

/**
 * A group file's path on the flattened drive, as `_lopen` from the Windows
 * directory finds it: `C:` and absolute, from the root, or from the Windows
 * directory; null for another drive. Letters made upper case as the
 * drive's paths are.
 */
export function groupPath(path: string) {
  let rest = path.replace(/[a-z]/g, (letter) => letter.toUpperCase());

  if (/^[A-Z]:/.test(rest)) {
    if (rest[0] !== 'C') {
      return null;
    }

    rest = rest.slice(2);
  }

  const names = rest.startsWith('\\') ? [] : [WINDOWS];

  for (const name of rest.split('\\')) {
    if (name === '' || name === '.') {
      continue;
    }

    if (name === '..') {
      names.pop();
    } else {
      names.push(name);
    }
  }

  return names.join('\\');
}

/** A group on a stack: its key, number and file, and the group, or why it would not load. */
export interface StackGroup extends GroupKey {
  file: string | null;
  group: Group | null;
  refusal: string | null;
}

/** The groups of a stack: `Order=` as read, and each group in the order start-up loads them. */
export interface Groups {
  order: string;
  groups: StackGroup[];
}

/**
 * The groups on a flattened stack, as Program Manager would load them at
 * start-up: `PROGMAN.INI` in the Windows directory read by `groupKeys`,
 * each file read by `readGroup`. A key with no number takes the lowest
 * not yet taken by a group loaded (seg4 `1d5c`-`1d6d`). A stack without
 * `PROGMAN.INI` has no groups.
 */
export function groupsOf(flat: Flat): Groups {
  const files = new Map(flat.files.map((file) => [file.path, file.data]));
  const ini = files.get(`${WINDOWS}\\PROGMAN.INI`);

  if (!ini) {
    return { order: '', groups: [] };
  }

  const { order, keys } = groupKeys(text(ini));
  const taken = new Set<number>();
  const groups: StackGroup[] = [];

  for (const key of keys) {
    let n = key.n;

    if (n === 0) {
      do {
        n++;
      } while (taken.has(n));
    }

    const file = groupPath(key.path);
    const data = file === null ? undefined : files.get(file);
    const refusal = data ? groupRefusal(data) : 'cannot be opened';
    const group = data && !refusal ? readGroup(data) : null;

    if (group) {
      taken.add(n);
    }

    groups.push({ ...key, n, file, group, refusal });
  }

  return { order, groups };
}
