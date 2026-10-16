---
kind: topic
name: Dialog boxes
summary: How Windows 3.1 turns a dialog template into a window — dialog units, the dialog font, where the dialog goes, its modal frame — and how the keyboard and a modal loop drive it, measured on four displays and replayed through the exports.
probes:
  [
    dialogs,
    dlgcolor,
    dlgclamp,
    dlgpos,
    defpush,
    multipfx,
    dlgneg,
    comboesc,
    mldlg,
    enddlg,
    syschar,
    dlgcode,
    sysdlg,
  ]
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
- [[read out]] Each control is made with `WS_EX_NOPARENTNOTIFY` (`USER.EXE` seg24 `082d`), so the dialog is not sent `WM_PARENTNOTIFY` as its controls are made or destroyed. [[measured]] [[probe:ofnopen]]'s hook is sent everything COMMDLG's Open box is sent before `WM_INITDIALOG`, and no `WM_PARENTNOTIFY` is among it.
- [[measured]] A push button's text is centred down on the font's ascent, not on its height: floor((height − ascent) ÷ 2) − 1. That fits every push button recorded, in the System font on four displays and in bold MS Sans Serif.
- [[refused]] Half of what the height leaves, and the height less its internal leading, both put the EGA's 18-pixel buttons in MS Sans Serif a row low.
- [[measured]] The character after `&` is underlined a row below the font's ascent, the rule the menu bar uses. Under an emboldened font, whose text measures a pixel wider than it draws, the underline starts that overhang to the left.
- [[measured]] With more than one `&`, only the last of the characters they mark is underlined. [[probe:multipfx]] draws a push button `&I &A&gr&e&e`, a check box `a&b&c`, static text `x&y&z` and [[fn:USER.DrawText]] of `&p&q&r`: the last "e", `c`, `z` and `r` are underlined, and nothing else. The template of FIBS/W's About box has that button. Once the box opens, FIBS/W replaces the button's text with one marked `&` once, choosing the letter from [[fn:USER.GetTickCount]]. The letter it picks depends on how long Windows has been running, so its screen and winbox.js's underline different letters.
- [[measured]] The dialog's edit control has the focus, so its caret shows. In the System font it is two pixels wide and three pixels in. In bold MS Sans Serif it is one wide and one in. Either way it is a pixel taller than the font. [[read out]] Its width follows the font's average width, and its place the edit control's margins and the font's overhang. See [[topic:edit-controls]].

## The keyboard

- [[measured]] When `WM_INITDIALOG` answers TRUE, the first control with `WS_TABSTOP` gets the focus. [[read out]] It must also be visible and not disabled; with no such control the first control gets it, whatever it is, and with no controls the dialog itself (`USER.EXE` seg25 `0089`). [[measured]] In [[probe:groupbox]]'s dialogs, whose controls have no tab stops, that is a group box, which shows no focus.
- [[measured]] Tab moves the focus through the tab stops in template order, and wraps back to the first. A radio button without `WS_TABSTOP` is skipped.
- [[read out]] [[fn:USER.GetNextDlgTabItem]] and [[fn:USER.GetNextDlgGroupItem]] first take the window they are given to the dialog's own control it is in (`USER.EXE` seg19 `0a02`, `0a77`): the window itself, or the last of its parents that is still a child before the dialog (seg25 `0f8c`). The focus in a combo box's edit control is in the combo box, and Tab goes on from there. winbox.js looked for the edit control among the dialog's controls, found nothing, and gave the focus back to the first tab stop, the same combo box: in Paintbrush's Font box Tab went nowhere, and the size typed after two Tabs went into the font's name; the focus never left the baud rate in Control Panel's Ports Settings.
- [[measured]] Enter sends `WM_COMMAND` for the default push button, and Escape for `IDCANCEL`, even when the focus is on a check box.
- [[measured]] The default push button follows the focus as the dialog manager moves it. [[probe:defpush]] makes a dialog of push buttons A, B and C, with C the template's default, and an edit control. It records which buttons have `BS_DEFPUSHBUTTON` after each step:
  - As the dialog opens, A takes the focus and becomes a default push button, and C stays one too, so both show the default's second outline.
  - A plain [[fn:USER.SetFocus]] on B changes nothing.
  - Tab to C leaves C the only default, and A is plain again.
  - Tab to the edit control leaves C the default.
  - Tab on to A makes A the default and C plain.
  - `DM_GETDEFID` answers C throughout.
