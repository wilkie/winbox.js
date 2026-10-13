---
kind: function
module: DDEML
name: DMGWNDPROC
ordinal: 31
summary: The window procedure of an instance's own window, class DMGClass: names registered and unregistered, and callbacks waiting.
probes: [ddemgmt]
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

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.
