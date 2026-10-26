'use strict';

/**
 * DDEML's data and its dialog as WinBox keeps them: no Windows file is
 * shipped, and none of Windows' bytes is copied here. The data segment is
 * laid out field by field from named constants (the names, the table, the
 * default parameters), each at the offset `DDEML.DLL`'s data segment (seg3,
 * 604 bytes) has it, each with the code that reads it; the dialog
 * `TERMDIALOG` is laid out from its controls. Where `DDEML.DLL` is on disk
 * `test/win16/ddeml_resources_test.ts` builds both and compares them with
 * the file's. As `crates/winbox-win16/src/ddeml/resources.rs`.
 */

import {
  D_CLASS_CLIENT,
  D_CLASS_DMG,
  D_CLASS_FRAME,
  D_CLASS_HOLDING,
  D_CLASS_MONITOR,
  D_CLASS_SERVER,
  D_CONTEXT,
  D_TEXT_30000,
  D_TEXT_3000,
  D_TEXT_DDEML,
  D_TEXT_PROGMAN,
  D_TEXT_RETRY,
  D_TEXT_SHUTDOWN,
  D_WHO,
  D_XPARAMS,
} from './core.js';

/** The size of `DDEML.DLL`'s data segment (seg3): its initialized data, and the fields set as it runs. */
export const DATA_SIZE = 604;

/**
 * Where the data segment's selector is relocated in (`DDEML.DLL`'s one
 * relocation of seg3): the segment half of the far pointer the default
 * transaction parameters hold to their result.
 */
export const XPARAMS_SELECTOR_AT = 0x170;

/**
 * What the file holds there until the loader relocates it: FFFFh, the end of
 * the relocation's chain of fix-ups.
 */
const XPARAMS_SELECTOR_UNRELOCATED = 0xffff;

// The words the data segment starts with, as a Windows data segment has
// them. Nothing in DDEML.DLL's code addresses ds:0004 or ds:0014 (seg1 and
// seg2 read out for both); they are kept as the file has them.
const HEADER_WORD_4 = 5;
const HEADER_WORD_14 = 1;

/** `D_SERIAL` (0024h) starts at 1; it numbers instances, conversations and lists (`55af`'s callers, `0232`, `579b`, `69dd`). */
const D_SERIAL_START = 1;
const SERIAL_AT = 0x24;

/**
 * The default `CONVCONTEXT` (0026h, 16 bytes: `cb`, `wFlags`, `wCountryID`,
 * `iCodePage`, `dwLangID`, `dwSecurity`), given to a conversation made with
 * none (`6af4`, `6db6`; `DdeConnect` copies it, `conv.ts` `D_CONTEXT`).
 */
const CONTEXT_CB = 0x10;
const CONTEXT_CODE_PAGE = 1004; // CP_WINANSI
const CONTEXT_CB_AT = D_CONTEXT;
const CONTEXT_CODE_PAGE_AT = D_CONTEXT + 6;

/**
 * The windows' class names. `RegisterClass` is given them (`62e0`-`63a5`,
 * `630a` and on), `CreateWindow` the same offsets with the empty name at
 * 0036h (`0271`, `02b2`, `0322`, `073f`, `6a71`, `6f86`, `6fc5`, `7203`).
 * `DMGHeapWatchClass`, 0092h, is in no instruction of seg1 or seg2.
 */
const CLASS_NAMES: ReadonlyArray<readonly [number, string]> = [
  [D_CLASS_FRAME, 'DMGFrame'],
  [D_CLASS_DMG, 'DMGClass'],
  [D_CLASS_CLIENT, 'DMGClientClass'],
  [D_CLASS_SERVER, 'DMGServerClass'],
  [D_CLASS_MONITOR, 'DMGMonitorClass'],
  [D_CLASS_HOLDING, 'DMGHoldingClass'],
  [0x92, 'DMGHeapWatchClass'],
];