- [[read out]] The dialog manager keeps the default push button as it moves the focus from one control to another (`USER.EXE` seg25 `0b5b`), asking each with `WM_GETDLGCODE` and nought, the control given the focus first:
  - Moved to the same control: that one made the default if it answers `DLGC_UNDEFPUSHBUTTON`, and nothing more.
  - Otherwise, where the control it came from answers as a push button -- or else the one it goes to does -- every control that answers `DLGC_DEFPUSHBUTTON` is made plain, each child asked from the control it goes to round the dialog (`0ab2`).
  - Then the control it goes to is made the default if it answers `DLGC_UNDEFPUSHBUTTON`; else the control `DM_GETDEFID` names -- 1, where the dialog answers none -- if it answers `DLGC_UNDEFPUSHBUTTON` and not `DLGC_DEFPUSHBUTTON` and is not disabled.

  Made the default or plain is `BM_SETSTYLE` with `BS_DEFPUSHBUTTON` or `BS_PUSHBUTTON`, drawn at once. Tab, an arrow, a mnemonic, `WM_NEXTDLGCTL`, `DM_SETDEFID`, the focus given back as the dialog is made active again (`0404`) and a press of the left button on a control (`0e98`) keep it so; and as the dialog is made, the move is from the control `WM_INITDIALOG` was given to the first tab item (seg24 `093e`). That is the same control as the dialog opens, so the template's default keeps its outline beside A's, as [[probe:defpush]] recorded. A dialog losing the activation, as it keeps its focus, makes every default plain from that control round (`03d3`). A plain [[fn:USER.SetFocus]] keeps nothing.

- [[read out]] **As the dialog is made**, each control is sent `WM_SETFONT` with the dialog's font, then asked with `WM_GETDLGCODE`, and one that answers `DLGC_DEFPUSHBUTTON` has its identifier written over the dialog's default, which starts as 1 (seg24 `0892`-`08c2`). [[measured]] [[probe:dlgcode]] makes dialogs with controls of its own class, which answer by their identifiers:
  - Each of them is sent `WM_CREATE`, `WM_SETFONT`, then `WM_GETDLGCODE` with nought, as it is made.
  - An edit control, X answering `DLGC_DEFPUSHBUTTON`, a push button with `BS_DEFPUSHBUTTON` (22) and Y answering `DLGC_UNDEFPUSHBUTTON`: `DM_GETDEFID` answers 22, the last.
  - A push button with `BS_DEFPUSHBUTTON` (21), then X (11), then an edit control: `DM_GETDEFID` answers 11, the button keeps its outline, and X is sent nothing as the edit control takes the focus.
  - A control answering `DLGC_DEFPUSHBUTTON` without `DLGC_BUTTON` (13) is the default too; a plain push button first takes the focus and the default's outline.
  - With none, `DM_GETDEFID` answers 1.

  Both engines took the template's first `BS_DEFPUSHBUTTON`, asked nothing, and kept the default with a rule of their own that fitted [[probe:defpush]].

