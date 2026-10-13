---
kind: function
module: DDEML
name: CONVLISTWNDPROC
ordinal: 32
summary: The window procedure of class DMGHoldingClass: a conversation list, and the parent of an instance's server conversations.
probes: [ddemgmt]
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `5758`:

- `WM_CREATE` (`578a`): its word 6 nought, its word 4 the next serial -- a list's handle's high word -- and its word 0 the instance.
- `WM_USER + CEh` (`57c0`): with 2000h, marked to go, each child sent the same with 6000h, and destroyed where it has no children; with 1000h, from a child destroyed, destroyed where it was marked and none are left.
- `WM_USER + CFh` (`5814`): `DdeEnableCallback`'s command sent on to each child.

[[measured]] [[probe:ddemgmt]]: a list disconnected was still a list until its conversations had been answered.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.
