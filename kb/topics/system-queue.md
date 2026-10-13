---
kind: topic
name: The system queue
summary: How Windows 3.1 keeps the keyboard's and the mouse's input in one queue for every program, gives each event its window only as a program takes it, makes a press a double click as it is taken, and hands it to the journal, keyboard and mouse hooks on the way -- read out of USER and recorded with keys and clicks put in faster than they were taken.
probes: [sysq, jrnlrec, jrnlplay, inhook, keyrep, inlock, inpost, lockinp, hwhook, gmhook, tasklist, prtsc, hotkey, dblrect, sebhook]
---

The keyboard and the mouse do not post their messages to a window. Their drivers hand each key and each press to USER, which puts it at the end of one queue for the whole system. A program takes it from there with [[fn:USER.GetMessage]] or [[fn:USER.PeekMessage]], and only then is it given a window: the window with the focus at that moment, for a key, or the window under the point at that moment, for the mouse. So a key pressed before a click that moves the focus, and taken after it, goes where the focus went.

Everything here is [[read out]] of `USER.EXE` unless marked; the offsets are seg1's. [[probe:sysq]], [[probe:jrnlrec]], [[probe:jrnlplay]] and [[probe:inhook]] put their input in through USER's own `KEYBD_EVENT` and `MOUSE_EVENT`, as the drivers do, before taking any of it, and both engines agree with all 32 of their records.

## Putting an event in

[[fn:USER.Keybd_Event]] (`4b59`) and [[fn:USER.Mouse_Event]] (`507a`) note the key or the button in the table [[fn:USER.GetAsyncKeyState]] reads, at once (`4f8d`, `518a`), and then put the event in (`4bd4`). With hardware input switched off by [[fn:USER.EnableHardwareInput]], the flag at `46h` of USER's segment 44, nothing is put in. The words named below at small offsets are that segment's; the queue itself is a segment of its own, whose selector is at its `0`.

An entry of the queue holds:

| Field | A key | The mouse |
| --- | --- | --- |
| extra information | SI and DI as the driver called | SI and DI |
| message | `WM_KEYDOWN`, `WM_KEYUP`, `WM_SYSKEYDOWN` or `WM_SYSKEYUP` | `WM_MOUSEMOVE`, or a button's press or release in its client form |
| `paramL` | the virtual key, and the scan code in the high byte (`4b87`) | x on the screen |
| `paramH` | the repeat count, and 8000h for an extended key, bit 0 of BH (`4c00`) | y on the screen |
| time | `GetSystemMsecCount` as it is put in (`54b7`) | the same |
| point | the cursor (`54cd`) | the cursor |

A key is made a system key as it is put in, by the keys held then ([[fn:USER.Keybd_Event]]): Alt down and Control not. F10 is not; it is made one as it is taken.

The queue is a ring, its entries from `6Eh` of its segment, with the size of an entry at `4`, the count at `6`, where to read at `8`, where to write at `0Ah` and its end at `0Ch` (`5480`-`5502`, `55f9`, `5641`); a program's own queue for what is posted to it is laid out the same. How many entries the system's holds is at `0F2h` of segment 44. With it full, the event is lost and `DoBeep` sounds (`4d99`).

- **The mouse's moves are not queued as they come.** `MOUSE_EVENT` moves the cursor and notes that a move is due (`4bf2`); the move is put in only when something else is put in, or a program looks at the queue (`4c78`, `833d`), and then over a move already at the end of the queue (`4d2d`). Moves not yet taken become one, at the cursor as it is then.
- **A key held down repeats into one event.** A press of the key the last entry pressed adds one to that entry's repeat count, rather than going in (`4c54`-`4c71`). Both must be `WM_KEYDOWN`, not a system key's, with the same virtual key and scan code, and both extended or neither. The check comes before a move that is due is put in, so a move made between the two presses does not part them.

[[measured]] [[probe:keyrep]], X pressed and let go into `T`, everything taken after:

- X pressed three times: one `WM_KEYDOWN` with `lParam` `2D0003h`, and one `WM_CHAR` with the same count.
- X pressed and taken, then pressed twice more: `402D0002h`, bit 30 for the key already down.
- Alt held, X pressed twice: two `WM_SYSKEYDOWN`, each with its own `WM_SYSCHAR`.
- X, Y and X: three presses. X, a move of the mouse, X: one, with a count of 2.
- X, then X as an extended key: two, the second with bit 24.
- X pressed, looked at with `PM_NOREMOVE` -- a count of 1 -- and pressed again: taken with a count of 2. A look that only looks leaves the entry in the queue to be added to.
- **USER makes moves of its own** ([[topic:mouse-input]]): it notes a move due (`52e9`) after [[fn:USER.SetCursorPos]], after a window is shown or moved, as a window lets go of the mouse with [[fn:USER.ReleaseCapture]] -- and so as a menu's loop or a control lets go of it (`28d0`-`28dd`) -- and as a journal hook is put in (`7e4a`).

