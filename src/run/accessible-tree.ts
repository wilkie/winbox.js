/**
 * USER's windows as an accessibility tree, as the engine hands it to the
 * page: what a screen reader is given in place of the pixels the screen
 * shows. The Rust engine makes it (`crates/winbox-win16/src/accessible_tree.rs`,
 * where the mapping's choices are written) and `AriaMirror` (`aria-mirror.ts`)
 * keeps it as elements.
 */

/** A window, menu or control, as ARIA names it. */
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

/** The tree: the top-level windows, the topmost first, and the key of what has the keys. */
export interface AccessibleTree {
  nodes: AccessibleNode[];
  focus: string | null;
}
