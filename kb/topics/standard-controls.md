---
kind: topic
name: Standard controls
summary: How USER draws the controls it registers itself — push buttons, check boxes, radio buttons, static text, edit controls, list boxes and scroll bars — measured pixel for pixel on four displays.
probes: [chrome, groupbox, msgbox, ctlcolor, dlgbrush, ctltrans]
---

USER registers some window classes itself, and any program can make windows of them: `BUTTON`, `STATIC`, `EDIT`, `LISTBOX` and `SCROLLBAR`. [[measured]] [[probe:chrome]]'s last window holds one of each kind a dialog box usually has, made with `CreateWindow` as children of an ordinary window, with the check box and radio button checked and two strings added to the list box. It reads back every pixel on the VGA, the Super VGA, the EGA and the Hercules. winbox.js draws all of them exactly: 190 rows of the window on each display, 8 controls in each.

Every colour below comes from [[fn:USER.GetSysColor]], and every text is in the System font.

## Buttons

- [[measured]] A **push button** has an outline in `COLOR_WINDOWFRAME` with its four corner pixels left out, so the corners look rounded. Inside the outline is a face of `COLOR_BTNFACE`, raised two pixels deep: `COLOR_BTNHIGHLIGHT` along the top and left, `COLOR_BTNSHADOW` along the bottom and right, the two meeting on a diagonal.
- [[measured]] A **default push button** has a second, complete outline inside the first. Its raised face sits inside that.
- [[measured]] The text is in `COLOR_BTNTEXT`. Vertically it is centred, at `(height - tmHeight) / 2`. Horizontally it is one pixel left of centre, at `(width - text width) / 2 - 1`, rounded down, on both displays' fonts and both buttons.
- [[measured]] A **check box** or **radio button** is an image from the display driver's `OBM_CHECKBOXES` bitmap. The bitmap is a grid four images across: unchecked, checked, and the two pressed. Its rows are check boxes, radio buttons and three-state boxes. An image is 13 pixels wide, and as tall as the bitmap's height over three: 13 on the VGA, 11 on the EGA and Hercules. It is centred vertically at the left of the control.
- [[read out]] A push button with the focus draws a dotted rectangle around its caption (`USER.EXE` seg25 `15d3`). It starts two borders left of the text and ends two borders right of it, and runs from one border above the text to two below it, kept inside the client area. On a push button it is also kept inside the button's edge: at least three borders from the top, or two on a screen of 300 rows or fewer, and four from the bottom. [[measured]] [[probe:msgbox]]'s default buttons show it on four displays. It is drawn as `DrawFocusRect` draws it, in the window's text and background colours: over a grey face every other pixel turns dark grey.
- [[measured]] The text follows the image, five pixels after it. Vertically it is one row below centre, at `(height - tmHeight) / 2 + 1`.

## Static text, edit controls and list boxes

- [[measured]] **Static text** (`SS_LEFT`) is drawn from the control's top-left corner, in `COLOR_WINDOWTEXT` on `COLOR_WINDOW`.
- [[read out]] Static text is laid out by `DrawText` (`USER.EXE` seg25 `1fe5`). Left, centred and right text is broken at words, `DT_WORDBREAK | DT_EXPANDTABS` with the alignment's flag. `SS_LEFTNOWORDWRAP` is `DT_EXPANDTABS | DT_NOCLIP`. `SS_NOPREFIX` adds `DT_NOPREFIX`. The client area is filled first with the brush the parent answers to `WM_CTLCOLOR` (seg25 `20da`). [[measured]] A message box's long text shows the breaking on four displays ([[topic:message-boxes]]).
- [[read out]] A static with `SS_ICON` loads the icon its text names as it is made: its instance's, or else the display driver's. It becomes that icon's size, `SM_CXICON` by `SM_CYICON`, wherever its template put it. It draws the icon at its corner (seg25 `23d8`).
- [[read out]] The rectangle styles fill the control with a system colour's brush: `SS_BLACKRECT` with `COLOR_WINDOWFRAME`, `SS_GRAYRECT` with `COLOR_BACKGROUND` and `SS_WHITERECT` with `COLOR_WINDOW` (seg25 `2220`). The frame styles draw a one-pixel line of the same colours round the control (seg25 `2245`). `SS_USERITEM` draws nothing. The About box's two rules are black rectangles one dialog unit tall ([[topic:about-boxes]]).
- [[documented]] `STM_SETICON` gives a static a new icon and answers the one before; `STM_GETICON` answers it. USER's own handling of them has not been read out.
- [[measured]] An **edit control** with `WS_BORDER` has a one-pixel border in the frame colour on its rectangle. [[read out]] It draws that border itself, inside its client area, having taken `WS_BORDER` out of its style.
- [[measured]] The edit control's text starts 4 pixels in from its window's corner, and 4 down on the VGA and 3 on the EGA and Hercules. [[read out]] The margins are half the font's average width across and a quarter of its height down, which settles what [[probe:chrome]] alone could not: the descent, the internal leading and a quarter of the height less one all fitted its two fonts. See [[topic:edit-controls]].
- [[measured]] A **list box** with `WS_BORDER` puts its border around the rectangle it was made with, not inside it. The window is one pixel bigger on every side, and the items have the whole rectangle. Each item is `tmHeight` tall, drawn two pixels from the left, in the order `LB_ADDSTRING` added them.

