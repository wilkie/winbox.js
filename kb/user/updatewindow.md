---
kind: function
module: USER
name: UpdateWindow
ordinal: 124
summary: Paints a window and the windows in it now where they are due, and answers nothing -- but leaves CDEFh in AX, which a program can take for an answer.
versions:
  '3.1': partial
probes: [updax]
source: crates/winbox-win16/src/paint.rs
topics: [painting]
---

## Observed behaviour

- [[read out]] `USER.EXE` seg1 `a95d`: the handle is checked (`a963`-`a966`); the offset of the export's own return, the `retf 2` at `a96e` pushed at `a960`, is popped into DX (`a969`); and the window is painted through seg1 `441d`, which sends `WM_PAINT` where a window is due. It returns through seg1 `4404`, which loads CDEFh into AX before it returns (`4415`). The function is documented as answering nothing.
- [[measured]] [[probe:updax]] reads DX:AX after `UpdateWindow`. For a window, AX is CDEFh whether or not it had something to paint. DX is A96Eh where it had nothing; where it was painted it is what the painting left, 06D7h in standard mode and 047Fh in enhanced. For nought and for a handle that is no window, both are nought.
- [[measured]] Google Eyes of the catalog answers its `InitInstance` with what `UpdateWindow` left in AX, and its `WinMain` ends where that is nought. winbox.js left AX as the window's procedure had, nought, and the program ended before its first message.

## Implementation

`update_window` in `crates/winbox-win16/src/paint.rs`: nought in DX:AX for a handle that is no window; else CDEFh in AX, and A96Eh in DX where no `WM_PAINT` was sent. DX after a paint is not followed, the known gap in [[probe:updax]]'s conformance.
