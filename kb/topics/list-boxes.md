---
kind: topic
name: List boxes
summary: How Windows 3.1's list box sizes itself, sorts and finds its items, draws and moves its selection and focus, scrolls, and talks to an owner that draws its items — read out of USER.EXE and measured on four displays.
probes: [listbox, filedlg]
---

[[measured]] [[probe:listbox]] makes three list boxes in the System font and records them on the VGA, Super VGA, EGA and Hercules:

- a sorted one that notifies, with a border and a vertical scroll bar, given more items than it shows;
- one with `LBS_MULTIPLESEL`;
- an owner-drawn one of fixed heights that keeps its strings, as `COMMDLG.DLL`'s file lists are.

Through `SendMessage` it fills them, searches them, selects, keys, clicks and scrolls them. After each step it records what the messages answered, the state, the notifications and what the owner was asked to draw, and at several steps every pixel. The code is `USER.EXE` segment 35, with segment 38 for making one and segment 43 for its items and scroll bar. winbox.js agrees with every record except one field, below.

## Size

- [[read out]] A list box moves itself out by a border each way as it is made, border or not, so a `WS_BORDER` frame lies outside the rectangle asked for (seg38 `02d5`).
- [[read out]] Then, unless `LBS_NOINTEGRALHEIGHT`, it makes itself a whole number of rows high (seg38 `0457`). [[measured]] The sorted box asked for 84 pixels shows 5 rows of 16 on the VGA and 7 of 12 on the EGA.
- A list box moved to another height is made a whole number of rows high again. Cribbage moves its list to 46 pixels, and Windows' screen shows it 34, two rows of 16 and its borders. winbox.js had kept the 46.
- [[read out]] A row is the font's height. An owner-drawn list box of fixed heights asks its parent with `WM_MEASUREITEM` when it is made, offering the font's height.
- [[measured]] That message's item number is never set, and carries what was left on the stack: 2567 on the VGA, 2287 on the others. It is the one field winbox.js does not reproduce.

## Items

- [[read out]] A sorted list box puts a string by a binary search, with names in brackets after all others and the rest compared by `lstrcmpi`. [[measured]] Fourteen fruit added in no order answer where each went: 0, 0, 1, 1, 2, 4, 5, 6, 7, 8, 9, 11, 3, 8.
- [[read out]] `LB_FINDSTRING` searches from after the item given, wrapping, for a prefix without regard to case. A search not itself starting with `[` passes over an item's leading `[` or `[-`, which `LB_DIR` gives directories and drives. `LB_FINDSTRINGEXACT` wants the whole string.
- [[read out]] `LB_DELETESTRING` answers the count left. `LB_RESETCONTENT` hides the scroll bar without moving its thumb.

## Drawing

- [[read out]] Each row's text is two pixels in. A selected row is filled in the highlight colour, its text in the highlight text colour. Painting draws an unselected item's text on its own cell over what the erase left; redrawing one item as its selection changes fills its whole row first (seg35 `069a`, `1096`).
- [[read out]] Scrolling moves what shows by whole rows, as `ScrollWindow` does, and draws only the rows it uncovers (seg35 `16f9`).
- [[measured]] While the list box has the focus, a dotted rectangle is inverted over the caret's row, even with nothing selected. Its pixels are those whose client coordinates add to an odd number. A corner, on two sides, is inverted twice and shows unchanged.
- [[read out]] `LB_SETSEL`, and adding or deleting items, only invalidate; the list is drawn when it is next painted. Keys, the mouse and `LB_SETCURSEL` draw at once.

## Keys, the mouse, scrolling

- [[measured]] Down, Page Down and End move the selection and scroll just enough to show it. A typed character finds the next item it begins, after the caret. A click selects the row under it.
- [[read out]] A page is a row less than show. The first arrow pressed with nothing selected selects the caret's item.
- [[read out]] The scroll bar shows while the list is scrolled or does not fit. Its position is the top over the furthest the top can go, as a percentage rounded as `MulDiv` rounds, in the window's range of 0 to 100. [[measured]] Tops of 5, 6, 9 and 3 of 14 items with 5 showing give 56, 67, 100 and 33.

## Notifications

- [[measured]] With `LBS_NOTIFY`, keys, typing and a click send `LBN_SELCHANGE`, and `LB_SETCURSEL` sends nothing. The focus arriving sends `LBN_SETFOCUS` and leaving sends `LBN_KILLFOCUS`, with or without `LBS_NOTIFY`.
- [[read out]] A press takes the focus for the list box itself, as it is taken, when it does not have it: `WM_KILLFOCUS` to the window that had it, then `WM_SETFOCUS` to the list (`USER.EXE` seg35 `133d`-`1353`). The class is registered with `CS_DBLCLKS` ([[topic:window-classes]]), so the second press of a double click comes as `WM_LBUTTONDBLCLK`, which is followed as a press let go at once (`13fc`). Let go, a double click is told as `LBN_DBLCLK`; to a list whose window lacks a mark of its state, bit 4 of byte 26h, `LBN_SELCHANGE` comes first (`16a2`-`16c6`). winbox.js takes the mark to be the one for a module made for Windows 3.10, which the recording agrees with but does not prove.
- [[measured]] [[probe:filedlg]] presses `COMMDLG.DLL`'s Open dialog with `MOUSE_EVENT`. A click on the directories, the file name's edit having the focus, sends `EN_KILLFOCUS`, `LBN_SETFOCUS` and `LBN_SELCHANGE`. A double click on a directory sends `LBN_SELCHANGE` twice and then `LBN_DBLCLK`: COMMDLG.DLL is made for Windows 3.00. The dialog then goes into the directory. Both engines agree with all 17 records.

## Owner-drawn

- [[read out]] An owner-drawn list box draws nothing of its items. It asks its parent with `WM_DRAWITEM`: `ODA_DRAWENTIRE` for each row when painted, `ODA_SELECT` as a selection changes, and `ODA_FOCUS` for the focus rectangle. The parent's `DefWindowProc` draws the focus rectangle if the parent does not.
- [[measured]] Moving the selection down one row asks, in order:
  1. focus off the old item;
  2. focus on the new;
  3. focus off it again;
  4. the old item unselected;
  5. the new item selected;
  6. focus on the new.

## Errors

- [[measured]] [[probe:lberr]]: a message that fails answers `LB_ERR`, or `CB_ERR` for a combo box, as −1 in all 32 bits, FFFFFFFFh. That covers an index out of range, no selection, and a string not found. Every answer is a signed word widened to a long; item data is a long of its own.
- [[measured]] File Manager walks a list with `LB_GETTEXT` until the answer is −1 as a long. winbox.js answered FFFFh before, and File Manager never stopped.
- [[read out]] An owner-drawn list without `LBS_HASSTRINGS` keeps no strings: `LB_GETTEXT` copies the item's data into the buffer, all four bytes, and it and `LB_GETTEXTLEN` answer 4 (`USER.EXE` seg43 `0234`). File Manager's directory list is one; its items are offsets into a block of its own, which it reads back this way. winbox.js copied nothing, and File Manager read an offset left in its buffer -- unnoticed until blocks were given their real limits ([[topic:global-and-local-memory]]).

## Not yet done

- `LBS_EXTENDEDSEL` with Shift and Ctrl.
- Owner-drawn items of variable height, multiple columns and tab stops.
- `LB_DIR`, and scrolling while dragging past an edge.

## In winbox.js

- `src/win16/user/listbox.ts` handles the messages.
- `control-classes.ts` gives it the desktop and its owner.
- `Desktop.listText`, `listFocus` and `listErase` draw it.
