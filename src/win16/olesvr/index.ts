'use strict';

/** @namespace OleSvr */

import { Module } from '../module.js';
import { segmentSelector } from '../selectors.js';
import { DWORD, INT, UINT } from '../types.js';
import { NAME, PATH, SERVER_VERSION, Svr } from './core.js';
import * as server from './server.js';

/**
 * `OLESVR`, OLE 1.0's server library, as WinBox's own: written from OLE
 * 1.0's documented interface and protocol and from the probe `olesrv`,
 * not from the code of `OLESVR.DLL` (`kb/topics/ole.md`). As
 * `crates/winbox-win16/src/olesvr/`.
 *
 * Kept as `OLECLI` is (`own-modules.ts`): with `OLESVR.DLL` on the drive,
 * a program that imports it gets the file's library, and each import of
 * an export answered here is linked to WinBox's stub, as `GetProcAddress`
 * answers it; with none, WinBox's is found by its file's name. It is kept
 * only once a program loads it.
 *
 * The ordinals and names are the file's entry table's: its API (2-12),
 * its windows' procedures (21-23), and the procedures it hands USER and
 * the `OLECLIENT` it gives a server's object (24-32): `ITEMCALLBACK` is
 * that client's method, and the others are what it hands `EnumProps` and
 * `EnumChildWindows` to walk the clients it keeps on its windows, which
 * WinBox's hands them too. 32, unnamed, is a timer's procedure WinBox's
 * sets no timer for.
 *
 * @memberof Win16
 */

/** Each entry: its ordinal, its name in the file, the bytes of arguments its `RETF` pops (read out of the file, `scripts/oracle/argument-sizes.mjs`). */
const ENTRIES: [number, string | null, number][] = [
  [1, 'WEP', 2],
  [2, 'OLEREGISTERSERVER', 16],
  [3, 'OLEREVOKESERVER', 4],
  [4, 'OLEBLOCKSERVER', 4],
  [5, 'OLEUNBLOCKSERVER', 8],
  [6, 'OLEREGISTERSERVERDOC', 16],
  [7, 'OLEREVOKESERVERDOC', 4],
  [8, 'OLERENAMESERVERDOC', 8],
  [9, 'OLEREVERTSERVERDOC', 4],
  [10, 'OLESAVEDSERVERDOC', 4],
  [11, 'OLEREVOKEOBJECT', 4],
  [12, 'OLEQUERYSERVERVERSION', 0],
  [21, 'SRVRWNDPROC', 10],
  [22, 'DOCWNDPROC', 10],
  [23, 'ITEMWNDPROC', 10],
  [24, 'SENDDATAMSG', 8],
  [25, 'FINDITEMWND', 6],
  [26, 'ITEMCALLBACK', 10],
  [27, 'TERMINATECLIENTS', 8],
  [28, 'TERMINATEDOCCLIENTS', 8],
  [29, 'DELETECLIENTINFO', 8],
  [30, 'SENDRENAMEMSG', 8],
  [31, 'ENUMFORTERMINATE', 8],
  [32, null, 10],
];

const PTR = DWORD;
const WM_DESTROY = 0x0002;