// The callback filter: the `CBF_` flag that keeps each transaction type away,
// by the type's number, (`XTYP_*` & 0F0h) >> 4, a doubleword each from 00A6h
// (`5838`-`5846`, the client's own check `129a`-`12c2`). The types with no
// flag are nought.
const CBF_FAIL_CONNECTIONS = 0x2000;
const CBF_FAIL_ADVISES = 0x4000;
const CBF_FAIL_EXECUTES = 0x8000;
const CBF_FAIL_POKES = 0x10000;
const CBF_FAIL_REQUESTS = 0x20000;
const CBF_SKIP_CONNECT_CONFIRMS = 0x40000;
const CBF_SKIP_REGISTRATIONS = 0x80000;
const CBF_SKIP_UNREGISTRATIONS = 0x100000;
const CBF_SKIP_DISCONNECTS = 0x200000;

const FILTER_AT = 0xa6;

/** The type number (`XTYP_*` >> 4 & 0Fh) and its flag. */
const FILTER: ReadonlyArray<readonly [number, number]> = [
  [0x3, CBF_FAIL_ADVISES], // XTYP_ADVSTART 1030h
  [0x5, CBF_FAIL_EXECUTES], // XTYP_EXECUTE 4050h
  [0x6, CBF_FAIL_CONNECTIONS], // XTYP_CONNECT 1060h
  [0x7, CBF_SKIP_CONNECT_CONFIRMS], // XTYP_CONNECT_CONFIRM 8070h
  [0x9, CBF_FAIL_POKES], // XTYP_POKE 4090h
  [0xa, CBF_SKIP_REGISTRATIONS], // XTYP_REGISTER 80A0h
  [0xb, CBF_FAIL_REQUESTS], // XTYP_REQUEST 20B0h
  [0xc, CBF_SKIP_DISCONNECTS], // XTYP_DISCONNECT 80C0h
  [0xd, CBF_SKIP_UNREGISTRATIONS], // XTYP_UNREGISTER 80D0h
  [0xe, CBF_FAIL_CONNECTIONS], // XTYP_WILDCONNECT 20E0h
];

/**
 * The profile's strings: `GetProfileString` of `ShutdownTimeout` and
 * `ShutdownRetryTimeout` in the `DDEML` section, with the defaults `3000`
 * and `30000` (`00bf`-`0135`, `profileTimeout`), and the name `Progman`
 * whose atom the first `DdeInitialize` adds (`0135`).
 */
const PROFILE_TEXT: ReadonlyArray<readonly [number, string]> = [
  [D_TEXT_3000, '3000'],
  [D_TEXT_SHUTDOWN, 'ShutdownTimeout'],
  [D_TEXT_DDEML, 'DDEML'],
  [D_TEXT_30000, '30000'],
  [D_TEXT_RETRY, 'ShutdownRetryTimeout'],
  [0x11c, 'DDEML'], // the section again, the retry timeout's (`00fa`)
  [D_TEXT_PROGMAN, 'Progman'],
];

/** `TermDialog`, the dialog's name for `DialogBox` (`04b6`). */
const TEXT_TERM_DIALOG = 'TermDialog';
const TEXT_TERM_DIALOG_AT = 0x12a;

/** A format string, `:(%04x)`, `wsprintf`'s (`2f05`). */
const TEXT_HANDLE_FORMAT = ':(%04x)';
const TEXT_HANDLE_FORMAT_AT = 0x136;

/**
 * DDEML's signature, 13Eh to 168h: three strings, `Who` and `Made me?` --
 * the atoms `D_WHO` and `D_MADE_ME` become -- and the answer to the one
 * request DDEML answers itself, `Made me?` of `Who` (`5860`-`587e`, handed
 * out as `D_TEXT_STAAB`).
 *
 * It is kept scrambled, as the first `DdeInitialize` unscrambles it in
 * place (`5990`-`59ad`): every byte from 13Eh up to the first nought byte
 * has 25h exclusive-or-ed on, so each string's own terminator is stored as
 * 25h, and the one real nought ends the blob (and the unscrambling).
 */
