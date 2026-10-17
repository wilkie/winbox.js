---
kind: topic
name: Common dialogs
summary: COMMDLG, Windows 3.1's common dialogs, made WinBox's own a function at a time — how a call reaches WinBox's code or the file's, its extended error, its registered messages, and its file dialogs — read out of COMMDLG.DLL.
probes: [loadpath, findrepl, choosclr]
---

`COMMDLG.DLL` holds Windows 3.1's common dialogs: Open and Save As, Find and Replace, Color, Font and Print. Programs import it by name, or load it with [[fn:KERNEL.LoadLibrary]], as WinHelp does. WinBox makes it its own a function at a time. A function not yet made its own stays the file's code while the drive has `COMMDLG.DLL` ([[topic:dynamic-link-libraries]]).

## One COMMDLG, two codes

- With the file, the program gets the file's library: its module handle and instance, its count, and its entry point. An import of an export WinBox answers is linked to WinBox's stub for that ordinal instead of the file's entry, and [[fn:KERNEL.GetProcAddress]] answers the stub.
- Without the file, every import is WinBox's stub. An export WinBox does not answer yet answers nought, as a stub does. [[fn:KERNEL.LoadLibrary]] finds `COMMDLG.DLL` by its name whether or not the file is there.
- A dialog WinBox makes is made with `COMMDLG`'s instance, and its procedure is WinBox's stub for the export the file would have used, called by USER as any procedure is.
- [[read out]] `COMMDLG` calls a program's hook with its own data segment in DS (`COMMDLG.DLL` seg2 `42f4`, seg2 `4331`). WinBox calls one so, with the file's data segment or its own.
- [[read out]] While it works, `COMMDLG` sets the hourglass, and the arrow when it is done (entry 32, seg2 `08e2`). It sets neither while its Open or Save dialog is being made (`[0CACh]`, seg2 `4354`). Where no mouse was present as it loaded, it also shows and hides the cursor. WinBox always has a mouse.

## The extended error

- [[read out]] `CommDlgExtendedError` answers a doubleword `COMMDLG` keeps, `[2CCh]` in its data (seg6 `01f1`), and changes nothing. Each function sets it as it fails; `GetOpenFileName` and `GetSaveFileName` clear it as they start (seg2 `0a2a`).
- WinBox keeps the one doubleword: the file's while the file is loaded, found from the file's own `CommDlgExtendedError`, and its own otherwise. The error reads the same whichever code failed last.

## Registered messages

- [[read out]] The entry point registers, in this order, `commdlg_LBSelChangedNotify` (`LBSELCHSTRING`), `commdlg_ShareViolation` (`SHAREVISTRING`), `commdlg_FileNameOK` (`FILEOKSTRING`), `commdlg_ColorOK` (`COLOROKSTRING`) and `commdlg_SetRGBColor` (`SETRGBSTRING`) (seg7 `010b` to `014c`). Once it has made its memory device context it registers `commdlg_help` (`HELPMSGSTRING`) (seg7 `0208`). `FindText` and `ReplaceText` register `commdlg_FindReplace` (`FINDMSGSTRING`) each time they are called.
- Without the file, WinBox registers the six as `COMMDLG` loads, in the same order. A message registered again keeps its number, so a program that registers one by its name gets the number `COMMDLG` uses.

## WinBox's code

The registration point is one entry per export, in each engine:

- TypeScript: `src/win16/commdlg/index.ts`, the export table. An export WinBox answers has its function in place of `CommDlg.stub`, with the bytes it pops, its arguments' types and its answer's type.
- Rust: `crates/winbox-win16/src/commdlg/mod.rs`, `implementation`, one arm per export by its name.
- `kept.rs` is written again from the TypeScript table (`npm run rust:modules`). The Rust test `commdlg::tests::ours_agree` checks that the two engines answer the same exports.

Helpers both engines keep for the dialogs: the far address of an export WinBox answers (`procAddress`, `proc_address`), the extended error (`setError`, `set_error`), `COMMDLG`'s instance (`instance`), a hook called as `COMMDLG` calls one (`callHook`, `call_hook`), the wait cursor (`waitCursor`, `wait_cursor`) and the registered messages (`message`).

