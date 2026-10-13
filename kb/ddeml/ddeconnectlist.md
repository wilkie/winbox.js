---
kind: function
module: DDEML
name: DdeConnectList
ordinal: 4
summary: Starts a conversation with every server that answers for a service and topic, as a list -- and, given an old list, keeps its conversations and drops the new ones they duplicate.
probes: [ddemgmt]
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: with nought for both names, the server was called back `XTYP_WILDCONNECT` and answered two pairs; the list held two conversations, each `ST_CONNECTED | ST_ISLOCAL | ST_CLIENT | ST_INLIST`, 55h, and [[fn:DDEML.DdeQueryConvInfo]] named the list as theirs. The first had DDEML's default `CONVCONTEXT`; the second, made for the server's second acknowledgement, had none: all its fields nought.
- [[measured]] Given that list again, the server was called back for two new conversations and then `XTYP_DISCONNECT` for both: the new ones were dropped as duplicates, the old two kept, moved into a new list, and the old list destroyed. [[fn:DDEML.DdeQueryNextServer]] then gave the second old conversation before the first.
- [[measured]] For a service no one has, it answered nought -- and set no error.

## Nuances

- [[read out]] A list is a `DMGHoldingClass` window, a child of the instance's `DMGClass` window, and its conversations are its children; its handle is `MAKELONG(` the window `,` its word 4 `)`, the serial counted as conversations' are (`CONVLISTWNDPROC`, `DDEML.DLL` seg1 `578a`).
- [[read out]] Each window at the top is sent `WM_DDE_INITIATE`, every one of them, not only until the first answers (`6bd6`). Each further acknowledgement from a DDEML server makes another client window in the list, not copying the `CONVCONTEXT` (`7202`-`7305`); one from another server is answered by terminating it and initiating again to the same window (`71bb`-`71ff`).
- [[read out]] **Given an old list** (`06d6`-`073c`, `07b6`-`08eb`): its conversations no longer connected are ended first. Of the new ones, each that has the same service and topic as an old one, with a partner of the same task, is ended; then the old ones are moved into the new list with [[fn:USER.SetParent]], each going first among its children, and the old list is sent `WM_USER + CEh` to go. A new list left with no conversation is destroyed, and the call answers nought with `DMLERR_NO_CONV_ESTABLISHED` (`08f0`-`0914`).
- [[read out]] With no old list and no conversation made, the call answers nought before that check, and the new list's window is left (`0792`-`07b2`).
- [[read out]] An old list's handle that is not a list's is refused with `DMLERR_INVALIDPARAMETER` (`06c5`).

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation. The order in which a list gives its conversations comes from where [[fn:USER.SetParent]] links a window among its new siblings: first, as winbox.js now does in both engines (`USER.EXE` seg14 `04ab`-`04b2`).