## Scroll bars

- [[measured]] A **scroll bar control** is drawn like a window's scroll bar ([[topic:window-frames]]), over the control's rectangle. It is filled with the scroll bar colour, which is patterned like any brush. The arrow bitmaps sit at each end, the thumb at the start, and the whole bar is outlined last.
- [[measured]] The arrows are scaled to the bar, which a window's scroll bar never needs. The control is 16 pixels high, and each driver's arrows are a different height: the VGA's 17 are shrunk, and the EGA's 14 and the Hercules's 11 are stretched. When stretching, row `r` of the result is row `(r * from + from / 2) / to` of the bitmap, rounded down. When shrinking, it is row `r * from / to`.
- Not yet measured: `StretchBlt` itself. The captures allow `(from - 1) / 2` in place of `from / 2`, and they cannot show which rows a reduction leaves out, because the outline covers the one that differs.

## Brush origins

[[measured]] A control's brushes are patterned from the control's own corner, not the screen's. The Hercules's scroll bar trough shows it: the quarter pattern is one row out of step with where it would be if it started at the screen's corner. See [[topic:brush-dithering]].

## Group boxes

[[measured]] [[probe:groupbox]] records two dialogs on four displays, one in bold MS Sans Serif 8 as `COMMDLG.DLL`'s Find dialog is, and one in the System font. Each has a group box made before the two radio buttons inside it, and another made after them. The code is `USER.EXE` seg25 `193a`, and winbox.js agrees with every pixel.

- [[read out]] A group box draws an outline on its rectangle in the frame colour. The top line is half the caption font's height down.
- [[read out]] Its caption stands on a ground of the control colour that `WM_CTLCOLOR` gives. The ground starts a pixel before the **System** font's average width, even when the caption is in another font, and is the caption's width and height and four more. The caption is two pixels in from the ground's start, and (descent + 4) / 2 down.
- [[read out]] The inside is never painted, not even erased. [[measured]] The radio buttons inside show, whichever was made first.
- [[read out]] A group box is transparent to the mouse, answering `WM_NCHITTEST` with `HTTRANSPARENT`, and static to the dialog manager, answering `WM_GETDLGCODE` with `DLGC_STATIC`. It draws no focus.

## Siblings and children

- [[measured]] Siblings without `WS_CLIPSIBLINGS` are not clipped by one another. A dialog's radio buttons draw inside the group box that lies over them. winbox.js took each pixel to be one window's until [[probe:groupbox]], and drew the group box over its radio buttons.
- [[measured]] A window without `WS_CLIPCHILDREN` draws over its children, as a dialog's erase reaches under its controls. Its children, frame and all, are then painted again after it, as Windows invalidates them with it.
- [[measured]] What a window moved or shrunk uncovers is all that is painted again of what lay beneath it, and that painting is clipped to it, as `BeginPaint` clips to the update region. [[probe:combobox]] shows it: a combo box shrunk to its field leaves its parent to paint where its list was, and the combo box itself is not painted again.

## Colours from the parent

A control asks its parent what to paint with, by sending it `WM_CTLCOLOR` as it paints. It passes its device context, with itself and its type in `lParam`: `CTLCOLOR_EDIT`, `CTLCOLOR_LISTBOX`, `CTLCOLOR_BTN`, `CTLCOLOR_SCROLLBAR` or `CTLCOLOR_STATIC`. The parent answers a brush, and may set the device context's text and background colours.

