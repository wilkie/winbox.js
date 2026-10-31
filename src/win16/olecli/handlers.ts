'use strict';

import { D, W, text } from '../commdlg/api.js';
import {
  OLE_ERROR_MEMORY,
  OLE_ERROR_STREAM,
  OLERENDER_DRAW,
  OLERENDER_FORMAT,
  OLERENDER_NONE,
  OT_EMBEDDED,
  OT_LINK,
  Ole,
  SCRATCH,
  bytesOf,
} from './core.js';
import { create, createFromFile, fromClip, load, pbTable, registerRelease } from './linked.js';

/**
 * Object handlers: a library a class names in the registration database
 * (`class\protocol\StdFileEditing\handler`), which `OLECLI` loads and calls
 * in place of its own defaults to make the class's objects, as the OLE 1.0
 * programmer's reference describes them -- its `DllCreate`,
 * `DllCreateFromClip`, `DllCreateLinkFromClip`, `DllCreateFromTemplate`,
 * `DllCreateFromFile`, `DllCreateLinkFromFile`, `DllCreateInvisible` and
 * `DllLoadFromStream`, given what the client gave its `Ole` function, each
 * free to call `OLECLI`'s default of the same name, the `Def` exports
 * (110-117), and to change what it makes. As
 * `crates/winbox-win16/src/olecli/handlers.rs`.
 *
 * **Measured** by `olehnd`, whose handler writes down each call it is
 * given: the arguments as the client gave them, a stream's class as an
 * atom, its type and a format of nought; what the defaults answer; the
 * library loaded once and held while its objects are. **Read out** of
 * `OLECLI.DLL`, in prose, what no probe can show: the library is found and
 * loaded by seg2 `02b6` (entry 961) -- the registration database asked
 * first, a class found again by its atom, every one of the seven `Dll`
 * exports but `DllCreateInvisible` wanted or the library let go -- and
 * counted by its objects (seg3 `1646`-`16e6`, the count put back where the
 * handler fails); an object's release counts it down (entry 986, seg2
 * `05ce`), and a library none of whose objects is left is let go only when
 * another's are, or a document is revoked (entry 1023, seg2 `055e`, called
 * by `OleRevokeClientDoc` first of all). A handler with no
 * `DllCreateInvisible` is called at `DllCreate`, its default told to make
 * the object hidden (seg3 `1657`).
 *
 * `OLECLI`'s own handler of the class `PBrush`, Paintbrush's, is the `Pb`
 * exports (800-812), with the same arguments (**read out**, seg7): each
 * calls its default asking for no picture where a picture was wanted -- a
 * link for its `Native` -- and gives the object Paintbrush's table where it
 * has no picture (`linked.ts`' `pbTable`).
 */

export type Way =
  'load' | 'clip' | 'linkClip' | 'template' | 'create' | 'file' | 'linkFile' | 'invisible';

/** The handler's exports, in the order `OLECLI` asks for them (seg2 `03fc`-`0503`). */
const WAYS: Way[] = [
  'load',
  'clip',
  'linkClip',
  'template',
  'create',
  'file',
  'linkFile',
  'invisible',
];
const EXPORT_OF: Record<Way, string> = {
  load: 'DllLoadFromStream',
  clip: 'DllCreateFromClip',
  linkClip: 'DllCreateLinkFromClip',
  template: 'DllCreateFromTemplate',
  create: 'DllCreate',
  file: 'DllCreateFromFile',
  linkFile: 'DllCreateLinkFromFile',
  invisible: 'DllCreateInvisible',
};

/** Where each way's out pointer is among its arguments. */
const OUT_AT: Record<Way, number> = {
  load: 5,
  clip: 4,
  linkClip: 4,
  template: 5,
  create: 5,
  file: 6,
  linkFile: 7,
  invisible: 5,
};