const SIGNATURE_KEY = 0x25;
const SIGNATURE_STRINGS = ['Who', 'Made me?', 'DDEML - By Sanford Alyn Staab'];

/** The signature as stored: the strings, each with its terminator, with every byte scrambled, and the blob's end. */
export function scrambledSignature(): number[] {
  const bytes: number[] = [];

  for (const string of SIGNATURE_STRINGS) {
    for (const char of string) {
      bytes.push(char.charCodeAt(0) ^ SIGNATURE_KEY);
    }

    bytes.push(0 ^ SIGNATURE_KEY);
  }

  // The last string's terminator is the blob's real end, not scrambled.
  bytes[bytes.length - 1] = 0;

  return bytes;
}

/**
 * The default transaction parameters (`D_XPARAMS`, 016Eh), the 1Ch bytes of
 * `DdeClientTransaction`'s parameters block a client conversation points to
 * with none of its own (`69f9`: the conversation's field 16h is 016Eh and
 * its segment): `pdwResult` -- a far pointer to the doubleword at 016Ah,
 * FFFFFFFFh, its segment relocated at 0170h --, the time-out 1, `wType`
 * 1062h and `wFmt` 1; the item, conversation, size and data nought.
 */
const XPARAMS_RESULT_AT = 0x16a;
const XPARAMS_NO_RESULT = 0xffffffff;
const XPARAMS_TIMEOUT = 1;
const XPARAMS_TYPE = 0x1062;
const XPARAMS_FORMAT = 1;

/**
 * Two words and a string of the C library that `DDEML.DLL`'s code does not
 * address (no instruction of seg1 or seg2 reads 0190h-019Fh), kept as the
 * file has them.
 */
const LIBRARY_WORD_190 = 0x0100;
const LIBRARY_TAG_196 = 'pspsps';

/**
 * The C library's run-time error text. `<<NMSG>>` is the prefix 8 bytes
 * before the banner `C RUNTIME ERROR ` (01A8h, handed to `FatalAppExit`'s
 * writer at `7519`); the table at 01B9h is searched by `74e0` (`lodsw` of a
 * code, a zero-ended text after it, FFFFh ending the table).
 */
const NMSG_PREFIX_AT = 0x1a0;
const NMSG_PREFIX = '<<NMSG>>';
const NMSG_BANNER_AT = 0x1a8;
const NMSG_BANNER = 'C RUNTIME ERROR ';
const NMSG_TABLE_AT = 0x1b9;

const NMSG_TABLE: ReadonlyArray<readonly [number, string]> = [
  [0, 'R6000\r\n- stack overflow\r\n'],
  [3, 'R6003\r\n- integer divide by 0\r\n'],
  [9, 'R6009\r\n- not enough space for environment\r\n'],
  [0xfc, '\r\n'],
  [0xff, 'run-time error '],
];
const NMSG_TABLE_END = 0xffff;
/** One byte more after the table's end, FFh. */
const NMSG_TABLE_LAST = 0xff;

function put16(data: Uint8Array, at: number, value: number) {
  data[at] = value & 0xff;
  data[at + 1] = (value >> 8) & 0xff;
}

function put32(data: Uint8Array, at: number, value: number) {
  put16(data, at, value & 0xffff);
  put16(data, at + 2, value >>> 16);
}

/** A string's characters at `at`; the terminator is the nought already there. */
function putText(data: Uint8Array, at: number, string: string): number {
  for (let i = 0; i < string.length; i++) {
    data[at + i] = string.charCodeAt(i);
  }

  return at + string.length + 1;
}

/**
 * DDEML's initialized data: the 604 bytes of the data segment, the fields
 * the code sets as it runs (the instance, the heap, the arrays, the
 * profile's buffer) nought. The segment's selector is not in it: the relocation at
 * `XPARAMS_SELECTOR_AT` is the loader's.
 */
