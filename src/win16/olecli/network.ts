'use strict';

import { D, W, text } from '../commdlg/api.js';
import { parseDialogTemplate } from '../user/dialog-template.js';
import { dialogBoxTemplate } from '../user/dialogs.js';
import { OLE_OK, OT_EMBEDDED, Ole, PATH, SCRATCH, bytesOf, signed16 } from './core.js';
import { leOf } from './linked.js';
import { exportAddress } from './objects.js';

/**
 * `OLECLI`'s network helpers, exports 950-954: a link's document on a
 * drive connected to a share -- its network name, kept in its stream --
 * told, checked, and connected again through a dialog, "Connect Network
 * Drive". As `crates/winbox-win16/src/olecli/network.rs`.
 *
 * None is documented. Their arguments and what each does are **read out**
 * of `OLECLI.DLL` seg8, described here in prose; what each answers is
 * **measured** by `olenet` on a machine with no network: a link to a file
 * on C:, on a drive that is not there, with no drive, one whose stream
 * names a share, and an embedded object, each named, checked and searched;
 * the dialog read as it is shown, and cancelled.
 */

/** `OLE_ERROR_BLANK`, `OLE_ERROR_DRIVE`, `OLE_ERROR_NETWORK` (ole.h). */
const OLE_ERROR_BLANK = 7;
const OLE_ERROR_DRIVE = 27;
const OLE_ERROR_NETWORK = 28;
const DRIVE_REMOTE = 4;
const LETTER_A = 0x41;
const COLON = 0x3a;

/** Where `OLECLI` keeps a share's name and a connection's while it asks (its data segment, beside `handlers.ts`' path). */
const NAME_AT = SCRATCH + 0x700;
const CONNECTION_AT = SCRATCH + 0x800;
const SIZE_AT = SCRATCH + 0x900;
const DRIVE_AT = SCRATCH + 0x904;
const NAME_SIZE = 0x100;

/** A drive's letter, `X:`, as `WNetGetConnection` is given it. */
const driveName = (letter: number) => [letter, COLON];

/** The share a drive is connected to; null where it is none. */
async function connection(ole: Ole, letter: number): Promise<number[] | null> {
  ole.w16(ole.near(SIZE_AT), NAME_SIZE);

  const error = await ole.user('WNetGetConnection', [
    text(driveName(letter)),
    D(ole.near(CONNECTION_AT)),
    D(ole.near(SIZE_AT)),
  ]);

  return error & 0xffff ? null : ole.string(ole.near(CONNECTION_AT));
}

const sameText = (a: number[], b: number[]) =>
  String.fromCharCode(...a).toLowerCase() === String.fromCharCode(...b).toLowerCase();

/** A drive's type by its number, A: nought. */
async function driveType(ole: Ole, drive: number) {
  return (await ole.kernel('GetDriveType', [W(drive)])) & 0xffff;
}

/** A letter made upper case as `AnsiUpperBuff` makes it, for the ASCII letters a drive has. */
const upper = (letter: number) => (letter >= 0x61 && letter <= 0x7a ? letter - 0x20 : letter);

/**
 * `SETNETNAME` (951), given an object: an embedded object's `OLE_OK`; a
 * link's document with no name `OLE_ERROR_BLANK`; on no drive -- no colon
 * second -- or a drive not remote, its network name forgotten, `OLE_OK`;
 * on a drive not there `OLE_ERROR_DRIVE`; on a remote drive, the share
 * `WNetGetConnection` gives it kept, with the drive's letter, or
 * `OLE_ERROR_DRIVE` where it gives none (**read out**, seg8 `0000`;
 * **measured** by `olenet`'s `named` records: C: and no drive forget a
 * stream's share, a drive not there 27).
 */
export async function setNetName(ole: Ole, object: number) {
  const le = leOf(ole, object);

  if (!le || le.type === OT_EMBEDDED) {
    return OLE_OK;
  }

  if (!le.topic.length) {
    return OLE_ERROR_BLANK;
  }

  if (le.topic[1] !== COLON) {
    le.network = [];
    return OLE_OK;
  }

  const letter = upper(le.topic[0]);
  const type = await driveType(ole, letter - LETTER_A);

  if (!type) {
    return OLE_ERROR_DRIVE;
  }

  if (type !== DRIVE_REMOTE) {
    le.network = [];
    return OLE_OK;
  }

  const share = await connection(ole, letter);

  if (!share) {
    return OLE_ERROR_DRIVE;
  }

  le.drive = letter;
  le.network = share;
  return OLE_OK;
}

/** A link's document moved to the drive connected: its first letter the drive's (**read out**, seg8 `031a`). */
function moveTopic(le: { topic: number[]; drive: number }) {
  if (!le.topic.length) {
    return false;
  }

  le.topic = [le.drive, ...le.topic.slice(1)];
  return true;
}

