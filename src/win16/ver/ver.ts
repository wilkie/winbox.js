'use strict';

import { B, D, W, api, buffer, stringOf, text } from '../commdlg/api.js';
import { lzClose, lzCopy, lzOpenFile, lzRead, lzSeek } from '../lzexpand/lz.js';
import { LANGUAGES, UNKNOWN_LANGUAGE } from './languages.js';

/**
 * `VER`, Windows' version information and file installation, as WinBox's
 * own: each routine of `VER.DLL` followed as it is read out (`kb/ver`,
 * `kb/topics/version-information.md`). As `crates/winbox-win16/src/ver/`.
 *
 * VER reads files through `LZEXPAND`, so a file `COMPRESS` made is read as
 * the file it holds: here, WinBox's own `LZEXPAND` (`lzexpand/lz.ts`),
 * called as VER calls it. Its other calls go to KERNEL, USER and KEYBOARD
 * as it makes them. What it keeps on its stack -- a file's headers, the
 * names it builds -- is kept below the caller's stack here too, where the
 * calls it makes can be given it.
 */

const sel = (at: number) => (at >>> 16) & 0xffff;
const off = (at: number) => at & 0xffff;
const far = (selector: number, offset: number) => ((selector << 16) | (offset & 0xffff)) >>> 0;
const plus = (at: number, n: number) => far(sel(at), off(at) + n);
const s16 = (value: number) => (value << 16) >> 16;

function rd8(system: any, at: number) {
  return system.machine.cpu.core.read8(sel(at), off(at));
}

function wr8(system: any, at: number, value: number) {
  system.machine.cpu.core.write8(sel(at), off(at), value & 0xff);
}

function rd16(system: any, at: number) {
  return rd8(system, at) | (rd8(system, plus(at, 1)) << 8);
}

function wr16(system: any, at: number, value: number) {
  wr8(system, at, value);
  wr8(system, plus(at, 1), value >> 8);
}

function rd32(system: any, at: number) {
  return rd16(system, at) | (rd16(system, plus(at, 2)) << 16) | 0;
}

function wr32(system: any, at: number, value: number) {
  wr16(system, at, value);
  wr16(system, plus(at, 2), value >>> 16);
}

/** A string at a far pointer, without its nought. */
function stringAt(system: any, at: number) {
  const bytes: number[] = [];

  for (let i = 0; ; i++) {
    const byte = rd8(system, plus(at, i));

    if (!byte) {
      return bytes;
    }

    bytes.push(byte);
  }
}

function writeString(system: any, at: number, bytes: number[]) {
  bytes.forEach((byte, i) => wr8(system, plus(at, i), byte));
  wr8(system, plus(at, bytes.length), 0);
}

/**
 * A frame of `size` bytes below the stack, as VER keeps its locals: the
 * far pointer to its start, given to `body`, and taken away after.
 */
async function frame<T>(system: any, size: number, body: (at: number) => Promise<T>) {
  const core = system.machine.cpu.core;
  const saved = core.sp;
  const sp = (saved - ((size + 1) & ~1)) & 0xffff;

  core.sp = sp;

  try {
    return await body(far(core.ss, sp));
  } finally {
    core.sp = saved;
  }
}

/** USER's `lstrcmpi`, of two strings where they are. */
async function lstrcmpi(system: any, a: number, b: number) {
  return s16((await api(system, 'USER', 'lstrcmpi', [D(a), D(b)])).value);
}

/** KERNEL's `lstrlen`, of a string where it is. */
async function lstrlen(system: any, at: number) {
  return (await api(system, 'KERNEL', 'lstrlen', [D(at)])).value & 0xffff;
}

/** KERNEL's `lstrcpy`, where the strings are. */
async function lstrcpy(system: any, to: number, from: number) {
  await api(system, 'KERNEL', 'lstrcpy', [D(to), D(from)]);
}

/** The resource type of version information. */
const RT_VERSION = 16;

/** `__AHINCR`: what a huge pointer's selector goes up by every 64K. */
const AHINCR = 8;

/**
 * A program's headers read (seg3 `0488`): opened by `LZOpenFile` sharing
 * it, else in compatibility mode; its old header checked for `MZ`, its new
 * header's 40h bytes read at the place the old one names and checked for
 * `NE`, and the file left at the new header. The answer, and the handle
 * `LZOpenFile` gave, or its error.
 *
 * Not followed: a ROM module's header, copied where KERNEL's `IsRomModule`
 * names one (seg3 `04a0`); Windows 3.1's answers nought (`KRNL386.EXE`
 * seg2 `1e9b`).
 */
