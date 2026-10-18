---
kind: function
module: DDEML
name: DdeConnectList
ordinal: 4
summary: Starts a conversation with every server that answers for a service and topic, as a list -- and, given an old list, keeps its conversations and drops the new ones they duplicate.
versions:
  '3.1': exact
probes: [ddemgmt, ddelist]
source: src/win16/ddeml/conv.ts
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: with nought for both names, the server was called back `XTYP_WILDCONNECT` and answered two pairs; the list held two conversations, each `ST_CONNECTED | ST_ISLOCAL | ST_CLIENT | ST_INLIST`, 55h, and [[fn:DDEML.DdeQueryConvInfo]] named the list as theirs. The first had DDEML's default `CONVCONTEXT`; the second, made for the server's second acknowledgement, had none: all its fields nought.
- [[measured]] Given that list again, the server was called back for two new conversations and then `XTYP_DISCONNECT` for both: the new ones were dropped as duplicates, the old two kept, moved into a new list, and the old list destroyed. [[fn:DDEML.DdeQueryNextServer]] then gave the second old conversation before the first.
- [[measured]] For a service no one has, it answered nought -- and set no error.
- [[measured]] [[probe:ddelist]]: a plain server acknowledging twice, from window A and then from window B, inside one `WM_DDE_INITIATE`: B was sent `WM_DDE_TERMINATE` from inside its acknowledgement, A was sent `WM_DDE_INITIATE` again and acknowledged once, and the list held two conversations with it, each 51h, `ST_CONNECTED | ST_CLIENT | ST_INLIST`. Answering as `Progman`, the list left B's two atoms counted, besides the two DDEML leaves for each conversation; as another name, it left none.

## Nuances

- [[read out]] A list is a `DMGHoldingClass` window, a child of the instance's `DMGClass` window, and its conversations are its children; its handle is `MAKELONG(` the window `,` its word 4 `)`, the serial counted as conversations' are (`CONVLISTWNDPROC`, `DDEML.DLL` seg1 `578a`).
- [[read out]] Each window at the top is sent `WM_DDE_INITIATE`, every one of them, not only until the first answers (`6bd6`). Each further acknowledgement from a DDEML server makes another client window in the list, not copying the `CONVCONTEXT` (`7202`-`7305`); one from another server is answered by sending it `WM_DDE_TERMINATE` and initiating again to the window the conversation was made through, its atoms deleted unless they name `Progman` (`71bb`-`71ff`).
- [[read out]] **Given an old list** (`06d6`-`073c`, `07b6`-`08eb`): its conversations no longer connected are ended first. Of the new ones, each that has the same service and topic as an old one, with a partner of the same task, is ended; then the old ones are moved into the new list with [[fn:USER.SetParent]], each going first among its children, and the old list is sent `WM_USER + CEh` to go. A new list left with no conversation is destroyed, and the call answers nought with `DMLERR_NO_CONV_ESTABLISHED` (`08f0`-`0914`).
- [[read out]] With no old list and no conversation made, the call answers nought before that check, and the new list's window is left (`0792`-`07b2`).
- [[read out]] An old list's handle that is not a list's is refused with `DMLERR_INVALIDPARAMETER` (`06c5`).

## Implementation

WinBox's own: `connectList` in `src/win16/ddeml/conv.ts` and `connect_list` in `crates/winbox-win16/src/ddeml/conv.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. The list is a `DMGHoldingClass` window; conversations of an old list are moved into the new one with [[fn:USER.SetParent]], duplicates of the same server task, service and topic ended. Both engines agree with [[probe:ddemgmt]] and [[probe:ddelist]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