export function buildData(): Uint8Array {
  const data = new Uint8Array(DATA_SIZE);

  put16(data, 4, HEADER_WORD_4);
  put16(data, 0x14, HEADER_WORD_14);
  put16(data, SERIAL_AT, D_SERIAL_START);
  put16(data, CONTEXT_CB_AT, CONTEXT_CB);
  put16(data, CONTEXT_CODE_PAGE_AT, CONTEXT_CODE_PAGE);

  for (const [at, name] of CLASS_NAMES) {
    putText(data, at, name);
  }

  for (const [type, flag] of FILTER) {
    put32(data, FILTER_AT + type * 4, flag);
  }

  for (const [at, text] of PROFILE_TEXT) {
    putText(data, at, text);
  }

  putText(data, TEXT_TERM_DIALOG_AT, TEXT_TERM_DIALOG);
  putText(data, TEXT_HANDLE_FORMAT_AT, TEXT_HANDLE_FORMAT);
  data.set(scrambledSignature(), D_WHO);

  put32(data, XPARAMS_RESULT_AT, XPARAMS_NO_RESULT);
  put16(data, D_XPARAMS, XPARAMS_RESULT_AT); // pdwResult's offset
  put16(data, XPARAMS_SELECTOR_AT, XPARAMS_SELECTOR_UNRELOCATED); // its segment, relocated
  put32(data, D_XPARAMS + 4, XPARAMS_TIMEOUT);
  put16(data, D_XPARAMS + 8, XPARAMS_TYPE);
  put16(data, D_XPARAMS + 0xa, XPARAMS_FORMAT);

  put16(data, 0x190, LIBRARY_WORD_190);
  putText(data, 0x196, LIBRARY_TAG_196);
  putText(data, NMSG_PREFIX_AT, NMSG_PREFIX);
  putText(data, NMSG_BANNER_AT, NMSG_BANNER);

  let at = NMSG_TABLE_AT;

  for (const [code, text] of NMSG_TABLE) {
    put16(data, at, code);
    at = putText(data, at + 2, text);
  }

  put16(data, at, NMSG_TABLE_END);
  data[at + 2] = NMSG_TABLE_LAST;

  return data;
}

/** DDEML's initialized data. */
export const DATA = buildData();

// `TermDialog`, `DdeUninitialize`'s dialog of a partner that did not
// answer. A Windows 3.1 `DLGTEMPLATE`: style, the number of controls, the
// box, the menu and class names (none), the caption, the font's size and
// name; then each control: its box, id, style, class, text, and no extra data.

const WS_POPUP = 0x80000000;
const WS_VISIBLE = 0x10000000;
const WS_CHILD = 0x40000000;
const WS_CAPTION = 0x00c00000;
const WS_SYSMENU = 0x00080000;
const WS_GROUP = 0x00020000;
const WS_TABSTOP = 0x00010000;
const DS_SYSMODAL = 0x02;
const DS_SETFONT = 0x40;
const DS_MODALFRAME = 0x80;
const BS_DEFPUSHBUTTON = 1;

const CLASS_BUTTON = 0x80;
const CLASS_STATIC = 0x82;

// The buttons' ids are the ones `DialogBox` ends with: `IDABORT` (Close),
// `IDRETRY` (Retry), `IDIGNORE` (Continue), what `TermDialog` tests (`04cb`).
const IDRETRY = 4;
const IDIGNORE = 5;
const IDABORT = 3;

interface Control {
  x: number;
  y: number;
  cx: number;
  cy: number;
  id: number;
  style: number;
  class: number;
  text: string;
}

const TERM_DIALOG_STYLE =
  WS_POPUP | WS_VISIBLE | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_SETFONT | DS_SYSMODAL;
const TERM_DIALOG_BOX = { x: 91, y: 34, cx: 181, cy: 137 };
const TERM_DIALOG_CAPTION = 'Windows DDE';
const TERM_DIALOG_FONT_SIZE = 8;
const TERM_DIALOG_FONT = 'Helv';

