---
kind: topic
name: Where the mouse lands
summary: How Windows 3.1 gives out the mouse as a program takes it — the window under it found from the desktop down, each asked with WM_NCHITTEST and passed over for HTTRANSPARENT, a press told up the windows it is in with WM_PARENTNOTIFY and its window asked with WM_MOUSEACTIVATE whether to be made active and whether to throw the press away — what DefWindowProc answers, the capture's kinds, and where a hidden window lies in the order of windows, as USER.EXE has it and the mousemsg probe recorded it.
probes: [mousemsg, curerr, comboact, iconclk]
---

USER keeps the mouse in one queue for the whole system. A press is not a message for a window when the mouse makes it. It is a point on the screen and a button, and it becomes a window's message only when a program looks at its queue. Then USER finds the window under the point, asks it which part of it the point is on, and, for a press, asks it whether it wants to be made active. All of that runs in the program that looks, through its own window procedures.

[[measured]] [[probe:mousemsg]] puts the mouse in through [[fn:USER.Mouse_Event]], as the mouse driver does. `P` is an overlapped window with three children: `A`, with `B` inside it, and `U`, with `T` over it. `Q` is another overlapped window, with a child `K`. Every window answers `WM_NCHITTEST` and `WM_MOUSEACTIVATE` as the probe sets for it, or else as [[fn:USER.DefWindowProc]] does, and logs what it is sent. winbox.js agrees with all 46 records. [[probe:curerr]], [[probe:comboact]] and [[probe:iconclk]] put the mouse in the same way.

## The look

[[read out]] `GetMessage` and `PeekMessage` look at the mouse only where their filter asks for some of what is waiting (`USER.EXE` seg1 `24bb`). The range asks for the mouse's moves where it holds `WM_MOUSEMOVE` or `WM_NCMOUSEMOVE`, for its buttons where it meets their client or non-client messages, and for the keys where it meets `WM_KEYDOWN` to `WM_SYSDEADCHAR` (`25e8`). No range asks for all of them.

Then each mouse message, oldest first, is hit-tested before the filter is held to it (`2d0c`, `2e0e`), and the look stops at the first that passes.

- [[measured]] A `PeekMessage` with `PM_NOREMOVE` asked only once, for the first message, a move, though a press and a release were waiting behind it. It sent no `WM_SETCURSOR` and nothing else.
- [[measured]] A `PeekMessage` for the keys alone asked nothing at all.
- [[measured]] Each look asks again: the move that `PeekMessage` had looked at was hit-tested a second time when `GetMessage` took it.

## Finding the window

[[read out]] The hit test (seg1 `71b9`) starts at the desktop window and goes down, front first.

- With the mouse captured, the capturing window has it, `HTCLIENT`, and nothing is asked.
- A hidden window is passed over, and so is one the point is not on.
- A disabled child is passed over, its children with it. A disabled window at the top is `HTERROR` there and then ([[topic:cursor]]).
- An icon is `HTCAPTION`, and is not asked.
- Where the point is in a window's client area, its children are looked at first, front first, and the window itself only after them.
- A window of another task is `HTCLIENT`, and that task is left to take the message. It hit-tests it again as it looks.
- Any other window is sent `WM_NCHITTEST`, with the point on the screen in `lParam`, and its answer is the hit-test code.

`HTTRANSPARENT`, -1, passes the window over as if the point were not on it (`7282`). The look goes on to its brothers behind it, and then to the window it is in. [[measured]]

- `T` answering `HTTRANSPARENT` over `U`: `T` was asked, then `U`, which took the press.
- Over nothing but `P`'s client area: `T` was asked, then `P`.
- `Q`, a window at the top, answering `HTTRANSPARENT` over `P`: `Q` was asked, then `P`.
- A child answering `HTTRANSPARENT` over its own window's client area passes the mouse to that window, which can then answer anything. `K` did so, and `Q` answered `HTBORDER` and `HTCAPTION` for it.

**`HTCAPTION` from a client area** makes the window move as its caption does. [[measured]] `P` answered `HTCAPTION` everywhere, and was pressed in its client area, moved 40 across and 30 down, and let go. It was sent `WM_NCLBUTTONDOWN` with `HTCAPTION`, and `DefWindowProc` sent it `WM_SYSCOMMAND` with `SC_MOVE` and `HTCAPTION`, `F012h`. It ended 40 across and 30 down.

## The message

[[read out]] Not `HTCLIENT`, the message takes its non-client form, `WM_NCLBUTTONDOWN` and the rest, with the hit-test code in `wParam` and the point on the screen (`2e03`). `HTERROR` and `HTNOWHERE` are thrown away, the window told with `WM_SETCURSOR` ([[topic:cursor]]). A press is a double click off the client area, or in it where the class has `CS_DBLCLKS` (`2d69`).

The capture has kinds (`28cd`, the kind kept at `10e`):

- [[fn:USER.SetCapture]]'s, the second: messages in the client area, at the point in it.
- A menu's (seg17 `0194`) and the loop that moves and sizes a window (seg23 `0957`), the fourth: the client form, at the point on the screen (`2e0e`). A menu's loop also makes a press twice a double click, whatever the class (`2d7c`). [[probe:iconclk]]'s icon, clicked twice while its system menu was up, was restored.
- A third kind, set at seg1 `029f`, gives the point in the window's own coordinates (`2e32`). Not read out further, and not followed.

## Taking a press

[[read out]] As a message is taken, not merely looked at, and with the mouse not captured (seg1 `2933`):