## Find and Replace

[[fn:COMMDLG.FindText]] and [[fn:COMMDLG.ReplaceText]] open a modeless dialog owned by one of the program's windows. The program keeps running its own loop, passing the dialog's messages through [[fn:USER.IsDialogMessage]], and the dialog tells the owner what to do with a registered message. Notepad and Cardfile use Find; nothing in the installation uses Replace. Every address in this section is in `COMMDLG.DLL` seg5.

### The structure

`FINDREPLACE`, 36 bytes:

| Offset | Field              | What COMMDLG does with it                                             |
| ------ | ------------------ | --------------------------------------------------------------------- |
| 0      | `lStructSize`      | must be 36                                                            |
| 4      | `hwndOwner`        | must be a window; told of each search                                 |
| 6      | `hInstance`        | the template's module, or with `FR_ENABLETEMPLATEHANDLE` the template |
| 8      | `Flags`            | read as the dialog opens; written with each search                    |
| 0Ch    | `lpstrFindWhat`    | shown as the dialog opens; written with each search                   |
| 10h    | `lpstrReplaceWith` | the same, Replace only                                                |
| 14h    | `wFindWhatLen`     | the room `GetDlgItemText` is given                                    |
| 16h    | `wReplaceWithLen`  | Replace only                                                          |
| 18h    | `lCustData`        | not read                                                              |
| 1Ch    | `lpfnHook`         | written nought without `FR_ENABLEHOOK`                                |
| 20h    | `lpTemplateName`   | with `FR_ENABLETEMPLATE`                                              |

The flags: `FR_DOWN` 1, `FR_WHOLEWORD` 2, `FR_MATCHCASE` 4, `FR_FINDNEXT` 8, `FR_REPLACE` 10h, `FR_REPLACEALL` 20h, `FR_DIALOGTERM` 40h, `FR_SHOWHELP` 80h, `FR_ENABLEHOOK` 100h, `FR_ENABLETEMPLATE` 200h, `FR_NOUPDOWN` 400h, `FR_NOMATCHCASE` 800h, `FR_NOWHOLEWORD` 1000h, `FR_ENABLETEMPLATEHANDLE` 2000h, `FR_HIDEUPDOWN` 4000h, `FR_HIDEMATCHCASE` 8000h, `FR_HIDEWHOLEWORD` 10000h.

### The templates

[[read out]] COMMDLG's dialog 1540 is Find and 1541 Replace, both in 8-point "Helv", which the dialog manager makes bold MS Sans Serif ([[topic:standard-controls]]). Neither is `WS_VISIBLE`: the procedure shows the dialog as it starts. Find, 236 × 62: "Fi&nd What:" and its text (480h), "Match &Whole Word Only" (410h), "Match &Case" (411h), the "Direction" group box (430h) with "&Up" (420h) and "&Down" (421h), "&Find Next" (1, the default button), "Cancel" (2) and "&Help" (40Eh). Replace, 230 × 94: the same text, "Re&place With:" and its text (481h), the two check boxes, "&Find Next" (1), "&Replace" (400h), "Replace &All" (401h), "Cancel" and "&Help".

### As the dialog starts

[[read out]] `WM_INITDIALOG` (`0410`, then `0870`):

1. Its data, four bytes holding the structure's address, is put under the property A000h.
2. The text to find is set, and the dialog sent `EN_CHANGE` from it as if typed: Find Next is enabled only with text.
3. Help is hidden and disabled without `FR_SHOWHELP`.
4. Match Whole Word is hidden and disabled with `FR_HIDEWHOLEWORD`, disabled with `FR_NOWHOLEWORD`, and checked by `FR_WHOLEWORD`; Match Case the same with its three flags.
5. With `FR_HIDEUPDOWN`, the group box and both buttons are hidden and the buttons disabled; with `FR_NOUPDOWN`, the buttons disabled.
6. Find checks Down for `FR_DOWN`, else Up. Replace sets its second text and sends its `EN_CHANGE` too.
7. With a hook, the hook is given `WM_INITDIALOG`, and what it answers is answered; without one, 1. Not nought, the dialog is shown (`SW_SHOWNORMAL` for Find, `SW_SHOW` for Replace) and updated.

