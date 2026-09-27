---
kind: topic
name: Painting and erasing
summary: When Windows 3.1 erases a window's background and when it leaves it, what BeginPaint's fErase and rcPaint say, and how a change of system colours is drawn — read out of USER.EXE and recorded, down to the Tutorial's first screen.
probes: [nobrush, uncover, uncovr2, syncpnt, menubits, menuinv, syscol, tutor, tnrwrap]
---

A window is drawn in two steps. Its background is erased with `WM_ERASEBKGND`, then it paints itself when it takes `WM_PAINT`. USER decides when the first happens, and what [[fn:USER.BeginPaint]] tells the program about it. [[read out]] Only one place in `USER.EXE` sends `WM_ERASEBKGND` (seg1 `7a83`). It sends `WM_ICONERASEBKGND` instead to a minimized window whose class has an icon.

## Erasing

- [[read out]] [[fn:USER.DefWindowProc]] erases with the window's class brush, over the part of the client area the device context shows (seg1 `6355`). A brush of 1 to 21 is a system colour, one more than its index. It answers 1.
- [[measured]] With no class brush, `DefWindowProc` draws nothing and answers nought. [[probe:nobrush]] shows a popup with no brush over a window of its own. The window underneath still shows through the whole popup.
- [[read out]] A window is erased as soon as it is shown: `SetWindowPos` ends by erasing what it showed (seg7 `28d`, seg1 `7913`), before any `WM_PAINT`. `CreateWindow` with `WS_VISIBLE` shows the window this way. A window of another task is sent `WM_SYNCPAINT` instead, to erase itself.
- [[measured]] A window that another window uncovers is drawn at once as well. [[probe:uncover]] hides, moves and destroys a window over one of its own. Each time, before the call answers, the window underneath is sent `WM_NCPAINT`, then `WM_ERASEBKGND`, and the screen already shows its background there. `WM_PAINT` waits until the probe takes its messages. Its `rcPaint` is the rectangle uncovered, the same one `GetUpdateRect` answered at once, and `fErase` is nought.
- [[measured]] `WM_NCPAINT` is sent even when only the client area was uncovered. [[probe:uncovr2]] does the same with a window lying wholly inside the client area, clear of the frame.
- [[read out]] [[measured]] It is not only what was uncovered: the end of `SetWindowPos` erases every window that has an erase due (seg1 `7913`, on the desktop). [[probe:menuinv]] invalidates its window, erase and all, while a menu is up. The erase comes the moment the menu goes, before the probe takes a message.
- [[measured]] A window of another program is sent `WM_SYNCPAINT` instead, and draws itself in its own time. [[probe:syncpnt]] starts a program that shows a window over the probe's, hides it, and waits. By the time [[fn:KERNEL.WinExec]] answers, the probe's window has been sent `WM_SYNCPAINT`, `WM_NCPAINT` and `WM_ERASEBKGND`, and the screen shows its background again. `WM_PAINT` comes when the probe takes its messages. [[read out]] `DefWindowProc` answers `WM_SYNCPAINT` by drawing what the window is due (seg1 `6151`). Not recorded: what `WM_SYNCPAINT` carries in `wParam` and `lParam`. winbox.js sends noughts.
- [[measured]] A pop-up menu is different: it puts back the screen it covered. [[probe:menubits]] opens one over a window of its own with [[fn:USER.TrackPopupMenu]] and closes it with Escape. The window underneath is sent nothing, not even after the probe takes its messages, and the screen shows it again at once. `TrackPopupMenu` answered 1.
- [[measured]] The saved bits are thrown away when the window underneath is invalidated where the menu is while it is up. [[probe:menuinv]] invalidates the whole window: when the menu goes, the window is sent `WM_NCPAINT` and `WM_ERASEBKGND`, then `WM_PAINT` for all of it. Invalidating only a part clear of the menu leaves the bits standing: the window is erased at once, and `WM_PAINT`'s `rcPaint` is only that part.
- [[read out]] `InvalidateRect` with its erase flag set only marks the window. [[measured]] Nothing is sent until the probe takes its messages, then `WM_ERASEBKGND` and `WM_PAINT` together. `BeginPaint` erases it later, on the context it hands back.

## An erase not done

- [[read out]] When the window procedure answers `WM_ERASEBKGND` with nought, USER notes on the window that the erase was not done (seg1 `7afa`). The note stays until the next erase is tried, so it can outlive the paint it was made for.
- [[measured]] `BeginPaint` gives the note back as `fErase`. Its value is **4**, not 1 (seg1 `76ac`).
- [[read out]] For a program made for a Windows before 3.1, an erase not done is still due, and `BeginPaint` tries it again (seg1 `7afe`). `CreateWindow` marks the windows of a 3.1 program (seg8 `42d`). [[measured]] The probe is marked for 3.0, and its popup was sent `WM_ERASEBKGND` twice: once as it was shown, and once in `BeginPaint`. Both were answered nought, and `fErase` was 4.

## What is painted again

- [[read out]] `BeginPaint` clips its context to what is to be painted again, and answers the box around it as `rcPaint`. [[measured]] The Tutorial invalidates the rectangle its mouse picture goes in, without erasing, and fills `rcPaint` white when `fErase` says the erase was not done. With `rcPaint` the whole client area, the fill covered the welcome text drawn before it.
- winbox.js keeps the rectangle around what is to be painted again, not the region itself.

## New system colours

[[probe:syscol]] makes the desktop white with [[fn:USER.SetSysColors]], over a window of its own. It reads the screen at once, then after taking its messages.

- [[measured]] Nothing is drawn at once. The desktop keeps its old colour until the probe takes its messages.
- [[measured]] The window is sent `WM_SYSCOLORCHANGE` at once. When the probe takes its messages, it is sent `WM_PAINT`. `BeginPaint` then draws its frame with `WM_NCPAINT`, then erases it with `WM_ERASEBKGND`.
- [[measured]] A popup with no brush, shown after, still shows what is underneath.

## The Tutorial's first screen

[[probe:tutor]] starts the Tutorial over a window of its own and reads the screen as soon as `WinExec` answers ([[topic:several-programs]]). By then the Tutorial has set its own system colours, shown its window, drawn its welcome text and its first picture, and is waiting for a message. The screen is white everywhere but the text, the picture, and the bar along the bottom. The window underneath does not show through.

- The Tutorial's main windows have no class brush. White shows only because their erases are not done and the Tutorial fills what it paints when `fErase` says so.
- The welcome text is `Times New Roman` at -28, asked for with nothing but a height and a face. [[probe:tnrwrap]] records what that font measures: 33 pixels high, and `Welcome to the Microsoft Windows Tutorial.` wraps into three lines in the Tutorial's rectangle. At -33 it is 37 pixels high and wraps into four.
- winbox.js's whole-program runs had loaded only the bitmap fonts, so `Times New Roman` fell back to `MS Sans Serif` and wrapped into four lines. They now load the fonts as starting Windows does, TrueType included.
- All 48 rows of the screen agree with winbox.js.

## In winbox.js

`src/win16/user/erase.ts` sends the erase and keeps the note. `BeginPaint` answers `fErase` and `rcPaint`, and `eraseDue` erases every window due it as `ShowWindow`, `SetWindowPos`, `CreateWindow`, `DestroyWindow` and a closing menu end. A window of another task is sent `WM_SYNCPAINT` instead. A menu's bits are kept by `openPopup` in `desktop.ts`. `repaintAll` in `src/win16/user/desktop.ts` marks everything when the system colours change, and the desktop is drawn when paints are next looked for.