async function openExecutable(
  system: any,
  file: number,
  header: number
): Promise<[number, number]> {
  return frame(system, 0xd0, async (at) => {
    const of = plus(at, 0);
    const old = plus(at, 0x90);
    let handle = await lzOpenFile(system, file, of, 0x40);

    if (handle < 0) {
      handle = await lzOpenFile(system, file, of, 0);
    }

    if (handle < 0) {
      return [0, handle];
    }

    if ((await lzRead(system, handle, old, 0x40)) !== 0x40 || rd16(system, old) !== 0x5a4d) {
      return [0, handle];
    }

    const place = rd32(system, plus(old, 0x3c));

    if ((await lzSeek(system, handle, place, 0)) !== place) {
      return [0, handle];
    }

    if ((await lzRead(system, handle, header, 0x40)) !== 0x40 || rd16(system, header) !== 0x454e) {
      return [0, handle];
    }

    await lzSeek(system, handle, place, 0);

    return [1, handle];
  });
}

/** A resource as the resource table names it: its place and length, in units of the table's shift. */
type Found = { shift: number; offset: number; length: number };

/**
 * A resource found in the resource table (seg3 `05d2`), read from the new
 * header on: the shift, then each type -- its number, its count -- its
 * resources read one by one where the type is the one wanted, the others
 * passed over. A type or a name is matched by its number alone, its top
 * bit taken off, against the argument's low word: a named type or resource
 * is matched by its name's place in the table, never by its name.
 */
async function findResource(
  system: any,
  handle: number,
  header: number,
  type: number,
  id: number
): Promise<Found | null> {
  return frame(system, 0x16, async (at) => {
    const shiftAt = plus(at, 0);
    const typeAt = plus(at, 2);
    const countAt = plus(at, 4);
    const info = plus(at, 0xa);

    await lzSeek(system, handle, rd16(system, plus(header, 0x24)), 1);

    if ((await lzRead(system, handle, shiftAt, 2)) !== 2) {
      return null;
    }

    const shift = rd16(system, shiftAt);

    if (shift > 12) {
      return null;
    }

    for (;;) {
      if ((await lzRead(system, handle, typeAt, 2)) !== 2 || rd16(system, typeAt) === 0) {
        return null;
      }

      if ((await lzRead(system, handle, countAt, 6)) !== 6) {
        return null;
      }

      const count = rd16(system, countAt);

      if ((rd16(system, typeAt) & 0x7fff) === (type & 0xffff)) {
        for (let i = 0; i < count; i++) {
          if ((await lzRead(system, handle, info, 12)) !== 12) {
            return null;
          }

          if ((rd16(system, plus(info, 6)) & 0x7fff) === (id & 0xffff)) {
            return { shift, offset: rd16(system, info), length: rd16(system, plus(info, 2)) };
          }
        }

        return null;
      }

      await lzSeek(system, handle, (12 * count) & 0xffff, 1);
    }
  });
}

/**
 * Win32s's own reading of a file that is no Windows 3.1 program, which VER
 * asks `W32SYS.DLL` for where it can load it (seg4 `003e`): it cannot,
 * with no Win32s installed, and VER answers nought.
 */
const WIN32S = 0;

/** `GetFileResourceSize` (seg3 `0010`): a resource's length, and its place in the file. */
export async function GetFileResourceSize(
  this: any,
  lpszFileName: number,
  lpszResType: number,
  lpszResID: number,
  lpdwFileOffset: number
) {
  const system = this;

  return frame(system, 0x40, async (header) => {
    const [opened, handle] = await openExecutable(system, lpszFileName, header);

    if (!opened) {
      /* Win32s's reading, which is not there (`WIN32S`), then the file closed. */
      void WIN32S;
      await lzClose(system, handle);

      return 0;
    }

    const found = await findResource(system, handle, header, lpszResType, lpszResID);

    await lzClose(system, handle);

    if (!found) {
      return 0;
    }

    wr32(system, lpdwFileOffset, (found.offset << found.shift) >>> 0);

    return (found.length << found.shift) >>> 0;
  });
}

/**
 * `count` bytes read into a huge buffer (seg3 `07c9`), 4000h at a time,
 * the selector stepped by `__AHINCR` past each 64K: how many were read, or
 * -1 for `LZRead`'s error.
 */
async function hugeRead(system: any, handle: number, to: number, count: number) {
  let left = count >>> 0;
  let at = to;

  while (left > 0x4000) {
    const read = await lzRead(system, handle, at, 0x4000);

    if (read >= 0x4000) {
      left -= 0x4000;

      const offset = off(at) + 0x4000;

      at = far(sel(at) + (offset > 0xffff ? AHINCR : 0), offset);
      continue;
    }

    if (read < 0) {
      return -1;
    }

    left -= read;
    break;
  }

  if (left < 0x4000) {
    const read = await lzRead(system, handle, at, left);

    if (read < 0) {
      return -1;
    }

    left -= read;
  }

  return ((count >>> 0) - left) >>> 0;
}

