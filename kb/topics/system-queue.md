---
kind: topic
name: The system queue
summary: How Windows 3.1 keeps the keyboard's and the mouse's input in one queue for every program, gives each event its window only as a program takes it, and hands it to the journal, keyboard and mouse hooks on the way -- read out of USER and recorded with keys and clicks put in faster than they were taken.
probes: [sysq, jrnlrec, jrnlplay, inhook]
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
- **A key held down repeats into one event.** A press of the key the last entry pressed, not a system key, adds one to that entry's repeat count (`4c54`-`4c71`). Not yet followed by winbox.js, whose hosts hand each repeat in as a key of its own.
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

Not followed: the computer-based training hooks' `HCBT_KEYSKIPPED` and `HCBT_CLICKSKIPPED`, which USER calls after a key or a press is taken where a keyboard or mouse hook is in (`3312`-`333b`, `2f8a`-`2fa7`); the hardware hooks, `WH_HARDWARE`, for any other event (`2c18`); and the `WH_GETMESSAGE` hooks, called with each message a look hands over (`2597`).

## Another program's input

The look that ends at another program's event wakes that program, and finds nothing itself. Both engines do this.

## Not yet followed

- USER lets one program at a time read the input. The first to look holds it, at `0F4h` of segment 44 (`2ab9`-`2ae0`), until a look of its finds nothing for it (`2b06`-`2b15`). Meanwhile any other program's look finds no input, so the program that took a click has handled it, focus and all, before another can take the key after it. A program that sends a message to another while it holds the input hands it over (`2825`-`2847`). In both engines a program takes input whenever it looks and the head of the queue is its own.
- A look with `PM_NOREMOVE` that came to input leaves the next look to read the input before what was posted (`24a2`-`24dd`, the flag at `106h`).
- The keys the queue takes for itself as they are taken: Control and Escape, which posts `WM_SYSCOMMAND` with `SC_TASKLIST` to the active window and is thrown away (`30b5`-`30eb`); Print Screen, which copies the screen, or with Alt the active window, to the clipboard (`30ee`-`311e`); and a hot key, which posts `WM_SYSCOMMAND` with `SC_HOTKEY` (`3121`-`3178`).
- A key held down merging into one event, its repeat count rising.
- While a window is system-modal, input for windows outside it is passed over (`3204`-`3235`, `2ee7`).
- The time and the point of a mouse move are the cursor's as the move is put in at last, not as the mouse moved.

## In winbox.js

`src/win16/user/system-queue.ts` and `crates/winbox-win16/src/system_queue.rs` keep the queue and call the hooks; `RasterInput.virtualKey` and `pointer` (`raster-input.ts`, `key_input.rs`, `raster_input.rs`) put events in, and `nextMessage` in `queue.ts` (`take_input` in Rust) takes them. The queue is one array, every task's `_input` in the TypeScript engine and `System::input` in the Rust one. The browser's keys carry no scan code; a program's through `KEYBD_EVENT` carry BL's.
