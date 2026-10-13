---
kind: topic
name: Menus
summary: How Windows 3.1 draws a menu open — the menu bar's selected item, a pull-down, a pop-up and the system menu — and how a menu runs, measured on four displays and replayed through the exports.
probes:
  [
    menus,
    minis,
    minis2,
    menuhelp,
    menuflag,
    iconclk,
    menubmp,
    altchild,
    menuenab,
    mdisys,
    titledbl,
    menuwnd,
    syschar,
  ]
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
- [[measured]] A grayed item on the bar is drawn in `COLOR_GRAYTEXT`, its underline too. Leapfrog of the corpus has its Undo, Up and Down grayed, and Windows' screen of it shows them grey. winbox.js drew them black, and its screen now matches Windows' pixel for pixel.
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
- [[measured]] Each item leaves a column for the display driver's `OBM_CHECK` (14 pixels on every display). A checked item shows the bitmap there, centred on the item. An item given bitmaps of its own by [[fn:USER.SetMenuItemBitmaps]] shows them there instead ([[probe:menubmp]]). The text starts one pixel after the column. Shortcuts, the text after a tab, start in a column of their own eight pixels after the longest text. A pop-up item shows `OBM_MNARROW` one pixel in from the right border, centred.
- [[measured]] A pop-up is as wide as its borders, the check column, the gap, the longest text, the shortcuts and their gap (when there are any), and fourteen pixels. That gives 153 for the File menu and 68 for the three-item pop-up on the VGA, and 167 for the system menu. On the EGA, whose System font is narrower in places, it gives 166 and 67.
- [[measured]] [[probe:menuwnd]]: a pop-up of Open and More, More a pop-up of its own, and no shortcuts, is 80 wide and its window 81 with the shadow, 15 more than its texts alone make. [[inferred]] A pop-up item's arrow, `OBM_MNARROW`, 7 wide on the VGA, takes a shortcut's room, its gap of 8 before it; the File menu above has shortcuts wider than the arrow. winbox.js had left it no room.
- [[measured]] A selected item is filled with `COLOR_HIGHLIGHT`, its text in `COLOR_HIGHLIGHTTEXT`. A grayed item's text is `COLOR_GRAYTEXT`, except when it is selected, or when the display's `COLOR_GRAYTEXT` is 0 as on the Hercules. Then the text is drawn in the text's own colour through every other pixel, the pixels whose x and y add to an even number from the pop-up's corner, as `GrayString` draws it. [[documented]] A `COLOR_GRAYTEXT` of 0 means the display driver has no solid grey.
- [[measured]] Opened from the keyboard, a pull-down selects its first item. A pop-up put up by `TrackPopupMenu` with no mouse button down does the same.

## A menu running

