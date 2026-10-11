---
kind: topic
name: Window frames
summary: What USER draws around a Windows 3.1 window — sizing frame, borders, caption, system menu and size boxes, menu bar and scroll bars — measured pixel for pixel on four displays.
probes: [chrome, flash, ovlstyle, nchit, swpframe]
---

Everything outside a window's client area is USER's to draw: the frame, the caption and its boxes, the menu bar and the scroll bars. [[measured]] [[probe:chrome]] makes a window of each common style, one at a time, and reads back every pixel of it. It uses seven styles: overlapped, inactive, caption only, dialog frame, popup with a border, a menu bar of three items, and both scroll bars. It was recorded on the VGA, the Super VGA, the EGA and the Hercules. winbox.js paints all 28 captures exactly, and gets the client rectangle right for each.

Every size below comes from [[fn:USER.GetSystemMetrics]] and every colour from [[fn:USER.GetSysColor]]. Areas are filled with brushes, so a colour the display lacks is a pattern ([[topic:brush-dithering]]). The Hercules's grey sizing frame is a checkerboard for that reason.

## Frames and borders

- [[measured]] A **sizing frame** is `SM_CXFRAME` wide. It has a line in `COLOR_WINDOWFRAME` at its outer edge and another at its inner edge, with the border colour (`COLOR_ACTIVEBORDER` or `COLOR_INACTIVEBORDER`) between them. A notch of the frame colour crosses it `SM_CXFRAME + SM_CXSIZE` from each corner, which marks where a drag sizes a corner rather than an edge.
- [[measured]] [[probe:ovlstyle]]: an **overlapped window**, neither a child nor a pop-up, always has a caption. `CreateWindow` adds `WS_CAPTION` to its style, and with it the thin border, whatever it asked for. It also adds `WS_CLIPSIBLINGS`, which a pop-up gets too. A child keeps its style as it asked. Of 200 by 100 asked for with no caption, a system menu and a minimize box, the client area is 198 by 79. Jewel Thief of the corpus asks for just that, and winbox.js drew its window with no caption or border.
- [[measured]] A **thin border** is one line of the frame colour. A **dialog frame** is one line, then `SM_CXDLGFRAME` of the caption colour. A dialog's **modal frame**, `DS_MODALFRAME` with a caption, is described with dialog boxes ([[topic:dialog-boxes]]).
- [[measured]] A **dialog frame comes before a sizing frame.** `WS_DLGFRAME` without `WS_BORDER`, or `WS_EX_DLGMODALFRAME`, with `WS_THICKFRAME` too, has its client area five pixels in, as a dialog frame's, not `SM_CXFRAME` in: [[probe:nchit]] records it on three displays, and the caption of the modal one starts a row lower to match. [[read out]] USER lays the client area out so (seg1 `6fed`), and draws the frame as a dialog frame (`9fa5`); the pixels are not measured. `WM_NCHITTEST` still answers a sizing frame's codes on its outer four pixels ([[topic:hit-testing]]). winbox.js draws and lays out both so.

## The caption

- [[measured]] The caption is `SM_CYCAPTION` tall. Its first and last rows are lines, and the first is the frame's inner line.
- [[measured]] The **system menu box** is the left half of the display driver's `OBM_CLOSE` bitmap, followed by a line.
- [[measured]] The **maximize box** is `OBM_ZOOM`, placed against the right edge, and the **minimize box** is `OBM_REDUCE`, just left of it. Each is 19 pixels wide, including its own separating column.
- [[measured]] The title is centred in the space that is left. Active and inactive windows differ only in colours: the caption, the caption text and the border.
- The bitmaps are the driver's own resources. winbox.js reads them from the user's installation and never ships them.
- [[read out]] The caption is drawn active or inactive as `WM_NCACTIVATE` last said, which `DefWindowProc` keeps apart from which window is active. Activating a window sends it, and so does [[fn:USER.FlashWindow]].

## Flashing

[[fn:USER.FlashWindow]] turns a caption to draw the eye, without changing which window is active. [[read out]] It is USER seg6 `0DA4`. [[measured]] [[probe:flash]] calls it five times each on the active window, an inactive one and a minimized one, and records its answer, the `WM_NCACTIVATE`s the window was sent, and which window is active after. All 14 records agree with winbox.js.