[[measured]] [[probe:findrepl]] records every control's text, check, and whether it is enabled and shown, for the flags as Notepad gives them, with all three hidden and all three disabled, and for Replace. With nothing to find, Find Next, Replace and Replace All are disabled.

### What the buttons do

[[read out]] Before each search the dialog writes the structure (`0a89`): the low byte of `Flags` keeps only `FR_DIALOGTERM` and `FR_SHOWHELP`; the two check boxes set `FR_WHOLEWORD` and `FR_MATCHCASE`; the search's own flag is added; the text is read with `GetDlgItemText` into `lpstrFindWhat`, `wFindWhatLen` its room. Find adds `FR_DOWN` unless Up is checked; Replace reads the second text and always adds `FR_DOWN`. Then the owner is sent the message, `wParam` nought and `lParam` the structure.

| Control, `WM_COMMAND`        | Flag added      | Then                                                                                     |
| ---------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| Find Next (1)                | `FR_FINDNEXT`   | answers 1                                                                                |
| Replace (400h)               | `FR_REPLACE`    | if the owner answered exactly 1, Cancel's text becomes COMMDLG's string 40Dh, "Close"    |
| Replace All (401h)           | `FR_REPLACEALL` | the same                                                                                 |
| Cancel (2), and 3            | —               | the dialog ends                                                                          |
| Help (40Eh)                  | —               | the owner is sent `HELPMSGSTRING`'s message, `wParam` the dialog, `lParam` the structure |
| the text (480h), `EN_CHANGE` | —               | Find Next, and Replace's two, enabled when it has text                                   |

[[read out]] The dialog ends (`0831`) by clearing `FR_FINDNEXT`, `FR_REPLACE` and `FR_REPLACEALL`, setting `FR_DIALOGTERM`, telling the owner, removing its property -- its four bytes are not freed -- and destroying itself. `WM_CLOSE` is sent on as Cancel's `WM_COMMAND`.

[[measured]] With the keys, as a person uses it, the owner was told: Enter with Match Case pressed by its mnemonic, 18Ch -- `FR_ENABLEHOOK`, `FR_SHOWHELP`, `FR_FINDNEXT`, `FR_MATCHCASE`, and no `FR_DOWN`, since the flags given had none; Up then Enter, 18Ch again; Whole Word, 18Eh; Escape, 1C6h. Replace's Replace, Replace All and Find Next: 191h, 1A1h, 189h; after the owner answered 1, Cancel said "Close".

### Hooks

- [[read out]] Once the dialog has its property, each message goes first to the hook, through the structure, and what it answers that is not nought is the procedure's answer (`0390`). `WM_INITDIALOG` goes to the hook last, after the dialog has set itself up, with the structure as `lParam`.
- [[read out]] `FindText` also keeps the hook in COMMDLG's own data while it makes the dialog (`[118h]`), and the procedure calls that one too, but only for a message after the property is there, and not for `WM_INITDIALOG`, which clears it (`03ca`). [[measured]] The messages USER sends as it makes the dialog, `WM_SETFONT` and `WM_PARENTNOTIFY`, reach no hook: before its `WM_INITDIALOG`, the hook was given only the `WM_COMMAND`s and `WM_CTLCOLOR`s of the dialog's own setting up.
- [[measured]] A hook that answers 1 to Find Next's `WM_COMMAND` stops the search: the owner was told nothing.

### Templates of the program's

[[measured]] With `FR_ENABLETEMPLATEHANDLE`, a template of the program's with only the text, Match Case and two buttons made a dialog the procedure ran as its own: the controls it does not have are left alone, and the owner was told 210Dh -- `FR_DOWN` added since there is no Up -- and 2145h as it ended.

