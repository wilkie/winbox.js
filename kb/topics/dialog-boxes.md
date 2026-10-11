---
kind: topic
name: Dialog boxes
summary: How Windows 3.1 turns a dialog template into a window — dialog units, the dialog font, where the dialog goes, its modal frame — and how the keyboard and a modal loop drive it, measured on four displays and replayed through the exports.
probes: [dialogs, dlgcolor, dlgclamp, dlgpos, defpush, multipfx, dlgneg, comboesc, mldlg, enddlg, syschar]
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
- [[read out]] [[fn:USER.GetNextDlgTabItem]] and [[fn:USER.GetNextDlgGroupItem]] first take the window they are given to the dialog's own control it is in (`USER.EXE` seg19 `0a02`, `0a77`): the window itself, or the last of its parents that is still a child before the dialog (seg25 `0f8c`). The focus in a combo box's edit control is in the combo box, and Tab goes on from there. winbox.js looked for the edit control among the dialog's controls, found nothing, and gave the focus back to the first tab stop, the same combo box: in Paintbrush's Font box Tab went nowhere, and the size typed after two Tabs went into the font's name; the focus never left the baud rate in Control Panel's Ports Settings.
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
- [[read out]] **A character**, `WM_CHAR`, or `WM_SYSCHAR` from Alt (`USER.EXE` seg25 `0e48`-`0f2b`):
  - `WM_SYSCHAR` with no window focused, and Alt up by the keyboard's state (`GetKeyState`, not the message's bit), beeps and is taken. Enter in a dialog minimized goes to `DefWindowProc` instead, which restores it. With Alt down it goes on as below.
  - Alt and Space goes to the dialog's own `DefWindowProc`, not its procedure: the system menu.
  - A character for the dialog's own window is taken, and nothing is done.
  - The window it is for is asked `WM_GETDLGCODE`, with the message. A `WM_CHAR` it wants with `DLGC_WANTCHARS` or `DLGC_WANTALLKEYS` is its own, and is dispatched.
  - A space is taken, and nothing done.
  - Otherwise the control the character names is looked for (seg19 `01a5`). A push button is pressed and let go with `BM_SETSTATE`, a pause between, and its parent sent `WM_COMMAND` with `BN_CLICKED`; the focus stays where it was (`0263`-`02a0`). Any other control is given the focus, and a check box or a radio button clicked.
  - Named by none: the window's own, dispatched, where it wants every key. Otherwise `WM_SYSCHAR` goes to the dialog's `DefWindowProc`, which sends the dialog `SC_KEYMENU` and opens its system menu's loop for the letter, and `WM_CHAR` beeps.
- [[measured]] [[probe:syschar]] posts characters to a modeless dialog with an edit control and a push button `&Go`, and takes them through `IsDialogMessage`:
  - Alt and Q in the edit control: the dialog, not the control, is sent `SC_KEYMENU` with `q`, then `WM_INITMENU`, `WM_MENUCHAR` with `MF_SYSMENU`, and the loop ends with `WM_MENUSELECT` for none. Both engines had dispatched it to the control, which sent itself `SC_KEYMENU`.
  - Alt and G: the dialog is sent `WM_COMMAND` for `&Go`, and the edit control keeps the focus. Both engines had given the button the focus as well.
  - With the button focused, Q reaches nothing, and G presses it. `WM_SYSCHAR` with Q and without Alt's bit reaches nothing either.
  - With nothing focused, `WM_SYSCHAR` with Q, Alt's bit or not, reaches nothing, and `WM_CHAR` for the dialog itself reaches nothing. Each is answered TRUE.
  - Both engines agree with all 81 records. Notepad's Find box shows it: Alt and F presses Find Next and leaves the focus in what is to be found, so what is typed next goes on its end. It once went to the Find Next button, and nowhere.
