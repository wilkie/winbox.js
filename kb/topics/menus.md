---
kind: topic
name: Menus
summary: How Windows 3.1 draws a menu open — the menu bar's selected item, a pull-down, a pop-up and the system menu — and how a menu runs, measured on four displays and replayed through the exports.
probes: [menus, minis, minis2, menuhelp, menuflag, iconclk]
---

A menu in Windows 3.1 is modal. While it is open, USER runs its own message loop, and the program gets control back only when the menu closes. [[measured]] [[probe:menus]] records five captures, each made from inside that loop by a timer the menu's loop dispatches to the window:

- the menu bar, nothing open;
- the File menu pulled down with its mnemonic;
- the same with Down pressed once;
- a pop-up from `TrackPopupMenu`;
- the system menu, opened with Alt+Space.

The File menu holds one of each kind of item: a shortcut after a tab, separators, a checked item, a grayed item and a pop-up. winbox.js reproduces every pixel of all five captures on the VGA, the Super VGA, the EGA and the Hercules, 1,200 records on each. The conformance suite replays the probe's own calls through the exports, timers and posted keys included.

## The menu bar and the system menu box

- [[measured]] While a menu is open from the bar, its item is filled with `COLOR_HIGHLIGHT`: the text's width and eight pixels either side, the bar's full height. Its text and underline are in `COLOR_HIGHLIGHTTEXT`.
- [[measured]] While the system menu is open, its box is drawn inverted, every bit of every pixel as `DSTINVERT` inverts it. On the EGA, the grey inverts to its own dark grey, `404040`.
- [[measured]] A pull-down opens at its bar item's left edge, its top border on the bar's bottom line. The system menu opens at the box's left edge, its top border on the caption's bottom line.

## Items at the right, and rows

[[measured]] [[probe:menuhelp]] gives windows from 300 down to 100 pixels wide a bar of File, Game, and a Help whose text starts with a backspace, as Tetris for Windows of the corpus does. It reads the bar back. winbox.js agrees with all 1,344 records.

- [[measured]] An item whose text starts with a backspace stands at the right of its row, with every item after it, and the backspace is not shown. Its text ends 4 pixels short of the bar's right edge, where the others have 8 after theirs.
- [[measured]] An item flagged `MF_HELP`, as Flak Attack of the corpus flags its Help, also stands at the right of its row. Its text ends 8 pixels short of the bar's right edge, as the other items' texts end 8 pixels short of their spaces: 4 pixels further in than a backspaced item's. [[probe:menuflag]] gives it the same windows as `menuhelp` does, a window 300 wide with a backspaced Help beside it, and a maximized window with each. winbox.js agrees with all 400 records.
- [[measured]] An item starts a new row under the last when, after it, fewer than 9 pixels of the bar would be left. Game ends 95 pixels in: it stays on the first row of a window 105 wide, and not of one 104 wide. A backspaced item that wraps stands at the right of its new row.
- [[measured]] Each row is 19 pixels, the bar's height and the line's, with no line between rows. The line is under the last row, and the client area starts below it.

## A pop-up

- [[measured]] A pop-up is `COLOR_MENU`, outlined in `COLOR_WINDOWFRAME`. It has a one-pixel shadow to its right and below, starting a pixel in from each corner, in `COLOR_GRAYTEXT`: light grey on the VGA, dark grey on the EGA, black on the Hercules. The two corners the shadow leaves out show what is beneath.
- [[measured]] An item is `tmHeight + 2` tall: 18 on the VGA, 14 on the EGA. A separator is `SM_CYMENU / 2 - 2`, 7 and 6, with its line across the middle, rounded down. The item height is not `SM_CYMENU`, which is 16 on the EGA.
- [[measured]] Each item leaves a column for the display driver's `OBM_CHECK` (14 pixels on every display). A checked item shows the bitmap there, centred on the item. The text starts one pixel after the column. Shortcuts, the text after a tab, start in a column of their own eight pixels after the longest text. A pop-up item shows `OBM_MNARROW` one pixel in from the right border, centred.
- [[measured]] A pop-up is as wide as its borders, the check column, the gap, the longest text, the shortcuts and their gap (when there are any), and fourteen pixels. That gives 153 for the File menu and 68 for the three-item pop-up on the VGA, and 167 for the system menu. On the EGA, whose System font is narrower in places, it gives 166 and 67.
- [[measured]] A selected item is filled with `COLOR_HIGHLIGHT`, its text in `COLOR_HIGHLIGHTTEXT`. A grayed item's text is `COLOR_GRAYTEXT`, except when it is selected, or when the display's `COLOR_GRAYTEXT` is 0 as on the Hercules. Then the text is drawn in the text's own colour through every other pixel, the pixels whose x and y add to an even number from the pop-up's corner, as `GrayString` draws it. [[documented]] A `COLOR_GRAYTEXT` of 0 means the display driver has no solid grey.
- [[measured]] Opened from the keyboard, a pull-down selects its first item. A pop-up put up by `TrackPopupMenu` with no mouse button down does the same.

## A menu running

