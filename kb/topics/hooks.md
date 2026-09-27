---
kind: topic
name: Hooks and message filters
summary: How Windows 3.1 calls the message filter hooks a program puts in, in what order and with what codes, through a modal dialog box, a menu and CallMsgFilter — recorded with three hooks of both kinds.
probes: [hooks]
---

A hook is a procedure a program puts in USER's way. USER calls it with a code, a `WPARAM` and an `LPARAM` before it does something. Nine of the accessories put in a **message filter**, `WH_MSGFILTER`. USER calls it with each message a dialog box's or a menu's own loop takes, before handling it. That is how a program sees F1 pressed in a dialog box it did not write, to open its help. Recorder puts in a keyboard hook and the Windows Tutorial a CBT hook. winbox.js keeps those, and never calls them.

[[measured]] [[probe:hooks]] puts in three message filters: A and B with [[fn:USER.SetWindowsHook]], each passing on with [[fn:USER.DefHookProc]], and C with [[fn:USER.SetWindowsHookEx]], passing on with [[fn:USER.CallNextHookEx]]. Each notes what it is called with. The probe then runs a modal dialog box and a pop-up menu, each closed by an Escape posted from a timer, and calls [[fn:USER.CallMsgFilter]]. Last, it takes the hooks out one by one. winbox.js agrees with every record.

## The chain

- [[measured]] The newest hook is called first: C, then B, then A. Each passes on to the one put in before it, whichever call put either in.
- [[measured]] A hook that answers without passing on ends the chain, and its answer is `CallMsgFilter`'s: C answering 1 gave 1, and B and A were not called.
- [[measured]] `SetWindowsHook` answers neither nought nor the hook before. The program keeps the answer and hands `DefHookProc` a pointer to it, to go on from there. winbox.js answers the new hook's own handle, and goes on from that hook.
- [[measured]] [[fn:USER.UnhookWindowsHook]] and [[fn:USER.UnhookWindowsHookEx]] answer 1, and the chain closes up round the gap.

## Where USER calls them

- [[measured]] A modal dialog box's loop calls the filters with `MSGF_DIALOGBOX`, 0, for each message it takes: the timer's `WM_TIMER` and the posted `WM_KEYDOWN`. No `WM_PAINT` is among them. The dialog box is painted as it is shown, not by its loop, and winbox.js now paints it and its controls then too.
- [[measured]] A menu's loop calls them with `MSGF_MENU`, 2, for each message it takes, `WM_PAINT` included. It also calls them with a `WM_MENUSELECT` as the menu starts and as it ends.
- [[measured]] `CallMsgFilter` calls them with the program's own message and code, and answers whether one answered non-nought.
- The mouse's moves are left out of the record, because they depend on where the pointer happens to be.

## Found on the way

A dialog box hidden or destroyed took the wrong window with it. The desktop found the window's place in its list, took the window's children out first, and then took out whatever was at that place. When a child sat above the window, that was another window: here, the dialog box's owner, which was then never painted again. Hiding also threw the window's children away for good. Hiding now keeps a window and its children, and destroying finds the window again after its children are gone.

## Not yet followed

- Every other kind of hook: keyboard, CBT, `WH_GETMESSAGE`, `WH_CALLWNDPROC`, journals. They are kept and passed on through, never called.
- A hook for one task, as `SetWindowsHookEx` can ask for. Every hook here is everyone's.
- The message boxes' and scroll bars' own loops, which call the filters with codes of their own.

## In winbox.js

`src/win16/user/hooks.ts` keeps each kind's chain, newest first, and calls the filters for the loops in `dialogs.ts` and `menu-loop.ts`.