/** `GetFileResource` (seg3 `017e`): a resource's bytes, found or at a place given. */
export async function GetFileResource(
  this: any,
  lpszFileName: number,
  lpszResType: number,
  lpszResID: number,
  dwFileOffset: number,
  dwResLen: number,
  lpvData: number
) {
  const system = this;
  let offset = dwFileOffset >>> 0;
  let length = dwResLen >>> 0;

  return frame(system, 0x90, async (at) => {
    const header = plus(at, 0);
    const of = plus(at, 0x40);
    let handle: number;

    if (offset === 0) {
      const [opened, opener] = await openExecutable(system, lpszFileName, header);

      handle = opener;

      if (!opened) {
        await lzClose(system, handle);

        return 0;
      }

      const found = await findResource(system, handle, header, lpszResType, lpszResID);

      if (!found) {
        await lzClose(system, handle);

        return 0;
      }

      offset = (found.offset << found.shift) >>> 0;

      const size = (found.length << found.shift) >>> 0;

      if (size < length) {
        length = size;
      }
    } else {
      handle = await lzOpenFile(system, lpszFileName, of, 0x40);

      if (handle < 0) {
        handle = await lzOpenFile(system, lpszFileName, of, 0);
      }

      if (handle < 0) {
        return 0;
      }
    }

    /* Read where it is (seg3 `0776`). */
    let read = false;

    if ((await lzSeek(system, handle, offset | 0, 0)) === (offset | 0)) {
      read = (await hugeRead(system, handle, lpvData, length)) === length;
    }

    await lzClose(system, handle);

    return read ? 1 : 0;
  });
}

/**
 * `GetFileVersionInfoSize` (seg3 `086e`): the version resource's length --
 * its block's own, where that is no more than the resource's -- once its
 * first 48h bytes show `VS_FIXEDFILEINFO`'s signature, FEEF04BDh, at 14h.
 */
export async function GetFileVersionInfoSize(this: any, lpszFileName: number, lpdwHandle: number) {
  const system = this;
  const size = await GetFileResourceSize.call(system, lpszFileName, RT_VERSION, 1, lpdwHandle);

  if (!size) {
    return 0;
  }

  return frame(system, 0x48, async (at) => {
    if (
      !(await GetFileResource.call(
        system,
        lpszFileName,
        RT_VERSION,
        1,
        rd32(system, lpdwHandle),
        0x48,
        at
      ))
    ) {
      return 0;
    }

    const length = rd16(system, at);

    if (length > size) {
      return 0;
    }

    if (rd16(system, plus(at, 0x14)) !== 0x04bd || rd16(system, plus(at, 0x16)) !== 0xfeef) {
      return 0;
    }

    return length;
  });
}

/** `GetFileVersionInfo` (seg3 `0906`): `GetFileResource` of the version resource. */
export async function GetFileVersionInfo(
  this: any,
  lpszFileName: number,
  dwHandle: number,
  dwLen: number,
  lpvData: number
) {
  return GetFileResource.call(this, lpszFileName, RT_VERSION, 1, dwHandle, dwLen, lpvData);
}

/**
 * `VerQueryValue` (seg3 `0943`): a value of a version block by its path.
 * Each part, the backslashes before it passed over, is looked for among
 * the children of the block found last, by USER's `lstrcmpi`; a block
 * must have room for itself in what is left of the whole, and a child
 * must be longer than five bytes. The block's last byte is made nought
 * while it is walked, and the path's separator each part ends at, and
 * both put back.
 */
