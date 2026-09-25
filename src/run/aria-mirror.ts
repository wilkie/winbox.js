'use strict';

import { type AccessibleNode, type AccessibleTree } from '../win16/user/accessible-tree.js';

/**
 * The accessibility tree of the raster desktop, kept as elements a screen
 * reader can read: the mirror of what the canvas shows. See
 * `win16/user/accessible-tree.ts` for what is mapped to what.
 *
 * Elements are kept by key from one update to the next -- a window that
 * stays is the same element, only its attributes changed -- so a reader does
 * not lose its place each time something repaints. What has the keys is told
 * to the reader through `aria-activedescendant` on `host`, the element that
 * holds the keyboard.
 */
export class AriaMirror {
  readonly root: HTMLElement;
  readonly host: HTMLElement;
  readonly prefix: string;

  #last = '';

  constructor(root: HTMLElement, host: HTMLElement, prefix = 'mirror') {
    this.root = root;
    this.host = host;
    this.prefix = prefix;
  }

  /** Brings the elements in line with a tree; nothing is touched if it is unchanged. */
  update(tree: AccessibleTree) {
    const serial = JSON.stringify(tree);

    if (serial === this.#last) {
      return false;
    }

    this.#last = serial;
    this.#reconcile(this.root, tree.nodes);

    const focused = tree.focus
      ? this.root.ownerDocument.getElementById(this.idOf(tree.focus))
      : null;

    if (focused) {
      this.host.setAttribute('aria-activedescendant', focused.id);
    } else {
      this.host.removeAttribute('aria-activedescendant');
    }

    return true;
  }

  idOf(key: string) {
    return `${this.prefix}-${key}`;
  }

  #reconcile(parent: HTMLElement, nodes: AccessibleNode[]) {
    const existing = new Map<string, HTMLElement>();

    for (const child of Array.from(parent.children) as HTMLElement[]) {
      if (child.dataset.key) {
        existing.set(child.dataset.key, child);
      }
    }

    let at: Element | null = parent.firstElementChild;

    for (const node of nodes) {
      let element = existing.get(node.key);

      if (element) {
        existing.delete(node.key);
      } else {
        element = parent.ownerDocument.createElement('div');
        element.dataset.key = node.key;
        element.id = this.idOf(node.key);
      }

      this.#apply(element, node);

      if (element !== at) {
        parent.insertBefore(element, at);
      } else {
        at = at.nextElementSibling;
      }
    }

    for (const stale of existing.values()) {
      stale.remove();
    }
  }

  #apply(element: HTMLElement, node: AccessibleNode) {
    const set = (name: string, value: string | undefined) => {
      if (value === undefined) {
        element.removeAttribute(name);
      } else if (element.getAttribute(name) !== value) {
        element.setAttribute(name, value);
      }
    };

    const flag = (value: boolean | 'mixed' | undefined) =>
      value === undefined ? undefined : String(value);

    /* Text is itself: static text and what an edit control holds are read as
     * content, everything else by its label. */
    const text =
      node.role === 'text' ? node.name : node.role === 'textbox' ? node.value : undefined;

    set('role', node.role === 'text' ? undefined : node.role);
    set('aria-label', text === undefined ? node.name : undefined);
    set('aria-roledescription', node.roleDescription);
    set('aria-description', node.description);
    set('aria-checked', flag(node.checked));
    set('aria-disabled', node.disabled ? 'true' : undefined);
    set('aria-expanded', flag(node.expanded));
    set('aria-haspopup', node.hasPopup ? 'menu' : undefined);
    set('aria-multiline', node.role === 'textbox' ? String(!!node.multiline) : undefined);
    set('aria-orientation', node.orientation);
    set('aria-keyshortcuts', node.shortcut);

    if (text !== undefined) {
      if (element.textContent !== text) {
        element.textContent = text;
      }

      return;
    }

    this.#reconcile(element, node.children);
  }
}