- [[documented]] `DefWindowProc` opens a menu when the menu bar or the system menu box is pressed (`WM_NCLBUTTONDOWN`), and when `WM_SYSCOMMAND` carries `SC_KEYMENU`. That comes from Alt and a letter, Alt and Space, or Alt or F10 alone. It sends `WM_INITMENU`, then `WM_INITMENUPOPUP` for each pop-up before it is shown, and `WM_MENUSELECT` as the selection moves. When an item is chosen, it sends `WM_COMMAND` once the menu has closed, or `WM_SYSCOMMAND` for the system menu. [[measured]] Inside the menu's loop, the program's other messages are dispatched as its own loop would dispatch them: the probe's timer fires there.
- [[documented]] `WM_PAINT` and `WM_TIMER` are never queued. Each is made when a program asks for a message and nothing posted is waiting, paints first. That is why a key the probe posts after setting a timer still reaches the menu before the timer does.
- [[measured]] [[probe:iconclk]] opens an icon's system menu with the mouse. `WM_INITMENU` names a menu that is not the one [[fn:USER.GetSystemMenu]] answers. [[inferred]] It is the one that holds it. `WM_INITMENUPOPUP` names `GetSystemMenu`'s, with 0 for its place and 1 in the high word for a system menu. When nothing waits, the menu's window gets `WM_ENTERIDLE` with `MSGF_MENU`, 2. Answered by sending the window `WM_CANCELMODE`, which `DefWindowProc` takes, the menu ends and nothing is chosen. The icon clicked twice while its menu is open ends the menu with `SC_RESTORE`, and the button's release goes with it. winbox.js had sent neither `WM_ENTERIDLE` nor let `WM_CANCELMODE` end a menu.
- [[measured]] [[probe:titledbl]] minimizes a window at the foot of the screen and presses its icon's title once: the icon's system menu comes up above the icon, from `(22, 266)` to `(190, 409)` for an icon at `(21, 408)` -- a pixel in from the icon's corner, put above that point as it does not fit below. winbox.js had put it from the icon's corner, moved up only as far as the screen's foot, over the title.
- [[measured]] [[probe:titledbl]]: **a press off the menu**. The title pressed twice, all four of the mouse's events put in at once: the first press brings the system menu up; the second, on the title, off the menu, ends it, and is then a double click on the title, `WM_NCLBUTTONDBLCLK` passed on to the window, which is restored. The icon itself pressed twice is restored by the menu, `SC_RESTORE`. [[read out]] The menu's loop looks at a press without taking it (seg10 `1eab`-`1ed2`); one that ends the menu is left in the queue (`1d2b`-`1d3d`), for the window it lands on to take, and to make a double click with the press before. winbox.js took it, and the window stayed an icon. It now leaves a press that ends the menu off the menu and off its own window; how USER treats one on its own window -- its caption, its system menu's box -- is not read out, and winbox.js takes that as before. `FindWindow` named no menu's window here, so the menu's rectangle was the one record of the probe neither engine agreed with; a menu's pop-ups are windows now ([[probe:menuwnd]], below), and both engines agree with all 11.
- [[measured]] [[probe:altchild]] drives a menu bar of two pop-ups, and the system menu, from the keyboard, and records each `WM_MENUSELECT`. [[read out]] USER sends it from seg10 `0000`: the item's flags as it has them, masked with `5FFFh`, with `MF_SYSMENU` (2000h) added while the system menu is tracked, and the menu the item is in in the high word. As the menu ends, the flags are FFFFh and the rest nought.
  - [[measured]] Alt and F: File selected on the bar first, `MF_POPUP | MF_HILITE` (90h), then `WM_INITMENUPOPUP` for it, then its first item selected, 80h. Escape closes the pull-down and selects File on the bar again, 90h; a second Escape ends the menu.
  - [[measured]] Alt alone, or F10 alone: File selected on the bar, 90h, nothing open. F then opens it, with no second `WM_MENUSELECT` for File. One Escape ends a menu with nothing open.
  - [[measured]] Alt and Space: the system menu selected as the item of the menu `WM_INITMENU` named, 2090h, under a handle that is not the one `GetSystemMenu` answers. Then `WM_INITMENUPOPUP` for `GetSystemMenu`'s, and its first item, Restore, 2080h. Escape closes the pop-up and leaves the menu running: `WM_MENUSELECT` names `GetSystemMenu`'s menu, `MF_SYSMENU | MF_POPUP` (2010h), not highlighted. A second Escape ends it. winbox.js had ended it on the first, and the second Escape had gone to the window.
  - [[read out]] Why the handle is not `GetSystemMenu`'s, and why Restore read as not grayed: a window that has never been asked for its system menu shows the one USER keeps for every such window (seg9 `0d6a`). [[fn:USER.GetSystemMenu]] gives the window one of its own, loaded afresh from USER's menu resource with nothing grayed, and a menu of that window's already open goes on with the new one (seg9 `0f00`-`0f41`). The probe first asks for it in the middle of the menu, so the `WM_MENUSELECT` before names the shared one, the `WM_INITMENUPOPUP` after names the window's own, and the highlight, kept in the old holder's item, is gone after Escape: 2010h, not 2090h.
