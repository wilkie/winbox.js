'use strict';

import { WNDCLASS } from '../user.js';
import { CreateWindowEx } from './CreateWindowEx.js';
import { DefWindowProc } from './DefWindowProc.js';

/**
 * USER's own hidden windows at the top, made as USER starts and the first
 * task's: **recorded** by `hidwnd`, front to back.
 *
 * * `#32771`, the task list's: a disabled pop-up, topmost, 10 by 10.
 * * `#42`: a window with a caption, 102 by 26.
 * * `#32768`, the menus': a pop-up, 100 by 100.
 *
 * All at the screen's corner, hidden, with no title and no owner. A program's
 * windows go between the first and the other two. They come along when
 * windows are enumerated (`minis3`). Made here by the first `InitApp`, for
 * the task that calls it; nothing is done with them yet.
 */
const WINDOWS = [
  { name: '#32768', style: 0x84000000, exStyle: 0, width: 100, height: 100 },
  { name: '#42', style: 0x04c00000, exStyle: 0, width: 102, height: 26 },
  { name: '#32771', style: 0x8c000000, exStyle: 0x0008, width: 10, height: 10 },
];

export async function makeUserWindows(system: any) {
  if (system.userWindowsMade || !system.rasterDesktop) {
    return;
  }

  system.userWindowsMade = true;

  for (const { name, style, exStyle, width, height } of WINDOWS) {
    if (!system.handles.retrieve(name)) {
      const windowClass: any = new WNDCLASS();

      windowClass.style = 0;
      windowClass.hbrBackground = 0;
      windowClass.lpszClassName = name;
      windowClass.lpfnWndProc = (hwnd: number, message: number, wParam: number, lParam: any) =>
        DefWindowProc.call(system, hwnd, message, wParam, lParam);

      system.handles.register(system.handles.allocate(windowClass), name);
    }

    await CreateWindowEx.call(system, exStyle, name, '', style, 0, 0, width, height, 0, 0, 0, 0);
  }
}