- FIBS/W's About box gives its first button, View License, the focus, and Windows draws it as the default. winbox.js now does too. The button changes style through `BM_SETSTYLE`, which repaints it.
- [[documented]] [[fn:USER.IsDialogMessage]] also moves the focus within a group with the arrow keys, and finds a control by its mnemonic. It asks each control what it wants with `WM_GETDLGCODE`, so an edit control keeps its characters and arrows.
- [[read out]] **A group** goes round: the control after the last of a group is its first, the last child with `WS_GROUP` at or before it going back round the dialog's children (seg19 `09ab`, `096c`). So a first control without `WS_GROUP` is in the group of the last control that has it. [[fn:USER.GetNextDlgGroupItem]] answers the next control of the group, or the one before, that shows and is not disabled; come back round, the control it started from, whatever it is (`0a5f`). [[fn:USER.GetNextDlgTabItem]] answers the next with `WS_TABSTOP` that shows and is not disabled, going round the children; come back round, the control it started from (`09ee`).
- [[read out]] **An arrow** moves to the next control of the group, or the one before (seg25 `0d92`-`0e38`), asking it with the message: a push button is given the focus marked as the dialog manager's (below); a radio button is given the focus, and an automatic one unchecked then clicked with 463h; static text is not moved to; anything else is given the focus. [[measured]] [[probe:dlgcode]]: Down from an automatic radio button to the next, unchecked, tells the dialog `BN_CLICKED` as the button gains the focus and again as 463h clicks it, which checks it and clears the other.
- [[read out]] **A character**, `WM_CHAR`, or `WM_SYSCHAR` from Alt (`USER.EXE` seg25 `0e48`-`0f2b`):
  - `WM_SYSCHAR` with no window focused, and Alt up by the keyboard's state (`GetKeyState`, not the message's bit), beeps and is taken. Enter in a dialog minimized goes to `DefWindowProc` instead, which restores it. With Alt down it goes on as below.
  - Alt and Space goes to the dialog's own `DefWindowProc`, not its procedure: the system menu.
  - A character for the dialog's own window is taken, and nothing is done.
  - The window it is for is asked `WM_GETDLGCODE`, with the message. A `WM_CHAR` it wants with `DLGC_WANTCHARS` or `DLGC_WANTALLKEYS` is its own, and is dispatched.
  - A space is taken, and nothing done.
  - Otherwise the control the character names is looked for (seg19 `00a5`): round the group of the window the character is for, with `GetNextDlgGroupItem`, back to that window; then round all the dialog's children from it. Each is asked with `WM_GETDLGCODE` and nought; one that wants characters is passed over, and so is static text with `SS_NOPREFIX`; the others' text is read with `WM_GETTEXT` and looked at: spaces at its start skipped, then the first `&` not doubled, and the character after it, both made capitals (seg19 `0000`).
  - The control found is asked again (`01d9`). Static text gives way to the next tab item after it; a disabled control is passed over for the next found, until the first disabled one comes round again.
  - A push button is pressed and let go with `BM_SETSTATE`, a pause between, and its parent sent `WM_COMMAND` with `BN_CLICKED`; the focus stays where it was (`0263`-`02a0`).
  - A button of another kind is given the focus marked as the dialog manager's -- a flag of the button's, 80h of its state, which keeps a radio button gaining the focus from telling its parent it was clicked (seg25 `1b13`) -- then the search is made again from it, and where it finds that same button, no other having the mnemonic, the button is sent 463h with 1 (`0233`-`025a`). Any other control is given the focus.
  - The focus moved to a control not clicked, the default push button is kept as above (`0f27`).
- [[read out]] **463h** is the button's own, its click (seg25 `1f3f`): it sends itself `WM_LBUTTONDOWN` and `WM_LBUTTONUP` at nought, then, with no press followed, lets itself go as a key other than the Space bar does. The press and the release do the rest: `BM_SETSTATE` in and out, the check an automatic button takes, and `BN_CLICKED`.
- [[measured]] [[probe:dlgcode]] posts Alt and a letter to the focus of a modeless dialog, its edit control, taken through `IsDialogMessage`:
  - `&Check`, an automatic check box: the edit control's group is asked, then the rest of the dialog, round to the box, which takes the focus; then the box's group and the dialog again, round to the box itself, then 463h, `WM_LBUTTONDOWN`, `BM_SETSTATE` with 1, `WM_LBUTTONUP`, `BM_SETSTATE` with nought, `BM_SETCHECK` with 1, and `BN_CLICKED`; then the box and the edit control asked, keeping the default. Again from the box, it is cleared.
  - `&Radio`, an automatic radio button: no `BN_CLICKED` as it gains the focus; its click checks it, asks the other of its group and clears it, then `BN_CLICKED`.
  - `&Plain`, a check box, and `&Bare`, a radio button: clicked, `BN_CLICKED`, and neither checked.
  - `&Dup`, two check boxes: the focus goes to the first and nothing is clicked; Alt and D again moves it to the second.
  - `&Static`, static text: the edit control after it takes the focus, its text selected with `EM_SETSEL`.
  - `&Go`, a push button: pressed and let go, `WM_COMMAND`, the focus left in the edit control.

  Both engines agree with all 312 records. They had looked for the first `&` of each control's own text, given a check box or a radio button the focus and clicked it themselves, and sent no 463h. Notepad's Find box shows it, in both engines' accessory sessions: Alt and C checks Match Case and gives it the focus, Alt and U and Alt and D choose the direction.
  - Named by none: the window's own, dispatched, where it wants every key. Otherwise `WM_SYSCHAR` goes to the dialog's `DefWindowProc`, which sends the dialog `SC_KEYMENU` and opens its system menu's loop for the letter, and `WM_CHAR` beeps.