- [[read out]] **The system menu brought up to the window's state** (seg9 `0d8b`), as a menu of the window starts and as an MDI document window is sized: Restore grayed unless the window is minimized or maximized; Minimize grayed without its box or minimized; Maximize without its box or maximized; Size without a thick frame, minimized or maximized; Move only when maximized and a child, or as large as the screen. A window with a dialog frame and no border, or `WS_EX_DLGMODALFRAME`, has only Move brought up; the shared menu has Close and Switch To enabled too. [[measured]] [[probe:menuenab]]: Restore of a window that shows, its menu never opened, is not grayed.
- [[measured]] [[probe:mdisys]], a frame with a bar, its system menu opened by Alt and Space: `WM_INITMENU` names the bar, not the holder. A window's menu is its bar unless it is a child or an icon, or it has no bar (seg17 `01b1`-`01ec`); only then is it the holder. The system item's `WM_MENUSELECT` names the pop-up the window shows; an icon's system menu opens without it.
- [[measured]] [[probe:mdisys]]: **the mouse**. A press on the bar or the system menu box is `WM_SYSCOMMAND` with `SC_MOUSEMENU` and the hit, `F093h` or `F095h`, the point in lParam (seg1 `04ab`). Every `WM_MENUSELECT` of a menu the mouse started has `MF_MOUSESELECT` (8000h; seg10 `0029`). Let go where it was pressed, the pop-up it opened selects its first item; let go on a bar item that opens nothing, that item is chosen. A move to where the mouse already was selects nothing.
- [[measured]] [[probe:mdisys]]: **a letter no item has**. The window is asked with `WM_MENUCHAR`: the character, `MF_SYSMENU` in lParam when its menu is the holder, `MF_POPUP` for `TrackPopupMenu`'s, and the menu. Its answer's high word: 1 closes the menu at once, `WM_MENUSELECT`'s end told twice; 2 carries out the item the low word names; 3 selects it; nought beeps (seg10 `053f`-`0591`).
- [[read out]] **Into the loop and out of it**, the menu's window is sent `WM_ENTERMENULOOP` as the menu starts, before the mouse is taken (`USER.EXE` seg17 `0161`; `TrackPopupMenu`'s seg9 `0bf7`), and `WM_EXITMENULOOP` as it ends, after the capture is let go and before the command chosen (seg10 `119c`; seg9 `0d53`): `wParam` 1 for `TrackPopupMenu`'s menu, nought for a window's own. [[measured]] [[probe:syschar]]: Alt and a letter sends `SC_KEYMENU`, then `WM_ENTERMENULOOP` with nought before `WM_INITMENU`, and `WM_EXITMENULOOP` with nought after the last `WM_MENUSELECT`; a pop-up tracked, the same with 1, `WM_INITMENUPOPUP` and the item's `WM_MENUSELECT` between. Neither engine had sent them.
- [[read out]] [[measured]] **The command chosen** is posted, `WM_COMMAND` from the bar and `WM_SYSCOMMAND` from the system menu; only `TrackPopupMenu`'s is sent (seg10 `11b0`-`11f4`; [[probe:mdisys]]: the frame takes `WM_COMMAND` from its queue).
- How a pull-down that would leave the screen is moved is winbox.js's own. So are the other `TrackPopupMenu` alignments, menu bars that wrap, and owner-drawn and bitmap items other than USER's own.

## A menu's windows

A pop-up shows in a window, of USER's own class `#32768`, which a program can find while the menu is up: [[fn:USER.FindWindow]], [[fn:USER.EnumWindows]], [[fn:USER.WindowFromPoint]] and [[fn:USER.GetWindowRect]] see it.

- [[read out]] **USER's own.** As it starts, USER makes one hidden `#32768`, a pop-up 100 by 100 at the screen's corner with no owner, and keeps it (`USER.EXE` seg3 `1a79`-`1aa4`, at 1C8h; [[topic:enumerating-windows]]). The first pop-up of the menu bar or the system menu is shown in it, where it is not showing already (seg10 `09b7`-`09f0`): its owner made the menu's window, its queue the window's, and it made topmost and put in front of every window with [[fn:USER.SetWindowPos]] and `HWND_TOPMOST`, `SWP_NOSIZE | SWP_NOMOVE | SWP_NOREDRAW | SWP_NOACTIVATE` and 200h. As the pop-up closes it is hidden with [[fn:USER.ShowWindow]] and owned by nothing (`0dd9`-`0e15`), and stays where it is: in front, topmost.
- [[read out]] **Every other pop-up** -- one opened from another, and `TrackPopupMenu`'s -- is shown in a window made for it, `CreateWindowEx` with `WS_EX_TOPMOST`, `#32768`, `WS_POPUP`, 100 by 100 at the corner, its parent the menu's window (seg10 `0a14`-`0a44`); `TrackPopupMenu`'s with no parent and so no owner (seg9 `0b59`-`0b86`). It is destroyed as it closes (seg10 `0e1c`). Each is moved to its place, topmost and in front, with `SWP_NOSIZE | SWP_NOACTIVATE` and 200h (`0d5d`-`0d6f`).
- [[read out]] **Where one opened from another goes** (seg10 `0b70`-`0c15`): its left edge `OBM_MNARROW`'s width in from the right end of the item it opens from, its top a border above that item's. Where it would run off the screen's right -- two borders and its width past its left -- it goes left of the pop-up it opens from, its right edge at that one's left, and so does each opened from it where there is room. Where it would run off the foot, it ends where the item starts, or at the foot where that is off the top. Never left of the screen or above it.
- [[read out]] **`WM_ENTERIDLE`** names in its `lParam` the window of the pop-up open last (seg10 `1ff8`-`2008`, `0da6`). [[measured]] For `TrackPopupMenu`'s own it is nought.
- [[measured]] [[probe:menuwnd]] writes, at moments of a run, `FindWindow("#32768", NULL)` and every window of the class `EnumWindows` gives, with its place among all of them, its rectangle, whether it shows, its owner, its styles, and whether `WindowFromPoint` at its middle names it:
  - Before any menu, USER's own at the fourth place, behind `#32771`, the probe's window and `#42`: hidden, `84000000h`, no extended style.
  - File open from the bar: in front of all, at File's place, (44, 81) to (125, 120), shown, owned by the menu's window, `94000000h` and `WS_EX_TOPMOST`; `FindWindow` names it, and so does `WindowFromPoint`, and so did `WM_ENTERIDLE`.
  - More open from File: a second window in front of it, (116, 99) to (173, 120), owned and topmost too; `FindWindow` names the new one.
  - After: More's window is gone, and USER's own is hidden, owned by nothing, still topmost and in front, at File's place.
  - `TrackPopupMenu`'s at (100, 100): a window of its own in front, owned by nothing.

