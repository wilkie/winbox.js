---
kind: topic
name: Choose Color
summary: COMMDLG's Color dialog — the CHOOSECOLOR structure, its template, the basic and custom grids, the spectrum and luminosity bar, the arithmetic between RGB and hue, saturation and luminosity, and what USER had to draw for it — read out of COMMDLG.DLL and recorded.
probes: [choosclr]
---

[[fn:COMMDLG.ChooseColor]] runs a modal dialog of 48 basic colours and 16 of the program's own, which can be opened out to choose any colour by its hue, saturation and luminosity. fibsw, champ and wslam of the corpus use it. Every address on this page is in `COMMDLG.DLL` seg1. What all the common dialogs share is in [[topic:common-dialogs]].

## The structure

`CHOOSECOLOR`, 32 bytes: `lStructSize` 0, `hwndOwner` 4, `hInstance` 6, `rgbResult` 8, `lpCustColors` 0Ch (16 `COLORREF`s), `Flags` 10h, `lCustData` 14h, `lpfnHook` 18h, `lpTemplateName` 1Ch. The flags: `CC_RGBINIT` 1, `CC_FULLOPEN` 2, `CC_PREVENTFULLOPEN` 4, `CC_SHOWHELP` 8, `CC_ENABLEHOOK` 10h, `CC_ENABLETEMPLATE` 20h, `CC_ENABLETEMPLATEHANDLE` 40h. Without `CC_ENABLEHOOK` the hook is written over with nought (`0ef8`).

## The template

[[read out]] Dialog `CHOOSECOLOR`, "Color", 298 × 184 in 8-point "Helv": the basic colours, 2D0h, a static of `SS_SIMPLE` 140 × 86 at (4, 14) with a tab stop; the custom colours, 2D1h, 140 × 28 at (4, 116); "&Define Custom Colors..." (2CFh); OK, Cancel and "&Help"; the spectrum's black frame 2C6h, 118 × 116 at (152, 4); the luminosity bar's place 2BEh, 8 × 116 at (280, 4); the sample's black frame 2C5h over "Color|S&olid"; "&o" (2C9h), a button at (300, 200), outside the dialog, the mnemonic of "S&olid"; Hue, Sat and Lum (2BFh–2C1h) and Red, Green and Blue (2C2h–2C4h) with their labels (2D3h–2D8h); and "&Add to Custom Colors" (2C8h).

## As it starts

[[read out]] `WM_INITDIALOG`, with the wait cursor (`17c5`):

1. A memory device context is made once, and the dialog's data, 15Eh bytes, put under the property A000h.
2. The rectangles are measured from the controls (`1654`): the spectrum is 2C6h's window less a pixel all round; the luminosity bar is 2BEh's, half `SM_CXSIZE` wider; right of it, half `SM_CXSIZE` wide, is where its mark goes; the sample is 2C5h's less a pixel, its left half "Color" and its right "Solid".
3. The colour is `rgbResult` with `CC_RGBINIT`, else black.
4. With `CC_FULLOPEN` or `CC_PREVENTFULLOPEN`, Define Custom Colors is disabled.
5. With `CC_FULLOPEN`, the spectrum is drawn and the six numbers set. Without it, the twelve numbers' controls, Add to Custom Colors and "&o" are disabled, and the dialog narrowed to halfway between the basic grid's right and the spectrum's left.
6. The grids are measured (`139a`), and both subclassed with `WantArrows`, COMMDLG's export 25.
7. The custom colours are read from `lpCustColors`.
8. The colour is looked for among all 64 boxes, and the first that has it is the one chosen.
9. Without `CC_SHOWHELP`, Help is disabled and hidden. "&o" loses its tab stop.
10. The hook is given `WM_INITDIALOG`, or the answer is 1; not nought, the dialog is shown.

[[measured]] Narrowed, the dialog was 264 pixels wide; opened out, 532. Each control's state is as read out.

## The grids

