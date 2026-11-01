---
kind: function
module: USER
name: WindowFromPoint
ordinal: 30
summary: Answers the window at a point of the screen by USER's hit test, asking the calling task's windows WM_NCHITTEST, passing over hidden and disabled children, static controls and group boxes.
versions:
  '3.1': exact
probes: [winpoint, iconkid, wfpwalk]
source: src/win16/user/window-from-point.ts
topics: [mouse-input, standard-controls]
---

## Observed behaviour

[[probe:winpoint]] makes a window holding one child of each kind: shown, hidden, disabled, a static control, a group box, and one with a child of its own. A second window covers part of it. The probe asks for points on each, as Championship Slots of the corpus asks where the mouse is.

- [[measured]] The answer starts from the top-level window that shows at the point. Its caption and frame count as the window, and a disabled top-level window is still answered.
- [[measured]] The answer then goes down to the child under the point, and to that child's child, and so on.
- [[measured]] A hidden child, a disabled child, a static control and a group box are passed over, and what lies beneath them answers. Nothing inside a disabled window is looked at, a top-level one included.
- [[measured]] Nothing inside a minimized window is looked at either: its icon answers for itself, its children visible or not ([[probe:iconkid]]).
- [[measured]] Where no window shows, the answer is the desktop window, from [[fn:USER.GetDesktopWindow]]. A point off the screen answers nought.

[[fn:USER.ChildWindowFromPoint]] looks only at one window's own children:

- [[measured]] It answers the first child whose rectangle holds the point, whether hidden, disabled, static or not. The point is in the parent's client area.
- [[measured]] A point of the client area that no child holds answers the parent. A point outside the client area answers nought.

[[probe:wfpwalk]] asks again with windows whose procedure writes down each `WM_NCHITTEST` it is sent and answers it as told:

- [[measured]] `WindowFromPoint` sends `WM_NCHITTEST` to the windows of the calling task it comes to, one at a time: a child in front answering `HTTRANSPARENT` is passed over for the one behind it, and over nothing else for its parent, which is asked next and answers. A window answering `HTCAPTION` from its client area is answered all the same; its children are asked first.
- [[measured]] A disabled child is passed over without being asked, for the child beneath it or else its parent.
- [[measured]] Where a child reaches past its parent's client area, a point of it outside that area is not its: past the parent altogether, the desktop window answers and no window is asked.
- [[measured]] With a window made system-modal, every point of the screen answers it, the desktop's too, and only it is asked.

## Inside Windows

[[read out]] `WindowFromPoint` (`USER.EXE` seg1 `713c`) is USER's hit test (`71b9`) from the desktop window, with nowhere to keep the hit-test code. The hit test walks the windows by their rectangles alone (seg1 `1dc0`), from the desktop window down, each window's children front to back, and asks no visible region:

- A window hidden, or whose rectangle does not hold the point, is passed over (`71bf`-`71e3`).
- A disabled child is passed over, its children with it; a disabled window that is not a child answers `HTERROR` for itself (`71e5`-`71f9`).
- Under a system-modal window, a window that is neither it nor a child in it, through windows styled children, is taken for it (`71fc`-`7208`, seg1 `287d`, `1bd3`). The first window walked is the desktop window, which is no window's child: so only the system-modal window and the windows in it are walked.
- An icon answers `HTCAPTION` (`720c`-`7217`).
- Where the point is in the window's client area, its children are walked first (`7219`-`7256`), the first of them to answer ending the walk.
- Then a window of another task answers `HTCLIENT` (`725d`-`726c`), its queue not the caller's (seg1 `817b`); a window of the calling task is sent `WM_NCHITTEST`, and answering `HTTRANSPARENT` is passed over (`726e`-`7285`).

A static control and a group box are passed over by their own answers: the static control's procedure answers `HTTRANSPARENT` (seg25 `24f2`), and the button procedure answers it for a group box alone (seg25 `1c9b`-`1ca8`). A static control of another task is not asked, and answers.

[[fn:USER.ChildWindowFromPoint]] (seg1 `715b`) takes the point into the screen's terms by the window's client area (`7166`-`7172`), answers nought for a point outside it (`7175`-`7187`), and else the first child, front to back, whose rectangle holds it, hidden and disabled alike (`7189`-`71a8`), or the window itself.

## Implementation

`Desktop.hitSteps` (`src/win16/user/desktop.ts`) and `hit_steps` (`crates/winbox-win16/src/raster_input.rs`) walk the windows as `71b9` does and give the steps it comes to, each a window and its answer or a window to be asked; the mouse's scan (`hitTest`, `scan_hit`) and `WindowFromPoint` ask each in turn. `Desktop.windowAt` and `window_at`, for WinBox's own use, take every window for the caller's and the answers of an icon's title and a group box as known.

winbox.js agrees with all 30 records of [[probe:winpoint]], with [[probe:iconkid]]'s, and with all 38 of [[probe:wfpwalk]].
