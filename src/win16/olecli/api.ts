'use strict';

import { W } from '../commdlg/api.js';
import {
  CF_BITMAP,
  CF_DIB,
  CF_METAFILEPICT,
  CLIENT_VERSION,
  type Kind,
  type Method,
  OLE_ERROR_ADDRESS,
  OLE_ERROR_CLASS,
  OLE_ERROR_FORMAT,
  OLE_ERROR_HANDLE,
  OLE_ERROR_OBJECT,
  OLE_ERROR_PROTOCOL,
  OLE_ERROR_STATIC,
  OLE_ERROR_STATIC_FROM_OTHER_OS,
  OLE_ERROR_STREAM,
  OLE_OK,
  OLERENDER_DRAW,
  OLERENDER_FORMAT,
  OT_EMBEDDED,
  OT_LINK,
  OT_STATIC,
  Ole,
  SCRATCH,
  bytesOf,
} from './core.js';
import { isDcMeta } from './draw.js';
import {
  enumObjects,
  registerClientDoc,
  renameClientDoc,
  revokeClientDoc,
  savedClientDoc,
} from './docs.js';
import { loadStatic, staticFromClipboard } from './kinds.js';
import {
  classKnown,
  create,
  createFromFile,
  fromClip,
  load,
  lockServer,
  unlockServer,
} from './linked.js';
import { callMethod, docError, isObject, kindOf, nameError, writable } from './objects.js';
import { get } from './streams.js';

/**
 * `OLECLI`'s functions a program calls, each its arguments checked and
 * then, for an object, the method its table holds called: what ole.h
 * declares, as the OLE 1.0 programmer's reference describes them, their
 * answers **recorded** by `olestat` and `olemem`. As
 * `crates/winbox-win16/src/olecli/api.rs`.
 */

const WORD = 3;
const DWORD = 7;

/** The protocols OLE 1.0 names (ole.h's comments, the reference): embedding and linking, and pictures alone. */
const STD_FILE_EDITING = 'StdFileEditing';
const STATIC = 'Static';

/** `OLE_ERROR_LAUNCH` (ole.h). */
const OLE_ERROR_LAUNCH = 35;

/** A protocol's name, compared as `lstrcmpi` compares: `'std'`, `'static'`, or null for neither. */
export function protocolOf(ole: Ole, at: number): 'std' | 'static' | null {
  if (!at || !ole.readable(at)) {
    return null;
  }

  const name = String.fromCharCode(...ole.string(at)).toLowerCase();

  if (name === STD_FILE_EDITING.toLowerCase()) {
    return 'std';
  }

  return name === STATIC.toLowerCase() ? 'static' : null;
}

/** An object's method called once the object is found to be one: `OLE_ERROR_OBJECT` where it is not. */
async function method(ole: Ole, object: number, name: Method, args: [number, number][] = []) {
  if (!isObject(ole, object)) {
    return OLE_ERROR_OBJECT;
  }

  return (await callMethod(ole, object, name, args)) & 0xffff;
}

const w = (value: number): [number, number] => [value & 0xffff, WORD];
const d = (value: number): [number, number] => [value >>> 0, DWORD];

export async function OleDelete(this: any, object: number) {
  return method(new Ole(this), object, 'Delete');
}

export async function OleRelease(this: any, object: number) {
  return method(new Ole(this), object, 'Release');
}

export async function OleSaveToStream(this: any, object: number, stream: number) {
  const ole = new Ole(this);

  if (isObject(ole, object) && !writable(ole, stream)) {
    return OLE_ERROR_ADDRESS;
  }

  return method(ole, object, 'SaveToStream', [d(stream)]);
}

/**
 * `OleLoadFromStream`: the stream's version and type read, then by the
 * protocol: `Static` reads a static object -- its class's name and what
 * that class keeps -- and `StdFileEditing` an embedded or linked one. A
 * version written by another system is `OLE_ERROR_STATIC_FROM_OTHER_OS`;
 * type nought `OLE_OK` with no object; a type the protocol does not read
 * `OLE_ERROR_PROTOCOL`; a stream that gives fewer bytes than asked for, or
 * a class's name of nought bytes, `OLE_ERROR_STREAM` (**recorded** by
 * `olestat`'s `load` records, where each stops reading).
 */