- [[read out]] `IsDialogMessage` is `USER.EXE` seg25 `0c23`, behind the checks at `2804`. It passes a message on to the message filter hooks first, and takes only a message for the dialog or a window inside it. For `WM_KEYDOWN` it asks the window with the focus `WM_GETDLGCODE`, and dispatches the key to it if the answer has `DLGC_WANTALLKEYS` (`0cc0`). It asks with the message it is taking, a far pointer to it in `lParam`, for `WM_CHAR` too (`0cae`, `0ebc`). A multi-line edit control asked so learns it is in a dialog, and takes Escape, Enter and Tab as the dialog's ([[topic:multi-line-edit-controls]]). winbox.js asked with nought. Nothing else keeps Escape or Enter from the dialog: `DLGC_WANTMESSAGE` is not looked at. Escape and Cancel are `WM_COMMAND` for `IDCANCEL`, with the Cancel button's window, or a beep if it is disabled (`0d6b`, `0e3a`). Enter is the default button's `WM_COMMAND`: the focus's own identifier if it answers `DLGC_DEFPUSHBUTTON`, else what `DM_GETDEFID` answers, else `IDOK` (`0d2d`).
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
- [[read out]] The loop ends once the dialog has ended, and destroys it with [[fn:USER.DestroyWindow]] (`08b5`-`08b9`). A dialog destroyed without `EndDialog` ends the loop too, answering 0 (`089e`-`08ab`), and leaves its owner disabled. [[measured]] [[probe:enddlg]]: `DestroyWindow` in the dialog's procedure makes the next window that can be active active -- not the owner, which is disabled -- and `DialogBox` answers 0 with the owner still disabled.

## Ending a dialog

[[fn:USER.EndDialog]] ends a dialog at once, modal or modeless; the loop of a modal one then sees it has ended, and destroys it. [[measured]] [[probe:enddlg]] runs a dialog D, with an edit control and a push button, owned by O, which has an edit control E with the focus, while another window W is open. It ends D in eleven ways. It records every enabling, showing, focus, activation, position and destruction message that O, E, W, D and the controls hear. At each step it also records the focus, the active window, whether D shows, whether O is enabled, `GetLastActivePopup(O)` and `DM_GETDEFID`. Both engines agree with all 499 records.

- [[read out]] `EndDialog` (`USER.EXE` seg25 `2564`), in order:
  1. Notes whether the dialog is the active window.
  2. Enables the owner -- the parent of a child dialog -- unless the dialog's word at 14h says it was disabled before `DialogBox` (`2589`-`25ab`). A modeless dialog notes nothing there: its owner is enabled, disabled before or not.
  3. Marks the dialog ended, its word at 12h, and writes the value over its word at 16h, the default button's identifier (`25b0`-`25b8`). `DM_GETDEFID` answers 0 from then on, and `DM_SETDEFID` is answered TRUE and changes nothing (`06d7`, `06f0`).
  4. Where the dialog is the active window and the focus is in one of its controls, gives the dialog itself the focus (`25bb`-`25d0`).
  5. Hides the dialog: [[fn:USER.SetWindowPos]] with `SWP_HIDEWINDOW`, `SWP_NOACTIVATE`, `SWP_NOZORDER`, `SWP_NOMOVE` and `SWP_NOSIZE`, 97h (`25d5`-`25e3`). That makes no other window active, and leaves the focus where it is.
  6. Where the dialog was the active window and has an owner, makes the owner active as USER's `ActivateWindow` does (seg1 `38e4` with 1, then `3514`), whether it is disabled, minimized or hidden ([[topic:activation-and-focus]]). With no owner, it leaves no window active and none with the focus, telling no one (`260e`-`2631`).

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
- [[inferred]] A dialog made system modal is made so no more, and the window that was system modal before is made so again and active (`25e8`-`260b`); its task, locked as it showed, is let go (seg1 `6eea`). [[probe:enddlg]] makes none system modal.

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
- A system modal dialog: `DS_SYSMODAL`, the task locked while it shows and let go as it ends, and the window system modal before made so again (seg25 `0826`-`0859`, `25e8`-`260b`).
- `DialogBox` with an owner of another task.
- As the dialog is made, the dialog manager sends each control `WM_GETDLGCODE`, and takes the last that answers `DLGC_DEFPUSHBUTTON` for the default (seg24 `08a9`-`08c2`). Both engines take the template's first `BS_DEFPUSHBUTTON`, and send nothing.
- `IsDialogMessage` calls the message filters itself, with `MSGF_DIALOGBOX` (seg25 `0c38`), in a program's own loop as well as the modal one. Both engines call them only in the modal loop.
- A mnemonic for a check box or a radio button: what the message 463h the dialog manager sends it is (seg19 `0251`).
- A probe cannot hear a beep. The beeps `IsDialogMessage`, `DefWindowProc` and the menu loop give are read out, not measured.