const HKEY_CLASSES_ROOT = 1;
/** A handler's path as the registration database gives it, at most this long. */
const PATH_SIZE = 0x100;
const PATH_AT = SCRATCH + 0x400;
const PATH_SIZE_AT = SCRATCH + 0x500;
/** `OLE_ERROR_CLIPBOARD` (ole.h): the default of a clip that is neither embedded nor linked (seg5 `0172`). */
const OLE_ERROR_CLIPBOARD = 11;
/** `OLE_ERROR_CLASS` (ole.h). */
const OLE_ERROR_CLASS = 20;

const lower = (bytes: number[]) => String.fromCharCode(...bytes).toLowerCase();

/** A class's handler: its index, `'pb'` for Paintbrush's, nought for none. */
async function handlerFor(ole: Ole, klass: number[]): Promise<number | 'pb'> {
  const state = ole.state();

  if (lower(klass) === 'pbrush') {
    return 'pb';
  }

  const size = ole.near(PATH_SIZE_AT);
  const path = ole.near(PATH_AT);

  ole.w32(size, PATH_SIZE);

  const found = await ole.call('SHELL', 'RegQueryValue', [
    D(HKEY_CLASSES_ROOT),
    text([...klass, ...bytesOf('\\protocol\\StdFileEditing\\handler')]),
    D(path),
    D(size),
  ]);

  if (found !== 0 || !ole.r8(path)) {
    return 0;
  }

  const index = state.handlers.findIndex((each) => each?.klass === lower(klass));

  if (index > 0) {
    state.handlers[index]!.count += 1;

    if (state.pending === index) {
      state.pending = 0;
    }

    return index;
  }

  const library = (await ole.kernel('LoadLibrary', [D(path)])) & 0xffff;

  if (library < 32) {
    return 0;
  }

  const procs: number[] = [];

  for (const way of WAYS) {
    procs.push(
      (await ole.kernel('GetProcAddress', [W(library), text(bytesOf(EXPORT_OF[way]))])) >>> 0
    );
  }

  /* Every one but `DllCreateInvisible` is wanted. */
  if (procs.slice(0, 7).some((proc) => !proc)) {
    await ole.kernel('FreeLibrary', [W(library)]);
    return 0;
  }

  let free = state.handlers.findIndex((each, i) => i > 0 && !each);

  if (free < 0) {
    free = Math.max(1, state.handlers.length);
  }

  state.handlers[free] = {
    klass: lower(klass),
    atom: await ole.addAtomText(klass),
    library,
    count: 1,
    procs,
  };
  return free;
}

/** The library none of whose objects is left let go. */
export async function freePending(ole: Ole) {
  const state = ole.state();
  const handler = state.pending ? state.handlers[state.pending] : null;

  if (handler) {
    await ole.deleteAtom(handler.atom);
    await ole.kernel('FreeLibrary', [W(handler.library)]);
    state.handlers[state.pending] = null;
  }

  state.pending = 0;
}

/** An object made through a handler let go: the handler counted down, and left to be let go where none of its objects is left. */
registerRelease(async (ole, object) => {
  const state = ole.state();
  const index = state.handlerOf.get(object >>> 0);

  if (!index) {
    return;
  }

  state.handlerOf.delete(object >>> 0);

  const handler = state.handlers[index];

  if (handler && --handler.count <= 0) {
    await freePending(ole);
    state.pending = index;
  }
});

/**
 * An object made as its class's handler makes it: by the handler's export,
 * by Paintbrush's, or by the default. `args` are the `Dll` export's, as
 * the client gave them to its `Ole` function.
 */
