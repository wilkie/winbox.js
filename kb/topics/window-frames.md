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

## Implementation

`paintFrame` in `src/win16/user/frame.ts` paints a window's non-client area into the screen's indexed pixels and returns the client rectangle. `test/raster/frame_test.ts` holds it to all 28 captures.