/** The API's functions, by the file's name: the function, the name WinBox's table gives it, its arguments and its answer. */
const API: Record<string, [(svr: Svr, ...args: number[]) => any, string, number[], number]> = {
  OLEREGISTERSERVER: [
    (s, klass, srv, out, instance, use) => server.registerServer(s, klass, srv, out, instance, use),
    'OleRegisterServer',
    [PTR, PTR, PTR, UINT, UINT],
    UINT,
  ],
  OLEREVOKESERVER: [(s, lh) => server.revokeServer(s, lh), 'OleRevokeServer', [DWORD], UINT],
  OLEBLOCKSERVER: [(s, lh) => server.blockServer(s, lh), 'OleBlockServer', [DWORD], UINT],
  OLEUNBLOCKSERVER: [
    (s, lh, out) => server.unblockServer(s, lh, out),
    'OleUnblockServer',
    [DWORD, PTR],
    UINT,
  ],
  OLEREGISTERSERVERDOC: [
    (s, lh, name, doc, out) => server.registerServerDoc(s, lh, name, doc, out),
    'OleRegisterServerDoc',
    [DWORD, PTR, PTR, PTR],
    UINT,
  ],
  OLEREVOKESERVERDOC: [
    (s, lh) => server.revokeServerDoc(s, lh),
    'OleRevokeServerDoc',
    [DWORD],
    UINT,
  ],
  OLERENAMESERVERDOC: [
    (s, lh, name) => server.renameServerDoc(s, lh, name),
    'OleRenameServerDoc',
    [DWORD, PTR],
    UINT,
  ],
  OLEREVERTSERVERDOC: [
    (s, lh) => server.revertServerDoc(s, lh),
    'OleRevertServerDoc',
    [DWORD],
    UINT,
  ],
  OLESAVEDSERVERDOC: [(s, lh) => server.savedServerDoc(s, lh), 'OleSavedServerDoc', [DWORD], UINT],
  OLEREVOKEOBJECT: [(s, client) => server.revokeObject(s, client), 'OleRevokeObject', [PTR], UINT],
  OLEQUERYSERVERVERSION: [() => SERVER_VERSION, 'OleQueryServerVersion', [], DWORD],
  SRVRWNDPROC: [
    (s, hwnd, message, wParam, lParam) => server.srvrWndProc(s, hwnd, message, wParam, lParam),
    'SRVRWNDPROC',
    [UINT, UINT, UINT, DWORD],
    DWORD,
  ],
  DOCWNDPROC: [
    (s, hwnd, message, wParam, lParam) => server.docWndProc(s, hwnd, message, wParam, lParam),
    'DOCWNDPROC',
    [UINT, UINT, UINT, DWORD],
    DWORD,
  ],
  /* An item's window holds its clients and takes no message of its own:
   * `WM_DESTROY` answered nought, anything else `DefWindowProc`'s (read
   * out, seg3 `23b2`-`23f4`). */
  ITEMWNDPROC: [
    (s, hwnd, message, wParam, lParam) =>
      message === WM_DESTROY
        ? 0
        : s.user('DefWindowProc', [
            { w: hwnd },
            { w: message },
            { w: wParam },
            { d: lParam >>> 0 },
          ]),
    'ITEMWNDPROC',
    [UINT, UINT, UINT, DWORD],
    DWORD,
  ],
  SENDDATAMSG: [
    (s, hwnd, name, info) => server.sendDataMsg(s, hwnd, name, info),
    'SENDDATAMSG',
    [UINT, PTR, UINT],
    INT,
  ],
  FINDITEMWND: [
    (s, hwnd, lParam) => server.findItemWnd(s, hwnd, lParam),
    'FINDITEMWND',
    [UINT, DWORD],
    INT,
  ],
  TERMINATECLIENTS: [
    (s, hwnd, name, client) => server.terminateClients(s, hwnd, name, client),
    'TERMINATECLIENTS',
    [UINT, PTR, UINT],
    INT,
  ],
  TERMINATEDOCCLIENTS: [
    (s, hwnd, name, client) => server.terminateClients(s, hwnd, name, client),
    'TERMINATEDOCCLIENTS',
    [UINT, PTR, UINT],
    INT,
  ],
  DELETECLIENTINFO: [
    (s, hwnd, name, info) => server.deleteClientInfo(s, hwnd, name, info),
    'DELETECLIENTINFO',
    [UINT, PTR, UINT],
    INT,
  ],
  SENDRENAMEMSG: [
    (s, hwnd, name, info) => server.sendRenameMsg(s, hwnd, name, info),
    'SENDRENAMEMSG',
    [UINT, PTR, UINT],
    INT,
  ],
  ENUMFORTERMINATE: [
    (s, hwnd, name, client) => server.enumForTerminate(s, hwnd, name, client),
    'ENUMFORTERMINATE',
    [UINT, PTR, UINT],
    INT,
  ],
  ITEMCALLBACK: [
    (s, client, what, object) => server.itemCallback(s, client, what, object),
    'ITEMCALLBACK',
    [PTR, UINT, PTR],
    INT,
  ],
};

/** The far address of one of WinBox's `OLESVR`'s exports: its stub. */
function exportAddress(system: any, ordinal: number): number {
  const info = system._modules.load(OleSvr).lookup(ordinal);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
}

/** An export that does first what `OLESVR`'s file does as it loads (`server.ts`'s `start`). Its name kept. */
function ready(implementation: (svr: Svr, ...args: number[]) => any, name: string) {
  return {
    async [name](this: any, ...args: number[]) {
      const svr = new Svr(this);

      await server.start(
        svr,
        (ordinal) => exportAddress(this, ordinal),
        this._modules.instanceFromPath(PATH) ?? 0
      );
      return implementation(svr, ...args);
    },
  }[name];
}

/** `WEP`: 1, as a library's is. */
function WEP() {
  return 1;
}

let table: any[] | null = null;

export class OleSvr extends Module {
  static get name(): string {
    return NAME;
  }

  static get path() {
    return PATH;
  }

  /** Its table, made once; an entry WinBox does not answer is its stub. */
  static get exports() {
    if (table) {
      return table;
    }

    const made: any[] = [null];

    for (const [ordinal, fileName, pops] of ENTRIES) {
      const declared = fileName ? API[fileName] : undefined;

      if (declared) {
        made[ordinal] = [
          ready(declared[0], declared[1]),
          declared[1],
          pops,
          declared[2],
          declared[3],
        ];
      } else if (ordinal === 1) {
        made[ordinal] = [WEP, 'WEP', pops, [INT], INT];
      } else {
        made[ordinal] = [OleSvr.stub, fileName ?? 'Unknown', pops];
      }
    }

    table = made;
    return table;
  }

  static stub() {
    console.log('Stub called!');
  }
}
