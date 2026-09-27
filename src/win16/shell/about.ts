'use strict';

import { decodeDib, dibToDevice } from '../../raster/dib.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { BitBlt } from '../gdi/BitBlt.js';
import { CreateCompatibleDC } from '../gdi/CreateCompatibleDC.js';
import { DeleteDC } from '../gdi/DeleteDC.js';
import { DeleteObject } from '../gdi/DeleteObject.js';
import { SelectObject } from '../gdi/SelectObject.js';
import { GetFreeSpace } from '../kernel/GetFreeSpace.js';
import { GetWinFlags } from '../kernel/GetWinFlags.js';
import { readProfile } from '../kernel/profiles.js';
import { resourcesOf, RT_BITMAP } from '../ne-resources.js';
import { PAINTSTRUCT, User } from '../user.js';
import { BeginPaint } from '../user/BeginPaint.js';
import { parseDialogTemplate } from '../user/dialog-template.js';
import { SetDlgItemText } from '../user/dialog-items.js';
import { dialogBoxTemplate, EndDialog } from '../user/dialogs.js';
import { EndPaint } from '../user/EndPaint.js';
import { GetDlgItem } from '../user/GetDlgItem.js';
import { GetFreeSystemResources } from '../user/GetFreeSystemResources.js';
import { SendDlgItemMessage } from '../user/SendDlgItemMessage.js';
import { SetWindowText } from '../user/SetWindowText.js';
import { ShowWindow } from '../user/ShowWindow.js';
import { USER_STRINGS } from '../user/strings.js';
import { ABOUT_DIALOG } from './about-dialog.js';
import { SHELL_STRINGS } from './strings.js';

/**
 * SHELL's About box. **Read out of `SHELL.DLL`** (seg9 `0000`, `0136`) and
 * **recorded** by `about`:
 *
 * * The caption is `About` and the program's name; or, when the name has a
 *   `#`, what is before it, and the `#` is made the end of the caller's
 *   string. The first line is `Microsoft Windows` and the name, or what is
 *   after the `#`.
 * * The other text is shown as it is, and nothing for none. The icon is
 *   shown where the template puts it; with none, its control is hidden and
 *   SHELL's Windows logo is drawn there, 64 pixels square at (10,10).
 * * The version is USER's string 204h, `3.1`, as `Version 3.1 `: a space
 *   where a debugging Windows says `(Debug)`. The licensee's lines and the
 *   serial number's are USER's strings 202h, 203h and 205h.
 * * The mode is standard mode; the memory free is `GetFreeSpace(1000h)` in
 *   kilobytes, truncated, its thousands separated by `WIN.INI`'s `[intl]`
 *   `sThousand`, its first character only; and the resources free are
 *   `GetFreeSystemResources(0)`. SMARTDrive's line is hidden.
 * * Any command ends it, answering 1.
 *
 * The strings and the dialog are winbox.js's own (`strings.ts`,
 * `about-dialog.ts`). The logo is read from the installation's `SHELL.DLL`,
 * as the display's artwork is, and is not drawn without it.
 *
 * Not followed: the credits hidden behind a double click.
 */

const ID_LINE = 101;
const ID_MODE = 102;
const ID_MEMORY = 104;
const ID_RESOURCES = 105;
const ID_SMARTDRIVE = 106;
const ID_NAME = 108;
const ID_COMPANY = 109;
const ID_SERIAL = 110;
const ID_ICON = 111;
const ID_VERSION = 112;
const ID_RESOURCES_LABEL = 113;
const ID_OTHER = 115;

const STM_SETICON = 0x0400;
const STM_GETICON = 0x0401;
const WF_PMODE = 0x0001;
const WF_STANDARD = 0x0010;
const WF_WLO = 0x8000;
const SRCCOPY = 0x00cc0020;
const LOGO = 130;

const SW_HIDE = 0;

function core(system: any) {
  return system.machine.cpu.core;
}

/** The string at a far pointer, and where it ends. */
function readString(system: any, far: number) {
  let text = '';

  for (let at = far & 0xffff; ; at = (at + 1) & 0xffff) {
    const byte = core(system).read8(far >>> 16, at);

    if (!byte) {
      return text;
    }

    text += String.fromCharCode(byte);
  }
}

/** A string with one `%s` filled, as `wsprintf` fills it. */
const filled = (format: string, value: string) => format.replace('%s', value);

/** A number of kilobytes as the box shows it, its thousands separated (seg9 `0050`). */
function thousands(n: number, separator: string) {
  const digits = String(n);
  let out = '';

  for (let i = 0; i < digits.length; i++) {
    if (i && (digits.length - i) % 3 === 0) {
      out += separator;
    }

    out += digits[i];
  }

  /* A separator that is nothing is a NUL, and ends the string there. */
  return out.split('\0')[0];
}

/** SHELL's Windows logo, from the installation's file; null without it. */
async function logo(system: any) {
  const handle = await system.dos.files.open('C:\\WINDOWS\\SYSTEM\\SHELL.DLL');

  if (!handle) {
    return null;
  }

  try {
    const file = system.dos.files.resolve(handle);
    const bytes = new Uint8Array(await file.read(0, file.size));
    const resource = resourcesOf(bytes).find((each) => each.type === RT_BITMAP && each.id === LOGO);

    if (!resource) {
      return null;
    }

    const depth = DevicePalette.depthOf(system.display);

    return dibToDevice(
      decodeDib(resource.data),
      depth,
      DevicePalette.forDisplay(system.display, depth)
    );
  } catch {
    return null;
  } finally {
    system.dos.files.close(handle);
  }
}

