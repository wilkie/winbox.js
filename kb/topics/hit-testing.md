---
kind: topic
name: Where the mouse lands
summary: How Windows 3.1 gives out the mouse as a program takes it — the window under it found from the desktop down, each asked with WM_NCHITTEST and passed over for HTTRANSPARENT, a press told up the windows it is in with WM_PARENTNOTIFY and its window asked with WM_MOUSEACTIVATE whether to be made active and whether to throw the press away — what DefWindowProc answers, the capture's kinds, and where a hidden window lies in the order of windows, as USER.EXE has it and the mousemsg and nchit probes recorded it.
probes: [mousemsg, nchit, curerr, comboact, iconclk]
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

**`WM_NCHITTEST`** (seg1 `6714`). [[read out]] The point is held to the window's rectangles in turn, and nothing asks whether it is on the window at all.

1. An icon, `WS_MINIMIZE`: `HTCAPTION` everywhere (`672f`).
2. The client area: `HTCLIENT` (`676b`), before anything else.
3. A sizing frame, `WS_THICKFRAME`: the window's rectangle less `SM_CXFRAME` and `SM_CYFRAME` on each side (`678e`). A point outside that is the frame's (`67bb`):
   - on or above the inner rectangle's top, or on or below its bottom: a corner where it is within `SM_CXSIZE` of the rectangle's left or right, `HTTOPLEFT` and the rest, else `HTTOP` or `HTBOTTOM`;
   - left or right of it: a corner where it is within `SM_CYSIZE` of the rectangle's top or bottom, else `HTLEFT` or `HTRIGHT`.
4. A dialog frame, `WS_DLGFRAME` without `WS_BORDER` or else `WS_EX_DLGMODALFRAME`, a sizing frame or not (`6744`): outside the rectangle so far less four borders and one, `HTBORDER` (`685c`). With a sizing frame too, that is inside the sizing frame.
5. Above the client area, in `SM_CYCAPTION` from the top of that rectangle, where the window has a caption (`68af`):
   - the system menu's box, from the rectangle's left for `SM_CXSIZE` and a border (`68ca`);
   - the rightmost box, from the rectangle's right less a border, for the width of `OBM_REDUCE`, the display driver's bitmap (seg3 `0fb8`): the maximize box, or the minimize box where there is only that (`6902`);
   - the box beside it, the minimize box where there are both (`691a`);
   - else `HTCAPTION`.
6. Still above the client area, below the caption, or below the rectangle's top without one: `HTMENU` where the window has a menu bar, else `HTNOWHERE` (`693f`). Neither this nor the caption looks at where the point is across.
7. Below the client area: `HTHSCROLL` where the horizontal scroll bar was laid out, `HTGROWBOX` right of the client area; else `HTNOWHERE` (`694e`).
8. Level with it, at or right of its right edge: `HTVSCROLL` where the vertical bar was laid out (`696c`); else `HTNOWHERE`.

Whether the menu bar and the scroll bars were laid out is the window's own flags, set as `WM_NCCALCSIZE` makes the client area (seg1 `6fd2`): the menu bar for a window that is not a child and has a menu; neither scroll bar where the caption and menu bar leave the client area no height; else the vertical bar where the style has it, and the horizontal one where more than `SM_CYHSCROLL` is left ([[topic:window-frames]]).

[[measured]] [[probe:nchit]] gives the point to `DefWindowProc` itself, at every pixel of a window and two pixels round it, for 31 windows: no frame, a thin border, a dialog frame, a caption, a sizing frame with and without a border or a dialog frame, `WS_EX_DLGMODALFRAME` with and without a sizing frame; with the system menu, either box or both, a menu bar, either scroll bar or both; one too small for its scroll bars; hidden; shown and disabled; maximized and minimized; and children with captions, a sizing frame and a border. It records each row as runs of answers. It was recorded on the VGA, the EGA and the Hercules, whose captions, boxes and scroll bars differ. All of the read-out held:

- A sizing frame's corner runs `SM_CXSIZE` and one pixel along the top and bottom edges from the inner rectangle's corner, so 25 pixels from the outside of a VGA window, and `SM_CYSIZE` and one down the sides. The rows of the top and bottom frame lines next to the inner rectangle are the corner's across the side's width: the 180 by 120 overlapped window's row 3 is `HTTOPLEFT` for x 0 to 22, `HTTOP` to 157, `HTTOPRIGHT` beyond; its rows 4 to 22, `HTTOPLEFT` for x 0 to 3.
- Two pixels beyond a sizing frame are still its edge's or corner's, and beyond a dialog frame `HTBORDER`. Beyond a thin border, or above a caption, `HTNOWHERE`; beside a caption, in its rows, the caption or the system menu box.
- A thin border's pixels are `HTNOWHERE`, a pop-up's, a caption window's and a child's alike, except above the client area: a pop-up with a border and a menu bar is `HTMENU` across its whole top row, the border's pixel and the two beyond it too.
- The boxes are 19 wide with their border on the VGA and the EGA, 17 on the Hercules, whose `SM_CXSIZE` is 19: the system menu box `SM_CXSIZE` and one, the others `OBM_REDUCE`'s width and one.
- Inside a sizing or modal frame the caption is hit from the frame's inner edge, a row below where it is drawn, on the frame's inner line. The 180 by 120 overlapped window with a menu bar answers `HTCAPTION` in its row 23, the menu bar's first row as it is drawn, and `HTMENU` from row 24 to the client area at 42.
- Without room, the 102 by 30 overlapped window with both scroll bars has no `HTVSCROLL` or `HTHSCROLL` anywhere, and its client area is empty, 4, 42, 98, 42 in the window on the VGA.
- `HTGROWBOX` starts a pixel right of the client area, and `HTHSCROLL` runs from the far left of the row to the client area's right edge, that pixel included; level with the client area, that same column is `HTVSCROLL`.
- A maximized window answers as any other, its frame's codes off the screen. Hidden and disabled windows answer as when shown. A child's caption, boxes and frame answer as a window's at the top.
- A window with `WS_DLGFRAME` and `WS_THICKFRAME` but no border, or with `WS_EX_DLGMODALFRAME` and `WS_THICKFRAME`, has a sizing frame's codes on its outer four pixels, `HTBORDER` inside them, and its client area five pixels in.

winbox.js answers from the read-out in both engines alike (`hitTest` in `raster-input.ts`, `hit_test` in `raster_input.rs`), and agrees with all 176 records on each display. The look's `WM_SETCURSOR`, a press's `WM_NCLBUTTONDOWN` -- the caption, its boxes, the menu bar, the frame's edges for the loop that sizes a window ([[topic:window-states]]) -- and the sizing cursors all go by its answer, so there is one geometry. A thin border's pixel, which winbox.js answered `HTBORDER` before, is now `HTNOWHERE`, and a press there is thrown away, as on Windows.

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
