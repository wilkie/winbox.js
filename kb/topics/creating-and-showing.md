---
kind: topic
name: Creating and showing a window
summary: Every message a Windows 3.1 window is sent as it is made, shown, hidden and destroyed, in order — WM_GETMINMAXINFO to WM_WINDOWPOSCHANGED — with the structures they carry, recorded and read out of USER.EXE.
probes: [showseq, tutor]
---

A program that does its work as its window is made, in `WM_CREATE`, `WM_SIZE`, `WM_SHOWWINDOW` or `WM_ACTIVATE`, depends on when each arrives and what it carries. [[measured]] [[probe:showseq]] logs every message a window of its own class is sent, in order, as it makes and shows windows of five kinds on the VGA:

- `A`, overlapped and hidden, then shown with `SW_SHOWNORMAL`;
- `B`, overlapped and visible at `CW_USEDEFAULT`;
- `C`, a visible child of A;
- `P`, a visible pop-up owned by A;
- `M`, overlapped, visible and maximized.

Then it hides A, shows it again, and destroys the windows. Mouse messages are left out. Every pointer's structure is written out, and a window is named by what it is. winbox.js agrees with all 157 records.

## Made

- [[measured]] An overlapped window is sent `WM_GETMINMAXINFO`, `WM_NCCREATE`, `WM_NCCALCSIZE` and `WM_CREATE`, in that order. A child and a pop-up are not sent `WM_GETMINMAXINFO`.
- [[measured]] `CREATESTRUCT` carries the style as the program gave it, without the `WS_CLIPSIBLINGS` and the caption USER adds to an overlapped window. Its place and size are as given. With `CW_USEDEFAULT`, the place is the one USER chose and the width is still `CW_USEDEFAULT`.
- [[measured]] `WM_NCCALCSIZE` carries the window's rectangle on the screen, a child's too.
- [[measured]] A child and a pop-up are sent `WM_SIZE`, then `WM_MOVE`, straight after `WM_CREATE`. An overlapped window is not, until it is first shown.
- [[measured]] A child's parent is sent `WM_PARENTNOTIFY` with `WM_CREATE` in `wParam`, and the child's handle and identifier in `lParam`. It comes after the child's own `WM_SIZE` and `WM_MOVE`. An owned pop-up's owner is not sent it.
- [[measured]] An overlapped window given `CW_USEDEFAULT` for its place is shown as its `y` says. B's `y` is nought, `SW_HIDE`, so B is made hidden, `WS_VISIBLE` or not.

## WM_GETMINMAXINFO

[[read out]] USER fills the structure before sending it (seg6 `18e0`), from sizes it keeps (seg3 `242f`). [[measured]] A, B and M were each offered `(36, 36)`, `(648, 488)`, `(-4, -4)`, `(102, 26)` and `(648, 488)`:

| Point            | What it is                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| reserved         | an icon's size and four borders                                                                                    |
| largest          | with a sizing frame, the screen and a frame beyond it on every side; without one, the screen and four borders more |
| where maximized  | with a sizing frame, a frame up and to the left of the screen's corner; without one, a border                      |
| least to drag to | `SM_CXMINTRACK` by `SM_CYMINTRACK` with a caption, a border each way without                                       |
| most to drag to  | the screen and a frame beyond it on every side                                                                     |

## Made maximized

[[measured]] `WS_MAXIMIZE` is carried out after `WM_CREATE`, while the window is still hidden:

1. `WM_GETMINMAXINFO`.
2. `WM_WINDOWPOSCHANGING`, at the maximized place and size, with `SWP_NOACTIVATE` and `SWP_FRAMECHANGED`.
3. `WM_GETMINMAXINFO` again.
4. `WM_NCCALCSIZE`, `wParam` 1, with the new rectangle.
5. `WM_WINDOWPOSCHANGED`, now with `SWP_NOZORDER` and `SWP_NOREDRAW` as well.

[[fn:USER.DefWindowProc]] answers `WM_WINDOWPOSCHANGED` with `WM_MOVE`, then `WM_SIZE` with `SIZE_MAXIMIZED`. The window is then shown as any other. When it shows it is still owed its first `WM_SIZE` and `WM_MOVE`, and it is sent them again.

## Shown

[[measured]] [[fn:USER.ShowWindow]] on a hidden window at the top sends, in order:

