'use strict';

import { type Desktop, type DesktopWindow } from './desktop.js';
import {
  BS_3STATE,
  BS_AUTO3STATE,
  BS_AUTOCHECKBOX,
  BS_AUTORADIOBUTTON,
  BS_CHECKBOX,
  BS_RADIOBUTTON,
  SBS_VERT,
} from './controls.js';
import { MF_CHECKED, MF_DISABLED, MF_GRAYED, MF_POPUP } from './menu-data.js';

/**
 * USER's windows as an accessibility tree: what a screen reader is given in
 * place of the pixels the raster desktop draws.
 *
 * Windows 3.1 had no accessibility interface, so nothing here is measured;
 * it is a mapping, and this file is where its choices are. Each is the
 * nearest ARIA role to what the window is to someone using it:
 *
 * * A top-level window is a group described as a window, named by its
 *   caption, and said to be active, minimized or maximized.
 * * Its menu bar is a `menubar` of `menuitem`s, each with its mnemonic as a
 *   shortcut; an open pop-up is a `menu` inside the item that opened it, and
 *   the system menu is a button with a pop-up of its own.
 * * The standard controls are what they look like: a push button a `button`,
 *   a check box a `checkbox`, a radio button a `radio`, an edit control a
 *   `textbox`, a list box a `listbox` of `option`s, a scroll bar a
 *   `scrollbar`; static text is text.
 *
 * Hidden windows are left out, and so is a minimized window's content: an
 * icon shows its title and nothing else. The tree is in the order the
 * windows are, the topmost first, children in the order they were made.
 *
 * `focus` names what keys go to: the item selected in the open menu if one is
 * open, or the window with the focus.
 */

export interface AccessibleNode {
  /** Stable across updates, so a renderer can keep what a reader has found. */
  key: string;
  role: string;
  name?: string;
  description?: string;
  roleDescription?: string;
  /** For a text box, what it holds. */
  value?: string;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  expanded?: boolean;
  hasPopup?: boolean;
  multiline?: boolean;
  orientation?: 'horizontal' | 'vertical';
  shortcut?: string;
  children: AccessibleNode[];
}

export interface AccessibleTree {
  nodes: AccessibleNode[];
  focus: string | null;
}

const WS_SYSMENU = 0x00080000;
const ES_MULTILINE = 0x0004;
const BS_GROUPBOX = 0x7;

/** A label as a reader should hear it: no `&` for the mnemonic, no accelerator after a tab. */
export function plainLabel(text: string) {
  return text.split('\t')[0].replace(/&(.)/g, '$1');
}

/** The key a label's `&` marks, as ARIA writes a shortcut with Alt. */
function mnemonic(text: string) {
  const match = /&([^&])/.exec(text.split('\t')[0]);

  return match ? `Alt+${match[1].toUpperCase()}` : undefined;
}

/** An accelerator written after a tab, as ARIA writes it: `Ctrl+Z` is `Control+Z`. */
function accelerator(text: string) {
  const after = text.split('\t')[1];

  return after ? after.replace(/\bCtrl\b/g, 'Control').replace(/\s+/g, '') : undefined;
}

