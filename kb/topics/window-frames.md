---
kind: topic
name: Window frames
summary: What USER draws around a Windows 3.1 window — sizing frame, borders, caption, system menu and size boxes, menu bar and scroll bars — measured pixel for pixel on four displays.
probes: [chrome]
---

Everything outside a window's client area is USER's to draw: the frame, the caption and its boxes, the menu bar and the scroll bars. [[measured]] [[probe:chrome]] makes a window of each common style, one at a time, and reads back every pixel of it. It uses seven styles: overlapped, inactive, caption only, dialog frame, popup with a border, a menu bar of three items, and both scroll bars. It was recorded on the VGA, the Super VGA, the EGA and the Hercules. winbox.js paints all 28 captures exactly, and gets the client rectangle right for each.

Every size below comes from [[fn:USER.GetSystemMetrics]] and every colour from [[fn:USER.GetSysColor]]. Areas are filled with brushes, so a colour the display lacks is a pattern ([[topic:brush-dithering]]). The Hercules's grey sizing frame is a checkerboard for that reason.

## Frames and borders

- [[measured]] A **sizing frame** is `SM_CXFRAME` wide. It has a line in `COLOR_WINDOWFRAME` at its outer edge and another at its inner edge, with the border colour (`COLOR_ACTIVEBORDER` or `COLOR_INACTIVEBORDER`) between them. A notch of the frame colour crosses it `SM_CXFRAME + SM_CXSIZE` from each corner, which marks where a drag sizes a corner rather than an edge.
- [[measured]] A **thin border** is one line of the frame colour. A **dialog frame** is one line, then `SM_CXDLGFRAME` of the caption colour.

## The caption

- [[measured]] The caption is `SM_CYCAPTION` tall. Its first and last rows are lines, and the first is the frame's inner line.
- [[measured]] The **system menu box** is the left half of the display driver's `OBM_CLOSE` bitmap, followed by a line.
- [[measured]] The **maximize box** is `OBM_ZOOM`, placed against the right edge, and the **minimize box** is `OBM_REDUCE`, just left of it. Each is 19 pixels wide, including its own separating column.
- [[measured]] The title is centred in the space that is left. Active and inactive windows differ only in colours: the caption, the caption text and the border.
- The bitmaps are the driver's own resources. winbox.js reads them from the user's installation and never ships them.

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
- Not yet measured: the thumb anywhere other than the start of a bar with the default range, pressed arrows, disabled bars, and bars too short for their thumb.

## The screen and the windows on it

- [[documented]] Windows 3.1 keeps no pixels for a window. What shows of a window is on the screen and nowhere else. A window draws through a device context that starts at its client area and is clipped to the part of it that shows. When one window uncovers another, USER repaints the frame, and the window repaints the rest when asked with `WM_PAINT`.
- [[measured]] Showing a window makes it the active one, and the window that was active is repainted as inactive. That is how [[probe:chrome]] made its inactive capture: by showing a second window elsewhere on the screen.
- [[measured]] The client area is erased with the class's background brush when the window is painted. `COLOR_WINDOW + 1`, which the probe's class gives, stands for the colour itself and is not a brush handle.
- Not yet measured: where `CW_USEDEFAULT` puts a window and how big it makes it, child windows and their clipping, and the desktop's wallpaper and pattern. Maximizing, minimizing, moving and sizing are in [[topic:window-states]].

## The mouse and the keyboard

- [[documented]] A mouse message goes to the window under the pointer, or to the window that called `SetCapture`. Over a client area it is `WM_MOUSEMOVE` or a button message, in client coordinates. Elsewhere on a window it is the `WM_NC` form, carrying the part of the window it is over, in screen coordinates. A second press is a double click only for a class with `CS_DBLCLKS`.
- [[documented]] Pressing on a window that is not active activates it. Keys go to the window with the focus, and `TranslateMessage` posts `WM_CHAR` for a key that typed a character.
- [[documented]] `WM_PAINT` is never queued. `InvalidateRect` marks a window, and the window is painted when its program next asks for a message and none is waiting.
- Not yet measured: no probe records the input queue. winbox.js answers `WM_NCHITTEST`, `WM_MOUSEACTIVATE` and `WM_SETCURSOR` as `DefWindowProc` does, without asking the window. Menus are in [[topic:menus]], and the caption boxes, moving and sizing are in [[topic:window-states]].

## Implementation

`paintFrame` in `src/win16/user/frame.ts` paints a window's non-client area and returns the client rectangle. `test/raster/frame_test.ts` holds it to all 28 captures.

`Desktop` in `src/win16/user/desktop.ts` is the screen as USER keeps it. It records which window each pixel shows, and each window's client area is a view of the screen's pixels, clipped to what shows, so everything GDI draws into a window lands on the screen. A brush's pattern starts at the corner of what it is drawn through: the window for its frame, the client area for the window's own drawing. `test/raster/desktop_test.ts` shows each captured window on a desktop the display's size and reads all 28 back from the screen.

The conformance suite replays [[probe:chrome]] itself through the exports: `RegisterClass`, `CreateWindow`, `ShowWindow` and `UpdateWindow`, with the probe's window procedure calling `BeginPaint`, `EndPaint` and `DefWindowProc`, then `GetWindowRect`, `GetClientRect`, [[fn:USER.ClientToScreen]] and [[fn:GDI.GetPixel]] on the screen. All eight of its windows agree on each display, 1,038 records each, the last one holding the standard controls ([[topic:standard-controls]]).
