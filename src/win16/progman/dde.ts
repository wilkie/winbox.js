'use strict';

import { B, D, W, buffer, stringOf, text } from '../commdlg/api.js';
import { type Item, TAG_HOTKEY, TAG_MINIMIZED } from '../../layers/groups.js';
import { type Pm, bytesOf } from './main.js';
import { type Loaded, topDown, groups, iconic, titleOf, zoomed } from './loaded.js';
import { Block, parse } from './parse.js';
import { run } from './commands.js';

/**
 * Program Manager's DDE, as `PROGMAN.EXE` seg7 answers it: the frame's
 * messages 3E0h-3E8h (seg2 `228c`-`2296`) go to its dispatcher (`1416`,
 * table `155e`), which keeps no state for a conversation, and the frame
 * answers nought. As `crates/winbox-win16/src/progman/dde.rs`
 * (`kb/topics/program-manager-dde.md`).
 */

const WM_DDE_INITIATE = 0x3e0;
const WM_DDE_TERMINATE = 0x3e1;
const WM_DDE_ADVISE = 0x3e2;
const WM_DDE_UNADVISE = 0x3e3;
const WM_DDE_ACK = 0x3e4;
const WM_DDE_DATA = 0x3e5;
const WM_DDE_REQUEST = 0x3e6;
const WM_DDE_POKE = 0x3e7;
const WM_DDE_EXECUTE = 0x3e8;

const CF_TEXT = 1;

/** Its data's flags: `GMEM_DDESHARE | GMEM_MOVEABLE`, and with `GMEM_ZEROINIT` for an `AppProperties` item's. */
const DDE_MEMORY = 0x2002;

/** While commands are carried out, every box Program Manager would show is not (seg1 `00fa`). */
export const D_QUIET = 0x22;

/** Whether a message is one of the dispatcher's. */
export const isDde = (message: number) => message >= WM_DDE_INITIATE && message <= WM_DDE_EXECUTE;

/** The dispatcher (`1416`-`156f`). */
export async function dde(pm: Pm, hwnd: number, message: number, wParam: number, lParam: number) {
  const low = lParam & 0xffff;
  const high = lParam >>> 16;

  switch (message) {
    case WM_DDE_INITIATE:
      return initiate(pm, hwnd, wParam, low, high);
    case WM_DDE_TERMINATE:
      /* `145b`: a terminate sent back, the same `lParam`, whether or not
       * there was a conversation. */
      await pm.send(wParam, WM_DDE_TERMINATE, hwnd, lParam);
      return;
    case WM_DDE_ADVISE:
    case WM_DDE_UNADVISE:
    case WM_DDE_DATA:
    case WM_DDE_POKE:
      return refuse(pm, hwnd, wParam, high);
    case WM_DDE_REQUEST:
      return request(pm, hwnd, wParam, low, high);
    case WM_DDE_EXECUTE:
      return execute(pm, hwnd, wParam, high);
  }
}

/** `0000`: a negative acknowledgement naming the item, posted; what came with the message is not freed. */
function refuse(pm: Pm, hwnd: number, client: number, item: number) {
  return post(pm, client, WM_DDE_ACK, hwnd, (item << 16) >>> 0);
}

async function post(pm: Pm, to: number, message: number, wParam: number, lParam: number) {
  await pm.user('PostMessage', [W(to), W(message), W(wParam), D(lParam)]);
}

/**
 * `1427`: the registered messages waiting dispatched first (`13e9`), then the
 * two pairs it answers: `Shell` and `AppProperties`, where a missing
 * application matches; and `Progman` and `Progman`.
 */
async function initiate(pm: Pm, hwnd: number, client: number, app: number, topic: number) {
  for (;;) {
    const called = await pm.call('USER', 'PeekMessage', [
      buffer(18),
      W(0),
      W(0xc000),
      W(0xffff),
      W(1),
    ]);

    if ((called.value & 0xffff) === 0) {
      break;
    }

    await pm.user('DispatchMessage', [B(called.buffers[0])]);
  }

  await offer(pm, hwnd, client, app, topic, 'Shell', 'AppProperties', true);
  await offer(pm, hwnd, client, app, topic, 'Progman', 'Progman', false);
}

/**
 * `0b24`: both names added as atoms; the initiator's matched against them --
 * a missing application only where `missing` says, a missing topic always; a
 * match answered with `WM_DDE_ACK` sent, carrying the new atoms, which are the
 * receiver's to delete; otherwise both deleted.
 */