export async function VerQueryValue(
  this: any,
  lpvBlock: number,
  lpszSubBlock: number,
  lplpBuffer: number,
  lpcb: number
) {
  const system = this;
  let at = lpvBlock >>> 0;
  let path = lpszSubBlock >>> 0;

  if (s16(rd16(system, at)) < 5) {
    return 0;
  }

  const endOffset = (off(at) + rd16(system, at) - 1) & 0xffff;
  const end = far(sel(at), endOffset);
  const last = rd8(system, end);

  wr8(system, end, 0);

  const fail = () => {
    wr8(system, end, last);

    return 0;
  };

  while (rd8(system, path)) {
    while (rd8(system, path) === 0x5c) {
      path = plus(path, 1);
    }

    if (!rd8(system, path)) {
      break;
    }

    const room = s16((endOffset - off(at) + 1) & 0xffff);

    if (room < 5 || (room & 0xffff) < rd16(system, at)) {
      return fail();
    }

    const key = ((await lstrlen(system, plus(at, 4))) + 4) & 0xfffc & 0xffff;
    const first = (((rd16(system, plus(at, 2)) + 3) & 0xfffc) + key + 4) & 0xffff;

    if (rd16(system, at) < first) {
      return fail();
    }

    const blockEnd = (off(at) + rd16(system, at)) & 0xffff;

    at = plus(at, first);

    const start = path;

    while (rd8(system, path) && rd8(system, path) !== 0x5c) {
      path = plus(path, 1);
    }

    const separator = rd8(system, path);

    wr8(system, path, 0);

    let compared = 1;

    for (;;) {
      if (s16(rd16(system, at)) <= 5) {
        break;
      }

      if (s16((blockEnd - off(at)) & 0xffff) < s16(rd16(system, at))) {
        break;
      }

      compared = await lstrcmpi(system, start, plus(at, 4));

      if (compared === 0) {
        break;
      }

      at = plus(at, (rd16(system, at) + 3) & 0xfffc);
    }

    wr8(system, path, separator);

    if (compared !== 0) {
      return fail();
    }
  }

  if (lpcb) {
    wr16(system, lpcb, rd16(system, plus(at, 2)));
  }

  const key = ((await lstrlen(system, plus(at, 4))) + 4) & 0xfffc & 0xffff;

  wr32(system, lplpBuffer, far(sel(at), off(at) + key + 4));
  wr8(system, end, last);

  return 1;
}

/**
 * `VerLanguageName` (seg3 `1599`): a language's name, VER's string of its
 * number, else of nought, "Unknown Language", cut to the buffer; its whole
 * length answered. A buffer of nought is given the whole name.
 */
export function VerLanguageName(this: any, wLang: number, szLang: number, nSize: number) {
  const name = Array.from(LANGUAGES.get(wLang & 0xffff) ?? UNKNOWN_LANGUAGE, (c) =>
    c.charCodeAt(0)
  );
  const length = name.length;
  const size = nSize & 0xffff;
  const copy = size <= length && size > 0 ? name.slice(0, size - 1) : name;

  writeString(this, szLang, copy);

  return length;
}

/**
 * A folder and a name joined (seg3 `1192`): the folder copied, a backslash
 * added where it ends in neither one nor a colon, and the name after. The
 * folder's length with its backslash.
 */
function join(folder: number[], name: number[]): [number[], number] {
  const out = folder.slice();
  let length = out.length;

  if (length && out[length - 1] !== 0x5c && out[length - 1] !== 0x3a) {
    out.push(0x5c);
    length++;
  }

  return [[...out, ...name], length];
}

/**
 * Whether a file is a module loaded from it (seg3 `113a`): `GetModuleHandle`
 * of its name, and the module's file the path, by `lstrcmpi`.
 */
async function inUse(system: any, path: number[], name: number) {
  const module = (await api(system, 'KERNEL', 'GetModuleHandle', [D(name)])).value & 0xffff;

  if (module <= 1) {
    return 0;
  }

  const file = await api(system, 'KERNEL', 'GetModuleFilename', [
    W(module),
    buffer(0x104),
    W(0x104),
  ]);
  const compared = await api(system, 'USER', 'lstrcmpi', [text(path), text(stringOf(file))]);

  return (compared.value & 0xffff) === 0 ? 1 : 0;
}

/**
 * A file looked for in folders (seg3 `1200`): in each, while there is room
 * for the name, by `OpenFile`'s `OF_EXIST`; then the name alone, where
 * `OpenFile` looks. The folder it was found in -- `OpenFile`'s path to its
 * last backslash, the root's kept, cut to `size` and made ANSI -- and that
 * backslash's place, or nought.
 */
async function findIn(
  system: any,
  file: number,
  size: number,
  folders: number[]
): Promise<[number, number[]]> {
  const name = stringAt(system, file);
  const length = await lstrlen(system, file);
  let first = true;
  let index = 0;

  for (;;) {
    let path: number[];

    if (first && index < folders.length && folders[index]) {
      const folder = folders[index];

      if ((((await lstrlen(system, folder)) + length) & 0xffff) >= 0x103) {
        index++;
        continue;
      }

      path = join(stringAt(system, folder), name)[0];
    } else if (first) {
      first = false;
      path = name;
    } else {
      return [0, []];
    }

    const opened = await api(system, 'KERNEL', 'OpenFile', [
      text(path),
      B(new Array(136).fill(0)),
      W(0x4000),
    ]);

    if ((opened.value & 0xffff) === 0xffff) {
      index++;

      if (!first) {
        return [0, []];
      }

      continue;
    }

    const found = opened.buffers[1].slice(8);
    const end = found.indexOf(0);
    const whole = end < 0 ? found : found.slice(0, end);
    let slash = 0;

    whole.forEach((byte, i) => {
      if (byte === 0x5c) {
        slash = i;
      }
    });

    if (slash <= 3) {
      slash++;
    }

    const cut = size - 1 < slash ? size - 1 : slash;
    const folder = whole.slice(0, Math.max(0, cut));
    const ansi = await api(system, 'KEYBOARD', 'OemToAnsi', [
      text(folder),
      buffer(folder.length + 1),
    ]);

    return [slash, stringOf(ansi, 1)];
  }
}

