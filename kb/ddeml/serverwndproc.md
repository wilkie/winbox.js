---
kind: function
module: DDEML
name: SERVERWNDPROC
ordinal: 29
summary: The window procedure of DDEML's server conversations, class DMGServerClass: the requests that come from a client, and DDEML's own messages.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/conv.ts
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

WinBox's own: `serverProc` in `src/win16/ddeml/conv.ts` and `server_proc` in `crates/winbox-win16/src/ddeml/conv.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is WinBox's own export, the procedure of the `DMGServerClass`; the messages become queued callbacks in `serverDde` (`server_dde`), seg1 `3a68`. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