async function offer(
  pm: Pm,
  hwnd: number,
  client: number,
  app: number,
  topic: number,
  appName: string,
  topicName: string,
  missing: boolean
) {
  const oursApp = (await pm.user('GlobalAddAtom', [text(bytesOf(appName))])) & 0xffff;
  const oursTopic = (await pm.user('GlobalAddAtom', [text(bytesOf(topicName))])) & 0xffff;
  const appMatches = app === 0 ? missing : app === oursApp;
  const topicMatches = topic === 0 || topic === oursTopic;

  if (appMatches && topicMatches) {
    await pm.send(client, WM_DDE_ACK, hwnd, ((oursTopic << 16) | oursApp) >>> 0);
  } else {
    await pm.user('GlobalDeleteAtom', [W(oursApp)]);
    await pm.user('GlobalDeleteAtom', [W(oursTopic)]);
  }
}

/**
 * `1472`: the commands carried out (`0313`), and the acknowledgement posted
 * after all of it -- 8000h, or 0 -- carrying the commands' block, which is not
 * freed.
 */
async function execute(pm: Pm, hwnd: number, client: number, commands: number) {
  const status = (await carryOut(pm, commands)) ? 0x8000 : 0;

  await post(pm, client, WM_DDE_ACK, hwnd, ((commands << 16) | status) >>> 0);
}

/**
 * `0313`: the block locked; the string read whole (`01c8`), nothing done
 * where it is refused; each command in turn, the first that fails stopping
 * the rest (`0aee`-`0afa`); the block unlocked. Whether all were done.
 */
async function carryOut(pm: Pm, commands: number): Promise<boolean> {
  const at = (await pm.kernel('GlobalLock', [W(commands)])) >>> 0;

  if (at >>> 16 === 0) {
    return false;
  }

  pm.sd16(D_QUIET, 1);

  const size = (await pm.kernel('GlobalSize', [W(commands)])) >>> 0;
  const room = Math.min(size, 0x10000 - (at & 0xffff));
  const block = new Block(pm.readFar(at, room));
  const parsed = await parse(pm, block);
  let done = false;

  if (parsed) {
    const [list, read] = parsed;

    done = true;

    for (const command of read) {
      const ran = await run(pm, block, command);

      pm.writeFar(at, block.bytes);

      if (!ran) {
        done = false;
        break;
      }
    }

    await pm.kernel('GlobalFree', [W(list)]);
  }

  pm.writeFar(at, block.bytes);
  await pm.kernel('GlobalUnlock', [W(commands)]);
  pm.sd16(D_QUIET, 0);

  return done;
}

/**
 * `14a3`: `Progman` and `Groups` answer the list of groups; `GetIcon`,
 * `GetDescription` and `GetWorkingDir` answer as `AppProperties`; any other
 * item is a group's name. Atoms are found, not added.
 */
async function request(pm: Pm, hwnd: number, client: number, format: number, item: number) {
  const find = async (name: string) =>
    (await pm.user('GlobalFindAtom', [text(bytesOf(name))])) & 0xffff;

  if ((await find('Progman')) === item || (await find('Groups')) === item) {
    return groupList(pm, hwnd, client, item, format);
  }

  for (const [name, which] of [
    ['GetIcon', 'icon'],
    ['GetDescription', 'description'],
    ['GetWorkingDir', 'workingDir'],
  ] as [string, Property][]) {
    if ((await find(name)) === item) {
      return property(pm, hwnd, client, item, format, which);
    }
  }

  return groupText(pm, hwnd, client, item, format);
}

/**
 * `0b90`: the groups' titles in the order loaded, each with a carriage return
 * and line feed, after the header 3000h and `CF_TEXT`; anything but `CF_TEXT`
 * refused. The block is grown for each by `GlobalReAlloc`, and posted with the
 * item's atom as it came.
 */