/**
 * The next drive after the one numbered at `at` that is remote and
 * connected to the share: the number moved past each drive looked at, to
 * 26; one found becomes the link's drive, its document moved there, 1;
 * none, nought (**read out**, seg8 `025c`).
 */
async function nextDrive(ole: Ole, object: number, at: number, share: number[]) {
  const le = leOf(ole, object)!;

  while (signed16(ole.r16(at)) < 26) {
    const drive = ole.r16(at) + 1;

    ole.w16(at, drive);

    if ((await driveType(ole, drive)) !== DRIVE_REMOTE) {
      continue;
    }

    const letter = LETTER_A + drive;
    const connected = await connection(ole, letter);

    if (connected && sameText(connected, share)) {
      le.drive = letter;
      return moveTopic(le) ? 1 : 0;
    }
  }

  return 0;
}

/**
 * `SETNEXTNETDRIVE` (953), given an object, a far pointer to a drive's
 * number and a buffer for a share's name: an empty buffer is given the
 * link's network name -- none, nought at once -- and the drives after the
 * one numbered searched (**read out**, seg8 `025c`; **measured** by
 * `olenet`'s `next` records: no remote drive, the number left at 26 and
 * the share written into the buffer).
 */
export async function setNextNetDrive(ole: Ole, object: number, at: number, name: number) {
  const le = leOf(ole, object);

  if (!le) {
    return 0;
  }

  if (!ole.r8(name)) {
    if (!le.network.length) {
      return 0;
    }

    ole.write(name, [...le.network.slice(0, NAME_SIZE - 1), 0]);
  }

  return nextDrive(ole, object, at, ole.string(name));
}

/**
 * `CHECKNETDRIVE` (952), given an object and whether to ask: an embedded
 * object, or a link with no network name, `OLE_OK`; a link whose drive --
 * kept, or its document's first letter -- is connected to its share,
 * `OLE_OK`; else another drive connected to the share found and the link
 * moved to it; none, `OLE_ERROR_NETWORK` where it is not to ask, else the
 * dialog that connects one (**read out**, seg8 `011a`-`0259`; **measured**
 * by `olenet`'s `check` records: the share's link 28, and with asking the
 * dialog, cancelled, 28).
 */
export async function checkNetDrive(ole: Ole, object: number, ask: number) {
  const le = leOf(ole, object);

  if (!le || le.type === OT_EMBEDDED || !le.network.length) {
    return OLE_OK;
  }

  if (!le.drive && le.topic.length) {
    le.drive = le.topic[0];
  }

  const connected = await connection(ole, le.drive);

  if (connected && sameText(connected, le.network)) {
    return OLE_OK;
  }

  const drive = ole.near(DRIVE_AT);

  ole.w16(drive, 2);

  if (await nextDrive(ole, object, drive, le.network)) {
    return OLE_OK;
  }

  if ((ask & 0xffff) !== 1) {
    return OLE_ERROR_NETWORK;
  }

  const name = ole.near(NAME_AT);

  ole.write(name, [...le.network.slice(0, NAME_SIZE - 1), 0]);

  const answer = await connect(ole, object, name);

  if (answer) {
    return answer;
  }

  return moveTopic(le) ? OLE_OK : OLE_ERROR_BLANK;
}

/**
 * `GETTASKVISIBLEWINDOW` (954), `EnumTaskWindows`' procedure: a visible
 * window written where the far pointer given points, FALSE to stop; TRUE
 * to go on (**read out**, seg8 `0696`; **measured** by `olenet`'s `window`
 * records).
 */
export async function getTaskVisibleWindow(ole: Ole, hwnd: number, out: number) {
  if (!((await ole.user('IsWindowVisible', [W(hwnd)])) & 0xffff)) {
    return 1;
  }

  ole.w16(out, hwnd);
  return 0;
}

// The dialog.

const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_CAPTION = 0x00c00000;
const WS_BORDER = 0x00800000;
const WS_SYSMENU = 0x00080000;
const WS_GROUP = 0x00020000;
const WS_TABSTOP = 0x00010000;
const DS_MODALFRAME = 0x80;
const SS_RIGHT = 0x0002;
const ES_PASSWORD = 0x0020;
const ES_AUTOHSCROLL = 0x0080;
const ES_OEMCONVERT = 0x0400;
const CBS_DROPDOWNLIST = 0x0003;
const CBS_SORT = 0x0200;
const BS_DEFPUSHBUTTON = 1;
const CLASS_BUTTON = 0x80;
const CLASS_EDIT = 0x81;
const CLASS_STATIC = 0x82;
const CLASS_COMBOBOX = 0x85;

