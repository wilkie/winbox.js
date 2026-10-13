---
kind: function
module: DDEML
name: SERVERWNDPROC
ordinal: 29
summary: The window procedure of DDEML's server conversations, class DMGServerClass: the requests that come from a client, and DDEML's own messages.
probes: [ddemgmt]
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `523a`. The window is made by the instance's `DMGFrame` as it answers `WM_DDE_INITIATE`, a child of the instance's holding window (`6f74`):

- `WM_DDE_ADVISE`, `UNADVISE`, `REQUEST`, `POKE` and `EXECUTE` (3E2h-3E3h, 3E6h-3E8h): handed to the transactions' code (`3a68`), on the knowledge base's page of DDEML transactions.
- `WM_DDE_TERMINATE`: as a client's ([[fn:DDEML.CLIENTWNDPROC]]).
- `WM_USER + 6Bh` (`539e`): its client is another window, in a list.
- `WM_USER + CBh` (`53d6`): nought, that it is not a client's; with 1, the instance.
- `WM_USER + CEh` (`5422`): end it.
- `WM_USER + CFh` (`5432`): `DdeEnableCallback`'s command kept in its flags; enabled, what was held is done.

[[measured]] [[probe:ddemgmt]]: a server conversation's `wStatus` was `ST_CONNECTED`, with `ST_BLOCKED` when its instance's callbacks were disabled, and `ST_ISSELF` for a conversation with its own instance.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.