async function groupList(pm: Pm, hwnd: number, client: number, item: number, format: number) {
  if (format !== CF_TEXT) {
    return refuse(pm, hwnd, client, item);
  }

  const data = await dataBlock(pm);

  if (data === null) {
    return refuse(pm, hwnd, client, item);
  }

  let size = 6;

  for (const group of groups(pm).list) {
    const title = bytesOf(titleOf(group));

    size += title.length + 2;

    if (!((await pm.kernel('GlobalReAlloc', [W(data), D(size), W(2)])) & 0xffff)) {
      await pm.kernel('GlobalFree', [W(data)]);
      return refuse(pm, hwnd, client, item);
    }

    const at = ((await pm.kernel('GlobalLock', [W(data)])) + 4) >>> 0;
    const end = pm.readFar(at, size - 4).indexOf(0);

    pm.writeFar(at + Math.max(end, 0), [...title, 0x0d, 0x0a, 0]);
    await pm.kernel('GlobalUnlock', [W(data)]);
  }

  return post(pm, client, WM_DDE_DATA, hwnd, ((item << 16) | data) >>> 0);
}

/**
 * `GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, 6)` with the header 3000h --
 * `fResponse` and `fRelease` -- `CF_TEXT` and an empty string; null where
 * there is no memory.
 */
async function dataBlock(pm: Pm): Promise<number | null> {
  const data = (await pm.kernel('GlobalAlloc', [W(DDE_MEMORY), D(6)])) & 0xffff;

  if (!data) {
    return null;
  }

  const at = (await pm.kernel('GlobalLock', [W(data)])) >>> 0;

  pm.writeFar(at, [0x00, 0x30, 0x01, 0x00, 0x00, 0x00]);
  await pm.kernel('GlobalUnlock', [W(data)]);

  return data;
}

/** What a field of a group's text is: a string, quoted or not; or a number. */
type Field = { bytes: number[]; quoted: boolean } | { number: number };

/**
 * A field of a group's text (`0f99`): a string, quoted where asked, or a
 * number by `%d`; then a comma, or a carriage return and line feed at the end
 * of a line. The block grown by `GlobalReAlloc` with `GMEM_MOVEABLE |
 * GMEM_ZEROINIT`, the field written over the nought before its last byte;
 * where it cannot grow, it is freed. The size after, or null where it could
 * not grow.
 */
async function field(pm: Pm, data: number, size: number, value: Field, endOfLine: boolean) {
  const [bytes, quoted] =
    'number' in value
      ? [bytesOf(String((value.number << 16) >> 16)), false]
      : [value.bytes, value.quoted];
  const added = bytes.length + (endOfLine ? 2 : 1) + (quoted ? 2 : 0);

  if (!((await pm.kernel('GlobalReAlloc', [W(data), D(size + added), W(0x42)])) & 0xffff)) {
    await pm.kernel('GlobalFree', [W(data)]);
    return null;
  }

  const at = ((await pm.kernel('GlobalLock', [W(data)])) + size - 2) >>> 0;
  const written = [
    ...(quoted ? [0x22] : []),
    ...bytes,
    ...(quoted ? [0x22] : []),
    ...(endOfLine ? [0x0d, 0x0a] : [0x2c]),
    0,
  ];

  pm.writeFar(at, written);
  await pm.kernel('GlobalUnlock', [W(data)]);

  return size + added;
}

/** The value of an item's tag as seg4 `0c5a` reads it: none, 0; a record of six bytes, 1; of seven, its byte; of eight, its word. */
function tagValue(loaded: Loaded, item: Item, id: number): number {
  const tag = loaded.group.tags?.find((each) => each.id === id && each.item === item.slot);

  if (!tag) {
    return 0;
  }

  const data =
    tag.data !== undefined
      ? Array.from(tag.data)
      : id === TAG_HOTKEY
        ? [item.hotKey & 0xff, item.hotKey >> 8]
        : id === TAG_MINIMIZED
          ? []
          : bytesOf(item.programDirectory ?? '');

  switch (data.length) {
    case 0:
      return 1;
    case 1:
      return data[0];
    case 2:
      return data[0] | (data[1] << 8);
  }

  return 0;
}

/**
 * `10ad`: the group whose name is the item's atom (`GlobalFindAtom` of its
 * name), the MDI client's children walked from the top; its text, or a
 * negative acknowledgement where there is none or the format is not
 * `CF_TEXT`. The first line `"name",path,items,show`, show 3 maximized, 2 the
 * current group an icon and 7 another, 1 the current group otherwise and 4
 * another; then for each item in the group's order
 * `"name","command",directory,icon path,x,y,icon index,hot key,minimized`.
 */