const IDOK = 1;
const IDCANCEL = 2;
/** The dialog's controls: the drives' list, the password, the share (seg8 `04e7`, `04fa`, `0498`). */
const ID_DRIVE = 500;
const ID_PASSWORD = 501;
const ID_PATH = 502;

/** The dialog's procedure and the window procedure finding its owner, as `OLECLI`'s ordinals. */
const CONNECT_DLG_PROC = 950;
const GET_TASK_VISIBLE_WINDOW = 954;

/** `OLECLI`'s strings for a connection that fails (its string table, 600 and 601). */
const NETWORK_ERROR = 'Network Error';
const CANNOT_CONNECT = 'Unable to connect to network drive.';
const MB_RETRYCANCEL = 0x0005;
const MB_SYSTEMMODAL = 0x1000;
/** `WN_ALREADY_CONNECTED`? The error after which the drives are listed again (seg8 `05c9`). */
const LIST_AGAIN = 0x34;
const PASSWORD_SIZE = 0x20;

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

/**
 * The dialog, `CONNECTDLG`, laid out from what `olenet` measured of it --
 * each control's class, number, text, style and place in the dialog's
 * client area, at the system font's two pixels to a dialog unit each way
 * -- and its place, beside its owner's client area. No byte of
 * `OLECLI.DLL`'s resource is copied.
 */
const STYLE = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME;
const BOX = { x: 78, y: 55, cx: 155, cy: 76 };
const CAPTION = 'Connect Network Drive';
const TEXT = WS_CHILD | WS_VISIBLE | WS_GROUP | SS_RIGHT;
const FIELD = WS_CHILD | WS_VISIBLE | WS_GROUP | WS_TABSTOP | WS_BORDER;

const CONTROLS: Control[] = [
  { x: 9, y: 7, cx: 40, cy: 9, id: -1, style: TEXT, class: CLASS_STATIC, text: 'D&rive:' },
  {
    x: 53,
    y: 3,
    cx: 20,
    cy: 40,
    id: ID_DRIVE,
    style: WS_CHILD | WS_VISIBLE | WS_GROUP | WS_TABSTOP | CBS_DROPDOWNLIST | CBS_SORT,
    class: CLASS_COMBOBOX,
    text: '',
  },
  { x: 3, y: 21, cx: 46, cy: 8, id: -1, style: TEXT, class: CLASS_STATIC, text: '&Network Path:' },
  {
    x: 53,
    y: 20,
    cx: 96,
    cy: 12,
    id: ID_PATH,
    style: FIELD | ES_AUTOHSCROLL | ES_OEMCONVERT,
    class: CLASS_EDIT,
    text: '',
  },
  { x: 13, y: 37, cx: 36, cy: 10, id: -1, style: TEXT, class: CLASS_STATIC, text: 'Pass&word:' },
  {
    x: 53,
    y: 35,
    cx: 60,
    cy: 12,
    id: ID_PASSWORD,
    style: FIELD | ES_PASSWORD | ES_AUTOHSCROLL | ES_OEMCONVERT,
    class: CLASS_EDIT,
    text: '',
  },
  {
    x: 23,
    y: 54,
    cx: 42,
    cy: 14,
    id: IDOK,
    style: WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON,
    class: CLASS_BUTTON,
    text: '&Connect',
  },
  {
    x: 91,
    y: 55,
    cx: 43,
    cy: 14,
    id: IDCANCEL,
    style: WS_CHILD | WS_VISIBLE | WS_GROUP | WS_TABSTOP,
    class: CLASS_BUTTON,
    text: 'C&ancel',
  },
];

