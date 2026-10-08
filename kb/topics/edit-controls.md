---
kind: topic
name: Edit controls
summary: How Windows 3.1's single-line edit control lays out its text and caret, scrolls, selects and tells its parent — read out of USER.EXE and measured on four displays.
probes: [editctl, editdbl, sllen]
---

[[measured]] [[probe:editctl]] makes two single-line edit controls, 120 by 20 pixels, with a border and `ES_AUTOHSCROLL`. The first uses the System font; the second is given bold MS Sans Serif 8 with `WM_SETFONT` and starts with the text "Sans". The probe types into them, moves with the keys, deletes, selects, types past the right edge and past a limit, all through `SendMessage` so no keyboard is involved. After each step it records the caret, the selection, the text and the notifications, and it records the controls' pixels with the caret shown and hidden, on the VGA, Super VGA, EGA and Hercules. The single-line edit control's code is in `USER.EXE` segments 27 to 29, and the layout below is read out of it.

## Layout

- [[read out]] An edit control with `WS_BORDER` takes the style out of its own window when it is made (seg27 `013e`) and draws the border itself, inside its client area, in the window-frame colour. [[measured]] So its client area is all of its window: `GetCaretPos` and the pixels measured from the window's corner agree.
- [[read out]] The font's **average width** is the width of the 52 letters, `a` to `z` and `A` to `Z`, divided by 26, plus one, halved: the rule for a dialog's base units. A fixed-pitch font uses its `tmAveCharWidth` instead (seg2 `03a4`). The control also keeps the System font's average width and height.
- [[read out]] The text's rectangle is the client area. With a border, it is inset across by half the smaller of the two average widths, and down by a quarter of the smaller of the two heights. It is never taller than one line (seg29 `0000`). [[measured]] In the System font on the VGA that is 4 and 4, with a line 16 high; in bold MS Sans Serif, 3 and 3.
- [[read out]] What is drawn is clipped to the client area less those margins. [[measured]] In a control 20 pixels high on the VGA, the System font's descenders are cut off at the text rectangle's bottom.

## The caret

- [[read out]] On `WM_SETFOCUS` the control makes its caret: one pixel wide for a font whose average width is less than the System font's, otherwise two, and a pixel taller than the font (seg28 `1224`). [[measured]] That gives the System font a caret 2 by 17 and bold MS Sans Serif 1 by 14 on the VGA. The caret is drawn past the control's bottom edge and clipped there.
- [[read out]] The caret stands at the text's top. Across, it is at the text rectangle's left, less the font's overhang, plus the width of the characters that show before it, and never further right than the rectangle's right edge less the caret's width (seg28 `0000`, `0047`). [[measured]] In bold MS Sans Serif, whose overhang is 1, the caret in an empty control is at 2, a pixel left of where the text starts.
- [[measured]] The caret inverts what is under it: over black text it is white. It blinks every 530 milliseconds. See [[fn:USER.CreateCaret]].

## Keys and typing

- [[measured]] A character is typed at the caret, over the selection if there is one. Backspace deletes the selection or the character before the caret; Delete, the selection or the character after. Home, End and the arrows move the caret and clear the selection. The caret stands at the selection's end.
- [[read out]] With `ES_AUTOHSCROLL`, when the caret passes the last character that fits, the text scrolls so the caret is three quarters of the way along what fits, but never so far that the end of the text leaves space at the right. When the caret moves to or before the first character that shows, the text scrolls back by as many characters as fit in a quarter of the width (seg28 `061d`). [[measured]] Typing 26 letters after "eX" leaves "m" to "z" showing, and the caret at the rectangle's right edge less its width: 114 on the VGA.

## The mouse

- [[read out]] A place across the control falls before the character whose left edge, less half the font's average width, is at or beyond it: the dividing point before a character is half an average width back from its edge, whatever its own width (seg28 `0eee`). Left of the text's rectangle it is the character before the first that shows, and right of it, one past the first that does not fit, so a press or a drag past an edge scrolls a step. [[measured]] Over "abc" in the System font, letters 8 wide from 4, presses at 6 to 20 give 0, then 1 from 8, then 2 from 16.
- [[measured]] A press on a control without the focus gives it the focus: `EN_KILLFOCUS` from the one that had it, then `EN_SETFOCUS`. No selection is left. [[read out]] Unless `ES_NOHIDESEL`, the selection is first taken away. The press captures the mouse, and a move while it is captured stretches the selection; Shift with the press stretches it from its other end (seg28 `1009`).
- [[read out]] The class asks for double clicks: `Edit` is registered with `CS_DBLCLKS` ([[topic:window-classes]]).

## Double clicks and words

[[measured]] [[probe:editdbl]] double clicks a single-line control, bordered and 300 wide, and a multi-line one that wraps, bordered and 120 by 140, both in the System font. The clicks go through `MOUSE_EVENT`, a second apart, at character boundaries found from `EM_GETRECT` and the font's extents. For each, it records the selection after the first click and after the second, and the caret.

- [[read out]] A double click works from where the first click put the caret. It selects a word and the blanks after it, and puts the caret at the end (seg28 `10fd`, seg30 `1a08`). The mouse is no longer followed afterwards: dragging with the button still down changes nothing, by characters or by words. [[measured]] A double click on "jumps", dragged to the next line, leaves "jumps " selected.
- [[read out]] Only spaces and tabs are blanks (seg26 `0361`). Punctuation is part of a word. [[measured]] In "one two,three  four. five", a double click inside "two", or just after its comma, selects "two,three  " (4 to 15), and one after the full stop selects "four. ".
- [[read out]] The word is found by one routine for both kinds of control (seg26 `0426`). It is asked to look back first, unless the caret is at the start of the text (single-line) or of its line (multi-line).
  - **Looking back**, it goes back over blanks and line feeds, then over the word before them. It stops after a blank or a line feed, or on a CR.
  - **Not looking back**, from a blank or a CR it goes on over blanks and line feeds to the next word. From a word, it goes back to the word's start.
  - **The end** is found from one past the start: on over the word, then over the blanks after it. It stops at a CR, or after a line feed. A start on a CR takes the line break with it.
  - [[measured]] A caret just after blanks counts as being in the word before them. A double click on the "f" of "four", with the caret before it, selects "two,three  ", not "four".
  - [[measured]] At the start of "  lead word", it skips the blanks and selects "lead ". With the caret just before "lead", it selects the two blanks.
