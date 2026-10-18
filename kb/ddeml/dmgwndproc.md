---
kind: function
module: DDEML
name: DMGWNDPROC
ordinal: 31
summary: The window procedure of an instance's own window, class DMGClass: names registered and unregistered, and callbacks waiting.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/instance.ts
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `5558`. The window is at the top and never shown, the parent of the instance's client conversations and lists:

- `WM_CREATE`: the instance at its word 0.
- `WM_USER + C8h` and `C9h` (`55b6`): `XTYP_REGISTER` and `XTYP_UNREGISTER`, `hsz1` the name, `hsz2` the registering instance's own name -- the atom with that instance's `DMGFrame` window in its high word -- then the atom's count given back.
- `WM_USER + CCh` (`5744`): the callbacks waiting, made.
- `WM_USER + D0h` (`5600`): `DdePostAdvise`'s work, posted again while a callback is under way.

It does not answer `WM_DDE_INITIATE`: [[fn:DDEML.SUBFRAMEWNDPROC]] does.

[[measured]] [[probe:ddemgmt]]: the probe's client instance, its monitor and the server's own instance were all called back `XTYP_REGISTER` and `XTYP_UNREGISTER`.

## Implementation

WinBox's own: `dmgProc` in `src/win16/ddeml/instance.ts` and `dmg_proc` in `crates/winbox-win16/src/ddeml/instance.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is WinBox's own export, the procedure of the `DMGClass`; `WM_USER + CCh` runs the queue (`runQueue`, `run_queue`, seg1 `4e66`). Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