- [[measured]] For a window that is not minimized, it answers what the caption was: 64 when drawn active, 0 when not.
- [[measured]] Turning it sends `WM_NCACTIVATE` with the caption's state turned. On the active window, it goes 64, 0, 64 with 0, 1, 0 sent.
- [[measured]] Not turning it sends whether the window is the active one. So the active window's caption is put back lit, and an inactive one's unlit.
- [[measured]] The active window stays the active one throughout.
- [[measured]] A minimized window is sent nothing, and the call answers 1 every time. [[read out]] Its title is lit when turning and not already lit. Otherwise it is drawn again and no longer lit.

## The menu bar

- [[measured]] The menu bar lies directly under the caption. It is `SM_CYMENU` rows of `COLOR_MENU`, then a line of the frame colour, and the client area starts below that line.
- [[measured]] Each item is its text in the System font, in `COLOR_MENUTEXT`, with eight pixels on either side. The first item starts at the frame's inner edge, and each following item starts where the last one's space ends.
- [[measured]] The character after `&` is underlined. The underline is one pixel high, as wide as that character, and one row below the font's ascent.
- [[measured]] The text's cell is placed one pixel above centre in the bar. That is row 0 of the VGA's 18-row bar for a 16-pixel font, and row 1 of the EGA's and Hercules's 16-row bar for a 12-pixel font.
- Not yet measured: whether the eight pixels follow the font. Every display's System font averages seven pixels a character, so this cannot be told. Also not measured: the vertical rule itself. Half the difference less one, a quarter of the difference, and centred less one pixel all fit both bars. A display whose font and bar give another difference would settle both questions.

## Scroll bars

- [[measured]] A vertical scroll bar is `SM_CXVSCROLL` wide, and it shares its edge lines with its neighbours: the client area's right edge moves in by `SM_CXVSCROLL - 1`. A horizontal bar does the same by `SM_CYHSCROLL - 1`. The bar runs from one pixel outside the client area on each side, so its end lines are the caption or menu line above it and the frame line below it.
- [[measured]] Each bar is filled with `COLOR_SCROLLBAR` and outlined in the frame colour. The EGA's `818181` is solid `808080`, and the Hercules's `3f3f3f` is its quarter pattern.
- [[measured]] The arrow buttons are the driver's `OBM_UPARROW`, `OBM_DNARROW`, `OBM_LFARROW` and `OBM_RGARROW`, placed at each end, and nothing is drawn over them.
- [[measured]] The **thumb** is `SM_CYVTHUMB` (or `SM_CXHTHUMB`) long. At position 0 it overlaps the first arrow's last line. It is a box in `COLOR_BTNFACE`, outlined in the frame colour. `COLOR_BTNHIGHLIGHT` lights it one pixel along the top and left, and `COLOR_BTNSHADOW` shades it two pixels along the bottom and right.
- [[measured]] With both bars, the box between them is filled with the scroll bar colour inside the lines around it.
- [[measured]] **A window too small for its scroll bars has none.** Where the caption and menu bar reach the bottom of the frame, the client area is left empty at their foot and neither bar is laid out; else the vertical bar is, and the horizontal one only where more than `SM_CYHSCROLL` is left (seg1 `70b7`, `70e3`). [[probe:nchit]]'s overlapped window of 102 by 30 with both bars and a menu bar has the client area 4, 42, 98, 42 on the VGA, below the window's foot, and no part of it answers `HTVSCROLL` or `HTHSCROLL`. winbox.js had taken both bars off a client area already empty.
- Not yet measured: the thumb anywhere other than the start of a bar with the default range, pressed arrows, disabled bars, and bars too short for their thumb.

## The screen and the windows on it

- [[documented]] Windows 3.1 keeps no pixels for a window. What shows of a window is on the screen and nowhere else. A window draws through a device context that starts at its client area and is clipped to the part of it that shows. When one window uncovers another, USER repaints the frame, and the window repaints the rest when asked with `WM_PAINT`.
- [[measured]] Showing a window makes it the active one, and the window that was active is repainted as inactive. That is how [[probe:chrome]] made its inactive capture: by showing a second window elsewhere on the screen.
- [[measured]] The client area is erased with the class's background brush when the window is painted. `COLOR_WINDOW + 1`, which the probe's class gives, stands for the colour itself and is not a brush handle.
- Not yet measured: where `CW_USEDEFAULT` puts a window and how big it makes it, and child windows and their clipping. The desktop's pattern and wallpaper are in [[topic:system-parameters]]. Maximizing, minimizing, moving and sizing are in [[topic:window-states]].

## A frame changed