- [[read out]] At the end of the text, with the caret at a line's start, the selection is nought to nought and the caret goes to the text's start. [[measured]] Double clicking a multi-line control's empty last line does that.
- [[read out]] `EM_SETWORDBREAKPROC` sets a program's own procedure in place of the routine, for either kind of control. It answers what it was given, and `EM_GETWORDBREAKPROC` answers it back (seg26 `0ee2`, `0ef0`).
  - [[read out]] The procedure is called with a far pointer to the text, the place, the length and a code (seg26 `0370`). Not looking back, `WB_ISDELIMITER` (2) asks whether the place is a delimiter. If it is, or the place is a CR, `WB_RIGHT` (1) asks for the next word's start; otherwise, as when looking back, `WB_LEFT` (0) asks for this word's start. The end is `WB_RIGHT` from one past the start.
  - [[measured]] Given a procedure that also takes commas as delimiters, a double click in "two" is called `WB_LEFT` at 5, then `WB_RIGHT` at 5, and selects "two," (4 to 8). At the text's start, it is called `WB_ISDELIMITER` at 0, `WB_LEFT` at 0 and `WB_RIGHT` at 1.
- [[read out]] `EM_GETRECT` copies the text's rectangle and answers 1 (seg26 `0e1c`).

## The selection

- [[read out]] A selected run is drawn in `COLOR_HIGHLIGHTTEXT` on `COLOR_HIGHLIGHT`, on a ground a pixel taller than the text rectangle each way, which the clip then trims (seg28 `0280`). [[measured]] On the VGA the selection is white text on dark blue.

## Notifications

- [[measured]] Each change sends the parent `EN_UPDATE`, then `EN_CHANGE`, as `WM_COMMAND` with the control's identifier, and the control's window and the code in `lParam`. Setting the text is a change; selecting is not.
- [[measured]] A character that would pass the limit `EM_LIMITTEXT` set changes nothing and sends `EN_MAXTEXT` alone.
- [[measured]] The focus arriving sends `EN_SETFOCUS`, and leaving sends `EN_KILLFOCUS`. The selection stays as it was.

## Modified

- [[read out]] Both kinds of edit control keep whether their text was changed since it was last set (`USER.EXE` seg26 `0e32`, `0e3e`):
  - `EM_GETMODIFY` answers 0 or 1.
  - `EM_SETMODIFY` sets the flag for any nonzero `wParam` and clears it for nought.
- [[read out]] Anything put in or taken out sets the flag (seg26 `05c4`, `0841`; seg28 `0719`; seg30 `0641`, `0943`). That covers typing, deleting, the clipboard, `EM_REPLACESEL` and undo, even an undo that brings the text back as it was. An insertion of nothing, or a deletion of an empty selection, leaves the flag as it was.
- [[read out]] Only setting the text clears the flag: `WM_SETTEXT`, and a multi-line control's `EM_SETHANDLE` (seg29 `00c0`, seg31 `00b6`, seg32 `01e1`). `WM_SETTEXT` goes through the same insertion and clears the flag afterwards. When the insertion fails for want of memory, the flag keeps what it had.
- [[inferred]] Notepad asks this to decide whether to offer to save.

## Not yet done

Multi-line edit controls are on a page of their own: [[topic:multi-line-edit-controls]].


Password characters, and `EM_REPLACESEL`, `EM_GETLINE` and the rest of the messages. Ctrl with Left and Right, which move by words through the same routine (seg28 `0d83`). Cut, copy and paste are on the clipboard's page: [[topic:clipboard]].

## The clipboard's keys

- [[read out]] Control and Insert copy, by `WM_COPY` sent to the control; Shift and Insert paste; Shift and Delete copy as Control and Insert does and take the selection out, or with nothing selected, delete as a backspace (`USER.EXE` seg28 `0a93`, `0c88`-`0d54`). The modifier is Control 1 and Shift 2, read with `GetKeyState` (`0aeb`-`0b15`); both held do nothing.
- [[read out]] The characters Control and C, V and X type are these three: C copies, V pastes, X cuts what is selected and beeps with nothing selected (seg28 `0959`-`0a1f`); Control and Z undoes. Other control characters beep. A multi-line control takes them alike (seg30 `1796`-`17ce`).
- Notepad's Edit menu names Control and V, which its accelerators take. In a dialog's field, which has no accelerators, only the control's own keys paste.
- Not yet done: `ES_READONLY`, which takes only the copy, and undo.

## EM_LINELENGTH

- [[measured]] [[probe:sllen]]: a single-line control answers its text's length whatever line `wParam` names, -1, 0, 3 or 100, and whatever is selected. File Manager's Copy box sizes the buffer it reads its From field into by it; answering nought, File Manager read the field four bytes long and looked for `C:\WINDOWS\CALC`.

## In winbox.js

- `src/win16/user/edit.ts` handles the messages.
- `Desktop.editLayout` and `#paintEdit` in `src/win16/user/desktop.ts` lay the control out and draw it.
- `src/win16/user/caret.ts` is the caret.
