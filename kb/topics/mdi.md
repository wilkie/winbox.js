---
kind: topic
name: Multiple document interface
summary: How Windows 3.1's MDI works — the MDIClient window, WM_MDICREATE and the other client messages, the Window menu, tiling and cascading, the client's scroll bars, DefFrameProc and DefMDIChildProc — read out of USER.EXE, and the scroll bars measured.
probes: [mdiscrl, mdisys]
---

Program Manager and File Manager are MDI programs. Each has a frame window with a menu, an `MDIClient` window filling the frame's client area, and document windows inside that client. The code is USER's segment 15, and segment 20 for the Window menu. Only the client's scroll bars are measured. For the rest, the two programs opening as they do on Windows is the only check.

## The client

- [[read out]] `MDIClient` is USER's own class (seg3 `1595`). It has an application-workspace background and 10h bytes of window extra. It keeps:
  - its children and their number;
  - the active child and the maximized one;
  - the Window menu, and the first child's identifier, both from the `CLIENTCREATESTRUCT` its creation parameters point at (seg15 `10ff`).
- [[read out]] Scroll bars asked for in the client's style start hidden, and show only when the children reach past its edges.
- [[read out]] A press on a child that is not the active one activates it. The client learns of it through `WM_PARENTNOTIFY`, which USER sends up from the window pressed to each window it is in ([[topic:hit-testing]]).

## The client's scroll bars

[[measured]] [[probe:mdiscrl]] moves a document window inside its client and past each of the client's edges. It scrolls the client with its own `WM_HSCROLL` and `WM_VSCROLL`, and with `ScrollChildren` called directly, then minimizes and maximizes the child. After each step it records the client's scroll bars, their ranges and positions, and the child's place: first as the step left them, then after [[fn:USER.CalcChildScroll]]. [[read out]] The code is seg15 `0276` and `053f`. winbox.js agrees with all 40 records.

- [[measured]] A bar shows only when a child reaches past that edge of the client, and goes again when none does.
- [[measured]] Ranges and positions are the screen's coordinates. A bar's position is the client's own left or top on the screen: 24 and 43 for the probe's client. Its range runs from where the children and the client together start, to where they end less the client's width or height.
- [[read out]] `CalcChildScroll` works on the client as if the bars it is asked about were not there, and walks its visible children:
  - a maximized child means no scrolling at all;
  - every other child's window counts towards what the children cover, icons and their titles too;
  - only a window of its own reaching past the client, not an icon's title, makes scrolling needed.
  If scrolling is needed, the range is worked out again with a bar added each time one becomes needed, until nothing changes. If a bar comes or goes, the frame is changed as `ShowScrollBar` changes it ([[topic:scroll-bars]]).
- [[measured]] The client recalculates by itself: every record taken before calling `CalcChildScroll` already agrees with the one taken after. [[read out]] It posts a message of its own, 10ACh, when a child moves or is sized, when it is sized itself, and when a child is destroyed or the icons arranged. It does not post while it is scrolling, or for a maximized child. A client made with only a horizontal bar never recalculates this way.
- [[measured]] A minimized child is an icon, whose window lies inside the client, so the bars go. A maximized child takes them away too.
- [[measured]] [[fn:USER.ScrollChildren]] moves a line of `SM_CXSIZE` or `SM_CYSIZE`, or a page of half the client, to a thumb position, or to either end. The new position is kept to the range. The distance moved is always a multiple of 8. A part of 8 is rounded up going forward, and going back it moves a whole 8 further: one line right from 24 is 18 pixels, rounded to 32, so the child moves from 330 to 298 and the position goes to 56. `SB_ENDSCROLL` recalculates the bar, and `SB_THUMBTRACK` does nothing.
- [[read out]] Tiling and cascading hide both bars and post nothing, so the bars stay hidden until something else asks.

## Children