## Taking an event

A look -- `GetMessage`, `PeekMessage`, or a loop of USER's own -- takes what was posted first, then the quit ([[topic:task-startup]]), then the input, then a paint, then a timer (`244f`). It looks at the input only where its filter asks for some kind there is: a key, a move or a button (`25e8`, [[topic:message-filters]]).

The input is read from the head (`2aa2`), one event at a time (`827a`):

1. **Its window is found.** A key's is the window with the focus; with no focus, the active window, and the key is made a system key, `WM_SYSKEYDOWN` for `WM_KEYDOWN` (`31a3`-`31db`). With neither, the key is thrown away (`31bb`). F10 is made a system key here (`3188`). A mouse event is hit-tested ([[topic:hit-testing]]; `2cdc`, `71b9`).
2. **A window of another program's ends the look.** That program is woken to take the event (`31df`-`3204`, `2d2c`-`2d4e`, `2b2d`), and this one finds no input. Nothing behind the event is looked at.
3. **The look's filter is held to it** -- the message it now is, and the window (`3212`-`3235`, `2e0e`-`2e1e`). One the filter does not take is passed over, and the look goes on to the next.
4. **A key's `lParam` is made** (`3263`-`32db`): the repeat count in the low word; the scan code in bits 16 to 23; bit 24 for an extended key; bit 29 where [[fn:USER.GetKeyState]]'s table says Alt is down, once this key has moved it; bit 30 where it said this key was down before it; bit 31 for a release. A mouse message's `wParam` is the `MK_` flags from the same table.
5. **Taken** (`4e2d`), the event is handed to the journal hooks, the key-state table `GetKeyState` reads moves with it (`4ea3`-`4f1d`: a press sets 80h and turns bit 1 where the key was up, a release clears 80h; the buttons as `VK_LBUTTON`, `VK_RBUTTON` and `VK_MBUTTON`), and it leaves the queue. A look with `PM_NOREMOVE` does none of this.
6. The message's time is the event's, and its point the cursor's as the mouse's last move taken left it (`3001`-`303b`).

[[measured]] [[probe:sysq]] gives a child `A` the focus and puts in a key, X pressed and let go, before anything is taken:

- `SetFocus(B)` before the key is taken: `B` takes both, and `WM_CHAR`.
- X, a click on `B` -- whose window procedure takes the focus as it is pressed -- and Y: `A` takes X, `B` the press, and `B` Y.
- A `PeekMessage` with `PM_NOREMOVE` names `A`; then `SetFocus(B)`; taken, the key is `B`'s.
- With no focus, the window `T` takes `WM_SYSKEYDOWN` and `WM_SYSCHAR`.
- A `PeekMessage` for `WM_KEYUP` alone takes the release, passing over the press, which is taken after it.

The engines kept the keyboard in each program's queue, and gave a key the window with the focus as it was pressed. Keys pressed together faster than the program took them went to the window that had the focus when they were pressed; in Control Panel's Ports Settings, Up, Tab, Down and Enter moved the first list's selection both ways. Now both engines keep one queue and give each event its window as it is taken.

## Double clicks

A double click is not the mouse's: the mouse driver hands over presses and releases, and USER makes a press a double click as a look takes it from the queue, by the press before it.

[[read out]] As the look comes to a press, in its client form `WM_LBUTTONDOWN`, `WM_RBUTTONDOWN` or `WM_MBUTTONDOWN` (seg1 `2dd1`-`2de1`), it may be a double click only off the client area, or in it where the window's class has `CS_DBLCLKS`, or in a menu's loop (`2d69`-`2d81`). Such a press is the second of a double click (`2d83`-`2dc1`) where all four hold:

- its time, the event's own, is no later than the time kept (`[0AB0h]`), compared unsigned;
- its window is the one kept (`[520h]`);
- its point on the screen is in the rectangle kept (`[558h]`), as [[fn:USER.PtInRect]] takes it, its right and bottom edges outside;
- its message, in the client form, is the one kept (`[516h]`): the same button.

It then takes the double-click form, `WM_LBUTTONDBLCLK` and the rest, and with it the non-client one where it is off the client area. As the look takes the press, not only looks at it (`2ed0`), after the mouse hooks have let it through and before the window is asked to be made active (`2ed9`-`2f54`), USER keeps it:

