---
kind: function
module: USER
name: CascadeChildWindows
ordinal: 198
summary: Cascades the children of any window as the MDI client cascades its own; TileChildWindows tiles them. Neither is documented.
versions:
  '3.1': exact
probes: [userwin]
source: src/win16/user/mdi.ts
topics: [mdi, window-calls]
---

## Observed behaviour

[[probe:userwin]] finds both by name with [[fn:KERNEL.GetProcAddress]]. It arranges three, four and five children of a plain window 400 by 300, and three of one 560 by 420. [[measured]]

- **Cascading** puts the child at the bottom at the client's corner, and each next child a step down and in. A step is a sizing frame and a size box, 22 pixels on the VGA. Each child is as large as the client less as many steps as fit a third of its height: 304 by 185 in a client 392 by 273, 442 by 283 in one 552 by 393, however many children there are.
- **Tiling** puts three children in three columns of the client's full height, four in two rows of two, and five in two columns of two and three. The child at the top comes first, down each column.

These are the rules `USER.EXE` reads out for the MDI client's `WM_MDICASCADE` and `WM_MDITILE` ([[topic:mdi]]), and winbox.js uses the same code for both. It agrees with all of these records. Both were stubs.