export async function OleLoadFromStream(
  this: any,
  stream: number,
  protocol: number,
  client: number,
  doc: number,
  name: number,
  out: number
) {
  const ole = new Ole(this);
  const kind = protocolOf(ole, protocol);
  const checked = docError(ole, doc) || (kind ? 0 : OLE_ERROR_PROTOCOL) || nameError(ole, name);

  if (checked) {
    return checked;
  }

  if (!writable(ole, out) || !writable(ole, stream)) {
    return OLE_ERROR_ADDRESS;
  }

  ole.w32(out, 0);

  const at = ole.near(SCRATCH);

  if (!(await get(ole, stream, at, 4))) {
    return OLE_ERROR_STREAM;
  }

  const version = ole.r32(at);

  if (!(await get(ole, stream, at, 4))) {
    return OLE_ERROR_STREAM;
  }

  const type = ole.r32(at);

  if (version >>> 16) {
    return OLE_ERROR_STATIC_FROM_OTHER_OS;
  }

  if (type === 0) {
    return OLE_OK;
  }

  if (kind === 'std' && (type === OT_LINK || type === OT_EMBEDDED)) {
    return load(ole, stream, type, client, doc, name, out);
  }

  if (kind !== 'static' || type !== OT_STATIC) {
    return OLE_ERROR_PROTOCOL;
  }

  if (!(await get(ole, stream, at, 4))) {
    return OLE_ERROR_STREAM;
  }

  const length = ole.r32(at);

  if (!length || length > 0x100 || !(await get(ole, stream, at, length))) {
    return OLE_ERROR_STREAM;
  }

  const klass = ole.string(at);

  return loadStatic(ole, stream, klass, client, doc, name, out);
}

export async function OleClone(
  this: any,
  object: number,
  client: number,
  doc: number,
  name: number,
  out: number
) {
  const ole = new Ole(this);

  if (!isObject(ole, object)) {
    return OLE_ERROR_OBJECT;
  }

  const checked =
    docError(ole, doc) || nameError(ole, name) || (writable(ole, out) ? 0 : OLE_ERROR_ADDRESS);

  return checked || method(ole, object, 'Clone', [d(client), d(doc), d(name), d(out)]);
}

/** `OleCopyFromLink` and `OleObjectConvert`: the document checked before the method is called (**measured** by `olemem`: `OLE_ERROR_HANDLE` for nought, where the method answers `OLE_ERROR_STATIC`). */
export async function OleCopyFromLink(
  this: any,
  object: number,
  _protocol: number,
  client: number,
  doc: number,
  name: number,
  out: number
) {
  const ole = new Ole(this);

  if (!isObject(ole, object)) {
    return OLE_ERROR_OBJECT;
  }

  return (
    docError(ole, doc) || method(ole, object, 'CopyFromLink', [d(client), d(doc), d(name), d(out)])
  );
}

export async function OleObjectConvert(
  this: any,
  object: number,
  protocol: number,
  client: number,
  doc: number,
  name: number,
  out: number
) {
  const ole = new Ole(this);

  if (!isObject(ole, object)) {
    return OLE_ERROR_OBJECT;
  }

  return (
    docError(ole, doc) ||
    method(ole, object, 'ObjectConvert', [d(protocol), d(client), d(doc), d(name), d(out)])
  );
}

export async function OleEqual(this: any, a: number, b: number) {
  const ole = new Ole(this);

  if (!isObject(ole, b)) {
    return OLE_ERROR_OBJECT;
  }

  return method(ole, a, 'Equal', [d(b)]);
}

/** The static formats on the clipboard, in the order asked for: a picture, a DIB, a bitmap. */
const STATIC_FORMATS = [CF_METAFILEPICT, CF_DIB, CF_BITMAP];

async function available(ole: Ole, format: number) {
  return ((await ole.user('IsClipboardFormatAvailable', [W(format)])) & 0xffff) !== 0;
}