/** The folders' order for VerFindFile: Windows', then the system's, then the program's for a shared file. */
const VFFF_ISSHAREDFILE = 1;
const VFF_CURNEDEST = 1;
const VFF_FILEINUSE = 2;
const VFF_BUFFTOOSMALL = 4;

/**
 * `VerFindFile` (seg3 `1315`): where a file is, and where it should go.
 * Windows' folder is asked for, whatever `szWinDir` says. The file is
 * looked for in the program's folder, Windows' and the system's -- the
 * program's last for a shared file -- then where `OpenFile` looks. A
 * shared file goes in the system folder where that is inside Windows', in
 * Windows' otherwise; another in the program's folder.
 */
export async function VerFindFile(
  this: any,
  uFlags: number,
  szFileName: number,
  _szWinDir: number,
  szAppDir: number,
  szCurDir: number,
  lpuCurDirLen: number,
  szDestDir: number,
  lpuDestDirLen: number
) {
  const system = this;
  let result = 0;

  return frame(system, 0x210, async (at) => {
    const windows = plus(at, 0);
    const systemDir = plus(at, 0x108);
    const windowsCall = await api(system, 'KERNEL', 'GetWindowsDirectory', [
      buffer(0x104),
      W(0x104),
    ]);

    writeString(system, windows, stringOf(windowsCall));

    const systemCall = await api(system, 'KERNEL', 'GetSystemDirectory', [buffer(0x104), W(0x104)]);

    writeString(
      system,
      systemDir,
      (systemCall.value & 0xffff) === 0 ? stringOf(windowsCall) : stringOf(systemCall)
    );

    const shared = uFlags & VFFF_ISSHAREDFILE;
    const folders = shared ? [windows, systemDir, szAppDir] : [szAppDir, windows, systemDir];
    const [length, found] = await findIn(system, szFileName, 0x104, folders);
    const current = length ? found : [];

    if (rd16(system, lpuCurDirLen) > length) {
      await frame(system, current.length + 2, async (copy) => {
        writeString(system, copy, current);
        await lstrcpy(system, szCurDir, copy);
      });
    } else {
      result |= VFF_BUFFTOOSMALL;
    }

    wr16(system, lpuCurDirLen, length + 1);

    if (szDestDir) {
      let dest: number;
      let destLength: number;

      if (shared) {
        const windowsName = stringAt(system, windows);
        const systemName = stringAt(system, systemDir);
        const n = windowsName.length;
        let chosen = windowsName;

        if (n && windowsName[n - 1] === 0x5c) {
          if (systemName[n - 1] === 0x5c && (await within(system, systemDir, windows, n))) {
            chosen = systemName;
          } else if (systemName[n - 1] !== 0x5c) {
            chosen = [];
          }
        } else if (systemName[n] === 0x5c && (await within(system, systemDir, windows, n))) {
          chosen = systemName;
        }

        destLength = chosen.length;
        dest = 0;
        await frame(system, chosen.length + 2, async (copy) => {
          writeString(system, copy, chosen);
          dest = copy;
          result = await toDest(
            system,
            result,
            dest,
            destLength,
            szDestDir,
            szCurDir,
            lpuDestDirLen
          );
        });
      } else {
        destLength = await lstrlen(system, szAppDir);
        result = await toDest(
          system,
          result,
          szAppDir,
          destLength,
          szDestDir,
          szCurDir,
          lpuDestDirLen
        );
      }
    }

    if (current[0]) {
      const [path] = join(current, stringAt(system, szFileName));

      if (await inUse(system, path, szFileName)) {
        result |= VFF_FILEINUSE;
      }
    }

    return result;
  });
}

/** Whether the system folder's first `n` bytes are Windows' folder, by `lstrcmpi`. */
async function within(system: any, systemDir: number, windows: number, n: number) {
  const at = plus(systemDir, n);
  const kept = rd8(system, at);

  wr8(system, at, 0);

  const compared = await lstrcmpi(system, windows, systemDir);

  wr8(system, at, kept);

  return compared === 0;
}

