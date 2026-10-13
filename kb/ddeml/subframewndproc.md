---
kind: function
module: DDEML
name: SUBFRAMEWNDPROC
ordinal: 30
summary: The window procedure of a server-capable instance's DMGFrame window: the one window of DDEML's that answers WM_DDE_INITIATE.
probes: [ddemgmt]
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `5480`: `WM_CREATE` keeps the instance at its word 0; `WM_DDE_INITIATE` goes to the server's side of connecting (`6bf6`, [[topic:dynamic-data-exchange]]); the rest to `DefWindowProc`. The window is a pop-up, `WS_POPUP`, at the top and never shown, made by [[fn:DDEML.DdeInitialize]] for an instance that is not `APPCMD_CLIENTONLY`; its handle is the high word of the instance's own name that `XTYP_REGISTER` gives.

[[measured]] [[probe:ddemgmt]]: every instance's `XTYP_REGISTER` named the server's `DMGFrame` window in its second string handle.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.
