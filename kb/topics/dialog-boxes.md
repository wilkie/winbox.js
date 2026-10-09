---
kind: topic
name: Dialog boxes
summary: How Windows 3.1 turns a dialog template into a window — dialog units, the dialog font, where the dialog goes, its modal frame — and how the keyboard and a modal loop drive it, measured on four displays and replayed through the exports.
probes: [dialogs, dlgcolor, dlgclamp, dlgpos, defpush, multipfx, dlgneg, comboesc, mldlg]
---

A dialog box is a window made from a template. The template gives the dialog's style, caption and font, and each control's class, text, identifier and style. Every place and size in it is in **dialog units**. [[measured]] [[probe:dialogs]] builds its templates in memory and gives them to `CreateDialogIndirect` and `DialogBoxIndirect`, so no resource compiler is involved. It records where everything lands, every pixel of each dialog, where the keyboard focus goes, and how a modal dialog runs. It was recorded on the VGA, Super VGA, EGA and Hercules, and every record agrees with winbox.js.

## Dialog units

- [[measured]] A dialog unit is a quarter of the **base width** across, and an eighth of the **base height** down. Every conversion rounds as [[fn:GDI.MulDiv]] does, to nearest. On the EGA, 90 units of a font 10 pixels high are 113 pixels, not the 112 that dropping the fraction would give.
- [[measured]] A place below nought does not round as `MulDiv` does. Half a unit is added and the fraction then cut off toward nought, so a negative place comes out a pixel nearer nought. [[probe:dlgneg]] places dialogs from -1 to -9 units down from their owner's client area, and in System font units they land 1, 3, 5, 7, 9, 11, 13 and 17 pixels up, where `MulDiv` gives 2, 4, 6 and so on. Above nought the two agree: 1 and 3 units are 2 and 6 pixels. Space Traveler's About box is at -2 units, and Windows shows it a row lower than winbox.js had put it. Its screen went from 14,739 pixels unlike Windows' to 1,220.
- The 1,220 are the caption, which reads "[PAUSED]" in Windows' screen. Space Traveler pauses when its window loses the focus while its game timer runs. Its window does lose the focus to the About box, but the game starts its timer only after the box is closed, and it never sets the field that holds the timer before then. [[inferred]] So in Windows that field held whatever its memory held before. The program's heap comes from [[fn:KERNEL.GlobalAlloc]] without `GMEM_ZEROINIT`. That is the state of Windows' machine, not anything Windows does, and winbox.js's memory starts as nought.
- [[measured]] [[fn:USER.GetDialogBaseUnits]] answers 8 by 16 on the VGA and 8 by 12 on the EGA and Hercules: the System font's.
- [[measured]] With `DS_SETFONT`, the template names a face and a size in points. The dialog's font, as `WM_GETFONT` gives it back, is that face at `-MulDiv(points, LOGPIXELSY, 72)` and **weight 700**: bold. MS Sans Serif 8 is `lfHeight` -11 on the VGA and -8 on the EGA. The base units then come from that font: 7 by 13 on the VGA, 7 by 10 on the EGA.
- [[documented]] Microsoft's rule for a dialog with its own font takes the base width as (the width of the 52 letters `A`–`Z` and `a`–`z` ÷ 26, plus 1) ÷ 2, and the base height as the font's height. The recordings fit it. The System font's letters are 429 pixels on the VGA (8) and 422 on the EGA (8), and bold MS Sans Serif's are 376 (7) and 373 (7).
- [[refused]] Two other rules fit every recording just as well: the letters' width ÷ 52, rounded, and the average character width + 1. The recorded fonts cannot tell the three apart.

## Where the dialog goes

- [[measured]] The template's place is where the dialog's client area goes, measured from its owner's client area. Without an owner, it's measured from the screen.
- A dialog whose template says `WS_CHILD` goes in its owner, now its parent, at the same place. BogOut's word lists are child dialogs. winbox.js counted the parent's corner twice and put them forty pixels low, and BogOut's screen now matches Windows'.
- [[measured]] The window's left edge is then moved to the nearest multiple of eight. [[probe:dialogs]] placed an empty dialog at each of 0 to 9 units across. Its windows started at 16, then 24 four times, 32 four times, and 40. Rounding down and rounding up each fail at least one of the ten. The top is not moved.
- [[measured]] The rounding is the class's `CS_BYTEALIGNWINDOW`, not the dialog class's alone. [[probe:dlgpos]] places dialogs, with and without a modal frame, at several places for an owner at the screen's corner, and each window's left edge is the nearest multiple of eight. Borland's BWCC registers its dialog class, `bordlg`, with `CS_BYTEALIGNWINDOW`. winbox.js had rounded only its own dialog class's windows, and put Space Traveler's and Cell War's dialogs two and three pixels right of Windows'. Cell War's screen now matches Windows' pixel for pixel.
- [[measured]] The alignment is to a byte of the display, which is eight pixels on the VGA, the Super VGA and the EGA, where a byte holds eight. On the 256-colour display a byte is a pixel, so there is nothing to round. Windows' screen of SimTower on it has the program's message box at x 119, where rounding to eight had put it at 120.
- [[measured]] A dialog is kept on the screen. [[probe:dlgclamp]] placed an empty dialog with no owner partly off each edge, on four displays:
  - Past the right edge, the dialog moves to end at the edge, then down to a multiple of eight, so it stays on. It ends at 634 on the 640-wide screens, 794 on the Super VGA and 714 on the Hercules.
  - Past the bottom, it ends four pixels above the bottom: 476 on the VGA, 346 on the EGA, 596 on the Super VGA and 344 on the Hercules.
  - A negative place becomes 0 on either axis.

  Calculator's own template puts it 620 pixels across, and this is what brings it onto the screen.