- a first press: its message; the time by which a second must come, its own and [[fn:USER.GetDoubleClickTime]]'s; its window; and the rectangle about its point, `SM_CXDOUBLECLK` and `SM_CYDOUBLECLK` each halved as a word, from the point less the half to the point and the half;
- a second press: the time kept made nought, so a third press is a first again.

A press that may not be a double click -- in the client area of a class without `CS_DBLCLKS` -- leaves what was kept as it was.

[[measured]] [[probe:dblrect]] plays presses back through a journal playback hook, each with a time of the script's own, onto `A`, of a class with `CS_DBLCLKS`, and `B`, of one without, and puts two pairs in through `MOUSE_EVENT` as well. With `WIN.INI`'s `DoubleClickSpeed=452` and a width and height of 4:

- A second press at the same point is a double click, 100 ms after the first; and one, two, three and four pixels from it: to the right, one is and two is not; to the left, two is and three is not; below and above the same. The rectangle is the point less two to the point and one.
- 500 and 501 ms after: neither, the time being 452. With `SetDoubleClickTime(200)`, 200 ms after is a double click and 201 is not: the time given is the last that is.
- Four presses 50 ms apart: a press, a double click, a press, a double click.
- The left button, then the right, then the right: the second press is a press, the third a double click.
- `A`, then `B`'s client area, then `A`: the third is a double click with the first, `B`'s press not kept.
- `B`'s client area twice: two presses. `B`'s caption twice: `WM_NCLBUTTONDOWN` and `WM_NCLBUTTONDBLCLK`. The middle button twice: `WM_MBUTTONDBLCLK`.
- `SPI_SETDOUBLECLKWIDTH` 10 and height 6: five to the right is not, four is; five to the left is, six is not; two below is, three is not; three above is, four is not.
- A width of 1, or of nought, or a height of 1: the half is nought, the rectangle empty, and no press is a double click, not even at the same point. A width of 5 is 4's.
- Through `MOUSE_EVENT`, at once, at the same point: a double click; two pixels to the right: not.

Both engines agree with all 16 records. Before, a press was made a double click as it was put in -- by the page's own count of clicks, or by `MOUSE_EVENT` at the same point within the time -- whatever window it came to.

## Hooks on the way

USER keeps the hooks of each kind in a chain, newest first, at `8A2h` and on in its data, `-1` to `10` ([[topic:hooks]]). A hook put in for one task is kept on that task's queue, at `52h`, and is called before the system's.

### Journal record

Each event taken from the queue is handed to the `WH_JOURNALRECORD` hooks with `HC_ACTION`, nought, and a pointer to an `EVENTMSG` in USER's frame on the stack -- its message, `paramL`, `paramH` and time, as the queue held them (`4e77`-`4e89`).

[[measured]] [[probe:jrnlrec]]:

- X pressed and let go: `WM_KEYDOWN` with `paramL` `2D58h` and `paramH` 1, then `WM_KEYUP` the same. Each time is the time [[fn:USER.GetMessageTime]] gives the message it became.
- A key taken with no focus is handed over as it was put in, `WM_KEYDOWN`, although `T` takes `WM_SYSKEYDOWN`.
- Alt, X and Alt: `WM_SYSKEYDOWN` for Alt and for X, `WM_SYSKEYUP` for X, and `WM_KEYUP` for Alt, as `KEYBD_EVENT` made them.
- The mouse moved to (81h, 7Bh) and pressed there: `WM_MOUSEMOVE`, `WM_LBUTTONDOWN` and `WM_LBUTTONUP`, each with the point on the screen.
- A `PeekMessage` with `PM_NOREMOVE` hands nothing over.
- Taken by a hook that answers non-nought, an event is handed over all the same (`2c60`).
- The move USER makes as a menu's loop lets go of the mouse is handed over too: Alt and X in a window whose system menu has no X ended a menu's loop at once, and a move at the cursor followed.

### Journal playback

While a `WH_JOURNALPLAYBACK` hook is in, the count of them at `7Eh` of segment 44 is not nought (`7e45`, `7e8d`), and a look does not read the queue at all (`829a`). It asks the hook for the next event with `HC_GETNEXT`, and a pointer to an `EVENTMSG` whose time is now (`82ae`-`82da`); the `wParam` is USER's data segment, left in a register. The hook fills the `EVENTMSG` and answers how long to wait first, in milliseconds.

- **Nought**, the event is taken as one from the queue would be: given its window, filtered, its `lParam` made. Its time is the one the hook left.
- **More**, nothing is taken. USER keeps the wait (`8325`) and counts it down on its own timer's ticks, as it counts its timers; within 5 ms of the end it is over (`7336`-`7365`), and the task that would take the event is woken. Its look asks the hook again, which answers what is left.
- Only one event at a time: a look whose filter passes over it finds no input (`82a3`).
- Taken, the event is told to the hook with `HC_SKIP`, nought and nought, rather than handed to the record hooks (`4e49`-`4e73`). A move played back puts the cursor at its point.

