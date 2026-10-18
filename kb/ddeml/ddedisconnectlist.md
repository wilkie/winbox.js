---
kind: function
module: DDEML
name: DdeDisconnectList
ordinal: 6
summary: Ends every conversation of a list; the list goes when the last of them has.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/conv.ts
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: it answered TRUE, and the server was called back `XTYP_DISCONNECT` for each conversation, the list's first child first.
- [[measured]] Called again at once with the same list it answered TRUE again: the list was still there, its conversations waiting for the server's answers.

## Nuances

- [[read out]] It sends the list `WM_USER + CEh` with 2000h (`DDEML.DLL` seg1 `0a8d`-`0a9a`): the list marks itself to go, sends each child the same with 6000h, and destroys itself where it has no children left (`CONVLISTWNDPROC`, `57c0`-`5811`). Each conversation, destroyed, posts its list `WM_USER + CEh` with 1000h, and the last one's makes the list go (`46a7`-`46ca`).
- [[read out]] A handle that is not a list's sets `DMLERR_INVALIDPARAMETER` on every instance of the calling task, and answers FALSE.

## Implementation

WinBox's own: `disconnectList` in `src/win16/ddeml/conv.ts` and `disconnect_list` in `crates/winbox-win16/src/ddeml/conv.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It sends the list `WM_USER + CEh`, 2000h, which ends each conversation in it. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