- [[refused]] The four pixels are `SM_CYDLGFRAME` in winbox.js. `SM_CYFRAME` is also four on every display recorded, and so is a plain constant; nothing recorded tells them apart.
- [[inferred]] That is the dialog class's byte alignment, which lets a display driver move the window's pixels whole bytes at a time.

## The modal frame

- [[measured]] A dialog with `DS_MODALFRAME` and a caption has an outline in the window-frame colour, then a ring four pixels wide in the active caption colour. The caption sits on the ring's inner row. The caption's top row and its two side columns are in the window colour, not the frame colour. Its boxes and title start a pixel further in, and its bottom line is the usual frame-colour line. The client area is flush with those side columns.
- [[documented]] `DS_MODALFRAME` is the extended style `WS_EX_DLGMODALFRAME` once the dialog is made. A window made by [[fn:USER.CreateWindowEx]] with that style has the same frame and client area. Delphi's dialog forms are made so, and Windows draws Championship Slots' Program Usage box with this ring. winbox.js makes the window with the frame before `WM_NCCALCSIZE`, so the program sees the client area the frame leaves.
- [[measured]] [[probe:dlgcolor]] settled which system colour those white lines are. They are white in all six system colours that are white in every display's default scheme. It turned each of those red in turn, redrew the dialog, and only `COLOR_WINDOW` changed them. The ring follows `COLOR_ACTIVECAPTION`, and the outline `COLOR_WINDOWFRAME`.

## Controls

- [[measured]] A control's rectangle is its template rectangle in pixels, measured from the dialog's client area.
- [[measured]] A push button's text is centred down on the font's ascent, not on its height: floor((height − ascent) ÷ 2) − 1. That fits every push button recorded, in the System font on four displays and in bold MS Sans Serif.
- [[refused]] Half of what the height leaves, and the height less its internal leading, both put the EGA's 18-pixel buttons in MS Sans Serif a row low.
- [[measured]] The character after `&` is underlined a row below the font's ascent, the rule the menu bar uses. Under an emboldened font, whose text measures a pixel wider than it draws, the underline starts that overhang to the left.
- [[measured]] With more than one `&`, only the last of the characters they mark is underlined. [[probe:multipfx]] draws a push button `&I &A&gr&e&e`, a check box `a&b&c`, static text `x&y&z` and [[fn:USER.DrawText]] of `&p&q&r`: the last "e", `c`, `z` and `r` are underlined, and nothing else. The template of FIBS/W's About box has that button. Once the box opens, FIBS/W replaces the button's text with one marked `&` once, choosing the letter from [[fn:USER.GetTickCount]]. The letter it picks depends on how long Windows has been running, so its screen and winbox.js's underline different letters.
- [[measured]] The dialog's edit control has the focus, so its caret shows. In the System font it is two pixels wide and three pixels in. In bold MS Sans Serif it is one wide and one in. Either way it is a pixel taller than the font. [[read out]] Its width follows the font's average width, and its place the edit control's margins and the font's overhang. See [[topic:edit-controls]].

## The keyboard

- [[measured]] When `WM_INITDIALOG` answers TRUE, the first control with `WS_TABSTOP` gets the focus. [[read out]] It must also be visible and not disabled; with no such control the first control gets it, whatever it is, and with no controls the dialog itself (`USER.EXE` seg25 `0089`). [[measured]] In [[probe:groupbox]]'s dialogs, whose controls have no tab stops, that is a group box, which shows no focus.
- [[measured]] Tab moves the focus through the tab stops in template order, and wraps back to the first. A radio button without `WS_TABSTOP` is skipped.
- [[measured]] Enter sends `WM_COMMAND` for the default push button, and Escape for `IDCANCEL`, even when the focus is on a check box.
- [[measured]] The default push button follows the focus as the dialog manager moves it. [[probe:defpush]] makes a dialog of push buttons A, B and C, with C the template's default, and an edit control. It records which buttons have `BS_DEFPUSHBUTTON` after each step:
  - As the dialog opens, A takes the focus and becomes a default push button, and C stays one too, so both show the default's second outline.
  - A plain [[fn:USER.SetFocus]] on B changes nothing.
  - Tab to C leaves C the only default, and A is plain again.
  - Tab to the edit control leaves C the default.
  - Tab on to A makes A the default and C plain.
  - `DM_GETDEFID` answers C throughout.