/**
 * `OleQueryCreateFromClip(protocol, render, format)`: for `Static`, drawn,
 * whether a picture, a DIB or a bitmap is on the clipboard; in a format,
 * whether that one is; with no rendering `OLE_ERROR_FORMAT`. For
 * `StdFileEditing`, whether `cfOwnerLink` is, after `cfFileName` -- not yet
 * whether its server can embed. Another protocol `OLE_ERROR_PROTOCOL`
 * (**recorded** by `olestat`; the formats asked about seen as WinBox ran
 * `OLECLI.DLL`).
 */
export async function OleQueryCreateFromClip(
  this: any,
  protocol: number,
  render: number,
  format: number
) {
  return queryFromClip(new Ole(this), protocol, render, format, 'OwnerLink');
}

/** `OleQueryLinkFromClip`: as `OleQueryCreateFromClip`, with `cfObjectLink`. */
export async function OleQueryLinkFromClip(
  this: any,
  protocol: number,
  render: number,
  format: number
) {
  return queryFromClip(new Ole(this), protocol, render, format, 'ObjectLink');
}

async function queryFromClip(
  ole: Ole,
  protocol: number,
  render: number,
  format: number,
  link: string
) {
  const kind = protocolOf(ole, protocol);

  if (kind === 'std') {
    const formats = ole.state().formats;

    await available(ole, formats.FileName ?? 0);

    return (await available(ole, formats[link] ?? 0)) ? OLE_OK : OLE_ERROR_FORMAT;
  }

  if (kind !== 'static' || link === 'ObjectLink') {
    return kind ? OLE_ERROR_FORMAT : OLE_ERROR_PROTOCOL;
  }

  return staticFormat(ole, render, format).then((found) => (found ? OLE_OK : OLE_ERROR_FORMAT));
}

/** The format a static object would be made of, by the rendering asked for; nought for none. */
async function staticFormat(ole: Ole, render: number, format: number): Promise<number> {
  if (render === OLERENDER_DRAW) {
    for (const each of STATIC_FORMATS) {
      if (await available(ole, each)) {
        return each;
      }
    }

    return 0;
  }

  if (render === OLERENDER_FORMAT) {
    return (await available(ole, format)) ? format : 0;
  }

  return 0;
}

/**
 * `OleCreateFromClip(protocol, client, doc, name, out, render, format)`:
 * the document, the name and the out pointer checked, then the protocol;
 * for `Static`, the first of the clipboard's formats, in its order, that is
 * a picture, a DIB or a bitmap, made into a static object.
 */
export async function OleCreateFromClip(
  this: any,
  protocol: number,
  client: number,
  doc: number,
  name: number,
  out: number,
  render: number,
  format: number
) {
  const ole = new Ole(this);
  const checked =
    docError(ole, doc) || nameError(ole, name) || (writable(ole, out) ? 0 : OLE_ERROR_ADDRESS);

  if (checked) {
    return checked;
  }

  const kind = protocolOf(ole, protocol);

  if (kind === 'std') {
    ole.w32(out, 0);
    return fromClip(ole, client, doc, name, out, false);
  }

  if (kind !== 'static') {
    return kind ? OLE_ERROR_FORMAT : OLE_ERROR_PROTOCOL;
  }

  ole.w32(out, 0);

  if (!(await staticFormat(ole, render, format))) {
    return OLE_ERROR_FORMAT;
  }

  let each = 0;

  for (;;) {
    each = (await ole.user('EnumClipboardFormats', [W(each)])) & 0xffff;

    if (!each) {
      return OLE_ERROR_FORMAT;
    }

    if (STATIC_FORMATS.includes(each) && (render !== OLERENDER_FORMAT || each === format)) {
      break;
    }
  }

  const handle = (await ole.user('GetClipboardData', [W(each)])) & 0xffff;
  const kinds: Record<number, Exclude<Kind, 'gen' | 'le'>> = {
    [CF_METAFILEPICT]: 'mf',
    [CF_BITMAP]: 'bm',
    [CF_DIB]: 'dib',
  };

  return staticFromClipboard(ole, kinds[each], handle, client, doc, name, out);
}