- [[measured]] [[probe:syschar]] posts characters to a modeless dialog with an edit control and a push button `&Go`, and takes them through `IsDialogMessage`:
  - Alt and Q in the edit control: the dialog, not the control, is sent `SC_KEYMENU` with `q`, then `WM_INITMENU`, `WM_MENUCHAR` with `MF_SYSMENU`, and the loop ends with `WM_MENUSELECT` for none. Both engines had dispatched it to the control, which sent itself `SC_KEYMENU`.
  - Alt and G: the dialog is sent `WM_COMMAND` for `&Go`, and the edit control keeps the focus. Both engines had given the button the focus as well.
  - With the button focused, Q reaches nothing, and G presses it. `WM_SYSCHAR` with Q and without Alt's bit reaches nothing either.
  - With nothing focused, `WM_SYSCHAR` with Q, Alt's bit or not, reaches nothing, and `WM_CHAR` for the dialog itself reaches nothing. Each is answered TRUE.
  - Both engines agree with all 81 records. Notepad's Find box shows it: Alt and F presses Find Next and leaves the focus in what is to be found, so what is typed next goes on its end. It once went to the Find Next button, and nowhere.
- [[read out]] `IsDialogMessage` is `USER.EXE` seg25 `0c23`, behind the checks at `2804`. It calls [[fn:USER.CallMsgFilter]] first, with the message and `MSGF_DIALOGBOX`, and a message a filter takes is answered TRUE and nothing more done (`0c32`-`0c44`); `DialogBox`'s loop calls the same, so its filters are this call's. Then it takes only a message for the dialog or a window inside it. [[measured]] [[probe:dlgcode]]: in a program's own loop, the filter is called with code 0 for a message for the dialog's edit control, and for one for a window outside the dialog, which `IsDialogMessage` then answers FALSE; a filter that answers TRUE has the message answered TRUE and not dispatched; `DialogBox`'s loop calls it once for a message. Both engines had called the filters in `DialogBox`'s loop alone. For `WM_KEYDOWN` it asks the window with the focus `WM_GETDLGCODE`, and dispatches the key to it if the answer has `DLGC_WANTALLKEYS` (`0cc0`). It asks with the message it is taking, a far pointer to it in `lParam`, for `WM_CHAR` too (`0cae`, `0ebc`). A multi-line edit control asked so learns it is in a dialog, and takes Escape, Enter and Tab as the dialog's ([[topic:multi-line-edit-controls]]). winbox.js asked with nought. Nothing else keeps Escape or Enter from the dialog: `DLGC_WANTMESSAGE` is not looked at. Escape, and Ctrl and Break (`VK_CANCEL`), are `WM_COMMAND` for `IDCANCEL`, with the Cancel button's window, or a beep if it is disabled (`0d6b`, `0e3a`). Enter, and `VK_EXECUTE`, is the default button's `WM_COMMAND`: the focus asked again with nought, its own identifier if it answers `DLGC_DEFPUSHBUTTON`, else what `DM_GETDEFID` answers, else `IDOK` (`0d2d`). A press of the left button keeps the default push button as the focus would move to the control pressed, then is dispatched (`0e98`).
- [[read out]] So a combo box with its list down does not keep Escape or Enter. It answers `WM_GETDLGCODE` with 81h, `DLGC_WANTARROWS` and `DLGC_WANTCHARS`, whatever the message and whether its list is down or not (seg33 `0212`), and a drop-down's edit control answers 89h. [[measured]] [[probe:comboesc]] runs a dialog with a drop-down list and a drop-down, and drops each list with F4, with Alt and Down, and with a click on its button. Escape then sends the dialog `IDCANCEL`, and Enter `IDOK`, every way the list was dropped, and the list is still down after. Only F4, sent on to the list, puts it away. In COMMDLG.DLL's Open box, Escape with the drives' list down ends the dialog and `GetOpenFileName` answers 0, as Notepad's and Media Player's File Open do. A dialog that wants the keys for its combo box has to look for them itself.
- [[read out]] [[fn:USER.EndDialog]] takes the focus back to the dialog itself, when the dialog is the active window and the focus is in one of its controls (seg25 `25bb`-`25d0`). The control is told `WM_KILLFOCUS` as the dialog ends, and the dialog, marked ended, gives the focus to no control. [[measured]] [[probe:comboesc]]: Escape in the Open box with the focus on the drives tells COMMDLG's hook `CBN_KILLFOCUS` after `IDCANCEL`, though the box has no owner to take the focus. A list left down is put away by that `WM_KILLFOCUS`, with `CBN_CLOSEUP` first.

