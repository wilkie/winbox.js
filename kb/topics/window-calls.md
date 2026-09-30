---
kind: topic
name: Windows and menus, the smaller calls
summary: What USER does for SetParent, ShowOwnedPopups, GetQueueStatus, PostAppMessage, the system-modal window, LoadMenuIndirect, HiliteMenuItem, the check mark's size, ClipCursor, the timer's resolution, ArrangeIconicWindows, and the undocumented CascadeChildWindows and TileChildWindows — as the userwin probe recorded them.
probes: [userwin]
---

[[measured]] [[probe:userwin]] asks each once or twice on the VGA, and winbox.js agrees with all 70 records. Every one of them was a stub.

## Windows

- [[fn:USER.SetParent]] answers the parent before, and the child keeps its place in its parent's client area: at (10, 12) in one window, it is at (10, 12) in the other after.
- `ShowOwnedPopups` with FALSE hides the pop-ups a window owns, and with TRUE shows them again.
- [[fn:USER.ArrangeIconicWindows]] puts a window's icons in their slots again, the ones [[topic:window-states]] sets out. It starts from the one at the top: of two, the one minimized last takes the first slot. A place the program set for an icon is forgotten. It answers how many icons there were: 0, 1 and 2, not a row's height.
- [[fn:USER.CascadeChildWindows]] and `TileChildWindows`, which USER exports and does not document, are the MDI client's cascade and tile ([[topic:mdi]]) for the children of any window.
- `SetSysModalWindow` answers the system-modal window before, nought for none, and [[fn:USER.GetSysModalWindow]] answers it after.

## Messages

- [[fn:USER.GetQueueStatus]] answers the kinds of message waiting in its high word, and what came since it was last asked, or a message was last taken, in its low word. With a message posted it answers 80008h; asked again, 80000h.
- `PostAppMessage` posts to a task, not to a window: `PeekMessage` takes the message with no window. It answers other than nought; 84h, not 1.

## Menus

- `LoadMenuIndirect` makes a menu from a template laid out as a menu resource is.
- `HiliteMenuItem` lights an item of a menu bar: [[fn:USER.GetMenuState]] has `MF_HILITE`, 80h, while it is lit. It answers TRUE.
- `GetMenuCheckMarkDimensions` answers 14 by 14 on the VGA, the size of the display driver's `OBM_CHECK`.
- `SetMenuItemBitmaps` answers TRUE. winbox.js keeps the bitmaps and does not draw them yet.

## The rest

- [[fn:USER.GetClipCursor]] answers the screen until `ClipCursor` gives a rectangle, that rectangle after, and the screen again after `ClipCursor(NULL)`. winbox.js keeps the rectangle but does not hold the pointer to it yet.
- `GetTimerResolution` answers 1000.

## Along the way

- An icon is not held to a window's least size. Moved at 36 by 36, it stays 36 by 36; winbox.js had made it 102 wide.