## Color

[[fn:COMMDLG.ChooseColor]] runs a modal dialog of 48 basic colours and 16 of the program's own, which can be opened out to choose any colour by its hue, saturation and luminosity. fibsw, champ and wslam of the corpus use it. Every address in this section is in `COMMDLG.DLL` seg1.

### The structure

`CHOOSECOLOR`, 32 bytes: `lStructSize` 0, `hwndOwner` 4, `hInstance` 6, `rgbResult` 8, `lpCustColors` 0Ch (16 `COLORREF`s), `Flags` 10h, `lCustData` 14h, `lpfnHook` 18h, `lpTemplateName` 1Ch. The flags: `CC_RGBINIT` 1, `CC_FULLOPEN` 2, `CC_PREVENTFULLOPEN` 4, `CC_SHOWHELP` 8, `CC_ENABLEHOOK` 10h, `CC_ENABLETEMPLATE` 20h, `CC_ENABLETEMPLATEHANDLE` 40h. Without `CC_ENABLEHOOK` the hook is written over with nought (`0ef8`).

### The template

[[read out]] Dialog `CHOOSECOLOR`, "Color", 298 × 184 in 8-point "Helv": the basic colours, 2D0h, a static of `SS_SIMPLE` 140 × 86 at (4, 14) with a tab stop; the custom colours, 2D1h, 140 × 28 at (4, 116); "&Define Custom Colors..." (2CFh); OK, Cancel and "&Help"; the spectrum's black frame 2C6h, 118 × 116 at (152, 4); the luminosity bar's place 2BEh, 8 × 116 at (280, 4); the sample's black frame 2C5h over "Color|S&olid"; "&o" (2C9h), a button at (300, 200), outside the dialog, the mnemonic of "S&olid"; Hue, Sat and Lum (2BFh–2C1h) and Red, Green and Blue (2C2h–2C4h) with their labels (2D3h–2D8h); and "&Add to Custom Colors" (2C8h).

### As it starts

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

### The grids

- [[read out]] The basic grid is 8 × 6 boxes, the custom 8 × 2. Inside each static, 3 pixels in from its window's edges, a box's pitch is the inside's width over 8 and its height over 6 (the basic grid's, for both), and each box is the pitch less 5 pixels.
- [[read out]] **The basic colours** are the display driver's: `OEMBIN` 2 of the module `DISPLAY` ([[topic:display-driver-resources]]), a count and that many colours, at most 48; boxes past the count are white, and are not shown or chosen. With no such resource, COMMDLG's own 48, kept in its code at `004e`.
- [[read out]] **Each box** is a `Rectangle` in the default black pen, filled with a solid brush of its colour -- dithered on 16 colours. The chosen box has a black frame a pixel outside it; the box with the focus, in the grid with the focus, has a dotted focus rectangle 3 pixels outside it, drawn over a rectangle of the window's colour. `WM_PAINT` draws that rectangle through a device context from `GetDC`, not the one it paints with.
- [[read out]] **Mouse**: a press on a grid moves the focus to it, and on a box chooses it (`04db`). A press in the 5-pixel gap between boxes, or on a box past the count, does nothing.
- [[read out]] **Keys**, through `WantArrows`, which asks for arrows and characters (`WM_GETDLGCODE` 81h) and sends `WM_KEYDOWN` and `WM_CHAR` to the dialog: the arrows move the focus box within its grid, not wrapping; Home and End go to its first and last; Space chooses the focus box (`11ff`, `0751`).
- [[measured]] Right, Right, Down, Space; Tab, End, Space; and a press on the basic grid's fifth row, seventh column each chose as read out; OK answered that box's colour, 400040h.

### Opened out

