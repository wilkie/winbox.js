---
kind: function
module: DDEML
name: CLIENTWNDPROC
ordinal: 28
summary: The window procedure of DDEML's client conversations, class DMGClientClass: the acknowledgements, data and terminations that come from the server, and DDEML's own messages.
probes: [ddemgmt]
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `4614`. A conversation's 42h bytes are at its window long 0, and a serial at its word 4 ([[topic:dynamic-data-exchange]]):

- `WM_CREATE` (`699e`): the conversation made in its instance's heap, `ST_CLIENT`, `ST_BLOCKED` where the instance's callbacks are disabled, and `ST_INLIST` where its parent is a list's window.
- `WM_DDE_ACK` while connecting, states 3 and 4 (`709c`): the first makes the conversation; another is answered with `WM_DDE_TERMINATE`, or in a list makes another conversation.
- `WM_DDE_TERMINATE` (`50be`): from its partner, `XTYP_DISCONNECT` and the answer; or the answer to its own.
- `WM_DDE_ACK`, `WM_DDE_DATA` and the rest at other times: the transactions (`4866`), on the knowledge base's page of DDEML transactions.
- `WM_TIMER` 1, a synchronous transaction's time out; 4, the posts kept to be posted again.
- `WM_DESTROY` (`468e`): ended if still connected, its list told, its queues and links freed, and its atoms deleted.
- `WM_USER + CBh`: 1, that it is a client's; with 1, the instance.
- `WM_USER + CEh`, `CFh`, `D1h`: end it, `DdeEnableCallback`'s command, and a termination left from a synchronous transaction.

[[measured]] [[probe:ddemgmt]]'s conversations, made, queried and ended, agree with Windows in both engines.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.