- [[inferred]] One rule gives every record. When the dialog manager moves the focus, a push button given the focus becomes the default, and any other control given it hands the default back to the `DM_GETDEFID` button. The other default push buttons are made plain only when the focus came from inside the dialog. [[refused]] Making them plain on every move takes C's outline as the dialog opens, which Windows does not.
- FIBS/W's About box gives its first button, View License, the focus, and Windows draws it as the default. winbox.js now does too. The button changes style through `BM_SETSTYLE`, which repaints it.
- [[documented]] [[fn:USER.IsDialogMessage]] also moves the focus within a group with the arrow keys, and finds a control by its mnemonic. It asks each control what it wants with `WM_GETDLGCODE`, so an edit control keeps its characters and arrows.
- [[read out]] `IsDialogMessage` is `USER.EXE` seg25 `0c23`, behind the checks at `2804`. It passes a message on to the message filter hooks first, and takes only a message for the dialog or a window inside it. For `WM_KEYDOWN` it asks the window with the focus `WM_GETDLGCODE`, and dispatches the key to it if the answer has `DLGC_WANTALLKEYS` (`0cc0`). It asks with the message it is taking, a far pointer to it in `lParam`, for `WM_CHAR` too (`0cae`, `0ebc`). A multi-line edit control asked so learns it is in a dialog, and takes Escape, Enter and Tab as the dialog's ([[topic:multi-line-edit-controls]]). winbox.js asked with nought. Nothing else keeps Escape or Enter from the dialog: `DLGC_WANTMESSAGE` is not looked at. Escape and Cancel are `WM_COMMAND` for `IDCANCEL`, with the Cancel button's window, or a beep if it is disabled (`0d6b`, `0e3a`). Enter is the default button's `WM_COMMAND`: the focus's own identifier if it answers `DLGC_DEFPUSHBUTTON`, else what `DM_GETDEFID` answers, else `IDOK` (`0d2d`).
- [[read out]] So a combo box with its list down does not keep Escape or Enter. It answers `WM_GETDLGCODE` with 81h, `DLGC_WANTARROWS` and `DLGC_WANTCHARS`, whatever the message and whether its list is down or not (seg33 `0212`), and a drop-down's edit control answers 89h. [[measured]] [[probe:comboesc]] runs a dialog with a drop-down list and a drop-down, and drops each list with F4, with Alt and Down, and with a click on its button. Escape then sends the dialog `IDCANCEL`, and Enter `IDOK`, every way the list was dropped, and the list is still down after. Only F4, sent on to the list, puts it away. In COMMDLG.DLL's Open box, Escape with the drives' list down ends the dialog and `GetOpenFileName` answers 0, as Notepad's and Media Player's File Open do. A dialog that wants the keys for its combo box has to look for them itself.
- [[read out]] [[fn:USER.EndDialog]] takes the focus back to the dialog itself, when the dialog is the active window and the focus is in one of its controls (seg25 `25bb`-`25d0`). The control is told `WM_KILLFOCUS` as the dialog ends, and the dialog, marked ended, gives the focus to no control. [[measured]] [[probe:comboesc]]: Escape in the Open box with the focus on the drives tells COMMDLG's hook `CBN_KILLFOCUS` after `IDCANCEL`, though the box has no owner to take the focus. A list left down is put away by that `WM_KILLFOCUS`, with `CBN_CLOSEUP` first.

## Running modal

- [[measured]] While [[fn:USER.DialogBox]] runs, the owner is disabled, and it is enabled again afterwards. `DialogBox` answers the value given to [[fn:USER.EndDialog]].

## In winbox.js

- `src/win16/user/dialog-template.ts` reads templates.
- `src/win16/user/dialogs.ts` has:
  - `CreateDialog` and `DialogBox` in all their forms;
  - `DefDlgProc`, the procedure of the dialog class `#32770`;
  - `IsDialogMessage`, and the rest of the dialog manager.
- The modal frame is drawn in `frame.ts`.

The replay runs [[probe:dialogs]] and [[probe:dlgcolor]] through the exports. Getting there found a bug outside dialogs: every structure handed to a window procedure on the stack, such as `CREATESTRUCT` or `MINMAXINFO`, had been given a pointer using the stack's descriptor index instead of its selector. Character Map reads its `CREATESTRUCT`, and faulted.

winbox.js closed the Open box for Escape with the drives' list down, as Windows does, but left the list on the desktop: it did not destroy a combo box's list with the combo box ([[topic:combo-boxes]]). Nor did `EndDialog` take the focus back, so the drives were told nothing as the box went.

Not yet done: whether a dialog whose control cannot be made fails as a whole.
