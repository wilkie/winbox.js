'use strict';

import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { Desktop } from '../../src/win16/user/desktop.js';
import { chromeReady, displayEnvironment } from './chrome.js';

/**
 * A child window keeps its place in its parent's client area: moved with
 * the parent, and drawn where it now is.
 */
(chromeReady('vga') ? describe : describe.skip)('children on the desktop', () => {
  let setup: any;

  beforeAll(async () => {
    setup = await displayEnvironment('vga');
  });

  it('move with their parent', () => {
    const desktop = new Desktop(
      new DeviceBitmap(setup.mode.width, setup.mode.height, setup.depth, undefined, setup.palette),
      setup.environment
    );
    const background = { colorref: setup.environment.sysColor(5) };
    const parent = desktop.create(40, 40, 200, 120, 0x00cf0000, 'Parent', undefined, background);

    desktop.show(parent);

    const origin = { x: parent.left + parent.client.left, y: parent.top + parent.client.top };
    const child = desktop.create(
      origin.x + 10,
      origin.y + 5,
      50,
      20,
      0x50800000,
      '',
      undefined,
      background,
      parent
    );

    desktop.show(child);
    desktop.place(parent, 100, 150, 200, 120);

    expect(child.left - (parent.left + parent.client.left)).toBe(10);
    expect(child.top - (parent.top + parent.client.top)).toBe(5);

    /* And its surface is a view of the screen where it now is: its border shows there. */
    desktop.paintFrame(child);
    expect(desktop.owners[child.top * desktop.screen.width + child.left]).toBe(child.id);
  });

  it('pass the mouse through a group box to what lies beneath it', () => {
    const desktop = new Desktop(
      new DeviceBitmap(setup.mode.width, setup.mode.height, setup.depth, undefined, setup.palette),
      setup.environment
    );
    const parent = desktop.create(40, 40, 200, 120, 0x00cf0000, 'Parent', undefined, null);

    desktop.show(parent);

    const x = parent.left + parent.client.left;
    const y = parent.top + parent.client.top;
    const box = desktop.create(x + 5, y + 5, 100, 60, 0x50000007, 'Group', undefined, null, parent);
    const radio = desktop.create(x + 10, y + 20, 40, 16, 0x50000009, 'Up', undefined, null, parent);

    box.control = { className: 'BUTTON', style: 7, text: 'Group', checked: 0, items: [] };
    radio.control = { className: 'BUTTON', style: 9, text: 'Up', checked: 0, items: [] };
    desktop.show(box);
    desktop.show(radio);

    expect(desktop.windowAt(x + 15, y + 25)).toBe(radio);
    expect(desktop.windowAt(x + 80, y + 40)).toBe(parent);
  });
});