/** `OleCreateLinkFromClip`: a link of a static picture is not made: `OLE_ERROR_FORMAT` for `Static`; `StdFileEditing` a link to `ObjectLink`'s document (`linked.ts`). */
export async function OleCreateLinkFromClip(
  this: any,
  protocol: number,
  client: number,
  doc: number,
  name: number,
  out: number
) {
  const ole = new Ole(this);
  const checked =
    docError(ole, doc) || nameError(ole, name) || (writable(ole, out) ? 0 : OLE_ERROR_ADDRESS);

  if (checked) {
    return checked;
  }

  if (protocolOf(ole, protocol) === 'std') {
    ole.w32(out, 0);
    return fromClip(ole, client, doc, name, out, true);
  }

  return protocolOf(ole, protocol) ? OLE_ERROR_FORMAT : OLE_ERROR_PROTOCOL;
}

export async function OleCopyToClipboard(this: any, object: number) {
  return method(new Ole(this), object, 'CopyToClipboard');
}

export async function OleQueryType(this: any, object: number, out: number) {
  return method(new Ole(this), object, 'QueryType', [d(out)]);
}

export async function OleSetHostNames(this: any, object: number, client: number, doc: number) {
  return method(new Ole(this), object, 'SetHostNames', [d(client), d(doc)]);
}

export async function OleSetTargetDevice(this: any, object: number, device: number) {
  return method(new Ole(this), object, 'SetTargetDevice', [w(device)]);
}

/** `OleSetBounds`: a NULL rectangle `OLE_ERROR_ADDRESS` before the method (**measured** by `olemem`). */
export async function OleSetBounds(this: any, object: number, rect: number) {
  const ole = new Ole(this);

  if (isObject(ole, object) && !writable(ole, rect, 8)) {
    return OLE_ERROR_ADDRESS;
  }

  return method(ole, object, 'SetBounds', [d(rect)]);
}

export async function OleQueryBounds(this: any, object: number, rect: number) {
  const ole = new Ole(this);

  if (isObject(ole, object) && !writable(ole, rect, 8)) {
    return OLE_ERROR_ADDRESS;
  }

  return method(ole, object, 'QueryBounds', [d(rect)]);
}

export async function OleDraw(
  this: any,
  object: number,
  dc: number,
  bounds: number,
  window: number,
  format: number
) {
  const ole = new Ole(this);

  if (isObject(ole, object) && !writable(ole, bounds, 8)) {
    return OLE_ERROR_ADDRESS;
  }

  return method(ole, object, 'Draw', [w(dc), d(bounds), d(window), w(format)]);
}

export async function OleQueryOpen(this: any, object: number) {
  return method(new Ole(this), object, 'QueryOpen');
}

export async function OleActivate(
  this: any,
  object: number,
  verb: number,
  show: number,
  focus: number,
  hwnd: number,
  rect: number
) {
  return method(new Ole(this), object, 'Activate', [w(verb), w(show), w(focus), w(hwnd), d(rect)]);
}

export async function OleUpdate(this: any, object: number) {
  return method(new Ole(this), object, 'Update');
}

export async function OleReconnect(this: any, object: number) {
  return method(new Ole(this), object, 'Reconnect');
}

export async function OleGetLinkUpdateOptions(this: any, object: number, out: number) {
  return method(new Ole(this), object, 'GetLinkUpdateOptions', [d(out)]);
}

export async function OleSetLinkUpdateOptions(this: any, object: number, option: number) {
  return method(new Ole(this), object, 'SetLinkUpdateOptions', [w(option)]);
}

/** `OleEnumFormats`: nought for what is not an object (**recorded** by `olestat`). */
export async function OleEnumFormats(this: any, object: number, format: number) {
  const ole = new Ole(this);

  return isObject(ole, object) ? method(ole, object, 'EnumFormats', [w(format)]) : 0;
}