- [[read out]] **`WM_MDICREATE`** reads an `MDICREATESTRUCT` and makes the child (seg15 `0ddb`):
  - The child's identifier is the first plus the number of children.
  - Its creation parameters point at the structure.
  - Whatever the style asked for, the child is a visible child window with a caption, a system menu, a sizing frame and both boxes. Only its own minimize, maximize, disabled, clip-children and scroll-bar bits are kept.
- [[read out]] A size or place left to the default takes the next step of a cascade (seg15 `0746`). Each step is a frame and a size box further down and in, and there are as many steps as fit a third of the client's height.
- [[read out]] **`WM_MDIDESTROY`** closes up the identifiers after the child, activates the next child, and destroys the child.
- [[read out]] **Activation** (seg15 `0b01`):
  - The old child is told first, with `WM_MDIACTIVATE`, and its item in the Window menu is unchecked.
  - The new child comes to the top of its siblings. Its caption is drawn active only while the frame is active.
  - The focus goes to the client, which hands it to the new child.
  - Finally the new child is told, with `WM_MDIACTIVATE`.
- [[read out]] **The client's other messages:**
  - `WM_MDINEXT` goes to the next child that is enabled and shows, or the previous one.
  - `WM_MDIGETACTIVE` answers the active child, with 1 in the high word if it is maximized.
  - `WM_MDIRESTORE` and `WM_MDIMAXIMIZE` show the child as they say.
- [[read out]] **A maximized child** fills the client's area, with its frame and caption just outside, where they do not show (seg15 `16ef`).

## Tiling and cascading

- [[read out]] **Cascading** takes the bottom child first, each child a step further (seg15 `0875`). A child without a sizing frame keeps its size.
- [[read out]] **Tiling** (seg15 `0956`):
  - `b` is the least number from 2 up whose square is more than the number of children.
  - There are `b − 1` rows, or `b − 1` columns with `MDITILE_HORIZONTAL`.
  - The last columns take one more row each, until every child is placed.
- [[read out]] Neither tiling nor cascading moves a minimized or maximized child, or one another window owns.

## The Window menu

- [[read out]] `WM_MDISETMENU` sets the frame's menu and the Window menu, and writes the list of children into the Window menu again (seg20 `02f9`):
  - after a separator, "&1 Title" and on, the active child checked;
  - "&More Windows..." after nine;
  - the old list taken out first, from the Window menu's last separator.

## DefFrameProc and DefMDIChildProc

- [[read out]] **`DefFrameProc`** (seg15 `147c`):
  - keeps the client the size of the frame's client area;
  - hands the focus to the client;
  - activates the child a Window-menu command names, restoring it if it is minimized;
  - passes a maximized child the frame's system commands.
- [[read out]] **`DefMDIChildProc`** (seg15 `187a`):
  - closes the child through the client;
  - activates it as it is focused or `WM_CHILDACTIVATE` arrives;
  - answers `WM_GETMINMAXINFO` with the client's area;
  - moves to the next or previous child for `SC_NEXTWINDOW` and `SC_PREVWINDOW`;
  - keeps track of which child is maximized.
- [[read out]] **`TranslateMDISysAccel`** (seg15 `01d1`): Ctrl+F4 closes the active child. Ctrl+F6 or Ctrl+Tab goes to the next child, and with Shift to the one before.

## What they needed besides

- [[measured]] Program Manager, to open:
  - `SetWindowPlacement`, which places each group from `PROGMAN.INI`;
  - `_lopen`, to read the group files;
  - a moveable global block reallocated to nought being discarded, so that its lock answers NULL and the group is read in;
  - `RectVisible`, before it draws each item;
  - a child shown when its parent is shown late: Program Manager shows the MDI client only after making its groups.
- [[measured]] File Manager, to open:
  - the registration database;
  - the disk transfer area that each task starts with ([[topic:directory-lists]]);
  - `wsprintf`'s `%c`;
  - list boxes answering −1 in all 32 bits ([[topic:list-boxes]]);
  - the network, drive and disk calls ([[topic:drives-and-disks]]).

