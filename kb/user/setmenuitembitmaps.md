---
kind: function
module: USER
name: SetMenuItemBitmaps
ordinal: 418
summary: Gives a menu item bitmaps of its own for checked and unchecked, drawn where the check mark goes, cut to its size, in the item's colours.
versions:
  '3.1': exact
probes: [menubmp, userwin]
source: src/win16/user/menus.ts
topics: [menus, window-calls]
---

## Observed behaviour

[[measured]] [[probe:menubmp]] opens a pop-up menu with [[fn:USER.TrackPopupMenu]]. Its items have 8 by 8 monochrome bitmaps for checked and unchecked, only a checked one, one of 20 by 20, none, and bitmaps given and then taken away. It reads the screen back with nothing pressed and with Down pressed once and twice.

- **Where:** the bitmap goes where [[fn:USER.GetMenuCheckMarkDimensions]]'s check mark goes: at the item's left, inside the border, with its top half the difference between the item's height and the check's. The text does not move.
- **Its size:** a bitmap larger than the check mark is cut to it, 14 by 14 on the VGA. It is not scaled.
- **Its colours:** a monochrome bitmap is copied as [[fn:GDI.BitBlt]] copies one to colour: a bit clear in the item's text colour, a bit set in its background. That is black on white, or white on the highlight when the item is selected. A box drawn in set bits disappears into the menu.
- **Checked or not:** a checked item shows its checked bitmap and an unchecked item its unchecked one. Where that one is none, the item shows nothing.
- **Taken away:** given none for both, an item shows the standard check mark again.
- It answers TRUE ([[probe:userwin]]).

Opened by `TrackPopupMenu` with no key pressed, the first item is selected. Down moves the selection on from there.

winbox.js draws a bitmap so in a pop-up and agrees with all 408 rows, the menu's left part in each capture. It had kept the bitmaps without drawing them. Bitmaps in a menu bar were not measured.