const TEXT_STYLE = WS_CHILD | WS_VISIBLE | WS_GROUP;
const BUTTON_STYLE = WS_CHILD | WS_VISIBLE | WS_TABSTOP;

/** The three explanations (101-104 are text: the notice and one for each button) and their bullets, then the buttons. */
const TERM_DIALOG_CONTROLS: Control[] = [
  {
    x: 7,
    y: 7,
    cx: 168,
    cy: 23,
    id: 101,
    style: TEXT_STYLE,
    class: CLASS_STATIC,
    text: "An application using DDE did not respond to the system's exit command.",
  },
  {
    x: 27,
    y: 32,
    cx: 148,
    cy: 24,
    id: 102,
    style: TEXT_STYLE,
    class: CLASS_STATIC,
    text: 'Choose Retry to attempt to close the application and return to Windows.',
  },
  {
    x: 27,
    y: 58,
    cx: 148,
    cy: 24,
    id: 103,
    style: TEXT_STYLE,
    class: CLASS_STATIC,
    text: 'Choose Continue to repeatedly attempt to close the application and return to Windows.',
  },
  {
    x: 27,
    y: 84,
    cx: 148,
    cy: 24,
    id: 104,
    style: TEXT_STYLE,
    class: CLASS_STATIC,
    text: 'Choose Close to exit the application that is not responding.  You may lose any unsaved information in this application.',
  },
  {
    x: 15,
    y: 117,
    cx: 40,
    cy: 14,
    id: IDRETRY,
    style: BUTTON_STYLE | BS_DEFPUSHBUTTON,
    class: CLASS_BUTTON,
    text: 'Retry',
  },
  {
    x: 70,
    y: 117,
    cx: 40,
    cy: 14,
    id: IDIGNORE,
    style: BUTTON_STYLE,
    class: CLASS_BUTTON,
    text: 'Continue',
  },
  {
    x: 125,
    y: 117,
    cx: 40,
    cy: 14,
    id: IDABORT,
    style: BUTTON_STYLE,
    class: CLASS_BUTTON,
    text: 'Close',
  },
  { x: 21, y: 33, cx: 6, cy: 24, id: 108, style: TEXT_STYLE, class: CLASS_STATIC, text: '*' },
  { x: 21, y: 59, cx: 6, cy: 24, id: 109, style: TEXT_STYLE, class: CLASS_STATIC, text: '*' },
  { x: 21, y: 85, cx: 6, cy: 24, id: 110, style: TEXT_STYLE, class: CLASS_STATIC, text: '*' },
];

/** `TermDialog`'s `DLGTEMPLATE`, made from its controls. */
export function buildTermDialog(): Uint8Array {
  const bytes: number[] = [];
  const u8 = (value: number) => bytes.push(value & 0xff);
  const u16 = (value: number) => {
    u8(value);
    u8(value >> 8);
  };
  const u32 = (value: number) => {
    u16(value & 0xffff);
    u16(value >>> 16);
  };
  const string = (value: string) => {
    for (const char of value) {
      u8(char.charCodeAt(0));
    }

    u8(0);
  };

  u32(TERM_DIALOG_STYLE >>> 0);
  u8(TERM_DIALOG_CONTROLS.length);
  u16(TERM_DIALOG_BOX.x);
  u16(TERM_DIALOG_BOX.y);
  u16(TERM_DIALOG_BOX.cx);
  u16(TERM_DIALOG_BOX.cy);
  string(''); // menu
  string(''); // class
  string(TERM_DIALOG_CAPTION);
  u16(TERM_DIALOG_FONT_SIZE);
  string(TERM_DIALOG_FONT);

  for (const control of TERM_DIALOG_CONTROLS) {
    u16(control.x);
    u16(control.y);
    u16(control.cx);
    u16(control.cy);
    u16(control.id);
    u32(control.style >>> 0);
    u8(control.class);
    string(control.text);
    u8(0); // no extra data
  }

  return Uint8Array.from(bytes);
}

/** `TermDialog`'s template. */
export const TERM_DIALOG = buildTermDialog();
