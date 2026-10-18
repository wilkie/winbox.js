---
kind: function
module: DDEML
name: SUBFRAMEWNDPROC
ordinal: 30
summary: The window procedure of a server-capable instance's DMGFrame window: the one window of DDEML's that answers WM_DDE_INITIATE.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/conv.ts
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `5480`: `WM_CREATE` keeps the instance at its word 0; `WM_DDE_INITIATE` goes to the server's side of connecting (`6bf6`, [[topic:dynamic-data-exchange]]); the rest to `DefWindowProc`. The window is a pop-up, `WS_POPUP`, at the top and never shown, made by [[fn:DDEML.DdeInitialize]] for an instance that is not `APPCMD_CLIENTONLY`; its handle is the high word of the instance's own name that `XTYP_REGISTER` gives.

[[measured]] [[probe:ddemgmt]]: every instance's `XTYP_REGISTER` named the server's `DMGFrame` window in its second string handle.

## Implementation

WinBox's own: `subframeProc` in `src/win16/ddeml/conv.ts` and `subframe_proc` in `crates/winbox-win16/src/ddeml/conv.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is WinBox's own export, the procedure of the `DMGFrame` class; `WM_DDE_INITIATE` goes to `frameInitiate` (`frame_initiate`), seg1 `6bf6`. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