/** The dialog's `DLGTEMPLATE`, made from its controls. */
export function buildConnectDialog(): Uint8Array {
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

  u32(STYLE >>> 0);
  u8(CONTROLS.length);
  u16(BOX.x);
  u16(BOX.y);
  u16(BOX.cx);
  u16(BOX.cy);
  string(''); // menu
  string(''); // class
  string(CAPTION);

  for (const control of CONTROLS) {
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

const CONNECT_DIALOG = buildConnectDialog();

/**
 * The dialog shown, its owner the task's first visible window
 * (`EnumTaskWindows` with `GetTaskVisibleWindow`), given the share's name:
 * the letter of the drive connected becomes the link's, nought where none
 * was, `OLE_ERROR_NETWORK` (**read out**, seg8 `03a4`).
 */
async function connect(ole: Ole, object: number, name: number) {
  const le = leOf(ole, object)!;
  const owner = ole.near(DRIVE_AT);
  const task = (await ole.kernel('GetCurrentTask', [])) & 0xffff;

  ole.w16(owner, 0);
  await ole.user('EnumTaskWindows', [
    W(task),
    D(exportAddress(ole, GET_TASK_VISIBLE_WINDOW)),
    D(owner),
  ]);

  const template = parseDialogTemplate((offset) => CONNECT_DIALOG[offset] ?? 0);
  const instance = ole.system._modules.instanceFromPath(PATH) ?? 0;
  const letter =
    (await dialogBoxTemplate(
      ole.system,
      instance,
      template,
      ole.r16(owner),
      exportAddress(ole, CONNECT_DLG_PROC),
      name
    )) & 0xff;

  le.drive = letter;
  return letter ? OLE_OK : OLE_ERROR_NETWORK;
}

/** The drives not there, D: to Z:, listed, the first chosen (**read out**, seg8 `0624`). */
async function listDrives(ole: Ole, dialog: number) {
  const CB_ADDSTRING = 0x403;
  const CB_RESETCONTENT = 0x40b;
  const CB_SETCURSEL = 0x40e;
  const list = (await ole.user('GetDlgItem', [W(dialog), W(ID_DRIVE)])) & 0xffff;

  await ole.user('SendMessage', [W(list), W(CB_RESETCONTENT), W(0), D(0)]);

  for (let drive = 3; drive < 26; drive++) {
    if (!(await driveType(ole, drive))) {
      await ole.user('SendMessage', [
        W(list),
        W(CB_ADDSTRING),
        W(0),
        text(driveName(LETTER_A + drive)),
      ]);
    }
  }

  await ole.user('SendMessage', [W(list), W(CB_SETCURSEL), W(0), D(0)]);
}

/**
 * `CONNECTDLGPROC` (950): the dialog's procedure. Shown, it lists the
 * drives not there and shows the share, keeping its name (`OLECLI.DLL`
 * keeps it in two of the dialog's properties; WinBox's in its own state),
 * and answers FALSE; Connect connects the drive chosen to the share with
 * the password typed, ending the dialog with the drive's letter, or says
 * why it could not -- Retry asks again, Cancel ends it; Cancel ends it with
 * nought; the share's field put back as it loses the focus (**read out**,
 * seg8 `0456`-`0620`; shown and cancelled, **measured** by `olenet`; what
 * Connect does `unrecorded`).
 */
export async function connectDlgProc(
  ole: Ole,
  dialog: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const WM_INITDIALOG = 0x110;
  const WM_COMMAND = 0x111;
  const WM_SETTEXT = 0x0c;
  const EN_KILLFOCUS = 0x200;
  const state = ole.state();

  if (message === WM_INITDIALOG) {
    state.connecting = lParam >>> 0;
    await listDrives(ole, dialog);
    await ole.user('SetDlgItemText', [W(dialog), W(ID_PATH), D(lParam)]);
    return 0;
  }

  if (message !== WM_COMMAND) {
    return 0;
  }

  if ((wParam & 0xffff) === IDCANCEL) {
    await ole.user('EndDialog', [W(dialog), W(0)]);
    return 1;
  }

  if ((wParam & 0xffff) === ID_PATH && lParam >>> 16 === EN_KILLFOCUS) {
    await ole.user('SendDlgItemMessage', [
      W(dialog),
      W(ID_PATH),
      W(WM_SETTEXT),
      W(0),
      D(state.connecting),
    ]);
    return 0;
  }

  if ((wParam & 0xffff) !== IDOK) {
    return 0;
  }

  const drive = ole.near(CONNECTION_AT);
  const password = ole.near(CONNECTION_AT + 0x10);

  await ole.user('GetDlgItemText', [W(dialog), W(ID_DRIVE), D(drive), W(3)]);
  await ole.user('GetDlgItemText', [W(dialog), W(ID_PASSWORD), D(password), W(PASSWORD_SIZE)]);

  const error =
    (await ole.user('WNetAddConnection', [D(state.connecting), D(password), D(drive)])) & 0xffff;

  if (!error) {
    await ole.user('EndDialog', [W(dialog), W(ole.r8(drive))]);
    return 1;
  }

  const message_ = ole.near(CONNECTION_AT + 0x40);

  ole.w16(ole.near(SIZE_AT), 0x80);

  if (
    (await ole.user('WNetGetErrorText', [W(error), D(message_), D(ole.near(SIZE_AT))])) & 0xffff
  ) {
    ole.write(message_, [...bytesOf(CANNOT_CONNECT), 0]);
  }

  const answer =
    (await ole.user('MessageBox', [
      W(dialog),
      D(message_),
      text(bytesOf(NETWORK_ERROR)),
      W(MB_SYSTEMMODAL | MB_RETRYCANCEL),
    ])) & 0xffff;

  if (answer === IDCANCEL) {
    await ole.user('EndDialog', [W(dialog), W(0)]);
    return 1;
  }

  if (error === LIST_AGAIN) {
    await listDrives(ole, dialog);
  }

  await ole.user('SetDlgItemText', [W(dialog), W(ID_PASSWORD), text([])]);
  return 0;
}
