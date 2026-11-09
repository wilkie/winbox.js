---
kind: function
module: USER
name: GetIconID
ordinal: 455
summary: The member of an icon or cursor group that fits the display: its identifier.
versions:
  '3.1': exact
probes: [iconid]
records: [icon, cursor, header]
topics: [cursor]
source: crates/winbox-win16/src/cursor_make.rs
---

## Observed behaviour

- [[measured]] [[probe:iconid]], on directories made in global memory, on the VGA, its icons 32 square and of 16 colours, its cursors 32 square:
  - The second argument is a resource type, an integer name: `RT_ICON` or `RT_CURSOR`.
  - Of icons 32 square of 2, 16 and 8 colours, the one of 16. Of 2 and 8, the one of 8, in either order.
  - None 32 square: of 16 by 16 of 16 colours and 64 square of 2, the first; of 0 by 0 of 16 and 32 square of 4, the one of 4 -- a width of nought is 256.
  - Two of 200 colours, one 32 square, the other not: the first, which is not 32 square. Of 32 square of 200 and 16 square of 2, the one of 2.
  - Two of nought colours: the first.
  - A group's type 1 or 2 both serve. A reserved word not nought, or a type of nought or 3: nought.
  - Cursors: the first 32 wide and 64 high in the directory, twice the cursor's height; none such, the first.

## Inside Windows

- [[read out]] `USER.EXE` seg12 `052b`-`05b6`: the block locked with `LockResource`, checked, the index chosen, `GlobalUnlock`, and the member's word at 0Ch answered. A directory that fails the check is left locked.
- [[read out]] Icons (seg12 `040c`-`04f4`): the display's colours, `1 << [698h]`, 7D00h from 16 bits up. Of `SM_CXICON` by `SM_CYICON`, one of that many colours at once; else the one of most colours below; else, of any size, the one of most colours not more than the display's; else the first. Among those of the size with more colours than the display's USER keeps the fewest, but starts from nought and so never takes one (`04b6`) -- [[probe:iconid]]'s two of 200 colours.
- [[read out]] Cursors (seg12 `04f7`-`0526`): the first `SM_CXCURSOR` wide whose height halved is `SM_CYCURSOR`.
- [[read out]] Any other type leaves the index the locked block's selector (`0541`, `0591`), and a word that far on is answered.

## Implementation

`crates/winbox-win16/src/cursor_make.rs`. The same choice is `pickIcon` (`winbox-raster`'s `pick_icon`), which [[fn:USER.LoadIcon]], SHELL's [[fn:SHELL.ExtractIcon]] and WinBox's own icons make.
