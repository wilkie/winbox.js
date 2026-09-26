---
kind: topic
name: Multiple document interface
summary: How Windows 3.1's MDI works — the MDIClient window, WM_MDICREATE and the other client messages, the Window menu, tiling and cascading, DefFrameProc and DefMDIChildProc — read out of USER.EXE.
---

Program Manager and File Manager are MDI programs. Each has a frame window with a menu, an `MDIClient` window filling the frame's client area, and document windows inside that client. The code is USER's segment 15, and segment 20 for the Window menu. Nothing here is measured yet. The two programs opening as they do on Windows is the only check.

## The client

- [[read out]] `MDIClient` is USER's own class (seg3 `1595`). It has an application-workspace background and 10h bytes of window extra. It keeps:
  - its children and their number;
  - the active child and the maximized one;
  - the Window menu, and the first child's identifier, both from the `CLIENTCREATESTRUCT` its creation parameters point at (seg15 `10ff`).
- [[read out]] Scroll bars asked for in the client's style start hidden, and show only when the children reach past its edges.
- [[read out]] A press on a child that is not the active one activates it. The client learns of it through `WM_PARENTNOTIFY`.

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

## Not yet done

- The client's scroll bars (`CalcChildScroll`, `ScrollChildren`).
- A maximized child's system menu and restore button in the frame's menu bar, and the frame's title while a child is maximized.
- The "More Windows" dialog, and `WM_MENUCHAR`.
- Minimized children's icons, which belong at the bottom of the client, not the screen, and arranging them.

## In winbox.js

- `src/win16/user/mdi.ts` holds the class, its messages and the default procedures.
- `src/win16/user/placement.ts` holds `SetWindowPlacement`.
- `Desktop.maximize` fills a child's parent.