export async function make(
  ole: Ole,
  way: Way,
  klass: number[],
  args: [number, number][]
): Promise<number> {
  const state = ole.state();
  const values = args.map(([value]) => value >>> 0);
  const found = await handlerFor(ole, klass);

  if (found === 'pb') {
    return PAINTBRUSH[way](ole, values);
  }

  if (!found) {
    return DEFAULTS[way](ole, values);
  }

  const handler = state.handlers[found]!;
  const count = handler.count;
  let proc = handler.procs[WAYS.indexOf(way)];
  let typed = args;

  if (way === 'invisible' && !proc) {
    state.invisible = values[8] !== 0;
    proc = handler.procs[WAYS.indexOf('create')];
    typed = args.slice(0, 8);
  }

  const answer = (await ole.callFarTyped(proc, typed)) & 0xffff;

  state.invisible = null;

  if (answer > 1) {
    handler.count = count - 1;
    return answer;
  }

  const object = ole.r32(values[OUT_AT[way]]);

  if (object) {
    state.handlerOf.set(object, found);
  }

  return answer;
}

/** An atom's name's bytes. */
async function atomBytes(ole: Ole, atom: number): Promise<number[]> {
  const at = ole.near(PATH_AT);

  if (!atom || !(await ole.atomName(atom & 0xffff, at, PATH_SIZE))) {
    return [];
  }

  return ole.string(at);
}

/**
 * A template's class: the registration database's for its extension,
 * `.hnd` the class `OleHnd` (**measured** by `olehnd`, whose template's
 * class is found so); none, null.
 */
export async function classOfFile(ole: Ole, file: number): Promise<number[] | null> {
  const name = ole.string(file);
  const dot = name.lastIndexOf(0x2e);
  const slash = Math.max(name.lastIndexOf(0x5c), name.lastIndexOf(0x3a));

  if (dot < 0 || dot < slash) {
    return null;
  }

  const size = ole.near(PATH_SIZE_AT);
  const at = ole.near(PATH_AT);

  ole.w32(size, PATH_SIZE);

  const found = await ole.call('SHELL', 'RegQueryValue', [
    D(HKEY_CLASSES_ROOT),
    text(name.slice(dot)),
    D(at),
    D(size),
  ]);

  return found === 0 && ole.r8(at) ? ole.string(at) : null;
}

// The defaults, the `Def` exports: each a `Dll` export's arguments.

type Default = (ole: Ole, args: number[]) => Promise<number>;

/**
 * Each default (110-117): what the `Ole` function does once it has checked
 * its arguments. They do not look at the protocol (**measured** by
 * `olehnd`: `DefLoadFromStream` and `DefCreateInvisible` given `Static`
 * make an embedded object). The clipboard's two answer
 * `OLE_ERROR_MEMORY` but inside `OleCreateFromClip` or
 * `OleCreateLinkFromClip`, whose clipboard they read (**measured**;
 * **read out**, the clipboard's object read by the `Ole` function, seg3
 * `30c2`).
 */
export const DEFAULTS: Record<Way, Default> = {
  load: async (ole, [stream, , client, doc, name, out, type, klass]) => {
    const bytes = await atomBytes(ole, klass);

    if (!bytes.length) {
      return OLE_ERROR_STREAM;
    }

    return load(ole, stream, type, client, doc, name, out, bytes, klass & 0xffff);
  },
  clip: async (ole, [, client, doc, name, out, render, format, type]) => {
    if (!ole.state().clipping) {
      return OLE_ERROR_MEMORY;
    }

    if (type !== OT_EMBEDDED && type !== OT_LINK) {
      return OLE_ERROR_CLIPBOARD;
    }

    return fromClip(ole, client, doc, name, out, type === OT_LINK, render & 0xffff, format);
  },
  linkClip: async (ole, [, client, doc, name, out, render, format]) => {
    if (!ole.state().clipping) {
      return OLE_ERROR_MEMORY;
    }

    return fromClip(ole, client, doc, name, out, true, render & 0xffff, format);
  },
  template: async (ole, [, client, template, doc, name, out, render]) => {
    const klass = await classOfFile(ole, template);

    if (!klass) {
      return OLE_ERROR_CLASS;
    }

    return create(ole, client, klass, doc, name, out, true, render & 0xffff, ole.string(template));
  },
  create: async (ole, [, client, klass, doc, name, out, render]) => {
    const hidden = ole.state().invisible;

    return create(ole, client, ole.string(klass), doc, name, out, hidden ?? true, render & 0xffff);
  },
  file: async (ole, [, client, klass, file, doc, name, out, render]) =>
    createFromFile(ole, client, klass, file, 0, doc, name, out, false, render & 0xffff),
  linkFile: async (ole, [, client, klass, file, item, doc, name, out, render]) =>
    createFromFile(ole, client, klass, file, item, doc, name, out, true, render & 0xffff),
  invisible: async (ole, [, client, klass, doc, name, out, render, , activate]) =>
    create(
      ole,
      client,
      ole.string(klass),
      doc,
      name,
      out,
      (activate & 0xffff) !== 0,
      render & 0xffff
    ),
};