/**
 * Shows the About box for a program.
 *
 * @param {Types.HWND} hWnd - Its owner.
 * @param {Types.FARPTR} szApp - The program's name, and after a `#` the first line.
 * @param {Types.LPCSTR} szOtherStuff - Text of the program's to show, or none.
 * @param {Types.HICON} hIcon - The icon to show, or none for the Windows logo.
 *
 * @returns {Types.INT} 1 once it is closed.
 */
export async function ShellAbout(
  this: any,
  hWnd: number,
  szApp: number,
  szOtherStuff: string | null,
  hIcon: number
) {
  const system = this;
  const template = parseDialogTemplate((at) => ABOUT_DIALOG[at] ?? 0);
  const item = (id: number) =>
    String(template.items.find((each: any) => each.id === id)?.text ?? '');

  const proc = async (hDlg: number, message: number, _wParam: number, _lParam: number) => {
    switch (message) {
      case User.WM_INITDIALOG: {
        const app = readString(system, szApp);
        const hash = app.indexOf('#');
        let line = app;

        if (hash >= 0) {
          core(system).write8(szApp >>> 16, ((szApp & 0xffff) + hash) & 0xffff, 0);
          await SetWindowText.call(system, hDlg, app.slice(0, hash));
          line = app.slice(hash + 1);
        } else {
          await SetWindowText.call(system, hDlg, filled(template.caption ?? '', app));
        }

        await SetDlgItemText.call(system, hDlg, ID_LINE, filled(item(ID_LINE), line));
        await SetDlgItemText.call(system, hDlg, ID_OTHER, szOtherStuff ?? '');
        await SendDlgItemMessage.call(system, hDlg, ID_ICON, STM_SETICON, hIcon, 0);

        if (!hIcon) {
          await ShowWindow.call(system, GetDlgItem.call(system, hDlg, ID_ICON), SW_HIDE);
        }

        await SetDlgItemText.call(system, hDlg, ID_SERIAL, USER_STRINGS.get(0x205) ?? '');
        await SetDlgItemText.call(
          system,
          hDlg,
          ID_VERSION,
          (SHELL_STRINGS.get(0xd8) ?? '')
            .replace('%s', USER_STRINGS.get(0x204) ?? '')
            .replace('%s', '')
        );

        const flags = GetWinFlags.call(system);
        const mode = !(flags & WF_PMODE) ? 0xd1 : flags & WF_STANDARD ? 0xd4 : 0xd5;

        await SetDlgItemText.call(system, hDlg, ID_MODE, SHELL_STRINGS.get(mode) ?? '');

        const profile = await readProfile(system, 'WIN.INI');
        const separator = (profile.get('intl', 'sThousand') ?? ',')[0] ?? '\0';
        const free = Math.floor((GetFreeSpace.call(system, 0x1000) >>> 0) / 1024);

        await SetDlgItemText.call(
          system,
          hDlg,
          ID_MEMORY,
          filled(SHELL_STRINGS.get(0xda) ?? '', thousands(free, separator))
        );
        await ShowWindow.call(system, GetDlgItem.call(system, hDlg, ID_SMARTDRIVE), SW_HIDE);

        if (flags & WF_PMODE && !(flags & WF_WLO)) {
          await SetDlgItemText.call(
            system,
            hDlg,
            ID_RESOURCES_LABEL,
            SHELL_STRINGS.get(0xd7) ?? ''
          );
          await SetDlgItemText.call(
            system,
            hDlg,
            ID_RESOURCES,
            (SHELL_STRINGS.get(0xdc) ?? '')
              .replace('%d', String(GetFreeSystemResources.call(system, 0)))
              .replace('%%', '%')
          );
        } else {
          await ShowWindow.call(system, GetDlgItem.call(system, hDlg, ID_RESOURCES_LABEL), SW_HIDE);
        }

        await SetDlgItemText.call(system, hDlg, ID_NAME, USER_STRINGS.get(0x202) ?? '');
        await SetDlgItemText.call(system, hDlg, ID_COMPANY, USER_STRINGS.get(0x203) ?? '');

        return 1;
      }

      case User.WM_PAINT: {
        const paint: any = new PAINTSTRUCT();
        const hdc = await BeginPaint.call(system, hDlg, paint);

        if (!(await SendDlgItemMessage.call(system, hDlg, ID_ICON, STM_GETICON, 0, 0))) {
          const memory = CreateCompatibleDC.call(system, hdc);
          const bitmap = memory ? await logo(system) : null;

          if (bitmap) {
            const hbm = system.handles.allocate(bitmap);
            const old = SelectObject.call(system, memory, hbm);

            BitBlt.call(system, hdc, 10, 10, 64, 64, memory, 0, 0, SRCCOPY);
            SelectObject.call(system, memory, old);
            DeleteObject.call(system, hbm);
          }

          if (memory) {
            DeleteDC.call(system, memory);
          }
        }

        EndPaint.call(system, hDlg, paint);
        return 1;
      }

      case User.WM_COMMAND:
        await EndDialog.call(system, hDlg, 1);
        return 1;
    }

    return 0;
  };

  return await dialogBoxTemplate(system, 0, template, hWnd, proc, 0);
}
