---
kind: topic
name: Hooks and message filters
summary: How Windows 3.1 calls the hooks a program puts in — the message filters, the system's and the task's, in what order and with what codes, through a modal dialog box, a menu, a scroll bar and CallMsgFilter; the computer-based training hooks and what each code lets them stop; the debugging hook; the shell hook; and the window procedure hook MFC's programs rely on.
probes:
  [
    hooks,
    shlhook,
    cwphook,
    jrnlrec,
    jrnlplay,
    inhook,
    alttab,
    gmhook,
    hwhook,
    sysfilt,
    cbthook,
    cbteat,
    dbghook,
    sebhook,
  ]
---

A hook is a procedure a program puts in USER's way. USER calls it with a code, a `WPARAM` and an `LPARAM` before it does something. Nine of the accessories put in a **message filter**, `WH_MSGFILTER`. USER calls it with each message a dialog box's or a menu's own loop takes, before handling it. That is how a program sees F1 pressed in a dialog box it did not write, to open its help. Recorder puts in **journal hooks**, which see every key and every press of the mouse taken, and play them back in place of the keyboard and the mouse, and a **keyboard hook**, which sees each key a program takes; [[topic:system-queue]] has where USER calls them. The Windows Tutorial puts in a computer-based training hook, `WH_CBT`, which USER asks before it makes, destroys, activates, focuses, minimizes or moves a window, and before `DefWindowProc` carries out a system command; the Tutorial's refuses Alt and Tab and the Task List while it runs ([below](#the-computer-based-training-hooks)). DDEML puts in a message hook, `WH_GETMESSAGE`, which USER calls with each message a program takes; no accessory loads DDEML. Programs built with Microsoft's MFC put in a window procedure hook, and cannot open a window without it.

## How USER keeps them

[[read out]] Each hook is a block of 14 bytes in USER's local heap (`USER.EXE` seg1 `7d77`-`7e35`): the next hook, the procedure, the kind, the task's queue for a hook put in for one task or nought, the module, and whether it is being called. The system's chains begin at `8A2h` of USER's data, a word for each kind from `WH_MSGFILTER`, -1, to `WH_SHELL`, 10; a task's at `52h` of its queue, called before the system's (`7ca2`, `7cbb`). A kind outside -1 to 10 is refused (`7d8f`). Putting in a journal hook, record or playback, makes the mouse move where it is (`7e4a`, the kinds' flags at `7c96`; [[topic:mouse-input]]), and a playback hook is counted at `7Eh` of USER's segment 44 (`7e45`). A hook taken out while it is being called has its procedure cleared, and is freed after (`7e9f`). USER's caller of hooks (`800d`) calls a debugging hook, `WH_DEBUG`, first, where one is in ([below](#the-debugging-hook)).

- [[read out]] Each kind has flags at `7C96h` of the segment, a byte a kind from -1. Bit 0 lets a hook of the kind be put in for one task: every kind but the journal hooks, `WH_JOURNALRECORD` and `WH_JOURNALPLAYBACK`, and the system message filters, `WH_SYSMSGFILTER`. One of those asked for with a task is refused (`7db7`-`7dc4`). Bit 1 makes the mouse move as the hook is put in, the journal hooks'.
- [[measured]] [[fn:USER.SetWindowsHookEx]] with `WH_SYSMSGFILTER` and the probe's own task answers nought; with no task, a handle ([[probe:sysfilt]]).
- [[read out]] The task's chain of a kind comes before the system's: `7ca2` takes the task's where it has one, and the last of the task's goes on to the system's first (`7cbb`-`7cd3`).

[[measured]] [[probe:hooks]] puts in three message filters: A and B with [[fn:USER.SetWindowsHook]], each passing on with [[fn:USER.DefHookProc]], and C with [[fn:USER.SetWindowsHookEx]], passing on with [[fn:USER.CallNextHookEx]]. Each notes what it is called with. The probe then runs a modal dialog box and a pop-up menu, each closed by an Escape posted from a timer, and calls [[fn:USER.CallMsgFilter]]. Last, it takes the hooks out one by one. winbox.js agrees with every record.

## The chain

- [[measured]] The newest hook is called first: C, then B, then A. Each passes on to the one put in before it, whichever call put either in.
- [[measured]] A hook that answers without passing on ends the chain, and its answer is `CallMsgFilter`'s: C answering 1 gave 1, and B and A were not called.
- [[measured]] `SetWindowsHook` answers neither nought nor the hook before. The program keeps the answer and hands `DefHookProc` a pointer to it, to go on from there. winbox.js answers the new hook's own handle, and goes on from that hook.
- [[measured]] [[fn:USER.UnhookWindowsHook]] and [[fn:USER.UnhookWindowsHookEx]] answer 1, and the chain closes up round the gap.

## Where USER calls them

[[read out]] USER has one caller of the message filters (`80cd`). It calls none while a window is system-modal (`80d8`); else it calls the system message filters, `WH_SYSMSGFILTER`, and only where they answered nought in AX the task's, `WH_MSGFILTER` (`80e8`-`8103`). Its answer is that last chain's AX. Its callers are a dialog box's loop (seg25 `0c38`), a menu's (seg10 `0079`, `1ec9`), a scroll bar's (seg18 `15d2`), Alt and Tab's (seg23 `0a58`), and [[fn:USER.CallMsgFilter]] (`a85b`). No other code of USER calls it: the loop that moves and sizes a window calls no filter, nor does any loop of USER's give `MSGF_MESSAGEBOX`, 1, `MSGF_MOVE`, 3, or `MSGF_SIZE`, 4.

[[measured]] [[probe:sysfilt]] puts in a system filter `S` and a filter for its own task `F`, both noting each call, and both passing on:

- `CallMsgFilter` with code 77: `S` first, then `F`, and it answers nought. `S` answering 1: `F` is not called, and it answers 1. `F` answering 1: both are called, and it answers 1.
- A modal dialog box closed by Escape posted from a timer: `S` and `F` each with `MSGF_DIALOGBOX`, 0, for the `WM_TIMER` and the `WM_KEYDOWN`, `S` first each time.
- A message box closed the same way: the same, code 0. A message box is a dialog box to its loop.
- A pop-up menu: `MSGF_MENU`, 2, for the `WM_MENUSELECT` as it starts, each message taken, and the `WM_MENUSELECT` as it ends.
- A press and release on a scroll bar control's arrow through `MOUSE_EVENT`: `MSGF_SCROLLBAR`, 5, for the `WM_LBUTTONUP` its loop takes.
- The window moved from the keyboard, the keys posted first: no filter is called.
- `CallMsgFilter` while the window is system-modal: neither is called, and it answers nought; with no system-modal window again, both are.

Both engines agree with all thirteen records. Before, the system filters were kept and never called, and the scroll bar's loop called no filter.

- [[measured]] A modal dialog box's loop calls the filters with `MSGF_DIALOGBOX`, 0, for each message it takes: the timer's `WM_TIMER` and the posted `WM_KEYDOWN`. No `WM_PAINT` is among them. The dialog box is painted as it is shown, not by its loop, and winbox.js now paints it and its controls then too.
- [[measured]] A menu's loop calls them with `MSGF_MENU`, 2, for each message it takes, `WM_PAINT` included. It also calls them with a `WM_MENUSELECT` as the menu starts and as it ends.
- [[measured]] Alt and Tab's loop calls them with `MSGF_NEXTWINDOW`, 6, for each message it looks at, before it takes it -- the keys, a move of the mouse, a press ([[probe:alttab]]). [[read out]] One they take it looks at again (`USER.EXE` seg23 `0a5d`; [[topic:task-list]]).
- [[measured]] `CallMsgFilter` calls them with the program's own message and code, and answers what the filter that ended the chain answered.
- [[read out]] A filter's answer is AX alone (`USER.EXE` seg1 `80f0`), whatever is left in DX. File Manager's filter answers `035F0000h` for a key it leaves alone; read as a long, every key in its Copy box was taken as filtered.
- The mouse's moves are left out of the record, because they depend on where the pointer happens to be.

## The computer-based training hooks

[[read out]] USER asks the computer-based training hooks, `WH_CBT`, before it does each of these things, with a code, a `WPARAM` and an `LPARAM`; for most, a hook answering non-nought stops it. Each caller tests AX alone but `HCBT_MOVESIZE`'s, which tests DX and AX.

| Code                 | When                                                                                                                                                                                               | `WPARAM`, `LPARAM`                                                                                                                                          | A non-nought answer                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `HCBT_MOVESIZE`, 0   | The move or size loop let go elsewhere than it began (seg6 `11b1`-`11d6`)                                                                                                                          | The window; its new rectangle on the screen                                                                                                                 | It keeps the rectangle it began with (`1241`)         |
| `HCBT_MINMAX`, 1     | A window minimized, maximized, or restored from either (seg6 `1ae0`-`1af5`): [[fn:USER.ShowWindow]] with 2, 3, 6 or 7, or with 1, 4 or 9 for a window minimized or maximized (seg14 `0c29`-`0c8d`) | The window; the command as `ShowWindow` was given it                                                                                                        | Nothing changes                                       |
| `HCBT_QS`, 2         | The move or size loop takes `WM_QUEUESYNC`, which it looks for before the keys and the mouse (seg6 `1658`-`16b3`)                                                                                  | Nought, nought                                                                                                                                              | Not looked at                                         |
| `HCBT_CREATEWND`, 3  | A window made, before it is sent anything (seg8 `0450`-`047d`)                                                                                                                                     | The window; a `CBT_CREATEWND`: a far pointer to the `CREATESTRUCT` -- `CreateWindow`'s own arguments on the stack -- and the window to put it after, nought | USER takes the window apart again (`073b`): see below |
| `HCBT_DESTROYWND`, 4 | [[fn:USER.DestroyWindow]], once the window is known to be the caller's (seg8 `0a4d`-`0a5d`)                                                                                                        | The window; nought                                                                                                                                          | Nothing is destroyed, and it answers nought           |
| `HCBT_ACTIVATE`, 5   | A window at the top about to be made active, USER's `ActivateWindow` (seg1 `3558`-`3582`)                                                                                                          | The window; a `CBTACTIVATESTRUCT`: whether a press made it active, and the window active now                                                                | Nothing changes                                       |
| `HCBT_SYSCOMMAND`, 8 | `DefWindowProc` with `WM_SYSCOMMAND`, once it is not ignored for a capture, a window disabled, or a system-modal window (seg1 `032e`-`03fd`)                                                       | The command less its low four bits; the `lParam`, 10000h made nought (`0351`-`0362`)                                                                        | The command is not carried out                        |
| `HCBT_SETFOCUS`, 9   | [[fn:USER.SetFocus]], with nought or with a window that has not the focus already (seg1 `382f`-`3897`), and as USER moves the focus itself                                                         | The window, or nought; the window that has the focus                                                                                                        | Nothing changes, and it answers nought                |

The other two codes, `HCBT_CLICKSKIPPED` and `HCBT_KEYSKIPPED`, come from the system queue ([[topic:system-queue]]).

[[measured]] [[probe:cbthook]] puts in a CBT hook for its own task, noting each call; in each case but the plain one it answers 1 for one code. `T` is an overlapped window with a child `A`, which has the focus, and `U` another overlapped window.

- **Making a window.** A hidden pop-up: `HCBT_CREATEWND` with the window -- its class can be read already -- and its arguments, 50, 60, 100 by 80, `WS_POPUP | WS_BORDER`, its name, no parent and nought to go after; then `WM_NCCREATE` and `WM_CREATE`. The hook setting the `CREATESTRUCT`'s `x` to 77 and `cx` to 123: the window is made there and so wide. A child: its parent in the `CREATESTRUCT`.
- **Destroying.** A pop-up `P` owning another, `Q`: `HCBT_DESTROYWND` for `P`, then for `Q`, then `Q`'s `WM_DESTROY` and `WM_NCDESTROY`, then `P`'s. Answering 1: only `P` is asked, `DestroyWindow` answers nought, and both are windows still.
- **Activating.** [[fn:USER.SetActiveWindow]] with `U`: `HCBT_ACTIVATE` with `U`, nought for the mouse, and `T`; then the activation's messages, and `HCBT_SETFOCUS` as `DefWindowProc` gives `U` the focus. Answering 1: `T` stays active and `A` keeps the focus; `SetActiveWindow` answers `T` all the same. A press in `U`'s client area through `MOUSE_EVENT`: `HCBT_ACTIVATE` with 1 for the mouse, and `WA_CLICKACTIVE`; answering 1, `T` stays active.
- **The focus.** `SetFocus(A)` from `T`: `HCBT_SETFOCUS` with `A` and `T` before `WM_KILLFOCUS`; answering 1, it answers nought and `T` keeps it. `SetFocus(NULL)`: the hook is asked with nought and `A`; answering 1, nothing changes. The focus given to a child of `U`, which is not active: `HCBT_SETFOCUS` for the child first, then `HCBT_ACTIVATE` for `U`, then `U`'s own `HCBT_SETFOCUS` from `DefWindowProc`.
- **Minimizing.** `ShowWindow(T, SW_MINIMIZE)`: `HCBT_MINMAX` with `T` and 6; then, the focus in `T`, `HCBT_SETFOCUS` with nought -- USER takes the focus through `SetFocus` -- `HCBT_ACTIVATE` for `U`, and last `HCBT_CREATEWND` for the icon's title, class `#32772`, no name, `WS_POPUP`, at nought, nought, one by one, with `T` its parent (seg1 `6ab8`-`6b20`). Minimized again after a restore, the title is not made again. Answering 1 to `HCBT_MINMAX`: nothing changes. `SW_SHOWMAXIMIZED` and `SW_RESTORE` are asked with 3 and 9.
- **System commands.** `WM_SYSCOMMAND` with `SC_MINIMIZE` and an `lParam` of 120034h: `HCBT_SYSCOMMAND` with F020h and 120034h, then the minimizing. Answering 1: the window is not minimized.
- **Moving.** `SC_MOVE` from the keyboard, Right twice and Enter posted first: `HCBT_SYSCOMMAND`, then `HCBT_MOVESIZE` with `T` and its new rectangle, 18 pixels right. Answering 1: `T` stays where it was. Enter alone: no `HCBT_MOVESIZE`. `WM_QUEUESYNC` posted before: `HCBT_QS`.

Both engines agree with all 47 records. Before, the hooks were asked only of keys and clicks skipped.

- [[measured]] A hook refusing `HCBT_CREATEWND` brings Windows down: [[probe:cbteat]] writes its record before `CreateWindow` and none after, and the screen shows a general protection fault in `USER.EXE` at 0001:3AB0. USER takes the window apart there and sends it `WM_NCDESTROY` (seg8 `0c36`-`0c84`) through its procedure, which it has not been given yet: seg1 `3ab0` calls the window's procedure, nought ([[read out]]). winbox.js, which has no code of USER's to fault in, takes the window apart with no message, and `CreateWindow` answers nought, as USER means it to (seg8 `039d`).
- [[read out]] The Windows Tutorial's hook (`WINTUTOR.EXE` seg6 `167d`, put in at seg5 `0973`) answers only `HCBT_SYSCOMMAND`, and passes nothing on: 1 for `SC_NEXTWINDOW`, `SC_PREVWINDOW` and `SC_TASKLIST` to `SC_HOTKEY`, and for every command in one state of its own. So Alt and Tab do not leave it, and Control and Escape bring up no Task List over it; both engines' sessions of the Tutorial hold to the last ([[topic:accessories]]).

## The debugging hook

[[read out]] Before each hook it calls, USER's caller of hooks looks for a debugging hook, `WH_DEBUG`, the task's (`[64h]` of its queue) or the system's (`[8B6h]`) (`8029`-`803b`). Where there is one, it calls that chain first (`803d`-`805f`) with code nought, the task the hook about to be called is for (`[2]` of its queue), and a `DEBUGHOOKINFO` on its stack: the hook's module, the caller's return address for the reserved field, and the `LPARAM`, `WPARAM` and code the hook is to have. A non-nought answer in DX and AX is the answer, and the hook is not called. The debugging hook is itself called through the same caller, which looks for a debugging hook before it calls it, and so on.

[[measured]] [[probe:dbghook]] puts in a message filter for its own task and calls `CallMsgFilter`, which calls it; then puts in a debugging hook for its own task, which [[fn:USER.SetWindowsHookEx]] answers with a handle, and calls `CallMsgFilter` again. That call never comes back, and the debugging hook is never called: the screen shows a general protection fault in `KRNL386.EXE` at 0001:7DC4, the stack worn out by the caller calling itself. winbox.js keeps a debugging hook and never calls it.

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

- The faults: a hook refusing `HCBT_CREATEWND`, and any hook called with a debugging hook in, end the program in Windows ([[probe:cbteat]], [[probe:dbghook]]). winbox.js takes the window apart and goes on, and never calls a debugging hook.
- What a hook answers for an icon's title, and the title kept, hidden, while the window is restored: winbox.js makes it again, asking the hooks only the first time.
- `HCBT_MINMAX` for a window made with `WS_MINIMIZE` or `WS_MAXIMIZE` (seg8 `0861`), and `HCBT_SETFOCUS` for USER's other moves of the focus through `SetFocus`, as for a window hidden (seg14 `0dd4`): only a window minimized with the focus in it is followed.
- `DefWindowProc`'s system commands ignored while something has the capture, the window is disabled, or a window is system-modal (seg1 `037c`-`03db`): winbox.js asks the hooks and carries the command out.
- The shell hook's code 3, `HSHELL_ACTIVATESHELLWINDOW`, which USER is not yet seen to send.
- A hook for one task, as `SetWindowsHookEx` can ask for. Every hook here is everyone's, called whichever task USER is working for.

## In winbox.js

`src/win16/user/hooks.ts` keeps each kind's chain, newest first, and calls the filters, the system's first, for the loops in `dialogs.ts`, `menu-loop.ts`, `scroll-track.ts` and `switch-loop.ts`. `askCbt` and `askCbtCreate` ask the computer-based training hooks for `CreateWindow.ts`, `DestroyWindow.ts`, `SetFocus.ts`, `dialogs.ts`, `window-state.ts`, `mouse-scan.ts`, `track-loop.ts` and `DefWindowProc.ts`. The scheduler's `callWndProc` calls `sentMessageHook` before every window procedure it runs for a message sent, and `DispatchMessage` goes round it. `callHooksWith` lays a structure of USER's on the stack for a hook; `system-queue.ts` calls the input hooks with it. The Rust engine has the same in `crates/winbox-win16/src/hooks.rs` and `system_queue.rs`, with `ask_cbt`, `ask_cbt_with` and `ask_cbt_create`.