- [[read out]] The basic grid is 8 × 6 boxes, the custom 8 × 2. Inside each static, 3 pixels in from its window's edges, a box's pitch is the inside's width over 8 and its height over 6 (the basic grid's, for both), and each box is the pitch less 5 pixels.
- [[read out]] **The basic colours** are the display driver's: `OEMBIN` 2 of the module `DISPLAY` ([[topic:display-driver-resources]]), a count and that many colours, at most 48; boxes past the count are white, and are not shown or chosen. With no such resource, COMMDLG's own 48, kept in its code at `004e`.
- [[read out]] **Each box** is a `Rectangle` in the default black pen, filled with a solid brush of its colour -- dithered on 16 colours. The chosen box has a black frame a pixel outside it; the box with the focus, in the grid with the focus, has a dotted focus rectangle 3 pixels outside it, drawn over a rectangle of the window's colour. `WM_PAINT` draws that rectangle through a device context from `GetDC`, not the one it paints with.
- [[read out]] **Mouse**: a press on a grid moves the focus to it, and on a box chooses it (`04db`). A press in the 5-pixel gap between boxes, or on a box past the count, does nothing.
- [[read out]] **Keys**, through `WantArrows`, which asks for arrows and characters (`WM_GETDLGCODE` 81h) and sends `WM_KEYDOWN` and `WM_CHAR` to the dialog: the arrows move the focus box within its grid, not wrapping; Home and End go to its first and last; Space chooses the focus box (`11ff`, `0751`).
- [[measured]] Right, Right, Down, Space; Tab, End, Space; and a press on the basic grid's fifth row, seventh column each chose as read out; OK answered that box's colour, 400040h.

## Opened out

- [[read out]] "Define Custom Colors..." (`0cfd`), with the wait cursor: the spectrum is drawn, the twelve controls, Add and "&o" enabled and Define disabled, the dialog widened to its template's size again, and the focus put on Hue.
- [[read out]] **The spectrum** (`23f8`) is drawn once into a bitmap the size of its rectangle: 60 columns of hue 0, 4, … 236 and 30 rows of saturation 240 down to 8, each cell a `FillRect` with a solid brush of that hue and saturation at luminosity 120. A cell's right edge is (hue + 4) × width / 240, its bottom (248 − saturation) × height / 240. It is copied to the dialog with `BitBlt`.
- [[read out]] **The cross** marks the hue and saturation (`1ec7`): four arms of three pixel lines, from 5 to 10 `SM_CXBORDER`s from the point across and `SM_CYBORDER`s up and down, kept inside the spectrum, in the default black pen. It is taken away by copying the spectrum back over 10 borders round the point (`1dfd`).
- [[read out]] **The luminosity bar** (`25e4`) is 30 bands of the hue and saturation at luminosity 0, 8, … 240, from the bottom up; each band's top is ((bottom + 4) × 240 − height × (luminosity + 8)) / 240, the last reaching the top. It is framed in black when painted for more than its own rectangle.
- [[read out]] **Its mark** is a triangle pointing at it, from 2 pixels into the mark's place to its right edge less one, a quarter of `SM_CYCAPTION` above and below the luminosity, in the black pen with the white brush (`1d0b`); it is taken away by filling with the window's colour (`1d96`).
- [[read out]] **The sample**: its left half filled with a solid brush of the colour, dithered; its right with the nearest pure colour.

## Positions and numbers

[[read out]] With the spectrum's width _w_ and height _h_, and the bar's height _b_ (`21ba`, `2276`):

| From the mouse                          | To the marks                            |
| --------------------------------------- | --------------------------------------- |
| Hue = (x − left) × 239 / (_w_ − 1)      | x = Hue × _w_ / 239 + left              |
| Sat = 240 − (y − top) × 240 / (_h_ − 1) | y = (240 − Sat) × (_h_ − 1) / 240 + top |
| Lum = 240 − (y − top) × 240 / (_b_ − 1) | y = (240 − Lum) × (_b_ − 1) / 240 + top |

A press in the spectrum or the bar captures the mouse and clips the cursor to it -- to the mark's place, for the bar -- until the button goes up; each move sets the numbers again.

## The arithmetic

[[read out]] All in unsigned words, divisions truncating (`281d`, `29f1`, `2999`):

- **To hue, luminosity, saturation.** With _max_ and _min_ of red, green and blue, and _sum_ and _d_ their sum and difference: Lum = (_sum_ × 240 + 255) / 510. If _d_ is nought, Sat = 0 and Hue = 160. Else Sat = (_d_ × 240 + _n_ / 2) / _n_, where _n_ is _sum_ for Lum ≤ 120 and 510 − _sum_ above; each colour's delta is ((_max_ − c) × 40 + _d_ / 2) / _d_; Hue is blue's less green's where red is largest, red's less blue's plus 80 where green is, and green's less red's plus 160 otherwise, then brought into 0 to 239.
- **To a colour.** With Sat nought, each of red, green and blue is Lum × 255 / 240, not rounded. Else _m2_ = (Lum × (240 + Sat) + 120) / 240 for Lum ≤ 120, else Lum + Sat − (Lum × Sat + 120) / 240; _m1_ = 2 × Lum − _m2_. Red is for Hue + 80, green for Hue, blue for Hue − 80: a hue past 240 less 240 once, then below 40 _m1_ + ((_m2_ − _m1_) × hue + 20) / 40; below 120 _m2_; below 160 _m1_ + ((_m2_ − _m1_) × (160 − hue) + 20) / 40; else _m1_; each then (v × 255 + 120) / 240.