[[measured]] [[probe:jrnlplay]] plays X, a click in the middle of `B`, Y after a wait of 200 ms, and a move to (300, 300):

- Each event is asked for with `HC_GETNEXT`, and skipped with `HC_SKIP` as its message is taken, before it is dispatched.
- Each message's time is the time the hook put in the event, 1000 and on; a key's `lParam` is its repeat count and scan code, `2D0001h`, and `C02D0001h` for the release.
- The click took the focus to `B`, and Y went there.
- Y's wait was waited: from the first `HC_GETNEXT` for it to its press being taken, at least 150 ms; and it was asked for more than once.
- The keys `KEYBD_EVENT` put in during the playback, Z pressed and let go, were taken after it, once the hook had taken itself out. The move to (100, 100) `MOUSE_EVENT` made during it was lost: the cursor stayed at (300, 300), where the playback left it. The mouse's moves are not put in while a playback hook is in (`50cc`); its buttons and the keys are.

USER calls the journal hooks nowhere else, and takes them out only as the program unhooks them or ends (`7e7c`, `7f51`): 3.1 has no `WM_CANCELJOURNAL`, and nothing in its keys' path stops a playback. Taken out, a playback hook leaves the running program's queue woken for input (`7e92`), which then reads the queue again, and what was put in meanwhile.

### System-modal windows

[[fn:USER.SetSysModalWindow]] tells the journal hooks, the playback hooks first, with `HC_SYSMODALON` for a window and `HC_SYSMODALOFF` for none, nought and nought (`1a0c`-`1a4a`). While a window is system-modal, no journal hook is called (`4e42`, `8283`), and neither are the keyboard and mouse hooks (`8117`). [[measured]] [[probe:jrnlrec]]'s key taken while `T` was system-modal was handed to no hook.

### Keyboard and mouse hooks

- A key is handed to the `WH_KEYBOARD` hooks once it has its window and its `lParam`: `HC_ACTION` for a look that takes it, after the journal hooks have it; `HC_NOREMOVE`, 3, for one that leaves it (`32e5`-`330f`). The `wParam` is the virtual key and the `lParam` the key's.
- A mouse message is handed to the `WH_MOUSE` hooks once it has its window and its form, before the journal hooks have it (`2e6e`-`2ec2`): `HC_ACTION` or `HC_NOREMOVE`, the message, and a `MOUSEHOOKSTRUCT` in USER's frame -- the point on the screen, the window, the hit-test code and the extra information.
- A hook that answers non-nought in AX throws the event away, taken or only looked at (`2c60`), and the look goes on with the next.

[[measured]] [[probe:inhook]]:

- A `PeekMessage` with `PM_NOREMOVE` hands X to the keyboard hook with 3 and `2D0001h`; taken, with nought, then `C02D0001h` for its release.
- The keyboard hook answering 1 for Q, as the `PeekMessage` only looks: Q's press and release are both handed to it with 3, and are gone. Nothing is left to take.
- The mouse hook: the press in the middle of `A` with 3 as it is looked at, then with nought as it is taken, `WM_LBUTTONDOWN`, `A`, `HTCLIENT` and the point (129, 123); the release with nought. Answering 1 for the press as it is looked at, the press is gone, and only the release reaches `A`.
- With a journal record hook in too: a key goes to the journal hook first and the keyboard hook after; a press to the mouse hook first and the journal hook after.

### Keys and clicks skipped

The computer-based training hooks, `WH_CBT`, are told as a key or a mouse event leaves the queue, where a keyboard or a mouse hook was in as the look came to it. The name is the codes'; nothing is skipped that would not be.

- [[read out]] As the look comes to a key, USER notes whether a `WH_KEYBOARD` hook is in (`32e5`-`32f0`, through `80b0`, which looks at the task's chain and then the system's), whatever then becomes of the call: a system-modal window keeps the keyboard hooks from being called (`8117`), and not that. Nothing is noted while [[fn:USER.SysErrorBox]]'s box is up, the flag at `0E0h` of USER's data, which it sets (`9350`-`9359`) along with [[fn:USER.LockMyTask]] -- and the keyboard and mouse hooks are not called then either (`32de`, `2e6e`). The key taken, after the keyboard hooks have let it through, the CBT hooks are called with `HCBT_KEYSKIPPED`, 7, the virtual key, and the key's `lParam`, as the keyboard hooks were (`3312`-`3336`); then the key is handed over (`3001`).
- [[read out]] A mouse event the same, where a `WH_MOUSE` hook is in (`2e75`-`2e80`): taken, after the journal hooks have it (`2f7f`), `HCBT_CLICKSKIPPED`, 6, the message, and the `MOUSEHOOKSTRUCT` the mouse hooks were handed, at the same place in USER's frame and as they left it (`2f84`-`2fa7`).
- [[read out]] An event thrown away -- a keyboard or a mouse hook answering non-nought, a press the window answered `MA_NOACTIVATEANDEAT`, a press on `HTERROR` -- goes to `2c60`: it leaves the queue (`4e2d` with 1), and the CBT hooks are told the same, for a look that only looks too (`2c6c`-`2cb6`). Both are told only once: the flags are cleared as they are called.
- No hook is told for a look with `PM_NOREMOVE` that leaves the event, nor where neither a keyboard nor a mouse hook is in.