1. A press is sent up from a child to each window it is in, in turn, as `WM_PARENTNOTIFY`, the mouse message in `wParam` and the point in that window's client area in `lParam`. Nothing checks `WS_EX_NOPARENTNOTIFY`.
2. A press on a window that is not the active one is sent `WM_MOUSEACTIVATE`. `wParam` names the window at the top it is in, the low word of `lParam` is the hit-test code and the high word the mouse message. A window at the top that is the desktop window's child, as a combo box's dropped list is, is asked nothing ([[topic:combo-boxes]]).
3. The window is sent `WM_SETCURSOR`, press or move, whatever the answer was.

What the answer does (`29c4`):

| Answer | The window at the top | The press |
|---|---|---|
| 0, `MA_ACTIVATE` | made active | handed over |
| `MA_ACTIVATEANDEAT`, 2 | made active | thrown away |
| `MA_NOACTIVATE`, 3 | left | handed over |
| `MA_NOACTIVATEANDEAT`, 4 | left | thrown away |

Made active by a press in the client area, it is told `WA_CLICKACTIVE`; by a press off it, `WA_ACTIVE` (`29d9`, `377e`). A press thrown away is gone, but the release that follows it is handed over.

[[measured]]

- A press on `B`, two windows down in `P`, active: `A` was sent `WM_PARENTNOTIFY` with the point (30, 30), then `P` with (40, 40). Then `B` was sent `WM_MOUSEACTIVATE` naming `P`. The right button's press was told the same way, with 204h.
- With `WS_EX_NOPARENTNOTIFY` set on `A` and `B`, every message was the same.
- Each answer of the table, from `Q` for a press on `K`, did as the table says. 0 made `Q` active as 1 does.
- `Q` answering `HTBORDER` was made active with `WA_ACTIVE`, 1; in the client area, with `WA_CLICKACTIVE`, 2.
- `Q` answering `HTCAPTION` answered `MA_NOACTIVATE` through `DefWindowProc`, and was made active by `WM_NCLBUTTONDOWN`, with `WA_CLICKACTIVE`.
- The window pressed that is the active one itself is asked nothing. `P`, dragged by its client area, was sent no `WM_MOUSEACTIVATE`.

## What DefWindowProc answers

**`WM_MOUSEACTIVATE`** (seg1 `600e`). [[read out]] A child asks the window it is in first, with the same `wParam` and `lParam`, and answers what that answers if it is not nought. Otherwise `MA_NOACTIVATE` on the caption, whose press activates the window as `WM_NCLBUTTONDOWN` takes it, and `MA_ACTIVATE` anywhere else. [[measured]] `K`'s `DefWindowProc` asked `Q` each time. With `Q` answering 0, `K` answered 1.

**`WM_NCHITTEST`** (seg1 `6714`). [[read out]]

- An icon: `HTCAPTION`.
- The client area: `HTCLIENT`.
- A sizing frame: outside the window's rectangle inset by the frame, the side's code, or a corner's within a caption box's width of the inset rectangle's ends.
- A dialog frame: outside the rectangle inset by four borders and one, `HTBORDER`.
- Above the client area, in the caption's height from the top: the system menu box, the maximize and minimize boxes where the style has them, else `HTCAPTION`. Below the caption, `HTMENU` where the window has a menu.
- Beside or below the client area: the vertical scroll bar's code, the horizontal's, and `HTGROWBOX` where both meet, where the window has them.
- Anywhere else, `HTNOWHERE`: a plain border's pixels among them, which the look then throws away.

winbox.js answers from the frame as it lays it out, as it did before it asked windows at all. That differs from the read-out on a border's pixels and at a frame's corners, by a pixel. Not measured yet.

## Where a hidden window lies

[[measured]] A window hidden stays where it was in the order of windows, its children with it. [[probe:mousemsg]] walks the windows at the top with [[fn:USER.GetWindow]] after each step:

- `R3`, `R2`, `R1` made in turn: `R3`, `R2`, `R1`.
- `R2` hidden with `SW_HIDE`: still between `R3` and `R1`.
- Shown with `SW_SHOWNA`: in front of all, not made active.
- Hidden and shown with `SW_SHOW`: in front, made active. Hidden again while active: still in front, and `R3` made active.
- Shown with `SW_SHOWNOACTIVATE` from there: where it lay, at the front.
- `R1` hidden with [[fn:USER.SetWindowPos]] and `SWP_HIDEWINDOW`: still behind `R3`.
- `A`, a child, hidden and shown again: still between `T` and `U`.

`SetWindowPos` with `HWND_TOP` brings a child in front of its brothers, and a window at the top in front of the others without making it active. [[probe:mousemsg]] puts `T` in front of `A` and `U` so, and `Q` in front of `P`.

## In winbox.js

`src/win16/user/mouse-scan.ts`, and `crates/winbox-win16/src/mouse_scan.rs`. The page's pointer, and [[fn:USER.Mouse_Event]], put the mouse in the queue of the task whose window is under it then, as the point on the screen and what the mouse did (`raster-input.ts`, `raster_input.rs`). Each look hit-tests it as USER's does, sending `WM_NCHITTEST` from the program's own look. A window found to be another task's has the message handed to that task's queue, which hit-tests it again. A press taken sends `WM_PARENTNOTIFY`, `WM_MOUSEACTIVATE` and `WM_SETCURSOR`, and makes the window active, as above. An MDI client learns of a press on a document window through `WM_PARENTNOTIFY`, and makes it active ([[topic:mdi]]).

A group box's `HTTRANSPARENT` is still found by the desktop as it finds the window under a point, and the group box is not asked. Only `HWND_TOP` among the places `SetWindowPos` can put a window is followed. [[fn:USER.MessageBeep]] makes no sound.

Every look at a mouse message is a call into the program. A move not yet taken is replaced by the next, as before, so a program that falls behind is asked once for each move it takes, not for each the mouse made.
