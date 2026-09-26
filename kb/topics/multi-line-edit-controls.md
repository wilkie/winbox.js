---
kind: topic
name: Multi-line edit controls
summary: How Windows 3.1's multi-line edit control, Notepad's, breaks and wraps its lines, moves between them, scrolls, paints and answers about its lines — read out of USER.EXE and measured on four displays.
probes: [mledit]
---

[[measured]] [[probe:mledit]] makes two multi-line edit controls in the System font and records them on the VGA, Super VGA, EGA and Hercules:

- **Notepad's kind:** no border, scroll bars both ways, `ES_AUTOHSCROLL | ES_AUTOVSCROLL`, 200 by 80.
- **A wrapping control:** a border, `ES_AUTOVSCROLL`, nothing across, 120 by 60.

Through `SendMessage` it types into them, presses Enter, Backspace and the keys between lines, pages up and down, types past the right edge, selects across lines, and clicks. After each step it records the caret, the selection, the text, what the line messages answer, the scroll bars' positions and the notifications, and at several steps every pixel. The code is in `USER.EXE` segment 30, and what is below is read out of it. See [[topic:edit-controls]] for the single-line control, whose layout the two share in part.

## The text's rectangle

- [[read out]] The rectangle is the client area. With a border, it is inset by half the **System** font's average width across and a quarter of its height down; the single-line control uses the smaller of the two fonts' values instead (seg30 `1ff9`). The rectangle is cut to a whole number of lines, and a line that would only partly fit is not counted. [[measured]] On the VGA, Notepad's kind shows 3 lines of 16 in a client area 63 high, and the wrapping control 3 in its 60.
- [[measured]] The rows below the last whole line are never drawn.
- [[read out]] The caret is 2 pixels wide and exactly as tall as the font, a pixel shorter than the single-line control's (seg30 `1de5`). It stands at the rectangle's left, plus the width of what is before it on its line, less how far the text is scrolled across. It is parked out of sight when its line does not show.

## Lines

- [[read out]] A line runs to its CR LF (or CR CR LF), which is not counted in its length. A line of more than 1024 characters is split (seg30 `0b63`).
- [[read out]] A control that scrolls neither way across **wraps its words**. A line takes as many characters as fit, goes back to the start of the word that would not fit, and keeps one space after its last word; a word too long for any line is broken where the width ends.
  - [[measured]] "The quick brown fox jumps over the lazy dog again and again" wraps as "The quick brown ", "fox jumps over ", "the lazy dog " and "again and again". A 43-letter word is broken across four lines.
- [[read out]] Typing builds the lines again only from the caret's line, and stops as soon as a line starts where one did before. Enter builds from the caret's line to the end.
  - [[measured]] Enter at the start of a wrapped line leaves the line before it still broken where it was, so the new line break stands on a line of its own.
- [[read out]] After typing or deleting, a caret on the first character of a line that was wrapped rather than broken stays at the end of the line before (seg30 `0604`). [[measured]] Without that, typing a long word in the wrapping control scrolls a keystroke early.

## Keys

- [[read out]] Up and Down keep no column. They press the mouse a line above or below the caret's place and let go, so the caret goes where a click there would (seg30 `12ca`). [[measured]] Down from the end of "Hello" to "World" lands on "Wor|ld", index 11.
- [[read out]] Page Up and Page Down scroll a page, one line less than shows, and then press where the caret was. [[measured]] The caret stays on the same row.
- [[measured]] Home and End go to the line's ends. Left and Right step over a line break whole. Backspace at a line's start joins it to the line before.

## Scrolling

- [[read out]] Down, the text scrolls just enough to bring the caret's line to the last row that shows, or up to the first. Across, it scrolls only when the text is wider than its rectangle, by whole average characters to a third of the width in (seg30 `1e9b`).
- [[read out]] Each scroll tells the parent `EN_VSCROLL` or `EN_HSCROLL`, even when nothing moved. [[measured]] A change that scrolls sends `EN_UPDATE`, then the scroll, then `EN_CHANGE`.
- [[read out]] The control sets its own scroll bars' positions, as a percentage and rounded as `MulDiv` rounds:
  - **Down:** the first line that shows, over the line count less one.
  - **Across:** the scroll, over the widest line built.
  - [[measured]] Six lines scrolled of nine gives 75, and one gives 13.
