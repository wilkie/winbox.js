/**
 * @jest-environment jsdom
 */
'use strict';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AriaMirror } from '../../src/run/aria-mirror.js';

/**
 * The elements `AriaMirror` keeps of the desktop's accessibility tree, given
 * trees the engine made: the committed `accessible-trees` recordings, which
 * `crates/winbox-win16/tests/accessible_parity.rs` holds the Rust engine to.
 * What the tree says of USER's windows is the engine's, held there and in
 * `crates/winbox-win16/tests/accessible_tree.rs`; this is the page's half,
 * the elements a screen reader reads.
 */

/** A recording's trees, each as the JSON text the engine hands the page. */
function treesOf(name: string): string[] {
  return JSON.parse(readFileSync(join(__dirname, 'accessible-trees', `${name}.json`), 'utf8'))
    .trees;
}

/** A mirror on a host in the document, and a way to take it away again. */
function mirrored() {
  const host = document.createElement('div');
  const root = document.createElement('div');

  host.append(root);
  document.body.append(host);

  return { host, root, mirror: new AriaMirror(root, host), done: () => host.remove() };
}

describe('the accessible desktop', () => {
  /* Notepad, untitled: its edit control has the focus and is empty, and then
   * holds what was typed into it. */
  const notepad = treesOf('notepad');

  it('names a window by its caption, and says it is active', () => {
    const { mirror, done } = mirrored();

    mirror.updateFrom(notepad[0]);

    const element = document.getElementById('mirror-w4')!;

    expect(element.getAttribute('role')).toBe('group');
    expect(element.getAttribute('aria-roledescription')).toBe('window');
    expect(element.getAttribute('aria-label')).toBe('Notepad - (Untitled)');
    expect(element.getAttribute('aria-description')).toBe('active');
    done();
  });

  it('gives the system menu, the menu bar and each control a role', () => {
    const { mirror, done } = mirrored();

    mirror.updateFrom(notepad[0]);

    const window = document.getElementById('mirror-w4')!;

    expect(
      (Array.from(window.children) as HTMLElement[]).map((child) => [
        child.getAttribute('role'),
        child.getAttribute('aria-label') ?? child.textContent,
      ])
    ).toEqual([
      ['button', 'System menu'],
      ['menubar', 'Notepad - (Untitled) menu'],
      ['textbox', ''],
    ]);
    expect(document.getElementById('mirror-w4-sys')!.getAttribute('aria-haspopup')).toBe('menu');

    const file = document.getElementById('mirror-w4-bar-0')!;

    expect(file.getAttribute('role')).toBe('menuitem');
    expect(file.getAttribute('aria-keyshortcuts')).toBe('Alt+F');
    expect(file.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('mirror-w5')!.getAttribute('aria-multiline')).toBe('true');
    done();
  });

  it('puts an open menu under the item that opened it, and the focus on its selection', () => {
    const { host, mirror, done } = mirrored();

    // The File menu opened, its first item selected.
    mirror.updateFrom(notepad[2]);

    const file = document.getElementById('mirror-w4-bar-0')!;
    const menu = document.getElementById('mirror-p1')!;

    expect(file.getAttribute('aria-expanded')).toBe('true');
    expect(menu.parentElement).toBe(file);
    expect(menu.getAttribute('role')).toBe('menu');
    expect(
      (Array.from(menu.children) as HTMLElement[]).map((item) => [
        item.getAttribute('role'),
        item.getAttribute('aria-label'),
      ])
    ).toEqual([
      ['menuitem', 'New'],
      ['menuitem', 'Open...'],
      ['menuitem', 'Save'],
      ['menuitem', 'Save As...'],
      ['menuitem', 'Print'],
      ['menuitem', 'Page Setup...'],
      ['menuitem', 'Print Setup...'],
      ['separator', null],
      ['menuitem', 'Exit'],
    ]);
    expect(document.getElementById('mirror-p1-4')!.getAttribute('aria-disabled')).toBe('true');
    expect(host.getAttribute('aria-activedescendant')).toBe('mirror-p1-0');

    // The selection moved down one, and the menu closed again.
    mirror.updateFrom(notepad[3]);
    expect(host.getAttribute('aria-activedescendant')).toBe('mirror-p1-1');

    mirror.updateFrom(notepad[5]);
    expect(document.getElementById('mirror-p1')).toBeNull();
    expect(file.getAttribute('aria-expanded')).toBe('false');
    done();
  });

  it('points the host at the focused control, and keeps elements across updates', () => {
    const { host, mirror, done } = mirrored();

    expect(mirror.updateFrom(notepad[0])).toBe(true);

    const element = document.getElementById('mirror-w5')!;

    expect(element.getAttribute('role')).toBe('textbox');
    expect(element.textContent).toBe('');
    expect(host.getAttribute('aria-activedescendant')).toBe(element.id);

    // The same tree again changes nothing.
    expect(mirror.updateFrom(notepad[0])).toBe(false);

    // Typed into: the same element, its text changed.
    mirror.updateFrom(notepad[1]);
    expect(document.getElementById('mirror-w5')).toBe(element);
    expect(element.textContent).toBe('hi');
    done();
  });

  it('reads controls of every kind a dialog box has', () => {
    const { mirror, done } = mirrored();
    const ctlcolor = treesOf('ctlcolor');

    mirror.updateFrom(ctlcolor[0]);

    const roles = new Set(
      (Array.from(document.querySelectorAll('[data-key]')) as HTMLElement[]).map(
        (element) => element.getAttribute('role') ?? '(text)'
      )
    );

    for (const role of ['checkbox', 'radio', 'listbox', 'option', 'scrollbar', '(text)']) {
      expect(roles).toContain(role);
    }

    // Static text is read as content, not given a role.
    const text = (Array.from(document.querySelectorAll('[data-key]')) as HTMLElement[]).find(
      (element) => element.getAttribute('role') === null
    )!;

    expect(text.textContent).not.toBe('');
    expect(text.getAttribute('aria-label')).toBeNull();
    expect(
      document.querySelector('[role="scrollbar"]')!.getAttribute('aria-orientation')
    ).not.toBeNull();
    done();
  });
});