export async function OleClose(this: any, object: number) {
  return method(new Ole(this), object, 'Close');
}

export async function OleGetData(this: any, object: number, format: number, out: number) {
  const ole = new Ole(this);

  if (isObject(ole, object) && !writable(ole, out, 2)) {
    return OLE_ERROR_ADDRESS;
  }

  return method(ole, object, 'GetData', [w(format), d(out)]);
}

export async function OleSetData(this: any, object: number, format: number, handle: number) {
  return method(new Ole(this), object, 'SetData', [w(format), w(handle)]);
}

/** `OleQueryProtocol`: the method's answer, a far pointer; NULL for what is not an object. */
export async function OleQueryProtocol(this: any, object: number, protocol: number) {
  const ole = new Ole(this);

  if (!isObject(ole, object)) {
    return 0;
  }

  return (await callMethod(ole, object, 'QueryProtocol', [d(protocol)])) >>> 0;
}

export async function OleQueryOutOfDate(this: any, object: number) {
  return method(new Ole(this), object, 'QueryOutOfDate');
}

/**
 * `OleCreate` and the calls that make an embedded or linked object from a
 * class, a template or a file: `Static` makes none (`OLE_ERROR_PROTOCOL`,
 * **recorded** by `olestat`); `StdFileEditing` looks the class up in the
 * registration database, a class it does not find `OLE_ERROR_CLASS`
 * (**recorded** by `olestat`). A class found has its server reached or
 * launched (`linked.ts`); a template is not yet followed
 * (`OLE_ERROR_LAUNCH`, `kb/topics/ole.md`, "Not yet done").
 */
async function checkClass(
  ole: Ole,
  protocol: number,
  klass: number,
  doc: number,
  name: number,
  out: number
) {
  const checked =
    docError(ole, doc) || nameError(ole, name) || (writable(ole, out) ? 0 : OLE_ERROR_ADDRESS);

  if (checked) {
    return checked;
  }

  if (protocolOf(ole, protocol) !== 'std') {
    return OLE_ERROR_PROTOCOL;
  }

  if (!klass || !ole.readable(klass)) {
    return OLE_ERROR_CLASS;
  }

  return (await classKnown(ole, klass)) ? OLE_OK : OLE_ERROR_CLASS;
}

export async function OleCreate(
  this: any,
  protocol: number,
  client: number,
  klass: number,
  doc: number,
  name: number,
  out: number
) {
  const ole = new Ole(this);

  return (
    (await checkClass(ole, protocol, klass, doc, name, out)) ||
    create(ole, client, klass, doc, name, out, true)
  );
}

export async function OleCreateFromTemplate(
  this: any,
  protocol: number,
  _client: number,
  _template: number,
  doc: number,
  name: number,
  out: number
) {
  const ole = new Ole(this);

  return (await checkClass(ole, protocol, 0, doc, name, out)) || OLE_ERROR_LAUNCH;
}

export async function OleCreateFromFile(
  this: any,
  protocol: number,
  client: number,
  klass: number,
  file: number,
  doc: number,
  name: number,
  out: number
) {
  const ole = new Ole(this);

  return (
    (await checkClass(ole, protocol, klass, doc, name, out)) ||
    createFromFile(ole, client, klass, file, 0, doc, name, out, false)
  );
}

export async function OleCreateLinkFromFile(
  this: any,
  protocol: number,
  client: number,
  klass: number,
  file: number,
  item: number,
  doc: number,
  name: number,
  out: number
) {
  const ole = new Ole(this);

  return (
    (await checkClass(ole, protocol, klass, doc, name, out)) ||
    createFromFile(ole, client, klass, file, item, doc, name, out, true)
  );
}

/** `OleCreateInvisible`: made, its server started only where it is to be activated (**recorded** by `oledde`, not). */
export async function OleCreateInvisible(
  this: any,
  protocol: number,
  client: number,
  klass: number,
  doc: number,
  name: number,
  out: number,
  _render: number,
  _format: number,
  activate: number
) {
  const ole = new Ole(this);

  return (
    (await checkClass(ole, protocol, klass, doc, name, out)) ||
    create(ole, client, klass, doc, name, out, (activate & 0xffff) !== 0)
  );
}