## Numbers in controls

- [[read out]] [[fn:USER.GetDlgItemInt]] reads the control's text with `GetDlgItemText`, 31 characters at most (`USER.EXE` seg25 `0233`, `00d4`): `WM_GETTEXT`, which a combo box answers with its edit control's text. winbox.js read the window's own text, and a combo box's is empty: Paintbrush's Font box said "Size must be a number." for every size.
- [[read out]] It skips spaces, takes a minus sign where asked for a signed number, and reads digits up to the first character that is not one. The digits read are the answer, negated after a minus, even when something follows them; the flag says whether the text ended there with at least one digit. No text answers nought, and so does a number past `FFFFh`, or past `7FFFh` signed (so -32768 too), with the flag FALSE.

## Running modal

- [[measured]] While [[fn:USER.DialogBox]] runs, the owner is disabled, and it is enabled again afterwards. `DialogBox` answers the value given to [[fn:USER.EndDialog]].
- [[read out]] `DialogBoxIndirectParam` (`USER.EXE` seg25 `08eb`), which the other three forms reach, takes a child owner's window at the top, and that window's last owner (seg1 `63a2`). It notes whether the owner is disabled already and whether it is the active window, then disables it, before the dialog is made. [[fn:USER.EnableWindow]] sends `WM_CANCELMODE`, then `WM_ENABLE` if the state changed, and takes the focus away only from the owner itself, not from a window in it (seg1 `6f28`). Then it makes the dialog, owned by that window, and runs the loop (`0737`). [[measured]] [[probe:enddlg]]: the owner hears `WM_CANCELMODE` and `WM_ENABLE` before the dialog's `WM_INITDIALOG`, and an owner disabled before hears `WM_CANCELMODE` alone.
- [[read out]] With no dialog made, the loop enables the owner again, unless it was disabled before, gives it the focus if it was active, and answers -1 (`0749`-`0779`). Otherwise it tells the window with the mouse's capture `WM_CANCELMODE`, notes the owner's state in the dialog's word at 14h, and takes messages until the dialog's word at 12h says it has ended (`07b1`).
- [[read out]] **When the dialog shows.** A dialog made hidden, as most are, is shown by the loop the first time it finds no message, or as it takes `WM_SYSTIMER` or `WM_SYSKEYDOWN`: [[fn:USER.ShowWindow]] with `SW_SHOWNORMAL`, then [[fn:USER.UpdateWindow]] (`0801`-`084c`). [[measured]] [[probe:enddlg]]: a message the dialog posts itself in `WM_INITDIALOG` is taken while it is still hidden, and the dialog shows after. Both engines showed the dialog before the loop began.
- [[read out]] A `WM_QUIT` taken is posted again with [[fn:USER.PostQuitMessage]], and the loop ends, answering the dialog's word at 16h as it stands: the default button's identifier where `EndDialog` has not written over it (`07d5`, `08ad`).
- [[read out]] The modal loop (`USER.EXE` seg25 `0737`) takes each message with USER's own `PeekMessage` (`07c7`), the function [[fn:USER.PeekMessage]] goes on to past its checks (seg1 `a76c`), so [[fn:USER.GetMessagePos]] and [[fn:USER.GetMessageTime]] answer the message the loop took last. Control Panel's spin buttons ask `GetMessagePos` where they were pressed; winbox.js answered the last message a program took, nowhere near them, and they did nothing.
- [[read out]] Finding nothing to take, the loop tells the owner the dialog is idle: [[fn:USER.SendMessage]] of `WM_ENTERIDLE`, `MSGF_DIALOGBOX` in `wParam` and the dialog in `lParam`, once until a message is taken again, unless the dialog has `DS_NOIDLEMSG` or the owner is no window (`085b`-`0892`). Then it waits. The first time it finds nothing it shows the dialog instead, if it does not show yet. Control Panel's Fonts fills Add Fonts' list of fonts as it is told so, a few files at a time; winbox.js never told it, and the list stayed empty.
- [[measured]] A message another program sends the dialog, which ends it, ends the loop: [[probe:tasklist]] presses the Task List's Cancel with [[fn:USER.SendMessage]] from another program, and the Task List goes. [[inferred]] The loop waits with `WaitMessage` (`0899`), and checks after each wait whether the dialog has ended (`07b1`); what makes the wait return once the message is answered is not read out. Both engines end their wait there ([[topic:task-list]]).
- [[read out]] **System modal.** A dialog with `DS_SYSMODAL` is made the system-modal window with [[fn:USER.SetSysModalWindow]] as soon as it is a window, before its controls; the window system modal before is kept in its word at 1Ch, and where another task's window keeps it from being so, `DS_SYSMODAL` is taken from its style (seg24 `062d`-`064b`). A dialog owned by the system-modal window -- a window at the top -- is made with `DS_SYSMODAL` (`011c`-`0148`). `DialogBox`'s loop, as it first shows the system-modal dialog, puts it in front of all with [[fn:USER.SetWindowPos]], `HWND_TOPMOST` and 1Bh, before `ShowWindow`, and locks the task with [[fn:USER.LockMyTask]] once it is painted (seg25 `0826`-`0854`). A modeless one made with `WS_VISIBLE` is locked as it shows (seg24 `0967`-`0976`). `SetSysModalWindow` refuses, answering nought, while another task's window is system modal (seg1 `19e8`-`1a0a`), and `ActivateWindow` refuses a window that is not the system-modal one unless the running task is its (`3531`-`354c`).
- [[measured]] [[probe:sysdlg]] runs D, `DS_SYSMODAL`, owned by A, while another program shows C, E and G:
  - In `WM_INITDIALOG`, D is already the system-modal window, and no task is locked.
  - As D shows, it is asked to go after none with 1Bh, its owner's other pop-up and its owner asked after it, and none of them is told; then it shows with 57h, and [[fn:KERNEL.IsTaskLocked]] names the program.
  - A key pressed reaches no window of the other program, which is not run: `WM_USER` posted to C is answered only once D has ended.
  - The program makes its own window B active with [[fn:USER.SetActiveWindow]], and D again.
  - [[fn:USER.CallMsgFilter]] answers nought, and the filter is not called, for the program's message or for the dialog's own.
  - Ended, no window is system modal, no task is locked, and A is active.
  - N run over D, owned by D, without `DS_SYSMODAL`, is the system-modal window while it shows. Ended, D is so again and active, its focus given back -- and no task is locked, though D still shows.
  - Made with [[fn:USER.CreateDialogIndirect]] and `WS_VISIBLE`, D locks the task as it shows; ended, it lets it go. Destroyed without `EndDialog`, it leaves no window system modal, and the task is let go too: [[fn:USER.DestroyWindow]] lets go a task locked with `LockMyTask` (seg8 `0a3f`-`0a48`), and the system-modal window destroyed leaves none (`0cbc`).

  Both engines agree with all 349 records. Neither had followed `DS_SYSMODAL` at all.