/** `LECREATEINVISIBLE` (230): `DefCreateInvisible`'s default without its protocol (**read out**: seg5 `02e0` passes all but the protocol to entry 230). */
export function leCreateInvisible(ole: Ole, args: number[]) {
  return DEFAULTS.invisible(ole, [0, ...args]);
}

// Paintbrush's handler, the `Pb` exports.

/** Where each way's rendering is among its arguments. */
const RENDER_AT: Partial<Record<Way, number>> = {
  clip: 5,
  linkClip: 5,
  template: 6,
  create: 6,
  file: 7,
  linkFile: 8,
  invisible: 6,
};

/** Whether `Native` is on the clipboard. */
async function nativeOnClipboard(ole: Ole) {
  const native = ole.state().formats.Native ?? 0;

  return (await ole.user('IsClipboardFormatAvailable', [W(native)])) !== 0;
}

/**
 * Paintbrush's handler of a way: no picture asked for where one was --
 * `olerender_draw` made `olerender_none`, or for a link `olerender_format`
 * of `Native` -- then the default, then Paintbrush's table where the
 * object has no picture (**read out**, seg7 `0000`-`0527`; **measured** by
 * `olehnd`'s `pb` records and, for what each is asked, `olepbd`).
 */
function paintbrush(way: Way): Default {
  return async (ole, args) => {
    const values = [...args];
    const at = RENDER_AT[way];
    const linked =
      way === 'linkClip' || way === 'linkFile' || (way === 'clip' && values[7] === OT_LINK);

    if (way === 'load' && values[6] === OT_LINK) {
      values[8] = ole.state().formats.Native ?? 0;
    }

    if (at !== undefined && (values[at] & 0xffff) === OLERENDER_DRAW) {
      const clipped = way === 'clip' || way === 'linkClip';

      if (!clipped || (await nativeOnClipboard(ole))) {
        values[at] = linked ? OLERENDER_FORMAT : OLERENDER_NONE;
        values[at + 1] = linked ? (ole.state().formats.Native ?? 0) : 0;
      }
    }

    const answer = await DEFAULTS[way](ole, values);

    if (answer <= 1) {
      const object = ole.r32(values[OUT_AT[way]]);

      if (object) {
        await pbTable(ole, object);
      }
    }

    return answer;
  };
}

export const PAINTBRUSH: Record<Way, Default> = Object.fromEntries(
  WAYS.map((way) => [way, paintbrush(way)])
) as Record<Way, Default>;

/** The `Def` and `Pb` exports by ordinal, each a way's. */
export const HANDLER_EXPORTS: Record<number, [Way, 'def' | 'pb']> = {
  110: ['load', 'def'],
  111: ['clip', 'def'],
  112: ['linkClip', 'def'],
  113: ['template', 'def'],
  114: ['create', 'def'],
  115: ['file', 'def'],
  116: ['linkFile', 'def'],
  117: ['invisible', 'def'],
  800: ['load', 'pb'],
  801: ['clip', 'pb'],
  802: ['linkClip', 'pb'],
  803: ['template', 'pb'],
  804: ['create', 'pb'],
  808: ['file', 'pb'],
  809: ['linkFile', 'pb'],
  812: ['invisible', 'pb'],
};