/** Where a file should go, given back as VerFindFile gives it (seg3 `14ec`). */
async function toDest(
  system: any,
  result: number,
  dest: number,
  length: number,
  szDestDir: number,
  szCurDir: number,
  lpuDestDirLen: number
) {
  if (rd16(system, lpuDestDirLen) > length) {
    await lstrcpy(system, szDestDir, dest);

    const n = await lstrlen(system, szDestDir);

    if (n && rd8(system, plus(szDestDir, n - 1)) === 0x5c) {
      wr8(system, plus(szDestDir, n - 1), 0);
    }

    if ((await lstrcmpi(system, szCurDir, szDestDir)) !== 0) {
      result |= VFF_CURNEDEST;
    }
  } else {
    result |= VFF_BUFFTOOSMALL;
  }

  wr16(system, lpuDestDirLen, length + 1);

  return result;
}

/* VerInstallFile's flags and answers. */
const VIFF_FORCEINSTALL = 1;
const VIFF_DONTDELETEOLD = 2;
const VIF_TEMPFILE = 0x1;
const VIF_MISMATCH = 0x2;
const VIF_SRCOLD = 0x4;
const VIF_DIFFLANG = 0x8;
const VIF_DIFFTYPE = 0x20;
const VIF_WRITEPROT = 0x40;
const VIF_FILEINUSE = 0x80;
const VIF_OUTOFSPACE = 0x100;
const VIF_CANNOTCREATE = 0x800;
const VIF_CANNOTDELETE = 0x1000;
const VIF_CANNOTRENAME = 0x2000;
const VIF_CANNOTDELETECUR = 0x4000;
const VIF_OUTOFMEMORY = 0x8000;
const VIF_CANNOTREADSRC = 0x10000;
const VIF_BUFFTOOSMALL = 0x40000;

/** DOS's error as a VIF flag (seg3 `0b42`): access denied, sharing violation, or none. */
function dosError(code: number) {
  return code === 5 ? 0x200 : code === 0x20 ? 0x400 : 0;
}

/** A DOS call: AX, DS:DX and ES:DI a path each, as given; the carry, AX and CX after. */
async function dos(system: any, ax: number, first: number, second = 0) {
  const core = system.machine.cpu.core;
  const saved = {
    ax: core.ax,
    cx: core.cx,
    dx: core.dx,
    di: core.di,
    ds: core.ds,
    es: core.es,
    carry: core.flags.carry,
  };

  core.ax = ax;
  core.ds = sel(first);
  core.dx = off(first);

  if (second) {
    core.es = sel(second);
    core.di = off(second);
  }

  await api(system, 'KERNEL', 'Dos3Call', []);

  const after = { carry: !!core.flags.carry, ax: core.ax, cx: core.cx };

  core.ax = saved.ax;
  core.cx = saved.cx;
  core.dx = saved.dx;
  core.di = saved.di;
  core.ds = saved.ds;
  core.es = saved.es;
  core.flags.carry = saved.carry;

  return after;
}

/** A path made OEM, on the stack. */
async function oem(system: any, path: number[], body: (at: number) => Promise<any>) {
  return frame(system, 0x104, async (at) => {
    const called = await api(system, 'KEYBOARD', 'AnsiToOem', [text(path), buffer(0x104)]);

    writeString(system, at, stringOf(called, 1));

    return body(at);
  });
}

/** A file's attributes (seg3 `0ac2`, DOS 4300h on its OEM name): the attributes, or null where it is not there. */
async function attributes(system: any, path: number[]) {
  return oem(system, path, async (at) => {
    const called = await dos(system, 0x4300, at);

    return called.carry ? null : called.cx;
  });
}

/** OpenFile's error, as VER keeps it (`[50h]`). */
type Kept = { error: number };

/** A file made, or deleted, by OpenFile (seg3 `0b63`, `0b94`): its answer, its error kept. */
async function openFile(system: any, path: number[], style: number, kept: Kept) {
  const called = await api(system, 'KERNEL', 'OpenFile', [
    text(path),
    B(new Array(136).fill(0)),
    W(style),
  ]);
  const of = called.buffers[1];

  kept.error = of[2] | (of[3] << 8);

  return s16(called.value);
}

/** A file renamed (seg3 `0bd6`, DOS 5600h on the OEM names): DOS's error, or nought. */
async function rename(system: any, from: number[], to: number[], kept: Kept) {
  return oem(system, from, (old) =>
    oem(system, to, async (fresh) => {
      const called = await dos(system, 0x5600, old, fresh);

      kept.error = called.carry ? called.ax : 0;

      return kept.error;
    })
  );
}

/**
 * A file's version information, in a block of memory of its own (seg3
 * `0c34`): asked for in 800h bytes, and again in as many as its block says
 * where that is more. The block's far pointer and handle, or null.
 *
 * VER keeps it in its own local heap; here it is a global block, freed
 * as VER frees its own.
 */