- [[measured]] **An owner of another program's**: [[probe:sysdlg]] runs D owned by C, the other program's window, active. C is sent `WM_CANCELMODE`, `WM_KILLFOCUS` and `WM_ENABLE` with nought before `WM_INITDIALOG`; made active as its first control takes the focus, D is the program's, so `WM_ACTIVATEAPP` goes to every window at the top of both programs ([[topic:activation-and-focus]]). Ended, C is enabled and made active again, the same messages the other way, and C's `DefWindowProc` takes the focus from D.
- [[read out]] The loop ends once the dialog has ended, and destroys it with [[fn:USER.DestroyWindow]] (`08b5`-`08b9`). A dialog destroyed without `EndDialog` ends the loop too, answering 0 (`089e`-`08ab`), and leaves its owner disabled. [[measured]] [[probe:enddlg]]: `DestroyWindow` in the dialog's procedure makes the next window that can be active active -- not the owner, which is disabled -- and `DialogBox` answers 0 with the owner still disabled.

## Ending a dialog

[[fn:USER.EndDialog]] ends a dialog at once, modal or modeless; the loop of a modal one then sees it has ended, and destroys it. [[measured]] [[probe:enddlg]] runs a dialog D, with an edit control and a push button, owned by O, which has an edit control E with the focus, while another window W is open. It ends D in eleven ways. It records every enabling, showing, focus, activation, position and destruction message that O, E, W, D and the controls hear. At each step it also records the focus, the active window, whether D shows, whether O is enabled, `GetLastActivePopup(O)` and `DM_GETDEFID`. Both engines agree with all 499 records.

