'use strict';

/**
 * A message another task sent, answered early, and asked about. **Read
 * out of `USER.EXE`** and **recorded** by `replym`, whose second program
 * sends the probe its messages. As the Rust engine's `reply_message.rs`.
 */

/** The message another task sent that the task is answering now, if it is. */
function answering(system: any) {
  const task = system.scheduler?.task;

  return task?.inSent ? (task.answering?.[task.answering.length - 1] ?? null) : null;
}

/**
 * The sender of the message the task is answering given its answer now, and
 * the processor, as the answer gives it (`USER.EXE` seg1 `3c37`-`3c96`):
 * what the procedure answers after is not taken. Nothing in a message the
 * task sent itself or was posted, or once answered.
 */
export async function ReplyMessage(this: any, lResult: number) {
  const item = answering(this);

  if (!item || item.replied) {
    return;
  }

  item.replied = true;
  item.done(lResult >>> 0);
  await this.scheduler.handBack(item.from);
}

/**
 * The message another task sent that the task is answering: its window,
 * message, `wParam` and `lParam` written, and 1; nought outside one, or with
 * any of the three handles given not nought (`USER.EXE` seg1 `490e`-`4980`).
 *
 * Not followed: after `ReplyMessage`, where Windows reads the sender's
 * queue from a selector of 1 and faults.
 */
export function QuerySendMessage(this: any, h1: number, h2: number, h3: number, lpmsg: any) {
  if (h1 & 0xffff || h2 & 0xffff || h3 & 0xffff) {
    return 0;
  }

  const item = answering(this);

  if (!item || item.replied || !item.message) {
    return 0;
  }

  lpmsg.hwnd = item.message.hwnd & 0xffff;
  lpmsg.message = item.message.message & 0xffff;
  lpmsg.wParam = item.message.wParam & 0xffff;
  lpmsg.lParam = item.message.lParam >>> 0;

  return 1;
}
