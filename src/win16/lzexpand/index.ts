'use strict';

/** @namespace LzExpand */

import { Module } from '../module.js';
import { FARPTR, INT, LONG, UINT } from '../types.js';
import {
  getExpandedName,
  lzClose,
  lzCopy,
  lzDone,
  lzInit,
  lzOpenFile,
  lzRead,
  lzSeek,
  lzStart,
} from './lz.js';

/**
 * `LZEXPAND`, the expansion of files `COMPRESS` made, as WinBox's own
 * (`lz.ts`). As `crates/winbox-win16/src/lzexpand/`.
 *
 * It is kept as `COMMDLG` is (`commdlg/index.ts`, `own-modules.ts`): with
 * `LZEXPAND.DLL` on the drive, a program that imports it gets the file's
 * library, and each import of an export answered here is linked to
 * WinBox's stub; with none, WinBox's stubs throughout.
 *
 * The ordinals and names are `LZEXPAND.DLL`'s entry table's; 13 on are
 * entries of its own far calls, not exported: its file names (13, 14),
 * the header (15, 16), a handle's state (17-19), the decoder (20), the
 * copier (21), the copying buffers (22, 23), opening by name (24), the
 * file's time (25, 28, 29), writing out and reading in (26, 27), and the C
 * library's (30).
 */
export class LzExpand extends Module {
  static get name(): string {
    return 'LZEXPAND';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\LZEXPAND.DLL';
  }

  static get exports() {
    const internal = Array.from({ length: 18 }, () => [LzExpand.stub, 'Unknown', 0]);

    return [
      // 0 // "Windows file expansion library"
      null,
      [LZCopy, 'LZCopy', 4, [INT, INT], LONG],
      [LZOpenFile, 'LZOpenFile', 10, [FARPTR, FARPTR, UINT], INT],
      [LZInit, 'LZInit', 2, [INT], INT],
      [LZSeek, 'LZSeek', 8, [INT, LONG, INT], LONG],
      [LZRead, 'LZRead', 8, [INT, FARPTR, INT], INT],
      [LZClose, 'LZClose', 2, [INT]],
      [LZStart, 'LZStart', 0, [], INT],
      [CopyLZFile, 'CopyLZFile', 4, [INT, INT], LONG],
      [LZDone, 'LZDone', 0, []],
      // 10 //
      [GetExpandedName, 'GetExpandedName', 8, [FARPTR, FARPTR], INT],
      [WEP, 'WEP', 2, [INT]],
      [ExportedStub, '___EXPORTEDSTUB', 0, [], INT],
      ...internal,
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}

async function LZCopy(this: any, hfSource: number, hfDest: number) {
  return lzCopy(this, hfSource, hfDest);
}

/** `CopyLZFile` (seg4 `013a`): `LZCopy`, called. */
async function CopyLZFile(this: any, hfSource: number, hfDest: number) {
  return lzCopy(this, hfSource, hfDest);
}

async function LZOpenFile(this: any, lpszFile: number, lpOf: number, style: number) {
  return lzOpenFile(this, lpszFile >>> 0, lpOf >>> 0, style);
}

async function LZInit(this: any, hfSrc: number) {
  return lzInit(this, hfSrc);
}

async function LZSeek(this: any, hFile: number, lOffset: number, nOrigin: number) {
  return lzSeek(this, hFile, lOffset, nOrigin);
}

async function LZRead(this: any, hFile: number, lpBuffer: number, cbRead: number) {
  return lzRead(this, hFile, lpBuffer >>> 0, cbRead);
}

async function LZClose(this: any, hFile: number) {
  await lzClose(this, hFile);
}

async function LZStart(this: any) {
  return lzStart(this);
}

async function LZDone(this: any) {
  await lzDone(this);
}

async function GetExpandedName(this: any, lpszSource: number, lpszBuffer: number) {
  return getExpandedName(this, lpszSource >>> 0, lpszBuffer >>> 0);
}

/** `LZEXPAND`'s exit procedure (seg3 `0000`): it does nothing. */
function WEP(this: any) {}

/** `___EXPORTEDSTUB` (seg11 `035e`): nought. */
function ExportedStub(this: any) {
  return 0;
}
