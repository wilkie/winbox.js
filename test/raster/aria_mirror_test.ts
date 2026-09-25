/**
 * @jest-environment jsdom
 */
'use strict';

import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { AriaMirror } from '../../src/run/aria-mirror.js';
import { accessibleTree, plainLabel } from '../../src/win16/user/accessible-tree.js';
import { Desktop } from '../../src/win16/user/desktop.js';
import { MF_CHECKED, MF_GRAYED, MenuData } from '../../src/win16/user/menu-data.js';
import { chromeReady, displayEnvironment } from './chrome.js';

/**
 * The raster desktop's windows as a screen reader is given them: the tree
 * `accessibleTree` makes of USER's windows, and the elements `AriaMirror`
 * keeps of it.
 */

const COLOR_WINDOW = 5;
const OVERLAPPED = 0x00cf0000;
const CHILD = 0x50000000;

(chromeReady('vga') ? describe : describe.skip)('the accessible desktop', () => {
  let setup: any;

  beforeAll(async () => {
    setup = await displayEnvironment('vga');
  });

  const desktopOf = () =>
    new Desktop(
      new DeviceBitmap(setup.mode.width, setup.mode.height, setup.depth, undefined, setup.palette),
      setup.environment
    );

  const background = () => ({ colorref: setup.environment.sysColor(COLOR_WINDOW) });

  const control = (
    desktop: Desktop,
    parent: any,
    className: string,
    style: number,
    text: string,
    extra = {}
  ) => {
    const window = desktop.create(
      10,
      10,
      80,
      20,
      CHILD | style,
      text,
      undefined,
      background(),
      parent
    );

    window.control = { className, style, text, checked: 0, items: [], ...extra };
    desktop.show(window);

    return window;
  };

  /** A window with a menu bar and one of each control. */
  const notepadish = () => {
    const desktop = desktopOf();
    const window = desktop.create(
      40,
      40,
      300,
      200,
      OVERLAPPED,
      'Notepad - (Untitled)',
      ['&File', '&Edit'],
      background()
    );

    desktop.show(window);

    const edit = control(desktop, window, 'EDIT', 0x4, 'hello');

    control(desktop, window, 'BUTTON', 0x0, '&OK');
    control(desktop, window, 'BUTTON', 0x3, '&Wrap', { checked: 1 });
    control(desktop, window, 'BUTTON', 0x9, 'Up');
    control(desktop, window, 'STATIC', 0x0, 'Find what:');
    control(desktop, window, 'LISTBOX', 0x0, '', { items: ['one', 'two'] });
    control(desktop, window, 'SCROLLBAR', 0x1, '');

    return { desktop, window, edit };
  };

  it('names a window by its caption, and says it is active', () => {
    const { desktop, window } = notepadish();
    const [node] = accessibleTree(desktop).nodes;

    expect(node).toMatchObject({
      key: `w${window.id}`,
      role: 'group',
      roleDescription: 'window',
      name: 'Notepad - (Untitled)',
      description: 'active',
    });
  });

  it('gives the system menu, the menu bar and each control a role', () => {
    const { desktop } = notepadish();
    const [node] = accessibleTree(desktop).nodes;

    expect(node.children.map((child) => [child.role, child.name ?? child.value])).toEqual([
      ['button', 'System menu'],
      ['menubar', 'Notepad - (Untitled) menu'],
      ['textbox', 'hello'],
      ['button', 'OK'],
      ['checkbox', 'Wrap'],
      ['radio', 'Up'],
      ['text', 'Find what:'],
      ['listbox', undefined],
      ['scrollbar', undefined],
    ]);
    expect(node.children[1].children.map((item) => [item.name, item.shortcut])).toEqual([
      ['File', 'Alt+F'],
      ['Edit', 'Alt+E'],
    ]);
    expect(node.children[2].multiline).toBe(true);
    expect(node.children[4].checked).toBe(true);
    expect(node.children[5].checked).toBe(false);
    expect(node.children[7].children.map((option) => option.name)).toEqual(['one', 'two']);
    expect(node.children[8].orientation).toBe('vertical');
  });

  it('puts an open menu under the item that opened it, and the focus on its selection', () => {
    const { desktop, window } = notepadish();
    const menu = new MenuData();

    menu.items.push({ flags: 0, id: 1, text: '&New' });
    menu.items.push({ flags: 0, id: 0, text: null });
    menu.items.push({ flags: MF_CHECKED, id: 2, text: '&Word Wrap' });
    menu.items.push({ flags: MF_GRAYED, id: 3, text: '&Undo\tCtrl+Z' });

    desktop.menuOwner = window;
    window.menuSelected = 0;
    const popup = desktop.openPopup(menu, 40, 80, 2);

    const tree = accessibleTree(desktop);
    const file = tree.nodes[0].children[1].children[0];

    expect(tree.nodes).toHaveLength(1);
    expect(file.expanded).toBe(true);
    expect(file.children[0].children.map((item) => [item.role, item.name])).toEqual([
      ['menuitem', 'New'],
      ['separator', undefined],
      ['menuitemcheckbox', 'Word Wrap'],
      ['menuitem', 'Undo'],
    ]);
    expect(file.children[0].children[3]).toMatchObject({ disabled: true, shortcut: 'Control+Z' });
    expect(tree.focus).toBe(`p${popup.id}-2`);
  });

  it('shows a minimized window as its title alone', () => {
    const { desktop, window } = notepadish();

    desktop.minimize(window);

    const [node] = accessibleTree(desktop).nodes;

    expect(node.children).toEqual([]);
    expect(node.description).toContain('minimized');
  });

  it('points the host at the focused control, and keeps elements across updates', () => {
    const { desktop, edit } = notepadish();
    const host = document.createElement('div');
    const root = document.createElement('div');

    host.append(root);
    document.body.append(host);

    const mirror = new AriaMirror(root, host);

    desktop.focus = edit;
    mirror.update(accessibleTree(desktop));

    const element = document.getElementById(`mirror-w${edit.id}`)!;

    expect(element.getAttribute('role')).toBe('textbox');
    expect(element.textContent).toBe('hello');
    expect(host.getAttribute('aria-activedescendant')).toBe(element.id);

    edit.control!.text = 'hello, world';
    mirror.update(accessibleTree(desktop));

    expect(document.getElementById(`mirror-w${edit.id}`)).toBe(element);
    expect(element.textContent).toBe('hello, world');

    host.remove();
  });
});

describe('a label, as a reader hears it', () => {
  it('drops the mnemonic and the accelerator', () => {
    expect(plainLabel('&Undo\tCtrl+Z')).toBe('Undo');
    expect(plainLabel('Fish && &Chips')).toBe('Fish & Chips');
  });
});