## A document window's icon

- [[read out]] An icon let go where it was pressed is sent `WM_SYSCOMMAND` with `SC_KEYMENU`: a top-level window's with a space, as Alt and Space would open its system menu, a child's with a hyphen, as Alt and the hyphen would (`USER.EXE` seg6 `1369`-`1391`). winbox.js sent a space for both, and a group's icon in Program Manager opened Program Manager's own system menu, which took the second click of a double click: the group was not restored.

## A document window's system menu

[[measured]] [[probe:mdisys]] opens two document windows' system menus by Alt and the hyphen, by a click on the box and on the icon, from the frame with the focus on it, and maximized from the frame's bar, and logs what the frame and the windows are told. winbox.js agrees with all 150 records, the screen's among them.

- [[read out]] A document window is given a system menu of its own as the client makes it: USER's menu resource 2, with Minimize grayed as it comes, Close with Ctrl+F4 and Next with Ctrl+F6 (seg15 `0e48`, `0f62`). Its holder's item is a hyphen. The client, made, gives the frame one of its own too (seg15 `1169`).
- [[read out]] [[measured]] Alt and the hyphen in a document window: `SC_KEYMENU` with the hyphen to the window itself, whose menu is its system menu, a child having one (seg17 `00fe`). A hyphen in a child opens it (seg19 `0544`). Alt and a letter there: `WM_MENUCHAR` to the window, which `DefMDIChildProc` answers by posting the letter's `SC_KEYMENU` to the frame and closing (seg15 `1a04`), so the frame's menu opens.
- [[read out]] [[measured]] The hyphen in the frame's own menu: no item has it, and `DefFrameProc` answers `WM_MENUCHAR` by posting `SC_KEYMENU` with the hyphen to the active child, or, with a child maximized, by carrying out the bar's first item (seg15 `1642`-`167f`).
- [[measured]] The box clicked: `SC_MOUSEMENU` with `HTSYSMENU`, the menu opened with its first item selected as the button is let go ([[topic:menus]]). The icon clicked: `SC_MOVE`, then `SC_KEYMENU` with the hyphen.
- [[read out]] [[measured]] Maximized, the child's system menu goes first in the frame's bar, a pop-up showing the right half of the display driver's `OBM_CLOSE` and a line, and its restore box last, `MF_HELP`, `SC_RESTORE`, showing `OBM_RESTORE`. The child loses `WS_SYSMENU` meanwhile, so its keys reach the frame's menu. Restored, or another maximized, they come out again (seg20 `00fe`, `0176`). Chosen from the bar, a command reaches the frame as `WM_COMMAND`, which `DefFrameProc` hands the child as `WM_SYSCOMMAND`.
- [[read out]] [[measured]] The frame's title is its own and the maximized child's after it: "F - [B]" (seg15 `0000`). `DefFrameProc` keeps a new `WM_SETTEXT` as the frame's own.
- [[measured]] A document window's caption box is the right half of `OBM_CLOSE`, the shorter bar. winbox.js had drawn the left half, the frame's.
- [[measured]] A child made active while the client has the focus, as after an icon, is given the focus.

## Not yet done

- `ScrollWindow` in general. The client's is its children moved and the client painted again, not its pixels moved.
- `WM_MDISETMENU` with a child maximized: USER puts its items in the new bar (seg20 `0252`).
- The arrows from a document window's system menu to the frame's bar, `WM_NEXTMENU` (seg15 `1681`, `1a28`).
- The "More Windows" dialog.
- Arranging minimized children's icons (`WM_MDIICONARRANGE`, `ArrangeIconicWindows`). A child is minimized into the first free slot at the bottom of the client, as a top-level window is on the screen ([[topic:window-states]]).

## In winbox.js

- `src/win16/user/mdi.ts` holds the class, its messages and the default procedures.
- `src/win16/user/placement.ts` holds `SetWindowPlacement`.
- `Desktop.maximize` fills a child's parent.
