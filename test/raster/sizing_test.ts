'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { Desktop } from '../../src/win16/user/desktop.js';
import { chromeReady, differences, displayEnvironment, DRIVES } from './chrome.js';

/**
 * A window maximized and minimized as Windows does it: the `sizing` probe's
 * captures -- the top of the screen with the window maximized, the icon and
 * its title with it minimized -- and its rectangles, rebuilt on the desktop.
 */

const COLOR_WINDOW = 5;
const IDI_APPLICATION = 32512;

function fixture(display: string) {
  const file = join(__dirname, '..', '..', 'oracle', 'fixtures', `sizing-${display}.json`);

  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).records : null;
}

for (const display of Object.keys(DRIVES)) {
  const records = fixture(display);
  const ready = chromeReady(display) && records;

  (ready ? describe : describe.skip)(`maximizing and minimizing on the ${display}`, () => {
    let setup: any;

    beforeAll(async () => {
      setup = await displayEnvironment(display);
    });

    const scene = () => {
      const screen = new DeviceBitmap(
        setup.mode.width,
        setup.mode.height,
        setup.depth,
        undefined,
        setup.palette
      );
      const desktop = new Desktop(screen, setup.environment);

      desktop.paintBackground();

      const window = desktop.create(40, 40, 200, 120, 0x00cf0000, 'Probe', undefined, {
        colorref: setup.environment.sysColor(COLOR_WINDOW),
      });

      window.icon = setup.environment.icons.get(IDI_APPLICATION);
      desktop.show(window);
      desktop.erase(window);

      return { desktop, window };
    };

    const rects = (name: string) =>
      records.find((record: any) => record.function === 'rects' && record.args === name).result;

    const describeRects = (window: any) =>
      `window=${window.left}:${window.top}:${window.left + window.width}:${window.top + window.height},` +
      `client=${window.left + window.client.left}:${window.top + window.client.top}:` +
      `${window.left + window.client.right}:${window.top + window.client.bottom}`;

    const area = (name: string) => {
      const [left, top] = records
        .find((record: any) => record.function === 'area' && record.args === name)
        .result.split(':')
        .map(Number);
      const rows = records
        .filter((record: any) => record.function === 'screen' && record.args.startsWith(`${name},`))
        .map((record: any) => record.result);

      return { left, top, rows };
    };

    it('maximizes a window as Windows does', () => {
      const { desktop, window } = scene();

      desktop.maximize(window);
      desktop.erase(window);

      expect(describeRects(window)).toBe(rects('maximized').replace(/,iconic.*/, ''));

      const { left, top, rows } = area('maximized');

      expect(differences(setup.depth, desktop.screen, left, top, rows)).toEqual([]);
    });

    it('restores it where it was', () => {
      const { desktop, window } = scene();

      desktop.maximize(window);
      desktop.restore(window);

      expect(describeRects(window)).toBe(rects('restored').replace(/,iconic.*/, ''));
    });

    it('minimizes a window to its icon and title as Windows does', () => {
      const { desktop, window } = scene();

      desktop.minimize(window);

      expect(describeRects(window)).toBe(rects('minimized').replace(/,iconic.*/, ''));

      const { left, top, rows } = area('minimized');

      expect(differences(setup.depth, desktop.screen, left, top, rows)).toEqual([]);
    });
  });
}
