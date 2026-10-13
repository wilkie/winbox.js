---
kind: function
module: DDEML
name: DdeDisconnectList
ordinal: 6
summary: Ends every conversation of a list; the list goes when the last of them has.
probes: [ddemgmt]
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: it answered TRUE, and the server was called back `XTYP_DISCONNECT` for each conversation, the list's first child first.
- [[measured]] Called again at once with the same list it answered TRUE again: the list was still there, its conversations waiting for the server's answers.

## Nuances

- [[read out]] It sends the list `WM_USER + CEh` with 2000h (`DDEML.DLL` seg1 `0a8d`-`0a9a`): the list marks itself to go, sends each child the same with 6000h, and destroys itself where it has no children left (`CONVLISTWNDPROC`, `57c0`-`5811`). Each conversation, destroyed, posts its list `WM_USER + CEh` with 1000h, and the last one's makes the list go (`46a7`-`46ca`).
- [[read out]] A handle that is not a list's sets `DMLERR_INVALIDPARAMETER` on every instance of the calling task, and answers FALSE.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation.