async function versionOf(
  system: any,
  path: number[]
): Promise<{ at: number; handle: number } | null> {
  let size = 0x800;

  for (;;) {
    const handle = (await api(system, 'KERNEL', 'GlobalAlloc', [W(0x42), D(size)])).value & 0xffff;

    if (!handle) {
      return null;
    }

    const at = (await api(system, 'KERNEL', 'GlobalLock', [W(handle)])).value >>> 0;
    const got = await frame(system, path.length + 2, async (name) => {
      writeString(system, name, path);

      return GetFileVersionInfo.call(system, name, 0, size, at);
    });

    if (!got) {
      await api(system, 'KERNEL', 'GlobalFree', [W(handle)]);

      return null;
    }

    if (rd16(system, at) > size) {
      size = rd16(system, at);
      await api(system, 'KERNEL', 'GlobalFree', [W(handle)]);
      continue;
    }

    return { at, handle };
  }
}

/** A version block's `\VarFileInfo\Translation`: its far pointer and its count of languages, or null. */
async function translations(system: any, at: number): Promise<[number, number] | null> {
  return frame(system, 0x30, async (scratch) => {
    const path = plus(scratch, 0);
    const value = plus(scratch, 0x1a);
    const length = plus(scratch, 0x1e);

    writeString(
      system,
      path,
      Array.from('\\VarFileInfo\\Translation', (c) => c.charCodeAt(0))
    );

    if (!(await VerQueryValue.call(system, at, path, value, length))) {
      return null;
    }

    return [rd32(system, value) >>> 0, rd16(system, length) >> 2];
  });
}

/**
 * `VerInstallFile` (seg3 `0c9a`): a file copied, expanded, into a
 * temporary file beside where it goes, compared with what is there, and
 * put in its place.
 */
export async function VerInstallFile(
  this: any,
  uFlags: number,
  szSrcFileName: number,
  szDestFileName: number,
  szSrcDir: number,
  szDestDir: number,
  szCurDir: number,
  szTmpFile: number,
  lpuTmpFileLen: number
) {
  const system = this;
  const kept: Kept = { error: 0 };
  let result = 0;

  const [source] = join(stringAt(system, szSrcDir), stringAt(system, szSrcFileName));
  const sourceHandle = await frame(system, 0x90 + source.length + 2, async (at) => {
    writeString(system, plus(at, 0x90), source);

    return lzOpenFile(system, plus(at, 0x90), at, 0);
  });

  if (sourceHandle < 0) {
    return VIF_CANNOTREADSRC;
  }

  const [dest, folderLength] = join(stringAt(system, szDestDir), stringAt(system, szDestFileName));
  /* The temporary file's path: first the destination's. */
  let temporary = dest.slice();
  const destAttributes = await attributes(system, dest);
  let made = true;

  const finish = async () => {
    await lzClose(system, sourceHandle);

    return result >>> 0;
  };

  const deleteTemporary = async () => {
    await openFile(system, temporary, 0x200, kept);
  };

  if (destAttributes !== null) {
    if (destAttributes & 1) {
      result |= VIF_WRITEPROT;

      return finish();
    }

    if (await inUse(system, dest, szDestFileName)) {
      result |= VIF_FILEINUSE;

      return finish();
    }
  }

  /* A temporary file given, forcing, and there: it is used. */
  if (uFlags & VIFF_FORCEINSTALL && rd8(system, szTmpFile)) {
    temporary = join(stringAt(system, szDestDir), stringAt(system, szTmpFile))[0];

    if ((await attributes(system, temporary)) !== null) {
      made = false;
    }
  }

  if (made) {
    temporary = [...dest.slice(0, folderLength), ...Array.from('temp.', (c) => c.charCodeAt(0))];

    for (let i = 0; ; i++) {
      const digits = [8, 4, 0].map((shift) => {
        const digit = (i >> shift) & 0xf;

        return digit < 10 ? 0x30 + digit : 0x37 + digit;
      });

      temporary = [...temporary.slice(0, folderLength + 5), ...digits];

      if ((await attributes(system, temporary)) === null) {
        break;
      }

      if (i > 0xfff) {
        result |= VIF_CANNOTCREATE;

        return finish();
      }
    }

    const handle = await openFile(system, temporary, 0x1000, kept);

    if (handle < 0) {
      result |= dosError(kept.error) | VIF_CANNOTCREATE;

      return finish();
    }

    const copied = await lzCopy(system, sourceHandle, handle);

    await api(system, 'KERNEL', '_lclose', [W(handle)]);

    if (copied < 0 && copied >= -8) {
      const failed = [
        VIF_CANNOTREADSRC,
        VIF_OUTOFSPACE,
        VIF_CANNOTREADSRC,
        VIF_OUTOFSPACE,
        VIF_OUTOFMEMORY,
        VIF_OUTOFMEMORY,
        VIF_CANNOTREADSRC,
        VIF_CANNOTREADSRC,
      ][-copied - 1];

      result |= failed;
      await deleteTemporary();

      return finish();
    }
  }

  if (destAttributes !== null) {
    if (!(uFlags & VIFF_FORCEINSTALL)) {
      result |= await compare(system, dest, temporary);
    }

    if (!result) {
      /* The installed file deleted. */
      if ((await openFile(system, dest, 0x200, kept)) < 0) {
        result |= dosError(kept.error) | VIF_CANNOTDELETE;
        await deleteTemporary();

        return finish();
      }
    }
  }

  if (result) {
    /* Left in the temporary file: its name given back, where there is room. */
    const name = temporary.slice(folderLength);

    if (name.length < rd16(system, lpuTmpFileLen)) {
      writeString(system, szTmpFile, name);
      result |= VIF_TEMPFILE;
    } else {
      result |= VIF_BUFFTOOSMALL;
      await deleteTemporary();
    }

    wr16(system, lpuTmpFileLen, name.length + 1);

    return finish();
  }

  /* The copy where it was found before, deleted. */
  if (
    !(uFlags & VIFF_DONTDELETEOLD) &&
    szCurDir &&
    rd8(system, szCurDir) &&
    (await lstrcmpi(system, szCurDir, szDestDir)) !== 0
  ) {
    const [old] = join(stringAt(system, szCurDir), stringAt(system, szDestFileName));

    kept.error = 0;

    if ((await attributes(system, old)) !== null) {
      if (await inUse(system, old, szDestFileName)) {
        result |= dosError(kept.error) | VIF_CANNOTDELETECUR;
      } else if ((await openFile(system, old, 0x200, kept)) < 0) {
        result |= dosError(kept.error) | VIF_CANNOTDELETECUR;
      }
    }
  }

  if (await rename(system, temporary, dest, kept)) {
    result |= dosError(kept.error) | VIF_CANNOTRENAME;
    await deleteTemporary();
  }

  return finish();
}