export function accessibleTree(desktop: Desktop): AccessibleTree {
  const popups = desktop.windows.filter((window) => window.popup && window.visible).reverse();
  let focus: string | null = null;

  /** The open pop-ups, oldest first, as nodes, each nested in the item that opened it. */
  const menuNode = (level: number): AccessibleNode | null => {
    const window = popups[level];

    if (!window?.popup) {
      return null;
    }

    const { menu, selected } = window.popup;
    const next = popups[level + 1]?.popup?.menu ?? null;

    if (selected >= 0) {
      focus = `p${window.id}-${selected}`;
    }

    return {
      key: `p${window.id}`,
      role: 'menu',
      children: menu.items.map((item, index) => {
        if (!item.text && !(item.flags & MF_POPUP)) {
          return { key: `p${window.id}-${index}`, role: 'separator', children: [] };
        }

        const opens = !!item.popup && item.popup === next;
        const child = opens ? menuNode(level + 1) : null;

        return {
          key: `p${window.id}-${index}`,
          role: item.flags & MF_CHECKED ? 'menuitemcheckbox' : 'menuitem',
          name: plainLabel(item.text ?? ''),
          shortcut: accelerator(item.text ?? ''),
          ...(item.flags & MF_CHECKED ? { checked: true } : {}),
          ...(item.flags & (MF_GRAYED | MF_DISABLED) ? { disabled: true } : {}),
          ...(item.popup ? { hasPopup: true, expanded: opens } : {}),
          children: child ? [child] : [],
        };
      }),
    };
  };

  const control = (window: DesktopWindow): AccessibleNode | null => {
    const state = window.control!;
    const key = `w${window.id}`;
    const name = plainLabel(state.text);
    const kind = state.style & 0xf;

    switch (state.className.toUpperCase()) {
      case 'BUTTON':
        if (
          kind === BS_CHECKBOX ||
          kind === BS_AUTOCHECKBOX ||
          kind === BS_3STATE ||
          kind === BS_AUTO3STATE
        ) {
          return {
            key,
            role: 'checkbox',
            name,
            checked: state.checked === 2 ? 'mixed' : state.checked === 1,
            children: [],
          };
        }

        if (kind === BS_RADIOBUTTON || kind === BS_AUTORADIOBUTTON) {
          return { key, role: 'radio', name, checked: state.checked === 1, children: [] };
        }

        if (kind === BS_GROUPBOX) {
          return { key, role: 'group', name, children: children(window) };
        }

        return { key, role: 'button', name, children: [] };

      case 'STATIC':
        return { key, role: 'text', name, children: [] };

      case 'EDIT':
        return {
          key,
          role: 'textbox',
          value: state.text,
          multiline: !!(state.style & ES_MULTILINE),
          children: [],
        };

      case 'LISTBOX':
        return {
          key,
          role: 'listbox',
          children: state.items.map((item, index) => ({
            key: `${key}-${index}`,
            role: 'option',
            name: item,
            children: [],
          })),
        };

      case 'SCROLLBAR':
        return {
          key,
          role: 'scrollbar',
          orientation: state.style & SBS_VERT ? 'vertical' : 'horizontal',
          children: [],
        };
    }

    return null;
  };

  const children = (parent: DesktopWindow): AccessibleNode[] =>
    desktop.windows
      .filter((window) => window.parent === parent && window.visible)
      .map((window) => (window.control ? control(window) : windowNode(window)))
      .filter((node): node is AccessibleNode => node !== null);

  const windowNode = (window: DesktopWindow): AccessibleNode => {
    const key = `w${window.id}`;
    const nodes: AccessibleNode[] = [];
    const open = desktop.menuOwner === window;

    if (window.state !== 'minimized') {
      if (window.style & WS_SYSMENU && !window.parent) {
        const menu = open && window.systemMenuOpen ? menuNode(0) : null;

        if (open && window.systemMenuOpen && focus === null) {
          focus = `${key}-sys`;
        }

        nodes.push({
          key: `${key}-sys`,
          role: 'button',
          name: 'System menu',
          hasPopup: true,
          expanded: !!menu,
          children: menu ? [menu] : [],
        });
      }

      if (window.menu?.length) {
        nodes.push({
          key: `${key}-bar`,
          role: 'menubar',
          name: window.title ? `${window.title} menu` : undefined,
          children: window.menu.map((label, index) => {
            const selected = open && window.menuSelected === index;
            const menu = selected ? menuNode(0) : null;

            if (selected && focus === null) {
              focus = `${key}-bar-${index}`;
            }

            return {
              key: `${key}-bar-${index}`,
              role: 'menuitem',
              name: plainLabel(label),
              shortcut: mnemonic(label),
              hasPopup: true,
              expanded: !!menu,
              children: menu ? [menu] : [],
            };
          }),
        });
      }

      nodes.push(...children(window));
    }

    const states = [
      window.active ? 'active' : null,
      window.state === 'minimized' ? 'minimized' : null,
      window.state === 'maximized' ? 'maximized' : null,
    ].filter(Boolean);

    return {
      key,
      role: 'group',
      roleDescription: 'window',
      name: window.title || undefined,
      description: states.length ? states.join(', ') : undefined,
      children: nodes,
    };
  };

  const nodes = desktop.windows
    .filter((window) => window.visible && !window.parent && !window.popup && !window.titleOf)
    .map(windowNode);

  if (focus === null && desktop.focus && !desktop.menuOwner) {
    focus = `w${desktop.focus.id}`;
  }

  return { nodes, focus };
}
