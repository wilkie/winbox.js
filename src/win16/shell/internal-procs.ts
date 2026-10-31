'use strict';

import { GlobalFree } from '../kernel/GlobalFree.js';
import { withMsg } from '../mmsystem/tasks.js';
import { DefWindowProc } from '../user/DefWindowProc.js';
import { DestroyWindow } from '../user/DestroyWindow.js';
import { DispatchMessage } from '../user/DispatchMessage.js';
import { GetTickCount } from '../user/GetTickCount.js';
import { PeekMessage } from '../user/PeekMessage.js';
import { PostMessage } from '../user/PostMessage.js';
import { GetProp, RemoveProp, SetProp } from '../user/props.js';
import { CallWindowProc } from '../user/window-words.js';

/**
 * The two window procedures SHELL exports for its own windows: its DDE
 * windows' (`HERETHARBETYGARS`) and the one its About box's icon is
 * subclassed with (`WCI`). **Read out** of `SHELL.DLL` and **recorded** by
 * `ugaps`. As the Rust engine's `shell/internal_procs.rs`.
 */

const WM_DESTROY = 0x0002;
const WM_DDE_FIRST = 0x03e0;
const WM_DDE_TERMINATE = 0x03e1;
const WM_DDE_ACK = 0x03e4;
const WM_DDE_LAST = 0x03e8;
const PM_REMOVE = 0x0001;

/**
 * The property a DDE window keeps its partner under: SHELL's string at 0A0h
 * of its data (`SHELL.DLL` seg13 `00a0`).
 */
const CONVERSATION = 'ddeconv';
const CONVERSATION_AT = 0x00a0;

/** The partner's property while the window is ending: 1 (seg4 `060d`-`0612`). */
const ENDING = 1;

/** How long `WM_DESTROY` waits for the partner's `WM_DDE_TERMINATE`: ten seconds (seg4 `04f7`). */
const TERMINATE_WAIT = 10000;

/** The property's name, laid in SHELL's data where SHELL keeps it: its far pointer. */
function conversationName(system: any) {
  const data = system._moduleData?.SHELL ?? 0;
  const core = system.machine.cpu.core;

  for (let at = 0; at <= CONVERSATION.length; at++) {
    core.write8(
      data,
      CONVERSATION_AT + at,
      at < CONVERSATION.length ? CONVERSATION.charCodeAt(at) : 0
    );
  }

  return ((data << 16) | CONVERSATION_AT) >>> 0;
}

/**
 * The partner's `WM_DDE_TERMINATE` waited for (seg4 `04ec`-`054c`): the
 * task's DDE messages taken and dispatched, until one to this window is
 * `WM_DDE_TERMINATE`, or ten seconds have gone.
 */
async function awaitTerminate(system: any, hwnd: number) {
  const until = (GetTickCount.call(system) + TERMINATE_WAIT) >>> 0;

  await withMsg(system, async (msg) => {
    for (;;) {
      if (await PeekMessage.call(system, msg, 0, WM_DDE_FIRST, WM_DDE_LAST, PM_REMOVE)) {
        await DispatchMessage.call(system, msg);

        if ((msg.hwnd & 0xffff) === hwnd && (msg.message & 0xffff) === WM_DDE_TERMINATE) {
          return;
        }

        continue;
      }

      if (GetTickCount.call(system) >>> 0 >= until) {
        return;
      }
    }
  });
}

/**
 * The procedure of SHELL's DDE windows (`SHELL.DLL` seg4 `0550`-`065e`),
 * which keep their partner as the property `ddeconv`:
 *
 * * `WM_DDE_ACK` with no partner kept makes the sender the partner, and
 *   answers what `SetProp` did; with the partner 1, or from the partner,
 *   frees the block in lParam's high word -- and from the partner destroys
 *   the window; nought.
 * * `WM_DDE_TERMINATE` from the partner posts it one back, takes the
 *   property away and destroys the window; from anyone else does nothing;
 *   nought.
 * * `WM_DESTROY` with a partner sets the property to 1, posts the partner
 *   `WM_DDE_TERMINATE`, waits for its answer and takes the property away;
 *   then, as any other message, `DefWindowProc`.
 *
 * **Recorded** by `ugaps`.
 */
export async function HERETHARBETYGARS(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  hwnd &= 0xffff;
  wParam &= 0xffff;

  const name = conversationName(this);

  if (message === WM_DDE_ACK) {
    const partner = GetProp.call(this, hwnd, name) & 0xffff;

    if (!partner) {
      return SetProp.call(this, hwnd, name, wParam) & 0xffff;
    }

    if (partner === ENDING) {
      GlobalFree.call(this, lParam >>> 16);
      return 0;
    }

    if (partner === wParam) {
      GlobalFree.call(this, lParam >>> 16);
      await DestroyWindow.call(this, hwnd);
    }

    return 0;
  }

  if (message === WM_DDE_TERMINATE) {
    const partner = GetProp.call(this, hwnd, name) & 0xffff;

    if (partner === wParam) {
      PostMessage.call(this, partner, WM_DDE_TERMINATE, hwnd, 0);
      RemoveProp.call(this, hwnd, name);
      await DestroyWindow.call(this, hwnd);
    }

    return 0;
  }

  if (message === WM_DESTROY) {
    const partner = GetProp.call(this, hwnd, name) & 0xffff;

    if (partner) {
      SetProp.call(this, hwnd, name, ENDING);
      PostMessage.call(this, partner, WM_DDE_TERMINATE, hwnd, 0);
      await awaitTerminate(this, hwnd);
      RemoveProp.call(this, hwnd, name);
    }
  }

  return await DefWindowProc.call(this, hwnd, message, wParam, lParam);
}

/**
 * The procedure SHELL subclasses its About box's icon with (`SHELL.DLL`
 * seg9 `0829`-`0dbd`), for the credits: whatever the message, it ends in
 * `CallWindowProc` of the procedure it kept at 196h of its data as it
 * subclassed the icon. WinBox's About box subclasses nothing, so nothing
 * is kept, and USER's `CallWindowProc` refuses a null procedure through its
 * parameter check, nought (`USER.EXE` seg1 `a827`, `aed0`-`aeed`).
 * `WM_PAINT`'s credits are drawn only in the credits' state, and
 * `WM_NCDESTROY`'s state to let go is none. **Recorded** by `ugaps`, called
 * before any About box: `WM_USER`, `WM_PAINT` and `WM_NCDESTROY` nought.
 */
export async function WCI(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return await CallWindowProc.call(this, 0, hwnd, message, wParam, lParam);
}
