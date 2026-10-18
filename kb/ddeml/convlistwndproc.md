---
kind: function
module: DDEML
name: CONVLISTWNDPROC
ordinal: 32
summary: The window procedure of class DMGHoldingClass: a conversation list, and the parent of an instance's server conversations.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/conv.ts
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `5758`:

- `WM_CREATE` (`578a`): its word 6 nought, its word 4 the next serial -- a list's handle's high word -- and its word 0 the instance.
- `WM_USER + CEh` (`57c0`): with 2000h, marked to go, each child sent the same with 6000h, and destroyed where it has no children; with 1000h, from a child destroyed, destroyed where it was marked and none are left.
- `WM_USER + CFh` (`5814`): `DdeEnableCallback`'s command sent on to each child.

[[measured]] [[probe:ddemgmt]]: a list disconnected was still a list until its conversations had been answered.

## Implementation

WinBox's own: `convlistProc` in `src/win16/ddeml/conv.ts` and `convlist_proc` in `crates/winbox-win16/src/ddeml/conv.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is WinBox's own export, the procedure of the `DMGHoldingClass`. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