- [[read out]] `EndDialog` (`USER.EXE` seg25 `2564`), in order:
  1. Lets go a task locked with [[fn:USER.LockMyTask]], whichever locked it (`2579`); then notes whether the dialog is the active window.
  2. Enables the owner -- the parent of a child dialog -- unless the dialog's word at 14h says it was disabled before `DialogBox` (`2589`-`25ab`). A modeless dialog notes nothing there: its owner is enabled, disabled before or not.
  3. Marks the dialog ended, its word at 12h, and writes the value over its word at 16h, the default button's identifier (`25b0`-`25b8`). `DM_GETDEFID` answers 0 from then on, and `DM_SETDEFID` is answered TRUE and changes nothing (`06d7`, `06f0`).
  4. Where the dialog is the active window and the focus is in one of its controls, gives the dialog itself the focus (`25bb`-`25d0`).
  5. Hides the dialog: [[fn:USER.SetWindowPos]] with `SWP_HIDEWINDOW`, `SWP_NOACTIVATE`, `SWP_NOZORDER`, `SWP_NOMOVE` and `SWP_NOSIZE`, 97h (`25d5`-`25e3`). That makes no other window active, and leaves the focus where it is.
  6. The dialog the system-modal window, it makes the window system modal before it so again -- none, where that is no longer a window -- and that window, not the owner, is the one made active below (`25e8`-`260b`).
  7. Where the dialog was the active window and has an owner, makes the owner active as USER's `ActivateWindow` does (seg1 `38e4` with 1, then `3514`), whether it is disabled, minimized or hidden ([[topic:activation-and-focus]]). With no owner, it leaves no window active and none with the focus, telling no one (`260e`-`2631`).

  It answers nothing, and asks nothing of the dialog's state first: called again, it does it all again.

- [[measured]] **Ended at a timer's tick**, D active with the focus in its edit control, in this order, all inside `EndDialog`:
  - O hears `WM_ENABLE` with 1.
  - The edit control hears `WM_KILLFOCUS`, and D `WM_SETFOCUS`.
  - D hears `WM_WINDOWPOSCHANGING` and `WM_WINDOWPOSCHANGED`, 97h.
  - D hears `WM_NCACTIVATE` and `WM_ACTIVATE` inactive, naming O, then O its two, naming D.
  - D hears `WM_KILLFOCUS`, and O `WM_SETFOCUS`, from O's `DefWindowProc`.

  Then the loop destroys D: `WM_DESTROY` to D, its edit control and its button, then `WM_NCDESTROY` to the edit control, the button, and D last. `DialogBox` answers 7. The focus is O's, not E's: O's procedure leaves `WM_ACTIVATE` to `DefWindowProc`, which gives the window itself the focus. [[inferred]] Notepad, whose text has the focus again after its Find box ends, gives it there on `WM_ACTIVATE` itself.