async function groupText(pm: Pm, hwnd: number, client: number, item: number, format: number) {
  if (format !== CF_TEXT) {
    return refuse(pm, hwnd, client, item);
  }

  const all = groups(pm);
  let found: [number, Loaded] | null = null;

  for (const [index, group] of topDown(all)) {
    const atom = (await pm.user('GlobalFindAtom', [text(bytesOf(group.group.name))])) & 0xffff;

    if (atom === item) {
      found = [index, group];
      break;
    }
  }

  if (!found) {
    return refuse(pm, hwnd, client, item);
  }

  const data = await dataBlock(pm);

  if (data === null) {
    return refuse(pm, hwnd, client, item);
  }

  const [index, group] = found;
  const current = all.current === index;
  const show = zoomed(group) ? 3 : iconic(group) ? (current ? 2 : 7) : current ? 1 : 4;
  const string = (value: string, quoted: boolean): Field => ({ bytes: bytesOf(value), quoted });
  const fields: [Field, boolean][] = [
    [string(group.group.name, true), false],
    [string(group.path, false), false],
    [{ number: group.group.items.length }, false],
    [{ number: show }, true],
  ];

  for (const each of group.group.items) {
    fields.push(
      [string(each.name, true), false],
      [string(each.command, true), false],
      [string(each.directory, false), false],
      [string(each.iconPath, false), false],
      [{ number: each.x }, false],
      [{ number: each.y }, false],
      [{ number: each.iconIndex }, false],
      [{ number: tagValue(group, each, TAG_HOTKEY) }, false],
      [{ number: tagValue(group, each, TAG_MINIMIZED) }, true]
    );
  }

  let size: number | null = 6;

  for (const [value, end] of fields) {
    size = await field(pm, data, size, value, end);

    if (size === null) {
      return refuse(pm, hwnd, client, item);
    }
  }

  return post(pm, client, WM_DDE_DATA, hwnd, ((item << 16) | data) >>> 0);
}

/** The `AppProperties` items. */
type Property = 'icon' | 'description' | 'workingDir';

/**
 * `0c8b`: the item Program Manager is starting, or the item whose program has
 * the instance in `lParam`'s low word; its icon, its name or its working
 * directory; else a negative acknowledgement. WinBox's starts no item yet, so
 * no item has a program's instance: every item's is nought, and only a request
 * whose low word is nought finds one -- the first item of the top group, as
 * the file's walk would.
 */
async function property(
  pm: Pm,
  hwnd: number,
  client: number,
  item: number,
  instance: number,
  which: Property
) {
  const found =
    instance === 0
      ? topDown(groups(pm))
          .map(([, group]) => group.group.items[0])
          .find((first) => first !== undefined)
      : undefined;

  if (!found) {
    return refuse(pm, hwnd, client, item);
  }

  let value: number[];

  switch (which) {
    case 'icon':
      /* Not yet: the icon's header and planes as `GetInternalIconHeader`
       * gives them (`0d64`, `0e1b`-`0f26`), which wants the item's icon. */
      return refuse(pm, hwnd, client, item);
    case 'description':
      value = bytesOf(found.name);
      break;
    default: {
      /* `0d9d`-`0df4`: the working directory made OEM, its environment
       * variables put in, made ANSI again and upper case. */
      const directory = [...bytesOf(found.directory), ...new Array(0x80).fill(0)].slice(0, 0x80);
      const oem = (await pm.call('KEYBOARD', 'AnsiToOem', [B(directory), buffer(0x80)])).buffers[1];
      const substituted = (await pm.call('SHELL', 'DoEnvironmentSubst', [B(oem), W(0x80)]))
        .buffers[0];
      const ansi = (await pm.call('KEYBOARD', 'OemToAnsi', [B(substituted), buffer(0x80)]))
        .buffers[1];

      value = stringOf(await pm.call('USER', 'AnsiUpper', [B(ansi)]), 0);
    }
  }

  const data =
    (await pm.kernel('GlobalAlloc', [W(DDE_MEMORY | 0x40), D(value.length + 5)])) & 0xffff;

  if (!data) {
    /* `0cd1` with the message already `WM_DDE_DATA`: data of nought. */
    return post(pm, client, WM_DDE_DATA, hwnd, (item << 16) >>> 0);
  }

  const at = (await pm.kernel('GlobalLock', [W(data)])) >>> 0;

  pm.writeFar(at, [0x00, 0x30, 0x01, 0x00, ...value, 0]);
  await pm.kernel('GlobalUnlock', [W(data)]);

  return post(pm, client, WM_DDE_DATA, hwnd, ((item << 16) | data) >>> 0);
}
