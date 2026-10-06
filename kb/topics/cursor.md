---
kind: topic
name: The cursor a window sets
summary: How Windows 3.1 asks the window under the mouse for its cursor with WM_SETCURSOR as each mouse message is taken, what it sends for a disabled window and as a menu starts, and what DefWindowProc answers — the class's cursor, a border's sizing cursor, the arrow, and a disabled window's owned pop-up brought up — as USER.EXE has it and the setcur, titledis and curerr probes recorded it.
probes: [setcur, titledis, curerr]
---

The cursor is one for the whole screen. Windows does not keep a cursor for each window. It asks the window under the mouse for one each time the mouse does something there.

[[measured]] [[probe:setcur]] has three windows log `WM_SETCURSOR` and `WM_MOUSEMOVE` and pass both on to [[fn:USER.DefWindowProc]]. `A` is a top-level window whose class's cursor is the I-beam, `C` is a child of `A` whose class's cursor is the cross, and `N` is a window whose class has none. The probe moves the cursor, shows, moves and destroys windows under it, and reads [[fn:USER.GetCursor]] after each. [[probe:curerr]] puts the mouse in through [[fn:USER.Mouse_Event]], as the mouse driver does, on a disabled window, a disabled child, with the mouse captured, with `PeekMessage` only looking, and as menus start, and sends `WM_SETCURSOR` straight to `DefWindowProc`. winbox.js agrees with every record of both, and of [[probe:titledis]].

## When a window is asked

[[read out]] The system queue's scan (`USER.EXE` seg1 `2aa2`) finds the window under the mouse and the part of it the mouse is on (`71b9`), asking windows with `WM_NCHITTEST` as it goes ([[topic:hit-testing]]). With the mouse captured, that is the capturing window and `HTCLIENT`. Otherwise it goes down from the top-level windows, front first: a hidden window is passed over, and so is a disabled child, for what lies beneath it and in the end for the window it is in. A disabled top-level window is `HTERROR` there and then, and is not sent `WM_NCHITTEST`. An icon is `HTCAPTION`, a window of another task `HTCLIENT`, and any other window is sent `WM_NCHITTEST`. Then:

- **`HTERROR`** (and `HTNOWHERE`, `2ec5`): the window is sent `WM_SETCURSOR` and the message is thrown away. It is thrown away whether the look takes messages or only looks at them: [[probe:curerr]]'s `PeekMessage` with `PM_NOREMOVE` answered nothing, and the disabled window had been sent its five `WM_SETCURSOR`s by then. Inside a system-modal window, only its own windows are told.
- **Anything else, taken** (`2f59`, `2933`): with the mouse captured, nothing is sent. Otherwise a press is first sent up as `WM_PARENTNOTIFY` from a child, then the window is sent `WM_MOUSEACTIVATE`, and is activated if it asks to be; then, press or move, it is sent `WM_SETCURSOR`. A look that only looks sends none of it, and [[probe:curerr]] saw the `WM_SETCURSOR`s come only as the messages were taken after.
- **A message posted** is not the mouse's, and asks nothing.

`wParam` names the window itself, the low word of `lParam` is the hit-test code, and the high word is the mouse message as the mouse made it: `WM_MOUSEMOVE`, `WM_LBUTTONDOWN` and so on, never the non-client form, and a double click as its press. [[measured]]

- Over the caption and the borders the high word is `WM_MOUSEMOVE`, 200h, as over the client area, and on the menu bar `HTMENU` with 200h and 201h.
- A double click comes with 201h: [[probe:curerr]]'s second press, `WM_LBUTTONDBLCLK`, followed `WM_SETCURSOR` with 201h.
- On a disabled window, `HTERROR` with 200h, 201h, 202h, 204h and 205h. An icon of a disabled window is the same ([[probe:titledis]]).
- A disabled child is passed over: a press there is a press on the window it is in, `HTCLIENT`, and that window is sent the messages.
- With the mouse captured, a move asks nothing.
- The move USER makes up when a window is shown, moved or destroyed under the cursor asks too ([[topic:mouse-input]]). A repaint asks nothing.
- Moves not yet taken become one. The cursor set somewhere and a window then shown under it make a single move, and only the new window is asked.
- Over the desktop, the program is asked nothing, and the cursor is the arrow.

