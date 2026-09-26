'use strict';

import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { HandleManager } from '../../src/win16/handle-manager.js';
import { Desktop } from '../../src/win16/user/desktop.js';
import {
  CreateCaret,
  DestroyCaret,
  GetCaretBlinkTime,
  HideCaret,
  SetCaretPos,
  ShowCaret,
} from '../../src/win16/user/caret.js';
import { RasterWindow } from '../../src/win16/user/raster-window.js';
import { chromeReady, displayEnvironment } from './chrome.js';

/**
 * The caret on the raster desktop: made hidden, shown by inverting its
 * rectangle of a window's client area, each hide to be undone before it
 * shows again. The replay's virtual clock keeps it from blinking.
 */
(chromeReady('vga') ? describe : describe.skip)('the caret', () => {
  let setup: any;

  beforeAll(async () => {
    setup = await displayEnvironment('vga');
  });

  const make = () => {
    const screen = new DeviceBitmap(640, 480, setup.depth, undefined, setup.palette);
    const desktop = new Desktop(screen, setup.environment);
    const handles = new HandleManager();
    const system: any = { handles, rasterDesktop: desktop, virtualClock: true, display: setup.display };
    const shown = desktop.create(40, 40, 200, 120, 0x00cf0000, 'Probe', undefined, null);
    const window = new RasterWindow(desktop, shown, { windowClass: 'Probe' });
    const hwnd = handles.allocate(window);

    shown.hwnd = hwnd;
    desktop.show(shown);

    const origin = { x: shown.left + shown.client.left, y: shown.top + shown.client.top };
    const at = (x: number, y: number) => screen.indexAt(origin.x + x, origin.y + y);

    return { system, hwnd, at };
  };

  it('starts hidden, and shows by inverting its rectangle', () => {
    const { system, hwnd, at } = make();
    const before = at(10, 10);

    CreateCaret.call(system, hwnd, 0, 2, 5);
    SetCaretPos.call(system, 10, 10);
    expect(at(10, 10)).toBe(before);

    ShowCaret.call(system, hwnd);
    expect(at(10, 10)).not.toBe(before);
    expect(at(11, 14)).not.toBe(before);
    expect(at(12, 10)).toBe(before);
    expect(at(10, 15)).toBe(before);
  });

  it('shows again only when every hide is undone', () => {
    const { system, hwnd, at } = make();
    const before = at(0, 0);

    CreateCaret.call(system, hwnd, 0, 1, 1);
    ShowCaret.call(system, hwnd);
    HideCaret.call(system, hwnd);
    HideCaret.call(system, hwnd);
    ShowCaret.call(system, hwnd);
    expect(at(0, 0)).toBe(before);

    ShowCaret.call(system, hwnd);
    expect(at(0, 0)).not.toBe(before);
  });

  it('moves with SetCaretPos, and goes with DestroyCaret', () => {
    const { system, hwnd, at } = make();
    const before = at(0, 0);

    CreateCaret.call(system, hwnd, 0, 1, 1);
    ShowCaret.call(system, hwnd);
    SetCaretPos.call(system, 5, 0);
    expect(at(0, 0)).toBe(before);
    expect(at(5, 0)).not.toBe(before);

    DestroyCaret.call(system);
    expect(at(5, 0)).toBe(before);
  });

  it('blinks every 530 milliseconds until told otherwise', () => {
    expect(GetCaretBlinkTime.call({})).toBe(530);
  });
});