- [[documented]] `DefWindowProc` opens a menu when the menu bar or the system menu box is pressed (`WM_NCLBUTTONDOWN`), and when `WM_SYSCOMMAND` carries `SC_KEYMENU`. That comes from Alt and a letter, Alt and Space, or Alt or F10 alone. It sends `WM_INITMENU`, then `WM_INITMENUPOPUP` for each pop-up before it is shown, and `WM_MENUSELECT` as the selection moves. When an item is chosen, it sends `WM_COMMAND` once the menu has closed, or `WM_SYSCOMMAND` for the system menu. [[measured]] Inside the menu's loop, the program's other messages are dispatched as its own loop would dispatch them: the probe's timer fires there.
- [[documented]] `WM_PAINT` and `WM_TIMER` are never queued. Each is made when a program asks for a message and nothing posted is waiting, paints first. That is why a key the probe posts after setting a timer still reaches the menu before the timer does.
- [[measured]] [[probe:iconclk]] opens an icon's system menu with the mouse. `WM_INITMENU` names a menu that is not the one [[fn:USER.GetSystemMenu]] answers. [[inferred]] It is the one that holds it. `WM_INITMENUPOPUP` names `GetSystemMenu`'s, with 0 for its place and 1 in the high word for a system menu. When nothing waits, the menu's window gets `WM_ENTERIDLE` with `MSGF_MENU`, 2. Answered by sending the window `WM_CANCELMODE`, which `DefWindowProc` takes, the menu ends and nothing is chosen. The icon clicked twice while its menu is open ends the menu with `SC_RESTORE`, and the button's release goes with it. winbox.js had sent neither `WM_ENTERIDLE` nor let `WM_CANCELMODE` end a menu.
- Not yet measured: how a menu is driven, beyond the keys the probe presses. The mouse, where a submenu opens, and how a menu that would leave the screen is moved are winbox.js's own. So are the other `TrackPopupMenu` alignments, menu bars that wrap, and owner-drawn and bitmap items.

## Asking about a menu, and taking it apart

[[measured]] [[probe:minis]] builds a menu of four items (a command, a separator, a pop-up of two commands, and a grayed command) and asks about it. winbox.js agrees with all 30 records.

- [[measured]] [[fn:USER.GetMenuItemCount]] answers 4, or -1 for a handle that is no menu.
- [[measured]] [[fn:USER.GetMenuItemID]] answers a command's identifier, 0 for a separator, and -1 (65535) for a pop-up or a position past the end.
- [[measured]] [[fn:USER.GetMenuState]] answers an item's flags. A separator also has `MF_DISABLED`: `MF_SEPARATOR | MF_DISABLED`, 2050. A pop-up answers its count of items in the high byte and its flags in the low byte: 528 for two items. An item that is not there answers -1.
- [[measured]] [[fn:USER.GetMenuString]] copies an item's text, `&` and all, cut to fit with its NUL, and answers how many characters it copied: `&Fi` into a buffer of 4. The buffer is emptied first, so a separator, or an item that is not there, leaves it empty and answers 0.
- [[measured]] [[fn:USER.RemoveMenu]] and [[fn:USER.DeleteMenu]] take an item out, by command in any pop-up or by position, and answer 0 for an item that is not there. `RemoveMenu` keeps a pop-up's menu to be used again. `DeleteMenu` destroys it, and its handle then names no menu.

## ChangeMenu

[[fn:USER.ChangeMenu]] is the older call that does the work of the others, chosen by its flags. [[read out]] USER (seg9 `01A8`) sends it on in this order:

- A null menu handle answers 0.
- `MF_SEPARATOR` with command 0, and no `MF_CHANGE`, is taken as `MF_APPEND`. A null string is taken as `MF_SEPARATOR`.
- `MF_REMOVE` calls [[fn:USER.RemoveMenu]], always **by position**: the flags lose `MF_REMOVE` and gain `MF_BYPOSITION`.
- `MF_DELETE` calls [[fn:USER.DeleteMenu]] with the flags less `MF_DELETE`.
- `MF_CHANGE` calls [[fn:USER.ModifyMenu]] with the flags masked to `4C7Fh`.
- `MF_APPEND` calls [[fn:USER.AppendMenu]] with the flags less `MF_APPEND`.
- Anything else calls [[fn:USER.InsertMenu]].

[[measured]] [[probe:minis2]] builds a menu with it and records the answer and the menu after each step. All 7 records agree with winbox.js.

- [[measured]] Appending `One` (101) and then `Two` (102) answers 1 each time. Inserting `Zero` (100) at command 101 puts it before `One`.
- [[measured]] Changing command 102 to `Deux` (202) replaces the item where it stands.
- [[measured]] Deleting position 1 takes out `One`.
- [[measured]] Removing command 202 answers 0 and leaves the menu as it was. The 202 is read as a position, and there is no item 202.
- [[measured]] Deleting a command that is not there answers 0.

Write builds its menus this way.

Media Player and Sound Recorder delete items from their menus, and Windows Help counts its menu bar's items to find its Help menu.

## Implementation

`AppendMenu.ts` has `AppendMenu`, `InsertMenu`, `ModifyMenu` and `ChangeMenu`. `menus.ts` lays out and paints a pop-up, and `frame.ts` paints the bar's selected item and the inverted box. `menu-loop.ts` is the modal loop, and `queue.ts` holds the order a program's messages come in, for `GetMessage`, `PeekMessage` and the menu alike. `test/raster/menus_test.ts` holds the drawing to the captures, and the conformance suite replays the probe.
