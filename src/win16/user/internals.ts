'use strict';

import { W, word } from '../commdlg/api.js';
import { indexFor } from '../selectors.js';
import { systemQueue } from './system-queue.js';

/**
 * USER's exports for Windows' own components that WinBox answers as a
 * program calling them sees Windows answer: read out of `USER.EXE`, each
 * with what was recorded. See `kb/topics/user-internals.md` for the map of
 * them all. As the Rust engine's `user_internals.rs`.
 */

/** `UserSeeUserDo`'s requests (seg41 `1827`-`1837`). */
const USUD_LOCALALLOC = 1;
const USUD_LOCALFREE = 2;
const USUD_LOCALCOMPACT = 3;
const USUD_LOCALHEAP = 4;
const USUD_FIRSTCLASS = 5;

/** Two of USER's words `UserSeeUserDo` answers: 1C4h and F2h of its data. */
const LOCALHEAP_AT = 0x1c4;
const FIRSTCLASS_AT = 0xf2;

/**
 * Ordinal 216, `UserSeeUserDo` (`USER.EXE` seg41 `181e`): a request by its
 * number, on USER's own data segment -- 1 `LocalAlloc` of `wParam1`'s flags
 * and `lParam2`'s low word's bytes, 2 `LocalFree` of `wParam1`, 3
 * `LocalCompact` of `lParam2`'s low word, 4 and 5 the words at 1C4h and
 * F2h; each a word in DX:AX, DX nought. Any other request answers -1.
 * **Recorded** by `strfunc`. WinBox keeps USER's objects in itself and its
 * data segment holds no local heap, nor those words: the heap's requests
 * answer what WinBox's KERNEL answers for a segment with none.
 *
 * @param {Types.UINT} wReqType - The request.
 * @param {Types.UINT} wParam1 - Its word.
 * @param {Types.DWORD} lParam2 - Its double word.
 *
 * @returns {Types.DWORD} Its answer, or -1.
 */
export function UserSeeUserDo(this: any, wReqType: number, wParam1: number, lParam2: number) {
  const user = this._moduleData?.USER ?? 0;
  const heap = user ? this.allocator.heapOf(indexFor(user)) : null;
  const core = this.machine.cpu.core;
  const word = wParam1 & 0xffff;
  const low = lParam2 & 0xffff;

  switch (wReqType & 0xffff) {
    case USUD_LOCALALLOC:
      return heap ? heap.localAlloc(word, low) & 0xffff : 0;
    case USUD_LOCALFREE:
      return heap ? heap.localFree(word) & 0xffff : word;
    case USUD_LOCALCOMPACT:
      return heap ? heap.localCompact(low) & 0xffff : 0;
    case USUD_LOCALHEAP:
      return user ? core.read16(user, LOCALHEAP_AT) & 0xffff : 0;
    case USUD_FIRSTCLASS:
      return user ? core.read16(user, FIRSTCLASS_AT) & 0xffff : 0;
    default:
      return 0xffffffff;
  }
}

/**
 * Ordinal 481, `Hardware_Event` (`USER.EXE` seg1 `4d6c`): an event put in
 * the system queue from registers -- AX the message, CX and DX `paramL` and
 * `paramH`, SI and DI the extra information, as `keybd_event`'s and
 * `mouse_event`'s own put calls the same routine (`4c82`) -- with the
 * queue's selector read from DS:0 (`4d84`, `4def`), where those two have
 * USER's segment 44. No export names that segment; the one a program can
 * name, USER's data segment 45 (ordinal 285), holds no queue's selector
 * there, and the read of the queue faults inside USER, which USER's own
 * `__GP` handlers answer: nought, nothing put. **Recorded** by `hwevent`.
 * WinBox's input is its own drivers', put in directly, and it answers as a
 * program finds it: nought.
 *
 * @returns {Types.UINT} Nought.
 */
export function Hardware_Event(this: any) {
  return 0;
}

/**
 * Ordinal 400, `FinalUserInit` (`USER.EXE` seg3 `2570`): USER's last step
 * as Windows starts, which KERNEL calls once -- a line in the boot log
 * (`seg3:0238`), a memory device context of the screen and a monochrome
 * bitmap selected into it for USER's own drawing (1BAh, 1B8h; GDI's
 * `CreateCompatibleDC`, `CreateBitmap`, `SelectObject`), its colours set,
 * and GDI's `FinalGDIInit` with the desktop's brush. WinBox's USER has done
 * its own start, and keeps no such context: a second call changes nothing a
 * program can see.
 */
export function FinalUserInit(this: any) {}

/**
 * Ordinal 4, `DisableOEMLayer` (`USER.EXE` seg5 `01a2`): the screen and the
 * input given up, as WINOLDAP does for a DOS program that runs full screen
 * -- the cursor hidden (`ShowCursor(FALSE)`, seg1 `150c`); USER's own
 * disabling (seg5 `00d4`): the installable drivers sent `DRV_DISABLE`
 * (seg2 `04cc`), the sound driver's `disable`, the mouse's, the keyboard's
 * and the system timers' `Disable`, and the system queue emptied
 * (`0143`-`0160`); then GDI's `Death` on USER's screen context.
 * **Recorded** by `oemlayer`: the cursor's count one less; a message
 * posted to the program's queue before still there.
 *
 * WinBox's drivers are its own and its display is not turned off; it hides
 * the cursor and empties the system queue, which is what a program finds.
 */
export async function DisableOEMLayer(this: any) {
  await word(this, 'USER', 'ShowCursor', [W(0)]);
  systemQueue(this).length = 0;
}

/**
 * Ordinal 3, `EnableOEMLayer` (`USER.EXE` seg5 `0165`): the screen and the
 * input taken back -- GDI's `Resurrection` on USER's screen context; USER's
 * own enabling (seg5 `0000`): the system timers, the key state tables
 * cleared (`000a`-`0040`), the keyboard's and the mouse's `Enable`, the
 * sound driver's `enable`, the installable drivers sent `DRV_ENABLE`; then
 * the whole screen redrawn, `RedrawWindow` of the desktop with
 * `RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_FRAME` (`0187`-
 * `0194`), and the cursor shown again (`0199`). **Recorded** by `oemlayer`:
 * every window painted, frame, background and client; the cursor's count
 * back; no key down. WinBox clears its key states, redraws and shows.
 */
export async function EnableOEMLayer(this: any) {
  this._keyStates?.fill(0);
  this._asyncKeys?.fill(0);

  /* `RedrawWindow`'s body for the desktop, as `RepaintScreen` (seg1
   * `77a7`) calls it, with `RDW_FRAME` too: frames, backgrounds and
   * clients. */
  this.rasterDesktop?.repaintAll(true);
  await word(this, 'USER', 'ShowCursor', [W(1)]);
}