winbox.js agrees with all 6 records in both engines. Before, a pop-up was a window of the desktop's own with no handle, and `FindWindow` named USER's hidden `#32768` where the program made it, at the corner.

- Not yet done: the messages USER sends its own window and the ones it makes -- made, moved, shown and hidden, and its private ones, 403h, 405h, 4C9h and 4CBh among them (seg10 `0a54`-`0aaa`, `0dc8`, `0df2`) -- which a program sees only through a hook; and the shell hook told of `TrackPopupMenu`'s window, which has no owner (seg8 `08a0`-`08b5`).

## Asking about a menu, and taking it apart

[[measured]] [[probe:minis]] builds a menu of four items (a command, a separator, a pop-up of two commands, and a grayed command) and asks about it. winbox.js agrees with all 30 records.

- [[measured]] [[fn:USER.GetMenuItemCount]] answers 4, or -1 for a handle that is no menu.
- [[measured]] [[fn:USER.GetMenuItemID]] answers a command's identifier, 0 for a separator, and -1 (65535) for a pop-up or a position past the end.
- [[measured]] [[fn:USER.GetMenuState]] answers an item's flags. A separator also has `MF_DISABLED`: `MF_SEPARATOR | MF_DISABLED`, 2050. A pop-up answers its count of items in the high byte and its flags in the low byte: 528 for two items. An item that is not there answers -1.
- [[measured]] [[fn:USER.GetMenuString]] copies an item's text, `&` and all, cut to fit with its NUL, and answers how many characters it copied: `&Fi` into a buffer of 4. The buffer is emptied first, so a separator, or an item that is not there, leaves it empty and answers 0.
- [[measured]] [[fn:USER.RemoveMenu]] and [[fn:USER.DeleteMenu]] take an item out, by command in any pop-up or by position, and answer 0 for an item that is not there. `RemoveMenu` keeps a pop-up's menu to be used again. `DeleteMenu` destroys it, and its handle then names no menu.

## Finding an item

- [[read out]] By command, USER walks a menu's items from the last to the first, searching a pop-up's own menu where the pop-up is and never taking its handle for a command. A separator's command is nought, and it is found; -1 is no command (seg10 `009c`).
- [[measured]] [[probe:menuenab]]: [[fn:USER.EnableMenuItem]], [[fn:USER.CheckMenuItem]] and [[fn:USER.GetMenuState]] answer -1 for an item that is not there, by command or past the end by position, and for no menu. 101 in a pop-up after an item 101 of its own menu is the pop-up's. `EnableMenuItem` of nought grays the separator, which answers `MF_DISABLED`: a separator is kept disabled, as `GetMenuState` shows it, until enabled. By position, a pop-up's item is grayed in place. The seven commands Windows Help grays as it opens a file are not in its menu, and answer -1 in Windows too.

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