A window's style can be changed with [[fn:USER.SetWindowLong]], and its menu with [[fn:USER.SetWindowWord]] and `GWW_ID`, but its client area stays where it was until [[fn:USER.SetWindowPos]] is told the frame changed, with `SWP_FRAMECHANGED`, which 3.1's headers also name `SWP_DRAWFRAME`. Clock does this to lose its title when it is double-clicked ([[topic:accessories]]). [[read out]] `CLOCK.EXE` seg1 `1a8e` takes `WS_DLGFRAME`, `WS_SYSMENU`, `WS_MINIMIZEBOX` and `WS_MAXIMIZEBOX` out of its style -- `WS_BORDER` and `WS_THICKFRAME` stay -- sets `GWW_ID` to nought, calls `SetWindowPos` with `27h`, `SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_DRAWFRAME`, and `ShowWindow` with `SW_SHOW`; and puts them all back the same way.

[[read out]] `SetWindowPos`'s work on each window (`USER.EXE` seg7 `0ccd`-`1169`):

- After `WM_WINDOWPOSCHANGING`, the window's flags gain `SWP_NOCLIENTSIZE` and `SWP_NOCLIENTMOVE` (`0d66`), and `SWP_NOMOVE` and `SWP_NOSIZE` where its place or size is the one it has (`0d70`-`0dcd`).
- `WM_NCCALCSIZE` is sent where a size is given or the frame changed (`0e8f`): `wParam` 1 and `NCCALCSIZE_PARAMS` -- the rectangle the window is to have, the one it has, and its client area's, each in its parent's client area, with a pointer to a copy of the `WINDOWPOS` (`0ea4`-`0f50`). What the window procedure answers says which of the old client area's bits to keep, and where; an answer of nought, or one outside 10h to 400h, keeps them at the new client area's top left (`0f67`-`0f84`).
- The first rectangle as the window procedure left it is the client area (`0f89`-`0fb9`). `SWP_NOCLIENTMOVE` is taken off where its corner moved (`0fcf`) and `SWP_NOCLIENTSIZE` where its width or height changed (`0fe6`).
- [[fn:USER.DefWindowProc]] answers `WM_NCCALCSIZE` with the client area the style leaves, written over the first rectangle, and nought. For `WM_WINDOWPOSCHANGING` with a size given, it asks an overlapped window, or one with a sizing frame, `WM_GETMINMAXINFO`, and holds the size to the tracking sizes it answered (seg1 `609a`, `0000`-`008a`). For `WM_WINDOWPOSCHANGED` it sends `WM_MOVE` without `SWP_NOCLIENTMOVE`, and `WM_SIZE` without `SWP_NOCLIENTSIZE` (seg7 `11fc`-`1250`) -- not as `SWP_NOMOVE` and `SWP_NOSIZE` say.

[[measured]] [[probe:swpframe]] does what Clock does to a window of 160 by 100 at (40, 40) with a menu bar, logs what it is sent and reads its pixels:

- Its caption and menu taken away: `WM_WINDOWPOSCHANGING` with `27h`; `WM_NCCALCSIZE` with 1, `40,40,200,140` made `44,44,196,136`, the old client area `44,82,196,136`, answered nought; `WM_NCPAINT` with a region of the whole window, not 1; `WM_ERASEBKGND`, its clip box `0,54,152,92` -- only what the old client area's bits, kept at the top, did not cover; `WM_WINDOWPOSCHANGED` with `27h`, and from it `WM_MOVE` to `(44,44)` and `WM_SIZE` of 152 by 92, though `SWP_NOMOVE` and `SWP_NOSIZE` were given. `ShowWindow` with `SW_SHOW`, the window shown already, sends nothing; `WM_PAINT` follows with the same rectangle to paint.
- Put back: the same, with `WM_GETTEXT` as the caption is drawn, and `WM_ERASEBKGND` with an empty clip box -- the smaller client area all kept -- and no `WM_PAINT`.
- `SWP_FRAMECHANGED` with nothing changed: the same messages, `WM_WINDOWPOSCHANGED` with `1827h`, and no `WM_MOVE` or `WM_SIZE`.
- The style changed with `SetWindowLong` alone, and `SetWindowPos` with neither a size nor `SWP_FRAMECHANGED`: only `WM_WINDOWPOSCHANGING`. The client area stays as it was, `44,82` with no caption in the style.
- Then sized: `WM_GETMINMAXINFO` after `WM_WINDOWPOSCHANGING`, `WM_NCCALCSIZE` with 1, `WM_NCPAINT` with a region of the whole window, all of the client area erased and painted.
- The frame drawn for a style with a border and no caption, and a menu bar, leaves much of what was there, the old caption among it; the probe does not keep those pixels.

