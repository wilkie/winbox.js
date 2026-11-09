---
kind: topic
name: Drawing bounds
summary: The bounds GDI keeps of what is drawn in a device context — the program's, by SetBoundsRect and GetBoundsRect, and Windows' own, by IsDCDirty and SetDCStatus — and the rectangle each call that draws gives them; read out of GDI.EXE and recorded.
probes: [bounds]
---

GDI can keep the bounds of what is drawn in a device context: a program's, which it enables and asks for with [[fn:GDI.SetBoundsRect]] and [[fn:GDI.GetBoundsRect]], and Windows' own, which every context keeps from the start and USER asks for with [[fn:GDI.IsDCDirty]] and [[fn:GDI.SetDCStatus]]. [[measured]] [[probe:bounds]] draws each kind of call alone into a memory context and a window's, and reads back the bounds; both engines agree with all 75 records.

## What is kept

[[read out]] Two rectangles in the screen's coordinates, the program's and Windows', and four flags: each set and enabled (`GDI.EXE` seg1 `0136`, seg31 `0526`). Each call that draws gives the rectangle it draws in, in device units, to seg1 `42be`. Where either is enabled it is moved by the context's corner; a right or bottom of nought becomes 7FFFh; a rectangle with nothing in it is passed over; and each enabled set is marked set and takes it in. The rectangle is the call's own, not clipped: [[fn:GDI.GetBoundsRect]] cuts the program's to the context's area as it answers.

## What each call gives

- [[read out]] **A rectangle, an ellipse or a round rectangle** (seg25 `02d1`): the rectangle, in order, grown by the pen -- half its width rounded down at the left and top, half less a pixel at the right and bottom, so a null pen leaves the right and bottom a pixel in. An inside-frame pen grows nothing. [[measured]] 10, 20 to 50, 60 for a rectangle of that, 8, 18 to 52, 62 with a pen of five, 10, 20 to 49, 59 with none.
- [[read out]] **A line or a chain of lines** (seg21 `08cc`): the points' box grown by half the pen's width rounded down, and a pixel more at the right and bottom. [[measured]] A line from 5, 6 to 40, 30 is 5, 6 to 41, 31, either way round.
- [[read out]] **A polygon** (seg24 `03f3`): the points' box as it is filled, and its outline's as a chain of lines. **Arcs, chords and pies** are their points so; [[measured]] the top half of an ellipse in 10, 20 to 50, 60 is 10, 20 to 50, 41.
- [[measured]] **A pixel**, where it is drawn: itself (seg23 `020f`). **A blit** and `PatBlt`: the destination, in order. **USER's `FillRect`, `FrameRect` and `InvertRect`**, which are `PatBlt`s: the rectangle. **A region painted**: its box, a frame's too.
- [[read out]] **Text** (seg1 `35ed`): with a rectangle and `ETO_OPAQUE` or `ETO_CLIPPED`, the rectangle; and but for `ETO_CLIPPED`, from where the text starts -- the point moved by the alignment, or nought across where a spacing was given -- to the right edge, as far down as the font is high. [[measured]] "Hi" at 10, 20 is 10, 20 to the bitmap's right edge, 36.
- [[read out]] **A flood fill** (seg15 `013c`): its runs' left and right, and their top and bottom rows -- the bottom row's own, not the one past it. [[measured]] 0, 0 to 200, 149 for a 200 by 150 bitmap filled whole.

## Not yet done

- The bounds of `SetDIBitsToDevice` and `StretchDIBits` are taken as their destination; not recorded.
- USER's own drawing in WinBox -- a window's frame, its background erased, a control drawn -- does not go through GDI's calls, and so is not taken into a context's bounds as Windows' would be.
- What a printer driver's context keeps.

## In winbox.js

`crates/winbox-win16/src/gdi/bounds.rs`, each call that draws giving them its rectangle.