[[measured]] [[probe:choosclr]] gives 24 colours with `SETRGBSTRING`'s message and types 15 sets of the three numbers: every one as read out -- red is hue 0, saturation 240, luminosity 120; silver is 160, 0, 181; 128,64,200 is 179, 133, 124.

## The numbers' controls

[[read out]] On `EN_CHANGE` (`0a11`, `2ae3`):

- **Hue**, **Sat**, **Lum**: the number read; past 239 for hue or 240 for the others it is set back to that. Unchanged, nothing; else the colour is made from the three, the marks moved and the bar and sample painted. Not a number but not empty, the old number is put back and selected.
- **Red**, **Green**, **Blue**: past 255 set back to 255; a change makes the colour and its hue, saturation and luminosity. On `EN_KILLFOCUS`, one that is not a number is put back.
- [[measured]] 300 typed into Red became 255.

## The other buttons

- [[read out]] **Add to Custom Colors** (`0ca5`) puts the colour in the custom box chosen, then moves down the column, from its bottom to the top of the next, and from the last to the first. [[measured]] Three adds wrote custom colours 0, 8 and 1, counting from nought.
- [[read out]] **"&o"**, the mnemonic of "S&olid", and a double click on the sample's solid half, make the colour its nearest pure one (`2115`).
- [[read out]] **`SETRGBSTRING`'s message**, its colour in `lParam`: a box of that colour is chosen; opened out, the colour is taken whether a box has it or not.
- [[read out]] **OK** writes `rgbResult`; OK and Cancel both write the custom colours back, then OK gives the hook `COLOROKSTRING`'s message, `wParam` nought and `lParam` the structure, and a hook answering it not nought keeps the dialog open. Ending, the memory DC and the spectrum's bitmap are deleted. **Help** sends the owner `HELPMSGSTRING`'s message.

## What USER had to draw as Windows does

The Color dialog showed three of USER's ways that the engines did not follow:

- [[read out]] A static of `SS_SIMPLE` fills nothing and asks no `WM_CTLCOLOR`: it draws its one line of text, and with none draws nothing (`USER.EXE` seg25 `2135`, `2265`). The engines filled it, and the grids' boxes, drawn by the dialog, were wiped.
- [[read out]] A disabled control's text is grayed in the control's own font, its mnemonic's line from the overhang to the left as when it is enabled; the engines grayed it in the System font. And a disabled default push button is drawn as a plain one (seg25 `18bc`): Find Next with nothing to find.
- [[measured]] `GetDC` while the window paints answers a device context that draws through the whole client area, not only what `BeginPaint` is painting, for a window whose class has no context of its own or of the class. The engines gave the window's one context, clipped to the paint.

## The functions

- [[fn:COMMDLG.ChooseColor]], what a program calls, with its errors.
- [[fn:COMMDLG.ColorDlgProc]], the procedure COMMDLG hands to USER, and [[fn:COMMDLG.WantArrows]], the grids' subclass.
- [[fn:COMMDLG.Ordinal 35]], which frees the spectrum's bitmap and the memory device context as COMMDLG is let go.

## In WinBox

- `src/win16/commdlg/choose-color.ts`, `colour-math.ts` and `guest-calls.ts`; `crates/winbox-win16/src/commdlg/choose_color.rs`, `colour_math.rs` and `guest_calls.rs`. The procedure and `WantArrows` are `COMMDLG`'s exports 8 and 25, given to USER and to `SetWindowLong` at their stubs' addresses.
- In Rust, each call the dialog makes into USER, GDI and KERNEL is made as a program makes it, through `api.rs`. In TypeScript it calls the exports' functions directly ([[topic:common-dialogs]]).
- The template and the 48 basic colours are `COMMDLG`'s, kept as WinBox's own (`templates.ts`, `templates.rs`).
- [[measured]] [[probe:choosclr]], 4,011 of 4,011 records, agrees in both engines, run whole.

## Not yet done

- The dialog keeps its data in WinBox's own memory, and puts a number of WinBox's under its property A000h where `COMMDLG` puts a handle of its local memory.
- The erase of its luminosity mark takes the window's colour as it is drawn, where `COMMDLG` takes the one it read as it loaded (seg7 `004b`, [[fn:COMMDLG.Ordinal 53]]).