[[inferred]] As a window is made, its client area is the one `WM_NCCALCSIZE` makes for the style it has then, after `WM_NCCREATE`: Visual Basic's forms change their style in `WM_NCCREATE` (Four Seasons of the corpus), and with the client area laid out before, moving the window a pixel told it `WM_SIZE` once the client flags were followed. winbox.js lays the client area out again there.

Both engines agree with all 312 records. winbox.js lays the client area out as the style says, whatever the window procedure leaves of the first rectangle, and does not hand over the `WINDOWPOS`'s pointer; it holds a size to the least before `WM_WINDOWPOSCHANGING`, as [[probe:minsize]] recorded, and not to the most the tracking size allows. Before, winbox.js laid out the client area again as soon as `GWW_ID` changed, and never as `SWP_FRAMECHANGED` asked, so Clock lost its menu bar and kept its caption; and it sent `WM_NCCALCSIZE` with nought and no structure, which this probe's window procedure reads: on the Rust engine the run went no further.

## The mouse and the keyboard

- [[documented]] A mouse message goes to the window under the pointer, or to the window that called `SetCapture`. Over a client area it is `WM_MOUSEMOVE` or a button message, in client coordinates. Elsewhere on a window it is the `WM_NC` form, carrying the part of the window it is over, in screen coordinates. A second press is a double click only for a class with `CS_DBLCLKS`.
- [[documented]] Pressing on a window that is not active activates it. Keys go to the window with the focus, and `TranslateMessage` posts `WM_CHAR` for a key that typed a character.
- [[documented]] `GetMessage` takes what was posted to a program before its mouse and keyboard input. So the `WM_CHAR` or `WM_SYSCHAR` that `TranslateMessage` posts for a key comes before that key's release, even though the release was already waiting. winbox.js once kept both in one line. Alt and F then reached `DefWindowProc` as Alt's release before the F, which opened the menu bar in place of the File menu.
- [[documented]] Releasing Alt enters the menu bar only if no other key was pressed while Alt was down. Alt and a letter opens that letter's menu, and the release that follows does nothing.
- [[documented]] Alt+F4 is the system menu's Close. `DefWindowProc` turns it into `SC_CLOSE`, as the menu's own label says.
- [[documented]] `WM_PAINT` is never queued. `InvalidateRect` marks a window, and the window is painted when its program next asks for a message and none is waiting.
- `WM_NCHITTEST` and `WM_MOUSEACTIVATE` are sent as Windows sends them, and `DefWindowProc`'s answers are in [[topic:hit-testing]]. `WM_SETCURSOR` is in [[topic:cursor]]. Menus are in [[topic:menus]], and the caption boxes, moving and sizing are in [[topic:window-states]].

## Implementation

`frameChanged` in `desktop.ts` and `frame_changed` in `crates/winbox-win16/src/position.rs` lay a window out again for a changed frame and keep its bits; `positionChanging` and `positionChanged` in `window-state.ts` (`position_changing`, `position_changed`) send `WM_NCCALCSIZE` and work out the client flags.

`paintFrame` in `src/win16/user/frame.ts` paints a window's non-client area and returns the client rectangle. `test/raster/frame_test.ts` holds it to all 28 captures.

`Desktop` in `src/win16/user/desktop.ts` is the screen as USER keeps it. It records which window each pixel shows, and each window's client area is a view of the screen's pixels, clipped to what shows, so everything GDI draws into a window lands on the screen. A brush's pattern starts at the corner of what it is drawn through: the window for its frame, the client area for the window's own drawing. `test/raster/desktop_test.ts` shows each captured window on a desktop the display's size and reads all 28 back from the screen.

The conformance suite replays [[probe:chrome]] itself through the exports: `RegisterClass`, `CreateWindow`, `ShowWindow` and `UpdateWindow`, with the probe's window procedure calling `BeginPaint`, `EndPaint` and `DefWindowProc`, then `GetWindowRect`, `GetClientRect`, [[fn:USER.ClientToScreen]] and [[fn:GDI.GetPixel]] on the screen. All eight of its windows agree on each display, 1,038 records each, the last one holding the standard controls ([[topic:standard-controls]]).
