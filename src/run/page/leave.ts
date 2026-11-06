/**
 * The way a keyboard user leaves the Windows desktop. While the desktop has
 * the keyboard every key goes to Windows -- Tab and Escape among them, as
 * Windows programs need them -- so the page cannot take one of those.
 *
 * Escape with the Meta key held (the Windows logo key, Command on a Mac)
 * leaves it. Windows 3.1's keyboard has no such key, and neither engine
 * gives it a virtual key (`User.VIRTUAL_KEY_TRANSLATE` and
 * `crates/winbox-win16/src/key_input.rs` have none for `MetaLeft` or
 * `MetaRight`, and drop a key they have none for), so Windows is told
 * nothing of Meta; the Escape pressed with it is taken by the page before
 * the desktop has it. No Windows program sees any key of it, so none can
 * have it for its own.
 */

/** The keys of a key's event that tell it. */
export interface KeyPressed {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** Whether a key pressed is the one that leaves the desktop: Meta and Escape, without Ctrl or Alt. */
export function leavesDesktop(event: KeyPressed) {
  return event.key === 'Escape' && event.metaKey && !event.ctrlKey && !event.altKey;
}

/** The way out, as the page tells it. */
export const LEAVE_TEXT =
  'While the desktop has the keyboard, every key goes to Windows. To leave it, press Esc ' +
  'while holding the Windows logo key (Command on a Mac).';
