'use strict';

/** @namespace Ddeml */

import { Module } from '../module.js';
import { registerDdeml } from './core.js';
import { BOOL, DWORD, FARPTR, HWND, INT, LPARAM, LRESULT, UINT, WPARAM } from '../types.js';
import {
  CLIENTWNDPROC,
  CONVLISTWNDPROC,
  DDEPOSTHOOKPROC,
  DDESENDHOOKPROC,
  DMGWNDPROC,
  DdeAbandonTransaction,
  DdeAccessData,
  DdeAddData,
  DdeClientTransaction,
  DdeCmpStringHandles,
  DdeConnect,
  DdeConnectList,
  DdeCreateDataHandle,
  DdeCreateStringHandle,
  DdeDisconnect,
  DdeDisconnectList,
  DdeEnableCallback,
  DdeFreeDataHandle,
  DdeFreeStringHandle,
  DdeGetData,
  DdeGetLastError,
  DdeInitialize,
  DdeKeepStringHandle,
  DdeNameService,
  DdePostAdvise,
  DdeQueryConvInfo,
  DdeQueryNextServer,
  DdeQueryString,
  DdeReconnect,
  DdeSetUserHandle,
  DdeUnaccessData,
  DdeUninitialize,
  INITENUM,
  MONITORWNDPROC,
  SERVERWNDPROC,
  SUBFRAMEWNDPROC,
  TERMDLGPROC,
  WEP,
} from './exports.js';

/**
 * `DDEML`, the DDE Management Library, as WinBox's own: every routine of
 * `DDEML.DLL` followed as it is read out (`kb/ddeml`). As
 * `crates/winbox-win16/src/ddeml/`.
 *
 * It is kept as `COMMDLG`, `VER` and `LZEXPAND` are (`own-modules.ts`): with
 * `DDEML.DLL` on the drive, a program that imports it gets the file's
 * library, and each import of an export answered here is linked to
 * WinBox's stub; with none, the program links to WinBox's stubs
 * throughout, and `LoadLibrary` finds it by its file's name.
 *
 * The ordinals and names are `DDEML.DLL`'s entry table's, spelled as the
 * knowledge base's pages spell them; 25 it has no entry for.
 *
 * @memberof Win16
 */
export class Ddeml extends Module {
  static get name(): string {
    return 'DDEML';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\DDEML.DLL';
  }

  static get exports() {
    const PROC = [HWND, UINT, WPARAM, LPARAM];

    return [
      // 0 // "DDE Management library"
      null,
      [WEP, 'WEP', 2, [INT], INT],
      [DdeInitialize, 'DdeInitialize', 16, [FARPTR, FARPTR, DWORD, DWORD], UINT],
      [DdeUninitialize, 'DdeUninitialize', 4, [DWORD], BOOL],
      [DdeConnectList, 'DdeConnectList', 20, [DWORD, DWORD, DWORD, DWORD, FARPTR], DWORD],
      [DdeQueryNextServer, 'DdeQueryNextServer', 8, [DWORD, DWORD], DWORD],
      [DdeDisconnectList, 'DdeDisconnectList', 4, [DWORD], BOOL],
      [DdeConnect, 'DdeConnect', 16, [DWORD, DWORD, DWORD, FARPTR], DWORD],
      [DdeDisconnect, 'DdeDisconnect', 4, [DWORD], BOOL],
      [DdeQueryConvInfo, 'DdeQueryConvInfo', 12, [DWORD, DWORD, FARPTR], UINT],
      // 10 //
      [DdeSetUserHandle, 'DdeSetUserHandle', 12, [DWORD, DWORD, DWORD], BOOL],
      [
        DdeClientTransaction,
        'DdeClientTransaction',
        28,
        [FARPTR, DWORD, DWORD, DWORD, UINT, UINT, DWORD, FARPTR],
        DWORD,
      ],
      [DdeAbandonTransaction, 'DdeAbandonTransaction', 12, [DWORD, DWORD, DWORD], BOOL],
      [DdePostAdvise, 'DdePostAdvise', 12, [DWORD, DWORD, DWORD], BOOL],
      [
        DdeCreateDataHandle,
        'DdeCreateDataHandle',
        24,
        [DWORD, FARPTR, DWORD, DWORD, DWORD, UINT, UINT],
        DWORD,
      ],
      [DdeAddData, 'DdeAddData', 16, [DWORD, FARPTR, DWORD, DWORD], DWORD],
      [DdeGetData, 'DdeGetData', 16, [DWORD, FARPTR, DWORD, DWORD], DWORD],
      [DdeAccessData, 'DdeAccessData', 8, [DWORD, FARPTR], DWORD],
      [DdeUnaccessData, 'DdeUnaccessData', 4, [DWORD], BOOL],
      [DdeFreeDataHandle, 'DdeFreeDataHandle', 4, [DWORD], BOOL],
      // 20 //
      [DdeGetLastError, 'DdeGetLastError', 4, [DWORD], UINT],
      [DdeCreateStringHandle, 'DdeCreateStringHandle', 10, [DWORD, FARPTR, INT], DWORD],
      [DdeFreeStringHandle, 'DdeFreeStringHandle', 8, [DWORD, DWORD], BOOL],
      [DdeQueryString, 'DdeQueryString', 18, [DWORD, DWORD, FARPTR, DWORD, INT], DWORD],
      [DdeKeepStringHandle, 'DdeKeepStringHandle', 8, [DWORD, DWORD], BOOL],
      null,
      [DdeEnableCallback, 'DdeEnableCallback', 10, [DWORD, DWORD, UINT], BOOL],
      [DdeNameService, 'DdeNameService', 14, [DWORD, DWORD, DWORD, UINT], DWORD],
      [CLIENTWNDPROC, 'CLIENTWNDPROC', 10, PROC, LRESULT],
      [SERVERWNDPROC, 'SERVERWNDPROC', 10, PROC, LRESULT],
      // 30 //
      [SUBFRAMEWNDPROC, 'SUBFRAMEWNDPROC', 10, PROC, LRESULT],
      [DMGWNDPROC, 'DMGWNDPROC', 10, PROC, LRESULT],
      [CONVLISTWNDPROC, 'CONVLISTWNDPROC', 10, PROC, LRESULT],
      [MONITORWNDPROC, 'MONITORWNDPROC', 10, PROC, LRESULT],
      [DDESENDHOOKPROC, 'DDESENDHOOKPROC', 8, [INT, WPARAM, LPARAM], LRESULT],
      [DDEPOSTHOOKPROC, 'DDEPOSTHOOKPROC', 8, [INT, WPARAM, LPARAM], LRESULT],
      [DdeCmpStringHandles, 'DdeCmpStringHandles', 8, [DWORD, DWORD], INT],
      [DdeReconnect, 'DdeReconnect', 4, [DWORD], DWORD],
      [INITENUM, 'INITENUM', 6, [HWND, LPARAM], BOOL],
      [TERMDLGPROC, 'TERMDLGPROC', 10, PROC, LRESULT],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}

registerDdeml(Ddeml);
