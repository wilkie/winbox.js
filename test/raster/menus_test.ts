'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { Desktop } from '../../src/win16/user/desktop.js';
import { MenuData } from '../../src/win16/user/menu-data.js';
import { chromeReady, differences, displayEnvironment, DRIVES } from './chrome.js';

/**
 * Menus as Windows draws them open: the `menus` probe's captures of a window
 * with a menu bar, its File menu pulled down, the same with the second item
 * selected, a pop-up from `TrackPopupMenu`, and the system menu -- rebuilt on
 * the desktop and read back from the screen over the probe's whole area.
 */

const AREA = { left: 32, top: 32, right: 352, bottom: 272 };
const COLOR_WINDOW = 5;

const MF_GRAYED = 0x0001;
const MF_CHECKED = 0x0008;
const MF_POPUP = 0x0010;
const MF_SEPARATOR = 0x0800;

function menu(items: [number, string][]) {
  const made = new MenuData();

  for (const [flags, text] of items) {
    made.items.push({ flags, id: 0, text: flags & MF_SEPARATOR ? null : text });
  }

  return made;
}

const FILE = menu([
  [0, '&New'],
  [0, '&Open...\tCtrl+O'],
  [MF_SEPARATOR, ''],
  [MF_CHECKED, '&Word Wrap'],
  [MF_GRAYED, '&Print'],
  [MF_POPUP, '&Recent'],
  [MF_SEPARATOR, ''],
  [0, 'E&xit'],
]);

const POPUP = menu([
  [0, '&Cut'],
  [0, 'C&opy'],
  [MF_GRAYED, '&Paste'],
]);

const SYSTEM = menu([
  [MF_GRAYED, '&Restore'],
  [0, '&Move'],
  [0, '&Size'],
  [0, 'Mi&nimize'],
  [0, 'Ma&ximize'],
  [MF_SEPARATOR, ''],
  [0, '&Close\tAlt+F4'],
  [MF_SEPARATOR, ''],
  [0, 'S&witch To...\tCtrl+Esc'],
]);

function captured(display: string, name: string) {
  const file = join(__dirname, '..', '..', 'oracle', 'fixtures', `menus-${display}.json`);

  return JSON.parse(readFileSync(file, 'utf8'))
    .records.filter((record: any) => record.args.startsWith(`${name},`))
    .map((record: any) => record.result);
}

for (const display of Object.keys(DRIVES)) {
  const ready =
    chromeReady(display) &&
    existsSync(join(__dirname, '..', '..', 'oracle', 'fixtures', `menus-${display}.json`));

  (ready ? describe : describe.skip)(`menus on the ${display}`, () => {
    let setup: any;

    beforeAll(async () => {
      setup = await displayEnvironment(display);
    });

    const scene = (open: (desktop: Desktop, window: any) => void) => {
      const screen = new DeviceBitmap(
        setup.mode.width,
        setup.mode.height,
        setup.depth,
        undefined,
        setup.palette
      );
      const desktop = new Desktop(screen, setup.environment);

      desktop.paintBackground();

      const window = desktop.create(40, 40, 240, 160, 0x00cf0000, 'Menus', ['&File', '&Edit', '&Help'], {
        colorref: setup.environment.sysColor(COLOR_WINDOW),
      });

      desktop.show(window);
      desktop.erase(window);
      open(desktop, window);

      return desktop;
    };

    /* Where a menu bar's first item's pop-up opens: its left, on the bar's bottom line. */
    const barPopup = (desktop: Desktop, window: any, selected: number) => {
      window.menuSelected = 0;
      desktop.paintFrame(window);
      desktop.openPopup(
        FILE,
        window.left + window.client.left,
        window.top + window.client.top - 1,
        selected
      );
    };

    const cases: Record<string, (desktop: Desktop, window: any) => void> = {
      bar: () => {},
      file: (desktop, window) => barPopup(desktop, window, 0),
      down: (desktop, window) => barPopup(desktop, window, 1),
      popup: (desktop) => desktop.openPopup(POPUP, 150, 120, 0),
      system: (desktop, window) => {
        window.systemMenuOpen = true;
        desktop.paintFrame(window);

        const caption = setup.environment.metric(4);

        desktop.openPopup(SYSTEM, window.left + window.client.left, window.top + 2 + caption, 0);
      },
    };

    for (const [name, open] of Object.entries(cases)) {
      it(`draws the ${name} capture as Windows does`, () => {
        const desktop = scene(open);

        if (process.env.DUMP === `${display}/${name}`) {
          const rows = captured(display, name);
          const [y0, y1, x0, x1] = (process.env.AT ?? '40,60,0,80').split(',').map(Number);
          for (let y = y0; y < y1; y++) {
            let row = '';
            for (let x = x0; x < x1; x++) {
              const got = desktop.screen.indices[(AREA.top + y) * desktop.screen.width + AREA.left + x];
              row += setup.depth === 1 ? (got ? 'f' : '0') : (got === 7 ? 8 : got === 8 ? 7 : got).toString(16);
            }
            process.stderr.write(`${String(y).padStart(3)} ${row}\n    ${rows[y].slice(x0, x1)}\n`);
          }
        }

        expect(
          differences(setup.depth, desktop.screen, AREA.left, AREA.top, captured(display, name))
        ).toEqual([]);
      });
    }
  });
}