- [[read out]] "Define Custom Colors..." (`0cfd`), with the wait cursor: the spectrum is drawn, the twelve controls, Add and "&o" enabled and Define disabled, the dialog widened to its template's size again, and the focus put on Hue.
- [[read out]] **The spectrum** (`23f8`) is drawn once into a bitmap the size of its rectangle: 60 columns of hue 0, 4, … 236 and 30 rows of saturation 240 down to 8, each cell a `FillRect` with a solid brush of that hue and saturation at luminosity 120. A cell's right edge is (hue + 4) × width / 240, its bottom (248 − saturation) × height / 240. It is copied to the dialog with `BitBlt`.
- [[read out]] **The cross** marks the hue and saturation (`1ec7`): four arms of three pixel lines, from 5 to 10 `SM_CXBORDER`s from the point across and `SM_CYBORDER`s up and down, kept inside the spectrum, in the default black pen. It is taken away by copying the spectrum back over 10 borders round the point (`1dfd`).
- [[read out]] **The luminosity bar** (`25e4`) is 30 bands of the hue and saturation at luminosity 0, 8, … 240, from the bottom up; each band's top is ((bottom + 4) × 240 − height × (luminosity + 8)) / 240, the last reaching the top. It is framed in black when painted for more than its own rectangle.
- [[read out]] **Its mark** is a triangle pointing at it, from 2 pixels into the mark's place to its right edge less one, a quarter of `SM_CYCAPTION` above and below the luminosity, in the black pen with the white brush (`1d0b`); it is taken away by filling with the window's colour (`1d96`).
- [[read out]] **The sample**: its left half filled with a solid brush of the colour, dithered; its right with the nearest pure colour.

### Positions and numbers

[[read out]] With the spectrum's width _w_ and height _h_, and the bar's height _b_ (`21ba`, `2276`):

| From the mouse                          | To the marks                            |
| --------------------------------------- | --------------------------------------- |
| Hue = (x − left) × 239 / (_w_ − 1)      | x = Hue × _w_ / 239 + left              |
| Sat = 240 − (y − top) × 240 / (_h_ − 1) | y = (240 − Sat) × (_h_ − 1) / 240 + top |
| Lum = 240 − (y − top) × 240 / (_b_ − 1) | y = (240 − Lum) × (_b_ − 1) / 240 + top |

A press in the spectrum or the bar captures the mouse and clips the cursor to it -- to the mark's place, for the bar -- until the button goes up; each move sets the numbers again.

### The arithmetic

[[read out]] All in unsigned words, divisions truncating (`281d`, `29f1`, `2999`):

- **To hue, luminosity, saturation.** With _max_ and _min_ of red, green and blue, and _sum_ and _d_ their sum and difference: Lum = (_sum_ × 240 + 255) / 510. If _d_ is nought, Sat = 0 and Hue = 160. Else Sat = (_d_ × 240 + _n_ / 2) / _n_, where _n_ is _sum_ for Lum ≤ 120 and 510 − _sum_ above; each colour's delta is ((_max_ − c) × 40 + _d_ / 2) / _d_; Hue is blue's less green's where red is largest, red's less blue's plus 80 where green is, and green's less red's plus 160 otherwise, then brought into 0 to 239.
- **To a colour.** With Sat nought, each of red, green and blue is Lum × 255 / 240, not rounded. Else _m2_ = (Lum × (240 + Sat) + 120) / 240 for Lum ≤ 120, else Lum + Sat − (Lum × Sat + 120) / 240; _m1_ = 2 × Lum − _m2_. Red is for Hue + 80, green for Hue, blue for Hue − 80: a hue past 240 less 240 once, then below 40 _m1_ + ((_m2_ − _m1_) × hue + 20) / 40; below 120 _m2_; below 160 _m1_ + ((_m2_ − _m1_) × (160 − hue) + 20) / 40; else _m1_; each then (v × 255 + 120) / 240.

[[measured]] [[probe:choosclr]] gives 24 colours with `SETRGBSTRING`'s message and types 15 sets of the three numbers: every one as read out -- red is hue 0, saturation 240, luminosity 120; silver is 160, 0, 181; 128,64,200 is 179, 133, 124.

### The numbers' controls

[[read out]] On `EN_CHANGE` (`0a11`, `2ae3`):

