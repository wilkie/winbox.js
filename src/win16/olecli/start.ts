'use strict';

import { B, text } from '../commdlg/api.js';
import { LOGPIXELSX, LOGPIXELSY, Ole, bytesOf } from './core.js';

/**
 * What `OLECLI` does as it is loaded, as its calls into USER, GDI and KERNEL
 * show it doing (each call it makes, logged with its arguments as WinBox
 * runs `OLECLI.DLL` from the drive): the seven clipboard formats of OLE's
 * protocol registered, its two window classes, and the atoms of the names
 * its conversations and streams use. As `crates/winbox-win16/src/olecli/start.rs`.
 */

/** The formats, in the order registered: `cfObjectLink`, `cfLink`, `cfOwnerLink`, `cfNative`, `cfBinary`, `cfFileName`, `cfNetworkName`. */
export const FORMATS = [
  'ObjectLink',
  'Link',
  'OwnerLink',
  'Native',
  'Binary',
  'FileName',
  'NetworkName',
];

/** The atoms, in the order added. */
export const ATOMS = [
  'ole',
  'StdDocumentName',
  'Save',
  'Change',
  'Close',
  'System',
  'OLEsystem',
  'Package',
  'MSDraw',
  'Clipboard',
  'METAFILEPICT',
  'DIB',
  'BITMAP',
];

/** The window classes: a document's conversations' and a server's, four bytes of window words each, style nought. */
export const CLASSES = [
  { name: 'OleDocWndClass', ordinal: 100 },
  { name: 'OleSrvrWndClass', ordinal: 101 },
];

/** A `WNDCLASS`'s bytes. */
function wndclass(procedure: number, instance: number, name: number) {
  const words = [
    0,
    procedure & 0xffff,
    procedure >>> 16,
    0,
    4,
    instance,
    0,
    0,
    0,
    0,
    0,
    name & 0xffff,
    name >>> 16,
  ];

  return words.flatMap((word) => [word & 0xff, (word >> 8) & 0xff]);
}

/**
 * The registrations made, once a session: the formats, the classes with
 * WinBox's procedures and its instance, the atoms. `address` gives the far
 * address of one of `OLECLI`'s exports; `instance` is its instance.
 */
export async function start(ole: Ole, address: (ordinal: number) => number, instance: number) {
  const state = ole.state();

  if (state.started) {
    return;
  }

  state.started = true;

  for (const name of FORMATS) {
    state.formats[name] =
      (await ole.user('RegisterClipboardFormat', [text(bytesOf(name))])) & 0xffff;
  }

  for (const kind of CLASSES) {
    const at = ole.near(0x0a00);

    ole.write(at, [...bytesOf(kind.name), 0]);
    await ole.user('RegisterClass', [B(wndclass(address(kind.ordinal), instance, at))]);
  }

  for (const name of ATOMS) {
    state.atoms[name] = await ole.addAtomText(bytesOf(name));
  }

  /* The screen's resolution asked for, each way, as the file asks. */
  const dc = await ole.getDC();

  for (const index of [LOGPIXELSX, LOGPIXELSY]) {
    await ole.mulDiv(0x7fff, await ole.deviceCaps(dc, index), 2540);
  }

  await ole.releaseDC(dc);
}
