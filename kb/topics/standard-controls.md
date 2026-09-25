---
kind: topic
name: Standard controls
summary: How USER draws the controls it registers itself — push buttons, check boxes, radio buttons, static text, edit controls, list boxes and scroll bars — measured pixel for pixel on four displays.
probes: [chrome]
---

USER registers some window classes itself, and any program can make windows of them: `BUTTON`, `STATIC`, `EDIT`, `LISTBOX` and `SCROLLBAR`. [[measured]] [[probe:chrome]]'s last window holds one of each kind a dialog box usually has, made with `CreateWindow` as children of an ordinary window, with the check box and radio button checked and two strings added to the list box. It reads back every pixel on the VGA, the Super VGA, the EGA and the Hercules. winbox.js draws all of them exactly: 190 rows of the window on each display, 8 controls in each.

Every colour below comes from [[fn:USER.GetSysColor]], and every text is in the System font.

## Buttons

- [[measured]] A **push button** has an outline in `COLOR_WINDOWFRAME` with its four corner pixels left out, so the corners look rounded. Inside the outline is a face of `COLOR_BTNFACE`, raised two pixels deep: `COLOR_BTNHIGHLIGHT` along the top and left, `COLOR_BTNSHADOW` along the bottom and right, the two meeting on a diagonal.
- [[measured]] A **default push button** has a second, complete outline inside the first. Its raised face sits inside that.
- [[measured]] The text is in `COLOR_BTNTEXT`. Vertically it is centred, at `(height - tmHeight) / 2`. Horizontally it is one pixel left of centre, at `(width - text width) / 2 - 1`, rounded down, on both displays' fonts and both buttons.
- [[measured]] A **check box** or **radio button** is an image from the display driver's `OBM_CHECKBOXES` bitmap. The bitmap is a grid four images across: unchecked, checked, and the two pressed. Its rows are check boxes, radio buttons and three-state boxes. An image is 13 pixels wide, and as tall as the bitmap's height over three: 13 on the VGA, 11 on the EGA and Hercules. It is centred vertically at the left of the control.
- [[measured]] The text follows the image, five pixels after it. Vertically it is one row below centre, at `(height - tmHeight) / 2 + 1`.

## Static text, edit controls and list boxes

- [[measured]] **Static text** (`SS_LEFT`) is drawn from the control's top-left corner, in `COLOR_WINDOWTEXT` on `COLOR_WINDOW`.
- [[measured]] An **edit control** with `WS_BORDER` has a one-pixel border in the frame colour on its rectangle, like any window's thin border. Its text starts three pixels into the client area.
- [[measured]] The edit control's text starts 3 rows down on the VGA, and 2 on the EGA and Hercules. That equals the System font's descent, but it also equals the font's internal leading, and a quarter of its height less one. The four displays have only two fonts between them, so which rule Windows uses is not measured.
- [[measured]] A **list box** with `WS_BORDER` puts its border around the rectangle it was made with, not inside it. The window is one pixel bigger on every side, and the items have the whole rectangle. Each item is `tmHeight` tall, drawn two pixels from the left, in the order `LB_ADDSTRING` added them.

## Scroll bars

- [[measured]] A **scroll bar control** is drawn like a window's scroll bar ([[topic:window-frames]]), over the control's rectangle. It is filled with the scroll bar colour, which is patterned like any brush. The arrow bitmaps sit at each end, the thumb at the start, and the whole bar is outlined last.
- [[measured]] The arrows are scaled to the bar, which a window's scroll bar never needs. The control is 16 pixels high, and each driver's arrows are a different height: the VGA's 17 are shrunk, and the EGA's 14 and the Hercules's 11 are stretched. When stretching, row `r` of the result is row `(r * from + from / 2) / to` of the bitmap, rounded down. When shrinking, it is row `r * from / to`.
- Not yet measured: `StretchBlt` itself. The captures allow `(from - 1) / 2` in place of `from / 2`, and they cannot show which rows a reduction leaves out, because the outline covers the one that differs.

## Brush origins

[[measured]] A control's brushes are patterned from the control's own corner, not the screen's. The Hercules's scroll bar trough shows it: the quarter pattern is one row out of step with where it would be if it started at the screen's corner. See [[topic:brush-dithering]].

## What the controls do

- [[measured]] `BM_SETCHECK` checks a button and `LB_ADDSTRING` adds a string to a list box, both sent with `SendDlgItemMessage`. Each one repaints the control when its queue is next empty.
- [[documented]] `WM_PAINT` is not queued. `GetMessage` and `PeekMessage` make it for a window that needs painting when nothing else is waiting, parents before their children. That is how every control on the probe's window is painted by its message loop.
- Not yet measured: pressed, focused and disabled controls, group boxes, other alignments of static text, multi-line edit controls, a selection in a list box, and a scroll bar thumb away from its start.

## Implementation

`paintControl` in `src/win16/user/controls.ts` draws each control through the `Painter` that also paints window frames. `control-classes.ts` holds the classes' window procedures, and `test/raster/desktop_test.ts` holds each control's block of the capture to what the desktop paints. The conformance suite replays the whole window through the exports: `CreateWindow` for each control, [[fn:USER.SendDlgItemMessage]] for the checks and strings, and the probe's own message loop.
