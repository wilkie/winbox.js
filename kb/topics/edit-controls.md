---
kind: topic
name: Edit controls
summary: How Windows 3.1's single-line edit control lays out its text and caret, scrolls, selects and tells its parent — read out of USER.EXE and measured on four displays.
probes: [editctl]
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
- [[read out]] A double click selects the word the caret is in and the spaces and tabs after it. Not measured: whether the edit class asks for double clicks at all, which winbox.js does not yet give it.

## The selection

- [[read out]] A selected run is drawn in `COLOR_HIGHLIGHTTEXT` on `COLOR_HIGHLIGHT`, on a ground a pixel taller than the text rectangle each way, which the clip then trims (seg28 `0280`). [[measured]] On the VGA the selection is white text on dark blue.

## Notifications

- [[measured]] Each change sends the parent `EN_UPDATE`, then `EN_CHANGE`, as `WM_COMMAND` with the control's identifier, and the control's window and the code in `lParam`. Setting the text is a change; selecting is not.
- [[measured]] A character that would pass the limit `EM_LIMITTEXT` set changes nothing and sends `EN_MAXTEXT` alone.
- [[measured]] The focus arriving sends `EN_SETFOCUS`, and leaving sends `EN_KILLFOCUS`. The selection stays as it was.

## Not yet done

Multi-line edit controls are on a page of their own: [[topic:multi-line-edit-controls]].


The clipboard, password characters, and `EM_REPLACESEL`, `EM_GETLINE` and the rest of the messages.

## In winbox.js

- `src/win16/user/edit.ts` handles the messages.
- `Desktop.editLayout` and `#paintEdit` in `src/win16/user/desktop.ts` lay the control out and draw it.
- `src/win16/user/caret.ts` is the caret.