- [[measured]] Setting the selection scrolls to the caret, which goes to the selection's second end.

## Messages

- [[measured]] The line count is 1 for an empty control, and one more after a final line break.
- [[read out]] `EM_LINEFROMCHAR` of −1 answers the selection's start. `EM_LINEINDEX` of −1 answers the caret's line, which differs at a wrapped line's start.
- [[read out]] `EM_LINELENGTH` of −1 answers the characters left unselected on the selection's first and last lines. [[measured]] A selection from 2 to 9 across "Hello" and "World" gives 5.
- [[measured]] `EM_GETLINE` copies a line without its line break, trailing spaces kept, and without a terminating zero.

## The text in the program's memory

- [[read out]] An edit control runs with DS set to the instance handle it was made with. What it allocates is therefore in that instance's local heap, a program's or a library's (`USER.EXE` seg1 `27a7`).
- [[read out]] At `WM_NCCREATE` it takes the following blocks (seg27 `0056`, `0114`):
  - its own data, 62h bytes;
  - for a multi-line control, a table of widths, 200h bytes;
  - the text, a moveable block of 20h noughts.

  A multi-line control's line starts follow at `WM_CREATE` (seg31 `010d`). Everything is freed at `WM_NCDESTROY`, the text by whichever handle the control has then (seg27 `01d6`).
- [[read out]] A dialog's edit control without `DS_LOCALEDIT` gets a heap of its own instead, in a 256-byte global block per dialog (seg24 `0337`).
- [[read out]] While typing, the text block grows to hold what is typed and 20h more. When more than 20h is spare after a deletion, it shrinks to the text and 10h (seg26 `05c4`, `0841`). The text is not kept ended with a nought.
- [[read out]] `EM_GETHANDLE` ends the text with a nought and answers the block's handle (seg30 `247c`). A single-line control answers 0.
- [[read out]] `EM_SETHANDLE` takes another block as the text (seg32 `018f`):
  - it reads the text up to its nought, and sizes the block to the text and 20h more;
  - it clears the modified flag and puts the caret and the view at the start;
  - it sends no notification, and does not free the old block.
- [[read out]] A multi-line control's `WM_SETTEXT` sends no notification either (seg31 `0067`). The single-line one sends `EN_UPDATE` and `EN_CHANGE`.
- [[measured]] Notepad reads a file this way. It asks for the handle when it starts, grows the block to the file's size, reads the file into it and hands it back. Without this, it called every file "too large for Notepad".

## The mouse

- [[read out]] The line comes from the height. Across, a binary search over the line's widths finds the character, half an average width back from each edge; the code's search is kept exactly, as a tie can land a character lower (seg30 `0366`). [[measured]] Clicks at four places land at 1, 2, 13 and 14.

## Not yet done

- Tab stops, which winbox.js does not expand yet.
- The clipboard and undo, `EM_FMTLINES`, and the limit on lines in a control that does not scroll down.
- Scrolling while dragging past an edge.
- Keeping the text in its block all the time. winbox.js writes it there when `EM_GETHANDLE` hands it out, and grows the block then, to the text and 20h, if it is too small. The line starts' block keeps its first size, and a dialog's edit control without `DS_LOCALEDIT` keeps no block.
- `EM_GETMODIFY` and `EM_SETMODIFY`.

## In winbox.js

- `src/win16/user/mledit.ts` handles the messages and builds the lines.
- `src/win16/user/edit-buffer.ts` keeps the control's blocks in the program's heap.
- `Desktop.linesLayout` and `#paintLines` in `src/win16/user/desktop.ts` lay the control out and draw it.