export async function OleQueryReleaseStatus(this: any, object: number) {
  return method(new Ole(this), object, 'QueryReleaseStatus');
}

export async function OleQueryReleaseError(this: any, object: number) {
  return method(new Ole(this), object, 'QueryReleaseError');
}

export async function OleQueryReleaseMethod(this: any, object: number) {
  return method(new Ole(this), object, 'QueryReleaseMethod');
}

export async function OleRegisterClientDoc(
  this: any,
  klass: number,
  name: number,
  reserved: number,
  out: number
) {
  return registerClientDoc(new Ole(this), klass, name, reserved, out);
}

export async function OleRevokeClientDoc(this: any, doc: number) {
  return revokeClientDoc(new Ole(this), doc);
}

export async function OleRenameClientDoc(this: any, doc: number, name: number) {
  return renameClientDoc(new Ole(this), doc, name);
}

export async function OleRevertClientDoc(this: any, doc: number) {
  return savedClientDoc(new Ole(this), doc);
}

export async function OleSavedClientDoc(this: any, doc: number) {
  return savedClientDoc(new Ole(this), doc);
}

export async function OleRename(this: any, object: number, name: number) {
  return method(new Ole(this), object, 'Rename', [d(name)]);
}

export async function OleEnumObjects(this: any, doc: number, out: number) {
  return enumObjects(new Ole(this), doc, out);
}

export async function OleQueryName(this: any, object: number, buffer: number, count: number) {
  const ole = new Ole(this);

  if (isObject(ole, object) && (!writable(ole, count, 2) || !writable(ole, buffer))) {
    return OLE_ERROR_ADDRESS;
  }

  return method(ole, object, 'QueryName', [d(buffer), d(count)]);
}

export async function OleSetColorScheme(this: any, object: number, palette: number) {
  return method(new Ole(this), object, 'SetColorScheme', [d(palette)]);
}

/** `OleRequestData`: format nought `OLE_ERROR_FORMAT` before the method (**measured** by `olemem`). */
export async function OleRequestData(this: any, object: number, format: number) {
  const ole = new Ole(this);

  if (isObject(ole, object) && !(format & 0xffff)) {
    return OLE_ERROR_FORMAT;
  }

  return method(ole, object, 'RequestData', [w(format)]);
}

/** `OleLockServer`: a static object has no server, `OLE_ERROR_STATIC`, nothing written (**recorded** by `olestat`); an embedded or linked one's is reached or launched (`linked.ts`). */
export async function OleLockServer(this: any, object: number, out: number) {
  const ole = new Ole(this);

  if (!isObject(ole, object)) {
    return OLE_ERROR_OBJECT;
  }

  if (kindOf(ole, object) === 'le') {
    return writable(ole, out) ? lockServer(ole, object, out) : OLE_ERROR_ADDRESS;
  }

  return OLE_ERROR_STATIC;
}

/** `OleUnlockServer`: a server WinBox locked let go; a handle it has not given `OLE_ERROR_HANDLE`. */
export async function OleUnlockServer(this: any, server: number) {
  return (await unlockServer(new Ole(this), server)) ?? OLE_ERROR_HANDLE;
}

export async function OleQuerySize(this: any, object: number, out: number) {
  const ole = new Ole(this);

  if (isObject(ole, object) && !writable(ole, out)) {
    return OLE_ERROR_ADDRESS;
  }

  return method(ole, object, 'QuerySize', [d(out)]);
}

export async function OleExecute(this: any, object: number, commands: number, reserved: number) {
  return method(new Ole(this), object, 'Execute', [w(commands), w(reserved)]);
}

/** `OleQueryClientVersion`: 1001h (**recorded** by `olestat`). */
export function OleQueryClientVersion(this: any) {
  return CLIENT_VERSION;
}

export async function OleIsDcMeta(this: any, dc: number) {
  return isDcMeta(new Ole(this), dc);
}

export { bytesOf };
