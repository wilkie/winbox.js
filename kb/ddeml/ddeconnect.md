---
kind: function
module: DDEML
name: DdeConnect
ordinal: 7
summary: Starts a conversation with the first server that answers for a service and topic -- either may be nought, for any -- by sending WM_DDE_INITIATE to each window at the top in turn.
probes: [ddemgmt, pmatom]
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: the server was called back `XTYP_CONNECT`, `hsz1` the topic, `hsz2` the service, `dwData1` the client's `CONVCONTEXT` and `dwData2` nought; then, having answered TRUE, `XTYP_CONNECT_CONFIRM` with its own new conversation. The client's callback was called nothing.
- [[measured]] With no `CONVCONTEXT`, the server was given DDEML's own: 16 bytes, flags nought, country nought, code page 1004 (`CP_WINANSI`). One of the client's, `cb` 16, was given as it was -- flags 1, country 44, code page 850, language 9, security 77h -- and kept in both conversations. One whose `cb` was 12 was refused with `DMLERR_INVALIDPARAMETER`, 4006h.
- [[measured]] A server that answered FALSE, or none at all, left nought and `DMLERR_NO_CONV_ESTABLISHED`, 400Ah.
- [[measured]] With nought for the service and topic the server was called back `XTYP_WILDCONNECT`, both handles nought; with a service and no topic, `XTYP_WILDCONNECT` with the service. It answered two pairs. The client's conversation was the first; the server's for the second was ended at once -- `XTYP_DISCONNECT` -- and then confirmed, `XTYP_CONNECT_CONFIRM` with no conversation.
- [[measured]] A server's instance connecting to its own service was called back `XTYP_CONNECT` and `XTYP_CONNECT_CONFIRM` with `dwData2` 1, and both conversations had `ST_ISSELF`.
- [[measured]] The conversation is a `DMGClientClass` window, a child of the instance's `DMGClass` window at the top, and the handle's high word is its window word 4.

## Nuances

- [[read out]] **Not a broadcast.** DDEML walks the windows at the top with [[fn:USER.EnumWindows]] and sends each `WM_DDE_INITIATE` (`INITENUM`, `DDEML.DLL` seg1 `6b8a`), and stops at the first to acknowledge (`6bd6`-`6be8`). Windows of other programs, DDEML's or not, are sent it in their turn; DDEML's own instances' `DMGClass` windows let it pass to `DefWindowProc`.
- [[read out]] A second acknowledgement to the same client window, from a server that answered with more than one pair, is answered by sending its sender `WM_DDE_TERMINATE` from inside the acknowledgement (`7184`-`71a3`, `730c`).
- [[read out]] A conversation with a DDEML server is `ST_ISLOCAL` (`70e6`-`70f4`), and its partner's handle is the server's `HCONV`; with another server, the partner's window alone.
- [[read out]] Where a server not DDEML's acknowledges with the application atom whose number DDEML kept for `Progman` (DS `00A4`), DDEML adds a count to both of the acknowledgement's atoms (`7140`-`7150`), and the conversation's end deletes them only once. [[measured]] [[probe:pmatom]]: each connection to Program Manager, or to another server answering `Progman`, left two counts of `Progman` behind; Program Manager adds the atoms it answers with, as the protocol asks ([[topic:dynamic-data-exchange]], [[topic:program-manager-dde]]).
- [[read out]] A service handle with a high word -- an instance's own name, as `XTYP_REGISTER` gives it -- is sent `WM_DDE_INITIATE` at that one window, the instance's `DMGFrame`, instead of at every window at the top (`0af9`, `6b13`-`6b35`). `DdeCreateStringHandle`'s handles have no high word.

## Inside Windows

[[read out]] Seg1 `0aac`: the instance checked and its last error cleared; the `CONVCONTEXT` checked; the conversation made (`6a68`): a `DMGClientClass` window, state `XST_INIT1`, the context copied in (DDEML's default at its data's 26h), and `WM_DDE_INITIATE` sent to each window at the top until one answers. Unanswered, the window is destroyed and `DMLERR_NO_CONV_ESTABLISHED` set. Answered, it is `XST_CONNECTED` and `ST_CONNECTED`, and its handle `MAKELONG(` the window `,` its word 4 `)`.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation. Its connection rests on winbox.js's own `EnumWindows`, `SendMessage` across tasks, `GetWindowLong` of a window procedure and the atoms; all of [[probe:ddemgmt]]'s records agree in both engines.