- [[read out]] An answer that is not a GDI object is asked of [[fn:USER.DefWindowProc]] instead (`USER.EXE` seg6 `028c`, and `GetControlBrush` at seg6 `02d2`). `DefWindowProc` (seg1 `5f9c`) sets the background to `COLOR_WINDOW` and the text to `COLOR_WINDOWTEXT`, and answers `COLOR_WINDOW`'s brush. For a scroll bar it sets white and black instead, and answers `COLOR_SCROLLBAR`'s brush, unrealized.
- [[measured]] [[probe:ctlcolor]] makes one of each control twice: once under a parent that leaves the message to `DefWindowProc`, and once under a parent that answers a red brush, blue text and a green background. It records what each control asked for, and counts each control's pixels by colour.
- [[measured]] As each control is first painted, a single-line edit control asks three times, a multi-line one twice, and a list box three times. A static control, each kind of button and a scroll bar ask once. Which of their painting asks which time has not been read.
- [[measured]] Edit controls, static controls, check boxes, radio buttons and list boxes fill with the brush. They draw their text in the text colour, on the background colour in the cell the text takes. A multi-line edit control puts the background colour under its whole line. A check box's or radio button's box is drawn in the text colour, and its inside in the brush's colour.
- [[measured]] A group box puts its caption on the brush, in the text colour on the background colour. Its outline stays the frame colour, and its inside is not painted.
- [[measured]] A push button uses the brush for its four corners and nothing else. A scroll bar's shaft is the brush, and its arrows are unchanged.
- [[measured]] Under the parent that leaves the message to `DefWindowProc`, every pixel is as the controls paint without asking.

- [[measured]] A dialog asks itself too, for its own background. [[probe:dlgbrush]] logs a dialog's procedure as the dialog is made and shown. It is given `WM_ERASEBKGND`, and, answering it with nought, then `WM_CTLCOLOR` of type `CTLCOLOR_DLG` naming the dialog itself, and only after that its static text's `CTLCOLOR_STATIC`. The client area is filled with the brush answered, red where it answered red. When it answers nought, the window colour fills it, white. FIBS/W answers grey. winbox.js painted every dialog white, and FIBS/W's About box went from 70,051 pixels unlike Windows' to 17,075, and Caribbean Treasure's installer from 80,160 to 1,956.

- [[measured]] What a static control leaves alone. [[probe:ctltrans]] answers a static's `CTLCOLOR_STATIC` three ways, the background colour set yellow each time. A hollow brush with the mode made `TRANSPARENT` leaves the static's area and the text's cell as the dialog painted them. A blue brush with the mode `TRANSPARENT` fills the area blue, with no yellow cell behind the text. A hollow brush with the mode left `OPAQUE` fills nothing, but the text's cell is yellow. BWCC sets `TRANSPARENT` for the text on its panels, and Windows shows that text on the panel's grey, as a hollow brush would leave it.

winbox.js agrees with all 36 records. Delphi colours every control of a form through this message: Championship Slots' memo is the colour of its form, with no border, as Windows shows it. The pieces are in `src/win16/user/ctlcolor.ts`.

## Superclasses

[[documented]] A program can make a class of its own that hands its messages on to a control's window procedure. It asks [[fn:USER.GetClassInfo]] for the control's class, registers its own under another name, and passes each message it does not want to the control's procedure with [[fn:USER.CallWindowProc]]. Delphi makes every control of a form this way: `TBitBtn` of `BUTTON` and `TMemo` of `EDIT`.

The control's state is kept in the window's own bytes, whatever the class is called, so the procedure works on the superclass's windows as on its own. winbox.js gives such a window the control's state at the first message the procedure sees, `WM_NCCREATE`, and makes a list or combo box's parts at its `WM_CREATE`. Before this, it kept state only for windows made under the control's own name, and every message to Championship Slots' buttons and memo went to [[fn:USER.DefWindowProc]]: none of them drew. Windows' own screen of the program shows them drawn, and winbox.js now draws them the same.

## Owner-drawn buttons

[[documented]] A button with `BS_OWNERDRAW` is drawn by its parent, which it sends `WM_DRAWITEM`. It sends `ODA_DRAWENTIRE` as it paints, and `ODA_FOCUS` as it gains or loses the focus, with `ODS_FOCUS` in the state saying which. winbox.js sends both. Delphi's buttons are drawn this way, and take their focus rectangle off when the focus goes: Championship Slots' Spin button kept its rectangle until the focus message was sent, where Windows shows none.

## What the controls do

- [[measured]] `BM_SETCHECK` checks a button and `LB_ADDSTRING` adds a string to a list box, both sent with `SendDlgItemMessage`. Each one repaints the control when its queue is next empty.
- [[documented]] `WM_PAINT` is not queued. `GetMessage` and `PeekMessage` make it for a window that needs painting when nothing else is waiting, parents before their children. That is how every control on the probe's window is painted by its message loop.
- Not yet measured: pressed, focused and disabled controls, other alignments of static text, multi-line edit controls, a selection in a list box, and a scroll bar thumb away from its start.

## Implementation

`paintControl` in `src/win16/user/controls.ts` draws each control through the `Painter` that also paints window frames. `control-classes.ts` holds the classes' window procedures, and `test/raster/desktop_test.ts` holds each control's block of the capture to what the desktop paints. The conformance suite replays the whole window through the exports: `CreateWindow` for each control, [[fn:USER.SendDlgItemMessage]] for the checks and strings, and the probe's own message loop.
