---
kind: topic
name: Hooks and message filters
summary: How Windows 3.1 calls the hooks a program puts in — the message filters, in what order and with what codes, through a modal dialog box, a menu and CallMsgFilter; the shell hook; and the window procedure hook MFC's programs rely on.
probes: [hooks, shlhook, cwphook, jrnlrec, jrnlplay, inhook, alttab, gmhook, hwhook]
---

A hook is a procedure a program puts in USER's way. USER calls it with a code, a `WPARAM` and an `LPARAM` before it does something. Nine of the accessories put in a **message filter**, `WH_MSGFILTER`. USER calls it with each message a dialog box's or a menu's own loop takes, before handling it. That is how a program sees F1 pressed in a dialog box it did not write, to open its help. Recorder puts in **journal hooks**, which see every key and every press of the mouse taken, and play them back in place of the keyboard and the mouse, and a **keyboard hook**, which sees each key a program takes; [[topic:system-queue]] has where USER calls them. The Windows Tutorial puts in a CBT hook, `WH_CBT`, for `HCBT_SYSCOMMAND` alone; winbox.js calls its CBT hooks only as a key or a click leaves the system queue where a keyboard or mouse hook is in, which the Tutorial never has, and so calls the Tutorial's never. DDEML puts in a message hook, `WH_GETMESSAGE`, which USER calls with each message a program takes; no accessory loads DDEML. Programs built with Microsoft's MFC put in a window procedure hook, and cannot open a window without it.

## How USER keeps them