1. `WM_SHOWWINDOW`, 1.
2. Message 9, `wParam` 1. It is sent wherever a window is shown or hidden. Nothing documents it.
3. `WM_WINDOWPOSCHANGING` with `SWP_NOSIZE`, `SWP_NOMOVE` and `SWP_SHOWWINDOW`, place and size nought. The window it goes after is the one it goes below. For a window brought to the top, that is USER's hidden `#32771` ([[topic:enumerating-windows]]).
4. The activation messages, as [[topic:activation-and-focus]] has them.
5. `WM_NCPAINT` with 1 for the whole frame, then `WM_ERASEBKGND`: the window is drawn at once.
6. `WM_WINDOWPOSCHANGED`, with the window's place and size, the same flags, and `0x1800` added. `SWP_NOZORDER` is added too when the window did not move among the others.
7. The first time only, the `WM_SIZE` and `WM_MOVE` an overlapped window was owed since it was made.

Its `WM_PAINT` waits for the program to take its messages.

- [[measured]] A child is not brought forward or made active: `SWP_NOZORDER` and `SWP_NOACTIVATE` are in its flags. Its frame and erase wait for its own `BeginPaint`.
- [[measured]] A child made visible by `CreateWindow` leaves its parent due a paint where it lies. The parent is erased at once, and painted before the child. [[probe:tutor]]: a hidden child shown later with `ShowWindow` does not. The Tutorial's main window is not painted again over the text it drew straight into its child.
- [[measured]] A window brought to the top takes its family with it: its owner, and every window that owner owns, just above it. Each is sent `WM_WINDOWPOSCHANGING` in turn, from the top down, after the one above it. The window shown has its own flags. The rest are neither sized, moved nor made active. Each is sent `WM_WINDOWPOSCHANGED` at the end, in the same order. When P showed, A was placed after it.
- [[measured]] A window made active that was not yet at the top is placed there once more between the two halves of its activation. That happens after the window losing the activation is told, and before the new one is. Every member of the family is sent `WM_WINDOWPOSCHANGING` again, the window itself with `SWP_NOSIZE` and `SWP_NOMOVE` only, and no `WM_WINDOWPOSCHANGED` follows.
- [[measured]] `DefWindowProc` asks a window with a caption for its text, `WM_GETTEXT` for 79 characters, each time it draws the caption: after every `WM_NCACTIVATE` and `WM_NCPAINT`.
- [[measured]] Once the program takes its messages, `WM_PAINT`s come from the top window down, each window before its children. When A was shown again, P was painted first, then A, then C.

## Hidden and destroyed

- [[measured]] `ShowWindow` with `SW_HIDE` sends `WM_SHOWWINDOW` with nought and message 9 with nought. Then comes `WM_WINDOWPOSCHANGING`, with `SWP_HIDEWINDOW`, `SWP_NOACTIVATE`, `SWP_NOZORDER`, `SWP_NOSIZE` and `SWP_NOMOVE`. `WM_WINDOWPOSCHANGED` follows.
- [[measured]] Only what the window uncovers is drawn again. Hiding A under the maximized M drew nothing at all.
- [[measured]] [[fn:USER.DestroyWindow]] hides a visible window the same way, without `WM_SHOWWINDOW` or message 9, before `WM_DESTROY` and `WM_NCDESTROY`.
- [[measured]] A window whose frame is uncovered only in part is sent `WM_NCPAINT` with a region, not 1. That is the case when P is destroyed over A and over A's child C.

## Not yet measured

- `WM_MINIMIZE` at creation, and a hidden child or pop-up's `WM_SIZE` at creation.
- Showing with `SW_SHOWNOACTIVATE`, `SW_SHOWNA` and `SW_SHOWMINNOACTIVE`. winbox.js leaves `SWP_NOACTIVATE` in their flags but still makes the window active.
- What `WM_NCCALCSIZE`'s `NCCALCSIZE_PARAMS` holds beyond its first rectangle. winbox.js gives the old rectangle, the old client area, and nought for the `WINDOWPOS` pointer.
- Whether `WM_NCCREATE` answered with nought stops the window being made.

## In winbox.js

- `CreateWindow` in `src/win16/user/CreateWindow.ts` sends the making messages. `minMaxInfo` in `src/win16/user/window-state.ts` fills `MINMAXINFO`, and `maximizeMade` maximizes a window made so.
- `showRaster` in `window-state.ts` sends a showing's or a hiding's messages. It works out the family, the window each goes after, and whether it moved. `deliverActivation` in `activation.ts` takes the second placing between its two halves.
- `Desktop.show` brings an owned window's owner up beneath it. `#gained` and `#exposeOwned` in `desktop.ts` mark what a window came to show or left showing, from the screen's owners before and after. `unpaintedWhere` hands out `WM_PAINT` from the top down.
- `sendNcPaint` in `erase.ts` makes the region `WM_NCPAINT` carries when only part of a frame is due.
