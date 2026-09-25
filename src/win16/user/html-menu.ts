'use strict';

import { Menu } from '../../controls/menu.js';
import { FixedWindow } from '../../windows/fixed-window.js';

import { type MenuData } from './menu-data.js';

const MF_GRAYED = 0x0001;

/**
 * A menu as the page's own window components show it, where there is no
 * raster desktop: a `Menu` for each item, a pop-up's items inside it, and a
 * click on an item posting `WM_COMMAND` with its identifier to the window's
 * program.
 */
export function htmlMenu(system: any, data: MenuData) {
  const root = new Menu({
    font: system.fonts.lookup('System'),
    size: 8,
    width: 800,
  });

  const fill = (into: any, menu: MenuData) => {
    for (const item of menu.items) {
      const entry: any = new Menu({ caption: item.text || '-' });

      entry.data = { id: item.id };

      if (item.flags & MF_GRAYED) {
        entry.disabled = true;
      }

      entry.on('click', () => {
        let dialog = entry.parent;

        while (dialog.parent && !(dialog instanceof FixedWindow)) {
          dialog = dialog.parent;
        }

        if (dialog && dialog.data.hWnd && item.id) {
          const task = system.handles.resolve(dialog.data.hInstance);

          system.windows.createMessage(dialog.data.hInstance, task, dialog.data.hWnd, 'command', {
            id: item.id,
          });
        }
      });

      into.append(entry);

      if (item.popup) {
        fill(entry, item.popup);
      }
    }
  };

  fill(root, data);

  return root;
}