[[read out]] Each hook is a block of 14 bytes in USER's local heap (`USER.EXE` seg1 `7d77`-`7e35`): the next hook, the procedure, the kind, the task's queue for a hook put in for one task or nought, the module, and whether it is being called. The system's chains begin at `8A2h` of USER's data, a word for each kind from `WH_MSGFILTER`, -1, to `WH_SHELL`, 10; a task's at `52h` of its queue, called before the system's (`7ca2`, `7cbb`). A kind outside -1 to 10 is refused (`7d8f`). Putting in a journal hook, record or playback, makes the mouse move where it is (`7e4a`, the kinds' flags at `7c96`; [[topic:mouse-input]]), and a playback hook is counted at `7Eh` of USER's segment 44 (`7e45`). A hook taken out while it is being called has its procedure cleared, and is freed after (`7e9f`). USER's caller of hooks (`800d`) calls a debugging hook, `WH_DEBUG`, first, where one is in, and lets it stop the call.

[[measured]] [[probe:hooks]] puts in three message filters: A and B with [[fn:USER.SetWindowsHook]], each passing on with [[fn:USER.DefHookProc]], and C with [[fn:USER.SetWindowsHookEx]], passing on with [[fn:USER.CallNextHookEx]]. Each notes what it is called with. The probe then runs a modal dialog box and a pop-up menu, each closed by an Escape posted from a timer, and calls [[fn:USER.CallMsgFilter]]. Last, it takes the hooks out one by one. winbox.js agrees with every record.

## The chain

- [[measured]] The newest hook is called first: C, then B, then A. Each passes on to the one put in before it, whichever call put either in.
- [[measured]] A hook that answers without passing on ends the chain, and its answer is `CallMsgFilter`'s: C answering 1 gave 1, and B and A were not called.
- [[measured]] `SetWindowsHook` answers neither nought nor the hook before. The program keeps the answer and hands `DefHookProc` a pointer to it, to go on from there. winbox.js answers the new hook's own handle, and goes on from that hook.
- [[measured]] [[fn:USER.UnhookWindowsHook]] and [[fn:USER.UnhookWindowsHookEx]] answer 1, and the chain closes up round the gap.

## Where USER calls them

- [[measured]] A modal dialog box's loop calls the filters with `MSGF_DIALOGBOX`, 0, for each message it takes: the timer's `WM_TIMER` and the posted `WM_KEYDOWN`. No `WM_PAINT` is among them. The dialog box is painted as it is shown, not by its loop, and winbox.js now paints it and its controls then too.
- [[measured]] A menu's loop calls them with `MSGF_MENU`, 2, for each message it takes, `WM_PAINT` included. It also calls them with a `WM_MENUSELECT` as the menu starts and as it ends.
- [[measured]] Alt and Tab's loop calls them with `MSGF_NEXTWINDOW`, 6, for each message it looks at, before it takes it -- the keys, a move of the mouse, a press ([[probe:alttab]]). [[read out]] One they take it looks at again (`USER.EXE` seg23 `0a5d`; [[topic:task-list]]).
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

## The input hooks

The journal record and playback hooks, `WH_JOURNALRECORD` and `WH_JOURNALPLAYBACK`, the keyboard hooks, `WH_KEYBOARD`, and the mouse hooks, `WH_MOUSE`, are called as USER's system queue gives out the keyboard's and the mouse's input; [[topic:system-queue]] has each call, its codes and its structures, and what [[probe:jrnlrec]], [[probe:jrnlplay]] and [[probe:inhook]] recorded of them. In short:

- [[measured]] A journal record hook is handed each event as it is taken, with `HC_ACTION` and an `EVENTMSG`: the message as it was put in, `paramL`, `paramH` and the time. It is told `HC_SYSMODALON` and `HC_SYSMODALOFF` as a window is made system-modal and no longer.
- [[measured]] A journal playback hook is asked for each event with `HC_GETNEXT`, answering how long to wait first, and told `HC_SKIP` as it is taken. While it is in, the keyboard's input waits in the queue for after it, and the mouse's moves are lost.
- [[measured]] A keyboard hook is handed each key with `HC_ACTION` as it is taken and `HC_NOREMOVE` as it is only looked at, its virtual key and its `lParam`; a mouse hook each mouse message so, with a `MOUSEHOOKSTRUCT`. Either throws the event away by answering non-nought.
- [[read out]] The keys the queue takes for itself -- Control and Escape, Print Screen and the hot keys ([[topic:task-list]]) -- are handed to the journal record hooks as they are taken, and never to the keyboard hooks (`USER.EXE` seg1 `30e6`, `30fa`, `3178`).
- [[measured]] Where a keyboard hook is in, the CBT hooks are told `HCBT_KEYSKIPPED` as a key leaves the queue, taken or thrown away; where a mouse hook is in, `HCBT_CLICKSKIPPED` as a mouse event does ([[probe:hwhook]]).
- [[measured]] The hardware hooks, `WH_HARDWARE`, are handed each event that is neither a key nor the mouse's, `WM_QUEUESYNC` excepted -- in Windows 3.1, what a journal playback hook plays back -- with a `HARDWAREHOOKSTRUCT`, and may throw it away ([[probe:hwhook]]).

## The message hooks

[[read out]] Every look of `GetMessage` and `PeekMessage` that finds a message -- posted, the quit, the input, a paint or a timer -- ends at `USER.EXE` seg1 `2597`, once the message is in the program's `MSG`. Where a `WH_GETMESSAGE` hook is in, the task's (`[58h]` of its queue) or the system's (`[8AAh]`), USER calls the chain with `HC_ACTION`, the look's flags, and the program's `MSG` itself (`25a9`-`25b7`). The flags are what `PeekMessage` was given, `PM_REMOVE` and `PM_NOYIELD` as the program asked, and `PM_REMOVE` for `GetMessage` (`a68f`, `2446`-`244e`, `a744`); a task locked with [[fn:USER.LockMyTask]] has `PM_NOYIELD` added (`245b`-`2462`). A message only looked at is handed over too. Then `GetMessage` answers nought where the `MSG` now holds `WM_QUIT` (`25bc`-`25cf`): it looks at the message as the hooks left it. A message sent is not looked for, and never handed to them.

[[measured]] [[probe:gmhook]] puts in a message hook with [[fn:USER.SetWindowsHook]], as DDEML puts in its own:

- `WM_USER` posted, then `PeekMessage` with `PM_NOREMOVE`: the hook is handed it with a `wParam` of nought; with `PM_REMOVE`, 1; again, finding nothing, the hook is not called. With `PM_REMOVE` and `PM_NOYIELD`, 3. `GetMessage`, 1.
- The hook making `WM_USER + 5` into `WM_USER + 6`, with a `wParam` of 66h: `PeekMessage` with `PM_NOREMOVE` hands the program `WM_USER + 6`, and the next look, with `PM_REMOVE`, finds `WM_USER + 5` in the queue still, which the hook changes again.
- The hook making `WM_USER + 7` into `WM_QUIT`: `GetMessage` answers nought, its `wParam` still 7. Making `WM_QUIT` into `WM_USER + 8`: `GetMessage` answers 1, the quit's code its `wParam`. The quit has no window.
- X pressed through `KEYBD_EVENT`, a keyboard hook in too: each key is handed to the keyboard hook first and the message hook after, and `WM_CHAR` from [[fn:USER.TranslateMessage]] to the message hook alone.
- `WM_PAINT` and `WM_TIMER` are handed over; `WM_USER + 9` sent is not.
- After `LockMyTask(TRUE)`, `PeekMessage` with `PM_REMOVE` hands the hook 3.
- With the hook taken out, nothing is called.

Both engines agree with all fourteen records. Before, the hooks were kept and never called.

## Not yet followed

- `WH_DEBUG` and `WH_SYSMSGFILTER`, and the CBT hooks' codes but `HCBT_KEYSKIPPED` and `HCBT_CLICKSKIPPED`. They are kept and passed on through, never called. [[read out]] USER's caller of hooks calls a `WH_DEBUG` hook first, where one is in (`800d`-`805f`).
- The shell hook's code 3, `HSHELL_ACTIVATESHELLWINDOW`, which USER is not yet seen to send.
- A hook for one task, as `SetWindowsHookEx` can ask for. Every hook here is everyone's.
- The message boxes' and scroll bars' own loops, which call the filters with codes of their own.

## In winbox.js

`src/win16/user/hooks.ts` keeps each kind's chain, newest first, and calls the filters for the loops in `dialogs.ts` and `menu-loop.ts`. The scheduler's `callWndProc` calls `sentMessageHook` before every window procedure it runs for a message sent, and `DispatchMessage` goes round it. `callHooksWith` lays a structure of USER's on the stack for a hook; `system-queue.ts` calls the input hooks with it. The Rust engine has the same in `crates/winbox-win16/src/hooks.rs` and `system_queue.rs`.