[[measured]] [[probe:hwhook]] puts in a CBT hook, writing only these two codes:

- X pressed and let go with no keyboard hook: nothing. With one: `PM_NOREMOVE` hands the keyboard hook X with 3 and nothing to the CBT hook; taken, the keyboard hook has it with nought and the CBT hook `c7:58/2d0001` before `A` is handed `WM_KEYDOWN`; then the release, `c02d0001`.
- The keyboard hook answering 1 for Q, as the `PeekMessage` only looks: Q's press and release are each handed to it with 3 and then to the CBT hook with 7, and are gone.
- A click on `A` with no mouse hook: nothing. With one: the press and the release, each told `c6` with its message, `A`, `HTCLIENT` and the point (129, 123), after the mouse hook has it with nought and before `A` is handed it.
- The mouse hook answering 1 for the press as it is looked at: the CBT hook is told of the press there and then.

Both engines agree with all eleven records. Before, the CBT hooks were kept and never called.

### While USER's system error box is up

[[read out]] [[fn:USER.SysErrorBox]] sets the word at `0E0h` (`9350`-`9359`), makes the desktop window the system-modal window, and gives it the capture and the focus (`9392`-`93d3`); its loop takes each message with `PeekMessage` for the desktop window, `PM_REMOVE | PM_NOYIELD` (`9759`-`9768`). So while it is up the keyboard and mouse hooks are not called and the CBT hooks are told of nothing skipped (`32de`, `2e6e`), the journal hooks are not called (the system-modal window, `4e42`), and the message hooks are handed each message the box takes, as `PeekMessage` hands any ([[topic:hooks]]). The word is put back as the box goes (`9a79`).

[[measured]] [[probe:sebhook]] puts in a keyboard, a mouse, a CBT and a message hook for its own task and a journal record hook, and calls `SysErrorBox`; Enter is pressed at the box from outside. While it is up only the message hook is called, with `WM_KEYDOWN` and `WM_KEYUP`, code nought; the box answers 1. X pressed through `KEYBD_EVENT` once it is gone: the journal hook, the keyboard hook, the CBT hook's `HCBT_KEYSKIPPED` and the message hook, for the press and for the release, as before it. Both engines agree with all three records. winbox.js's box takes the keyboard and the mouse from the page straight; it now hands each message to the message hooks before it reads it, a key's `lParam` as the key would have had, a press's the point.

### The hardware hooks

[[read out]] An event that is neither a key -- `WM_KEYDOWN` to `WM_SYSKEYUP` -- nor the mouse's goes another way as the look comes to it (`2b53`-`2baa`). Such events are what a journal playback hook plays back, and what a driver puts in with `HARDWARE_EVENT` (`4d6c`: CX the message, AX and DX `paramL` and `paramH`, SI and DI the extra information, put in with no window). That entry reads the system queue's selector from DS as it is called (`4d84`), so it is for a caller whose DS is USER's segment 44, and no program calls it: nothing in the installation imports it.

- **Its window**: the window the low word of its extra information names; 1 there the window with the focus; nought the active window (`2b9d`-`2baa`, `2cc7`-`2cd0`). A playback hook's events have nought there (`82e3`-`82e8`). `WM_QUEUESYNC`, 23h, is the window its `paramL` names, or the active window (`2bb0`-`2bbe`).
- **Its `wParam`** is the high word of the extra information, nought played back; its `lParam` `paramH` and `paramL` (`2bc6`-`2bcf`, `2cd3`). `WM_QUEUESYNC`'s `wParam` is nought.
- A window of another program's ends the look as a key's does (`2bd2`-`2bec`). **The look's filter not taking it ends the look**, rather than passing over it (`2bf8`-`2bff`).
- Then it is handed to the journal hooks, and leaves the queue as it is taken (`2c0a`), and only then, `WM_QUEUESYNC` excepted (`2c0f`), to the `WH_HARDWARE` hooks (`2c18`-`2c54`): `HC_ACTION`, or `HC_NOREMOVE` for a look that leaves it; nought; and a `HARDWAREHOOKSTRUCT` in USER's frame -- the window, the message, the `wParam` and the `lParam`. One answering non-nought in AX throws it away (`2c59`-`2c60`), and the look goes on.