/**
 * The installed file's version and the new one's compared (seg3 `0e72`):
 * an installed version later than the new one's is `VIF_SRCOLD`; another
 * type or subtype `VIF_DIFFTYPE`; a language of the installed one's that
 * the new one lacks `VIF_DIFFLANG` -- an installed code page of nought
 * agreeing with any but 1200 -- each with `VIF_MISMATCH`. New information
 * not to be read is `VIF_SRCOLD`; installed information not to be read is
 * no difference.
 */
async function compare(system: any, dest: number[], temporary: number[]) {
  let result = 0;
  const installed = await versionOf(system, dest);

  if (!installed) {
    return 0;
  }

  const fresh = await versionOf(system, temporary);

  if (!fresh) {
    await api(system, 'KERNEL', 'GlobalFree', [W(installed.handle)]);

    return VIF_MISMATCH | VIF_SRCOLD;
  }

  const was = (at: number) => rd32(system, plus(installed.at, at)) >>> 0;
  const is = (at: number) => rd32(system, plus(fresh.at, at)) >>> 0;

  if (was(0x1c) > is(0x1c) || (was(0x1c) === is(0x1c) && was(0x20) > is(0x20))) {
    result |= VIF_MISMATCH | VIF_SRCOLD;
  }

  if (was(0x38) !== is(0x38) || was(0x3c) !== is(0x3c)) {
    result |= VIF_MISMATCH | VIF_DIFFTYPE;
  }

  const old = await translations(system, installed.at);
  const now = old ? await translations(system, fresh.at) : null;

  if (old && now) {
    const [oldAt, oldCount] = old;
    const [newAt, newCount] = now;

    for (let i = 0; i < oldCount; i++) {
      const language = rd16(system, plus(oldAt, 4 * i));
      const page = rd16(system, plus(oldAt, 4 * i + 2));
      let found = false;

      for (let j = 0; j < newCount; j++) {
        if (rd16(system, plus(newAt, 4 * j)) !== language) {
          continue;
        }

        const newPage = rd16(system, plus(newAt, 4 * j + 2));

        if ((page === 0 && newPage !== 0x4b0) || page === newPage) {
          found = true;
          break;
        }
      }

      if (!found) {
        result |= VIF_MISMATCH | VIF_DIFFLANG;
      }
    }
  }

  await api(system, 'KERNEL', 'GlobalFree', [W(fresh.handle)]);
  await api(system, 'KERNEL', 'GlobalFree', [W(installed.handle)]);

  return result;
}

/** VER's exit procedure (seg1 `0000`): 1. */
export function WEP(this: any) {
  return 1;
}