- **Hue**, **Sat**, **Lum**: the number read; past 239 for hue or 240 for the others it is set back to that. Unchanged, nothing; else the colour is made from the three, the marks moved and the bar and sample painted. Not a number but not empty, the old number is put back and selected.
- **Red**, **Green**, **Blue**: past 255 set back to 255; a change makes the colour and its hue, saturation and luminosity. On `EN_KILLFOCUS`, one that is not a number is put back.
- [[measured]] 300 typed into Red became 255.

### The other buttons

- [[read out]] **Add to Custom Colors** (`0ca5`) puts the colour in the custom box chosen, then moves down the column, from its bottom to the top of the next, and from the last to the first. [[measured]] Three adds wrote custom colours 0, 8 and 1, counting from nought.
- [[read out]] **"&o"**, the mnemonic of "S&olid", and a double click on the sample's solid half, make the colour its nearest pure one (`2115`).
- [[read out]] **`SETRGBSTRING`'s message**, its colour in `lParam`: a box of that colour is chosen; opened out, the colour is taken whether a box has it or not.
- [[read out]] **OK** writes `rgbResult`; OK and Cancel both write the custom colours back, then OK gives the hook `COLOROKSTRING`'s message, `wParam` nought and `lParam` the structure, and a hook answering it not nought keeps the dialog open. Ending, the memory DC and the spectrum's bitmap are deleted. **Help** sends the owner `HELPMSGSTRING`'s message.

### What USER had to draw as Windows does

The Color dialog showed three of USER's ways that the engines did not follow:

- [[read out]] A static of `SS_SIMPLE` fills nothing and asks no `WM_CTLCOLOR`: it draws its one line of text, and with none draws nothing (`USER.EXE` seg25 `2135`, `2265`). The engines filled it, and the grids' boxes, drawn by the dialog, were wiped.
- [[read out]] A disabled control's text is grayed in the control's own font, its mnemonic's line from the overhang to the left as when it is enabled; the engines grayed it in the System font. And a disabled default push button is drawn as a plain one (seg25 `18bc`): Find Next with nothing to find.
- [[measured]] `GetDC` while the window paints answers a device context that draws through the whole client area, not only what `BeginPaint` is painting, for a window whose class has no context of its own or of the class. The engines gave the window's one context, clipped to the paint.

## In WinBox: Find, Replace and Color

- `src/win16/commdlg/find-replace.ts`, `choose-color.ts`, `colour-math.ts` and `guest-calls.ts`; `crates/winbox-win16/src/commdlg/find_replace.rs`, `choose_color.rs`, `colour_math.rs` and `guest_calls.rs`. The dialogs' procedures and `WantArrows` are `COMMDLG`'s exports 8, 13, 14 and 25, given to USER and to `SetWindowLong` at their stubs' addresses.
- In Rust, each call `COMMDLG` makes into USER, GDI and KERNEL is made as a program makes it: its arguments and structures laid on the program's stack below where it is, and the export's own function run on them (`guest_calls.rs`).
- The templates and the 48 basic colours are `COMMDLG`'s, kept as WinBox's own (`templates.ts`, `templates.rs`); a template is put in global memory as `LoadResource` would.
- [[measured]] [[probe:findrepl]], 629 of 629 records, and [[probe:choosclr]], 4,011 of 4,011, agree in both engines, run whole. Notepad's Find runs with no `COMMDLG.DLL` on the drive (`notepads_find_works_with_no_commdlg_file`).

## Not yet done

- Every export but `CommDlgExtendedError`, `FindText`, `ReplaceText`, `ChooseColor` and their procedures is still the file's code, or a stub without the file.
- The Find, Replace and Color dialogs keep their data in WinBox's own memory, and put a number of WinBox's under their property A000h where `COMMDLG` puts a handle of its local memory.
- The Color dialog's erase of its luminosity mark takes the window's colour as it is drawn, where `COMMDLG` takes the one it read as it loaded (seg7 `004b`).
- The memory device context the entry point makes and keeps (seg7 `01a1` to `0203`) is not made without the file.