[[measured]] [[probe:hwhook]] plays back `WM_USER + 1`, 401h, with a `paramL` of 3456h and a `paramH` of 7, through a playback hook that takes itself out as the event is taken:

- `PeekMessage` with `PM_NOREMOVE` hands the hardware hook `h3:0/T/401/0/73456` -- `T` the active window -- and then finds 401h. Taken, `h0` with the same, and `T` is handed 401h with a `wParam` of nought and an `lParam` of 73456h.
- The hardware hook answering 1 as it is only looked at: the event is gone, the playback hook told it was skipped and taken out, and the look goes on to the queue, where it finds the move USER made as the playback hook went in (`7e4a`).
- `WM_QUEUESYNC` played back with `paramL` `T`: no hardware hook is called, and `T` is handed it, its `lParam` `T`.

Before, a played-back event of any other kind was given the active window as it was played, its `paramL` as its `wParam` and its `paramH` as its `lParam`.

The `WH_GETMESSAGE` hooks are called with what a look hands over, not as the queue gives it out: [[topic:hooks]] has them.

## Another program's input

The look that ends at another program's event wakes that program, and finds nothing itself.

### One program at a time

USER lets one program at a time read the input. The first to look holds it, at `0F4h` of segment 44 (`2ab9`-`2ae0`). It holds it until a look of its finds nothing for it (`2b06`-`2b15`), whether the queue ran out or another program's event ended the look, or until it has done with what it took (below, "Letting it go"). Meanwhile any other program's look finds no input. So the program that took a click has handled it, focus and all, before another can take the key after it.

- A look by a program handling a message another program sent it lets the input go first, for it to take (`281c`-`2847`). The test is the program's [[fn:USER.InSendMessage]] word, at `38h` of its queue (`3dba`).
- The look that holds the input notes whether it only looks, `PM_NOREMOVE` (`2ac9`, the flag at `106h`). The next look of the program that holds it then reads the input before what was posted (`24a2`-`24dd`).

[[measured]] [[probe:inlock]] runs a second program, `B`, which is active with the focus. The probe's window `A` answers `WM_MOUSEACTIVATE` with `MA_NOACTIVATE`. The left button pressed and let go on `A` and X pressed and let go are put in before anything is taken.

- `A` yields forty times as it is handed the release. `B` takes X only after `A` has finished: `A:201`, `A:202`, `A:done`, then `B`'s X. Before, both engines gave X to `B` while `A` yielded.
- `A` sends `B` `WM_USER` instead, in which `B` looks for a key with `PeekMessage`. `B` finds X's press there, before `A` has finished.

[[measured]] [[probe:keyrep]]: X pressed, looked at with `PM_NOREMOVE`, then `WM_USER` posted to `T` and X let go. `T` takes X's press first, then the posted message, then the character and the release.

### Letting it go

[[read out]] Every look -- `GetMessage`, `PeekMessage`, a loop of USER's own -- begins at `281c`, once, before it looks at anything (`246f`). Besides letting the input go for a program in a message another sent it, that lets the input go where the program looking holds it and two marks are alike (`2836`-`2845`):

- **What was marked last for the program that holds the input**, the word at `0F6h` of segment 44. Taking an event of the input, or only looking at it, marks the input, 1 (`303f`). A message posted to the queue of the program that holds the input -- by [[fn:USER.PostMessage]], [[fn:USER.PostAppMessage]], [[fn:USER.TranslateMessage]]'s character, or USER's own posts, which all go through `23b4` -- marks that message, by its place in the queue's ring, or nought where the queue was full (`2430`-`2437`, `5480`).
- **What the program took last**, the word at `16h` of its queue. An event of the input taken or looked at sets it to 1 (`3058`). A posted message taken sets it to the message's place in the ring; one only looked at, to 1 (`55d4`-`55e9`). A timer's `WM_TIMER` is put in the ring as it comes due and read from there (`73bb`-`741b`), and sets it the same.

So the program that took an event lets the input go at its next look where nothing has been posted to it since; and where something has, at the look after the one that took the last message posted to it. A program that posts itself a message as it handles a click keeps the input while it handles that message too; one that takes a message posted to it before the click does not. Where the look that lets the input go then looks at the input, it takes it again (`2ac5`). That is also why [[probe:keyrep]]'s press, only looked at, is taken before the message posted after it: the post marked the message, the marks differ, and the input stays held, to be read first.