- [[measured]] **The owner's last active pop-up** is D while D is active, and O again once `EndDialog` has made O active: `ActivateWindow` notes the window it makes active as its root owner's last active pop-up. With no owner, nothing changes it.
- [[measured]] **Called twice**, 3 then 4: the second call only asks D, hidden, `WM_WINDOWPOSCHANGING` with 97h again, and does not tell it it moved. `DialogBox` answers 4.
- [[measured]] **Called in `WM_INITDIALOG`**: O hears `WM_ENABLE` with 1, and D is asked 97h, being hidden. Then the dialog manager gives no control the focus, and a template with `WS_VISIBLE` does not show (seg24 `090e`, `0949`): D never shows and is never active, and E keeps the focus. `DialogBox` answers 5.
- [[measured]] **The owner disabled before `DialogBox`**: it stays disabled, and is made active all the same. `DefWindowProc` cannot give it the focus, which [[fn:USER.SetFocus]] refuses a disabled window. USER moves the focus left in D to it all the same, asking nothing of it (seg1 `37a3`, `3412`). So the focus is O's.
- [[measured]] **The owner minimized**: made active as an icon, with its icon's title above it, so it is first brought to the front with the hidden D it owns -- D asked 13h, then O 3. `DefWindowProc` takes the focus from D and gives it to none.
- [[measured]] **No owner**: `EndDialog` leaves no window active and the focus with none, and no message goes out. As the loop destroys D, `DestroyWindow` finds no window active and makes the next one active (seg8 `0ba8`). O, which was active before D, is sent `WM_NCACTIVATE` and `WM_ACTIVATE` naming no window, and `WM_SETFOCUS`, before D's `WM_DESTROY`. O is not sent `WM_ACTIVATEAPP`: USER notes the active task apart from the active window, and `EndDialog` left it O's.
- [[measured]] **Called from outside**: O's procedure, taking a message D posted it, ends D, and the messages are the same as from D's own procedure.
- [[measured]] **A dialog over a dialog**: D gives its button the focus and runs N over itself. N ended makes D active, and the dialog manager gives D's button the focus back, as D kept it when it lost the activation ([[topic:activation-and-focus]]).
- [[measured]] **Modeless**, made with `CreateDialogIndirect`, shown and active, its focus in its edit control: `EndDialog` takes the focus back to D, hides it and makes O active, and D stays a window, hidden, until it is destroyed. With O disabled before D was made, `EndDialog` enables O. With W made active first, `EndDialog` only hides D: no activation message, and the focus stays W's.
- Hearts' screen in the corpus shows the change. Hearts runs its Players box with `DialogBox` while its title window is up; the box now shows at its loop's first idle, active, over the title window, as in Windows' screen. A strip of the title window's buttons still shows below the box: at the run's stop the box's loop is idle, sending `WM_ENTERIDLE`, and nothing is due a paint, so it is the title window itself, still shown. [[inferred]] Hearts takes it down later, at a time Windows' screen, taken later, has reached and the run has not.
- [[measured]] **System modal**: [[probe:sysdlg]] -- under Running modal -- records the window system modal before made so again and active, and the task let go.

## In winbox.js

- `src/win16/user/dialog-template.ts` reads templates.
- `dialogBox`, `runModal` and `EndDialog` in `src/win16/user/dialogs.ts`, and `begin_modal`, `run_modal` and `end_dialog` in `crates/winbox-win16/src/dialogs.rs`, follow `DialogBoxIndirectParam`, its loop and `EndDialog` as above. The dialog's words at 12h, 14h and 16h are `ended`, `ownerWasDisabled` (`owner_was_disabled`) and `defId` (`def_id`). The last holds the default button's identifier, and then the value `DialogBox` answers.
- `src/win16/user/dialogs.ts` has:
  - `CreateDialog` and `DialogBox` in all their forms;
  - `DefDlgProc`, the procedure of the dialog class `#32770`;
  - `IsDialogMessage`, and the rest of the dialog manager.
- The modal frame is drawn in `frame.ts`.

The replay runs [[probe:dialogs]] and [[probe:dlgcolor]] through the exports. Getting there found a bug outside dialogs: every structure handed to a window procedure on the stack, such as `CREATESTRUCT` or `MINMAXINFO`, had been given a pointer using the stack's descriptor index instead of its selector. Character Map reads its `CREATESTRUCT`, and faulted.

winbox.js closed the Open box for Escape with the drives' list down, as Windows does, but left the list on the desktop: it did not destroy a combo box's list with the combo box ([[topic:combo-boxes]]). Nor did `EndDialog` take the focus back, so the drives were told nothing as the box went.

Not yet done:

- Whether a dialog whose control cannot be made fails as a whole.
- A probe cannot hear a beep. The beeps `IsDialogMessage`, `DefWindowProc` and the menu loop give are read out, not measured.
- `SetSysModalWindow` and `ActivateWindow` refused for another task's system-modal window are read out; [[probe:sysdlg]]'s system-modal dialog is the program's own, and a send to the other program while its task is locked would wait for ever.
- The word at `0DCh` of USER's data, which keeps a system-modal window from refusing another and from locking its task (seg1 `19e8`, seg24 `096d`), set and put back at seg5 `0319`-`0334`, is not followed; neither engine keeps it.
- The dialog manager reads a control's text for its mnemonic with `WM_GETTEXT` (seg19 `010b`); both engines read the text the control keeps, which a control of a program's own class answering `WM_GETTEXT` itself would tell apart.
- The TypeScript engine runs a window procedure another program's `SendMessage` reaches on the sender's stack, so a dialog procedure that sets its data segment from the stack -- one passed to `DialogBox` without [[fn:KERNEL.MakeProcInstance]] -- finds the wrong one there. [[probe:sysdlg]] passes its procedures through `MakeProcInstance`.
