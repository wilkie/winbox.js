---
kind: topic
name: Hooks and message filters
summary: How Windows 3.1 calls the hooks a program puts in — the message filters, in what order and with what codes, through a modal dialog box, a menu and CallMsgFilter; the shell hook; and the window procedure hook MFC's programs rely on.
probes: [hooks, shlhook, cwphook]
---

A hook is a procedure a program puts in USER's way. USER calls it with a code, a `WPARAM` and an `LPARAM` before it does something. Nine of the accessories put in a **message filter**, `WH_MSGFILTER`. USER calls it with each message a dialog box's or a menu's own loop takes, before handling it. That is how a program sees F1 pressed in a dialog box it did not write, to open its help. Recorder puts in a keyboard hook and the Windows Tutorial a CBT hook. winbox.js keeps those, and never calls them. Programs built with Microsoft's MFC put in a window procedure hook, and cannot open a window without it.

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
- [[read out]] A filter's answer is AX alone (`USER.EXE` seg1 `80f0`), whatever is left in DX. File Manager's filter answers `035F0000h` for a key it leaves alone; read as a long, every key in its Copy box was taken as filtered.
- The mouse's moves are left out of the record, because they depend on where the pointer happens to be.

## The shell hook

- [[measured]] [[probe:shlhook]] puts in a shell hook, `WH_SHELL`, and makes and destroys windows of every kind. USER calls it with code 1, `HSHELL_WINDOWCREATED`, and the window, once a top-level window with no owner has had its `WM_CREATE`. It calls it with code 2, `HSHELL_WINDOWDESTROYED`, before that window's `WM_DESTROY`. Overlapped windows and popups are told, hidden or shown. Children and owned popups are not, and neither is showing a window. All 30 records agree.
- SHELL's [[fn:SHELL.RegisterShellHook]] is built on it: Program Manager registers itself, and is posted a message for each such window made and gone.

## The window procedure hook

A program built with MFC keeps a C++ object for each of its windows, and finds it from the window's handle in a map. The object is put in the map by a `WH_CALLWNDPROC` hook, which the program puts in just before it calls [[fn:USER.CreateWindowEx]]. The hook takes the first message USER sends the new window. The Towers from HANOI of the corpus is such a program. winbox.js never called the hook, so the program's window procedure found no object for its window and called through a null pointer. The result was a general protection fault as its window was made.

- [[measured]] [[probe:cwphook]] puts in a `WH_CALLWNDPROC` hook with [[fn:USER.SetWindowsHookEx]] for its own task, as MFC does. It then makes a window, sends it a message, posts it one, and destroys it. USER calls the hook just before the window procedure, with each message sent to the window. That includes the ones USER sends itself while making and destroying it: `WM_GETMINMAXINFO`, `WM_NCCREATE`, `WM_NCCALCSIZE`, `WM_CREATE`, `WM_DESTROY` and `WM_NCDESTROY`.
- [[measured]] A message posted and then dispatched does not go through the hook.
- [[measured]] The code and `WPARAM` are both nought. The `LPARAM` points at five words on the stack: the message's `LPARAM`, low word first, then its `WPARAM`, the message, and the window.
- [[measured]] What the hook leaves in those words is what the window procedure gets. When the probe's hook changed the message to the next one and rewrote `WPARAM` and `LPARAM`, the procedure was handed the changed ones.
- [[measured]] With the hook taken out, nothing is called.
- A first recording made the window visible. Its sequence had hook calls for messages the probe's window procedure never saw, such as `WM_ERASEBKGND` and a second `WM_ACTIVATEAPP`. Those went to other windows (the desktop being uncovered, and the program losing activation) while the probe's task was sending. So the hook sees what its task sends to any window. The sequence USER sends while showing a window made visible is not yet what winbox.js sends, so the recorded probe makes the window hidden.

## Found on the way

- [[fn:USER.PeekMessage]] took any message, whatever window and range it was asked for. The probe peeks for its own window's messages, and was handed another window's `WM_PAINT` for ever, since it never dispatches it. `PeekMessage` now keeps to its window and range, and so does `GetMessage` ([[topic:message-filters]]).
- A dialog box hidden or destroyed took the wrong window with it. The desktop found the window's place in its list, took the window's children out first, and then took out whatever was at that place. When a child sat above the window, that was another window: here, the dialog box's owner, which was then never painted again. Hiding also threw the window's children away for good. Hiding now keeps a window and its children, and destroying finds the window again after its children are gone.

## Not yet followed

- Every other kind of hook: keyboard, CBT, `WH_GETMESSAGE`, journals. They are kept and passed on through, never called.
- The shell hook's code 3, `HSHELL_ACTIVATESHELLWINDOW`, which USER is not yet seen to send.
- A hook for one task, as `SetWindowsHookEx` can ask for. Every hook here is everyone's.
- The message boxes' and scroll bars' own loops, which call the filters with codes of their own.

## In winbox.js

`src/win16/user/hooks.ts` keeps each kind's chain, newest first, and calls the filters for the loops in `dialogs.ts` and `menu-loop.ts`. The scheduler's `callWndProc` calls `sentMessageHook` before every window procedure it runs for a message sent, and `DispatchMessage` goes round it.