- [[read out]] Only `281c` reads the marks, and only `2b06`-`2b15` and [[fn:USER.LockMyTask]] (`6f0c`-`6f1b`) clear them.
- [[inferred]] The ring's places repeat, so a message posted in a place another was taken from earlier could match it; winbox.js numbers each posted message instead, and tells the two apart.

[[measured]] [[probe:inpost]] runs `B` as [[probe:inlock]] does. `A`, handed `WM_USER + 1`, yields forty times and writes `A:posted`. The click on `A` and X are put in before anything is taken.

- `A` posts itself `WM_USER + 1` as it is handed the release: `A:201`, `A:202`, `A:done`, `A:posted`, and only then `B`'s X. `A` held the input while it handled what it posted itself.
- `A` posts itself `WM_USER + 1` before the input is put in, and takes the move, the press and the release with `PeekMessage` for the mouse's messages alone, which pass over the posted message. Its next look lets the input go and takes `WM_USER + 1`; while it yields in it, `B` takes X: `A:201`, `A:202`, `B`'s X, then `A:posted`. Before, both engines kept the input with `A` until a look of its found none, and `B` took X after `A:posted`.

### Locking the input

[[fn:USER.LockInput]] is for a debugger: the input locked to one window of its, and no other program run, while it shows its own window. [[read out]] `4983`-`4af8`, its three arguments a handle that must be nought, the window, and whether to lock:

- **Refused**, answering nought: the handle not nought; to lock, the input locked already (the block kept, at `244h` of USER's data), the window nought, or a child -- the window at the top it is in not itself (seg2 `0ab8`, which climbs while the style's high byte has `WS_CHILD` without `WS_POPUP`) -- or the 1Ch bytes it keeps not had from USER's heap; to let go, the input not locked. A handle of no window is not looked at.
- **Locking**, it gives the desktop window to the window's task (seg8 `08c4`); locks the running task with [[fn:USER.LockMyTask]] (below), and notes it at `102h`, so that `LockMyTask` does nothing more until it is let go; then keeps, and sets without a message to any window: the focus and the active window, both made the window (`4a0a`-`4a1a`); the capture, let go with [[fn:USER.SetCapture]] and nought (`4a1e`-`4a2a`); the system-modal window, made the window as [[fn:USER.SetSysModalWindow]] makes it, the journal hooks told (`19de`); the cursor's clip, made the screen (`4a45`-`4a5c`); and the hardware input, switched on (`4a61`). It also keeps the words at `0DAh` and `1CAh` that make a key's `lParam` bits 27 and 28 -- a dialog box's loop and a menu's (`32af`-`32c9`) -- clearing `1CAh` and the word at `1CEh` beside it, and keeps the word at `0D0h` and [[fn:USER.SysErrorBox]]'s flag at `0E0h`. It answers 1.
- **Letting go** puts each back from what was kept, in the order the clip, the focus and the active window, the system-modal window, the words, the capture, the hardware input; clears `102h`; lets the task go with `LockMyTask`; and frees the block. The desktop window stays the task's. It answers 1.

[[fn:USER.LockMyTask]] (`6eea`-`6f24`), unless the input is locked: KERNEL's [[fn:KERNEL.LockCurrentTask]] with what it is given; the word at `0DEh` set, so each look of the program's is made without yielding, as with `PM_NOYIELD` (`245b`-`2462`) -- [[probe:gmhook]] sees the flag in the message hooks' `wParam` -- and, locking, the input let go by whatever program held it, both marks cleared (`6f0c`-`6f1b`).

[[fn:KERNEL.LockCurrentTask]] (`KRNL286.EXE` seg1 `79d9`) makes the running task the locked one, at 22Ch of KERNEL's data, or none, and answers it; [[fn:KERNEL.IsTaskLocked]] (`79f3`) answers it. While a task is locked, KERNEL's scheduler, finding another task with something to do first, does not switch to it (`7912`-`791b`): no other program runs until the lock is let go.

[[fn:USER.EnableHardwareInput]] (`4f36`-`4f45`) exchanges the word at `46h` of segment 44 for the one given, and answers what was there, 1 at first. While it is nought, `KEYBD_EVENT` and `MOUSE_EVENT` put nothing in (`4be3`), and the keys and the buttons are lost; the key-state table [[fn:USER.GetAsyncKeyState]] reads still moves (`4f8d`).

[[measured]] [[probe:lockinp]], `W` active with the focus and the capture and the cursor held to (0, 0)-(320, 240), and a second program `C` that answers a message posted it by posting one back:

- `LockInput` with a handle of 1, with no window, with the child `K`, and letting go when nothing is locked: each nought, and nothing changes.
- Locking to `L`: 1, and no message to `W` or `L`. Then the focus and the active window are `L`, the capture none, the system-modal window `L`, the clip the screen, 0,0 to 640,480, and [[fn:KERNEL.IsTaskLocked]] this task. Locking again, to `W`: nought.
- While locked, `C` does not answer what is posted it, though the probe looks and yields twenty times; X put in goes to `L`.
- Letting go: 1, no message; the focus, the active window and the capture `W` again, no system-modal window, the clip as it was, and no task locked. Then `C` answers.
- `EnableHardwareInput(0)` answers 1, and X put in reaches no window. Locked to `L` meanwhile, X reaches `L`; let go, it is lost again. `EnableHardwareInput(1)` answers nought, and X reaches `W`.

Before, all five were stubs in both engines.

## Keys the queue takes for itself

Some keys are taken as a look comes to them, before they are given a window, and thrown away: Control and Escape, which posts `SC_TASKLIST` to the active window; Print Screen, which copies the screen, or with Alt the active window, to the clipboard; and a window's hot key, which posts `SC_HOTKEY` (`3090`-`3178`). [[topic:task-list]] has them.

## System-modal windows and input

While a window is system-modal, a key for a window outside it is passed over, left in the queue (`3204`-`3235`). [[measured]] [[probe:keyrep]] gives `T` the focus with a pop-up `S` system-modal, and puts in X. `T` takes nothing until `S` is destroyed, and then takes X.

## Not yet followed

- A mouse event for a window outside the system-modal window (`2ee7`).
- [[fn:USER.LockInput]] giving the desktop window to the locking task (seg8 `08c4`), and the words at `0DAh`, `1CAh`, `1CEh` and `0D0h` it keeps, puts back and partly clears: winbox.js keeps none of them.
- With [[fn:USER.LockMyTask]], `GetMessage` does not yield before it looks at the timers (`254b`-`2552`); winbox.js's `GetMessage` yields as without.
- `HARDWARE_EVENT`, which a driver calls with DS USER's own segment 44 (`4d84`); winbox.js keeps it a stub, and has such events only from a journal playback hook. A window named by an event's extra information, and 1 for the focus, are not followed: no recording can reach them. A playback hook's events have nought for extra information (`82e3`-`82e8`), and a program cannot call the entry with USER's segment 44 in DS, whose selector it has no way to name.
- An event that is neither a key nor the mouse's where there is no active window: USER reads the window's queue from nought (`2bd5`); winbox.js hands the event over with no window.
- A move due is put in as a look comes to the queue (`833d`), so a press made after that look is not added to one before the move. winbox.js keeps a move at the end of the queue as the one due, and adds a press to the one before it.
- The time and the point of a mouse move are the cursor's as the move is put in at last, not as the mouse moved.

## In winbox.js

`src/win16/user/system-queue.ts` and `crates/winbox-win16/src/system_queue.rs` keep the queue and call the hooks; `RasterInput.virtualKey` and `pointer` (`raster-input.ts`, `key_input.rs`, `raster_input.rs`) put events in, and `nextMessage` in `queue.ts` (`take_input` in Rust) takes them. The queue is one array, every task's `_input` in the TypeScript engine and `System::input` in the Rust one. A press is added to the one before it as it is put in (`#queue`, `queue_input`). The task that holds the input is `_inputLock` (`input_lock`), taken and let go by the look (`holdsInput`, `holds_input`), and a task answering a message another sent it counts that in `inSent` (`in_sent`). The marks are `_inputMark` and each task's `_lastTaken` (`input_mark`, `Queue::taken_mark`), a posted message's its `mark` (`serial`), given by `postTo` (`post_to`). `lock-input.ts` and `lock_input.rs` keep `LockInput`, `LockMyTask` and `EnableHardwareInput`, and the scheduler's `locked` its locked task (`scheduler.ts`, `scheduler.rs`). `hardwareTarget`, `hardwareHook`, `keySkipped` and `clickSkipped` (`hardware_target`, `hardware_hook`, `key_skipped`, `click_skipped`) are the rest. `resolveMouse` and `noteClick` in `mouse-scan.ts` (`resolve_mouse`, `note_click`) make a press a double click and keep it. A button over no window is the desktop window's, its first program's (`mouse-scan.ts`, `mouse_scan.rs`; [[topic:task-list]]), and a double click there is made by the same rule, the desktop's class having `CS_DBLCLKS`. The browser's keys carry no scan code, but Print Screen's, which is the driver's; a program's through `KEYBD_EVENT` carry BL's. A key the browser repeats goes in as a press of its own, and is added to the press before it where that is not yet taken.
