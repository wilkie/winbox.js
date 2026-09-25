'use strict';

import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { controlRect } from '../../src/win16/user/controls.js';
import { Desktop } from '../../src/win16/user/desktop.js';
import {
  STYLES,
  capturedRects,
  capturedRows,
  chromeReady,
  chromeRecords,
  differences,
  displayEnvironment,
  DRIVES,
} from './chrome.js';

/**
 * USER's desktop, holding windows on one screen: each of the `chrome` probe's
 * windows made and shown as the probe made and showed it, at its place on a
 * screen of the display's size, and read back from the screen pixel for pixel.
 * The inactive window is made inactive the way the probe did it, by showing a
 * second window.
 */

const COLOR_WINDOW = 5;

for (const display of Object.keys(DRIVES)) {
  const ready = chromeReady(display);

  (ready ? describe : describe.skip)(`the desktop on the ${display}`, () => {
    const records = ready ? chromeRecords(display) : [];
    let setup: any;

    beforeAll(async () => {
      setup = await displayEnvironment(display);
    });

    const make = () => {
      const screen = new DeviceBitmap(
        setup.mode.width,
        setup.mode.height,
        setup.depth,
        undefined,
        setup.palette
      );
      const desktop = new Desktop(screen, setup.environment);

      desktop.paintBackground();

      return desktop;
    };

    const window = (desktop: Desktop, style: number, menu?: string[], at = [40, 40, 200, 120]) =>
      desktop.create(at[0], at[1], at[2], at[3], style, 'Probe', menu, {
        colorref: setup.environment.sysColor(COLOR_WINDOW),
      });

    for (const [name, frame] of Object.entries(STYLES)) {
      it(`shows the ${name} window as Windows does`, () => {
        const desktop = make();
        const shown = window(desktop, frame.style, frame.menu);

        desktop.show(shown);

        if (name === 'inactive') {
          desktop.show(window(desktop, 0x00cf0000, undefined, [400, 300, 160, 100]));
        }

        desktop.erase(shown);

        const { window: rect, client } = capturedRects(records, name);

        expect([
          shown.left + shown.client.left,
          shown.top + shown.client.top,
          shown.left + shown.client.right,
          shown.top + shown.client.bottom,
        ]).toEqual(client);
        expect([shown.left, shown.top, shown.left + shown.width, shown.top + shown.height]).toEqual(
          rect
        );
        expect(
          differences(setup.depth, desktop.screen, rect[0], rect[1], capturedRows(records, name))
        ).toEqual([]);
      });
    }

    it('keeps a covered window from drawing over the one on top of it', () => {
      const desktop = make();
      const under = window(desktop, 0x00cf0000);
      const over = window(desktop, 0x00cf0000, undefined, [100, 80, 200, 120]);

      desktop.show(under);
      desktop.show(over);

      const before = desktop.screen.indices.slice();
      const black = desktop.screen.devicePalette.index(0, 0, 0);
      const bitmap = under.surface.bitmap as DeviceBitmap;

      for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
          bitmap.put(x, y, black);
        }
      }

      /* Every pixel that changed is the covered window's own and still shows. */
      for (let at = 0; at < before.length; at++) {
        if (desktop.screen.indices[at] !== before[at]) {
          expect(desktop.owners[at]).toBe(under.id);
        }
      }

      /* And one it covers is not touched: inside both, the top window's. */
      const x = 110;
      const y = 100;
      expect(desktop.owners[y * desktop.screen.width + x]).toBe(over.id);
      expect(desktop.screen.indices[y * desktop.screen.width + x]).toBe(
        before[y * desktop.screen.width + x]
      );
    });

    it('paints the desktop again where a window was taken away', () => {
      const desktop = make();
      const blank = desktop.screen.indices.slice();
      const shown = window(desktop, 0x00cf0000);

      desktop.show(shown);
      desktop.erase(shown);
      desktop.destroy(shown);

      expect(desktop.screen.indices).toEqual(blank);
    });
  });
}

/**
 * The standard controls, in the ordinary window, as `chrome` made them: each
 * control's block of the capture held to what the desktop paints there.
 */
const CONTROLS: [string, string, number, number, number, number, number, string, string[]?][] = [
  ['push', 'BUTTON', 0x0, 8, 8, 64, 24, 'Push'],
  ['default', 'BUTTON', 0x1, 80, 8, 72, 24, 'Default'],
  ['check', 'BUTTON', 0x2, 8, 40, 72, 16, 'Check'],
  ['radio', 'BUTTON', 0x4, 88, 40, 72, 16, 'Radio'],
  ['static', 'STATIC', 0x0, 168, 40, 80, 16, 'Static text'],
  ['edit', 'EDIT', 0x00800000, 8, 64, 100, 22, 'Edit'],
  ['list', 'LISTBOX', 0x00800001, 120, 64, 100, 48, '', ['First', 'Second']],
  ['scroll', 'SCROLLBAR', 0x0, 8, 124, 200, 16, ''],
];

for (const display of Object.keys(DRIVES)) {
  const ready = chromeReady(display);

  (ready ? describe : describe.skip)(`the standard controls on the ${display}`, () => {
    const records = ready ? chromeRecords(display) : [];
    let setup: any;
    let desktop: Desktop;
    let parent: any;

    beforeAll(async () => {
      setup = await displayEnvironment(display);

      const screen = new DeviceBitmap(
        setup.mode.width,
        setup.mode.height,
        setup.depth,
        undefined,
        setup.palette
      );

      desktop = new Desktop(screen, setup.environment);
      desktop.paintBackground();
      parent = desktop.create(40, 40, 260, 190, 0x00cf0000, 'Probe', undefined, {
        colorref: setup.environment.sysColor(COLOR_WINDOW),
      });
      desktop.show(parent);
      desktop.erase(parent);

      for (const [, className, style, x, y, w, h, text, items] of CONTROLS) {
        const rect = controlRect(className, style, x, y, w, h);
        const child = desktop.create(
          parent.left + parent.client.left + rect.x,
          parent.top + parent.client.top + rect.y,
          rect.width,
          rect.height,
          0x50000000 | style,
          text,
          undefined,
          null,
          parent
        );

        child.control = {
          className,
          style,
          text,
          checked: className === 'BUTTON' && (style === 0x2 || style === 0x4) ? 1 : 0,
          items: items ?? [],
        };
        desktop.show(child);
        desktop.paintControl(child);
      }
    });

    it('lays the window out as Windows does', () => {
      const { window: rect, client } = capturedRects(records, 'controls');

      expect([parent.left + parent.client.left, parent.top + parent.client.top]).toEqual(
        client.slice(0, 2)
      );
      expect(parent.left + parent.width).toBe(rect[2]);
    });

    for (const [name, className, style, x, y, w, h] of CONTROLS) {
      it(`paints the ${name} control as Windows does`, () => {
        const rows = capturedRows(records, 'controls');
        const { window: rect, client } = capturedRects(records, 'controls');
        const outer = controlRect(className, style, x, y, w, h);

        /* The control's block, a pixel around it, in the window's capture. */
        const left = client[0] - rect[0] + outer.x - 1;
        const top = client[1] - rect[1] + outer.y - 1;
        const block = rows
          .slice(top, top + outer.height + 2)
          .map((row) => row.slice(left, left + outer.width + 2));

        expect(
          differences(setup.depth, desktop.screen, rect[0] + left, rect[1] + top, block)
        ).toEqual([]);
      });
    }
  });
}