**As a menu starts.** [[read out]] A menu takes the mouse as it starts (seg17 `0177`) and sends its window `WM_SETCURSOR` naming itself, with `HTCAPTION` and no mouse message, after `WM_ENTERMENULOOP` and before `WM_INITMENU`. The menu's loop sends the same when it takes the mouse back from a window that took it (seg10 `1f0b`). [[measured]] An icon's system menu ([[probe:titledis]]), a menu bar's menu and `TrackPopupMenu`'s ([[probe:curerr]]) each sent one, before `WM_INITMENU`. `TrackPopupMenu` sends `WM_INITMENU` too, naming its menu.

## What DefWindowProc answers

[[read out]] `DefWindowProc` (seg1 `590a`) answers FALSE, except where a parent answered TRUE. With `M` the mouse message in the high word:

- **On a border**, with `M` not nought: the sizing cursor for that side, asking no parent. `IDC_SIZEWE` left and right, `IDC_SIZENS` top and bottom, `IDC_SIZENWSE` at the top-left and bottom-right corners, and `IDC_SIZENESW` at the other two.
- **A child** passes the question to its parent first, still naming the child, and answers TRUE if the parent does. The parent shows the cursor of the class of the window `wParam` names, so over `C` the cursor is the cross, not `A`'s I-beam.
- **With no mouse message** -- a menu's -- the arrow, whatever the hit-test code.
- **`HTERROR` with the left button's press** (`597c`): the first window after this one in the order of windows, going round, that is the same task's, enabled and shown is looked at (`5745`). If this window owns it, at any remove, and it is not the window in front of all, this window is put on top with `SWP_NOMOVE`, `SWP_NOSIZE` and `SWP_NOACTIVATE` -- the windows it owns above it -- and that window is made active. [[fn:USER.MessageBeep]] beeps where nothing was found, or the active window is the same after. With the right or the middle button's press, the beep alone. Then the arrow.
- **In the client area**, the cursor of the class of the window `wParam` names. A class with none leaves the cursor as it was: the wait cursor the program had set stayed.
- **Anything else** -- the caption, the system menu box, the maximize box, `HTERROR` with a move or a release -- the arrow.
- **To begin with**, before anything is set, the cursor is the arrow. `SetCursor` answers the arrow's handle.

[[measured]] [[probe:curerr]] presses the left button on a disabled window `O` whose pop-up `D` is active:

- With `D` in front of all, nothing moved: the beep.
- With a hidden window made in front of `D`, and another of `O`'s task hidden behind `O`, `O` came to the top with `D` above it. `D` was active already: the beep.
- With an enabled window of `O`'s task not owned by `O` in front, the look found it first and gave up: nothing moved.
- The right button: nothing moved.

`DefWindowProc` answered nought every time, a child's border and a child's client area alike.

## In winbox.js

`src/win16/user/set-cursor.ts` and `mouse-scan.ts`, and `crates/winbox-win16/src/mouse_scan.rs` and `def_window.rs`. The mouse is put in the queue as the mouse made it, and each look hit-tests it as USER's scan does ([[topic:hit-testing]]): a disabled top-level window's input is thrown away as the look comes to it, `PM_NOREMOVE` or not, the window told; any other mouse message asks for the cursor as it is taken. `MessageBeep` makes no sound. The menu's own `WM_SETCURSOR` is sent as winbox.js's menu loop takes the mouse; it never has it taken back.

The page's own pointer stands in for the cursor, so nothing draws it on the screen. The corpus survey draws the cursor into its picture of the screen, as the display driver would draw it, to compare with Windows' screenshots: `withCursor` in `cursor-api.ts`. With that done, the cursor that Champ's edit field sets matches, and its screen matches Windows' pixel for pixel.
