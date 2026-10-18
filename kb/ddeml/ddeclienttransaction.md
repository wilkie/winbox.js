---
kind: function
module: DDEML
name: DdeClientTransaction
ordinal: 11
summary: Sends a request, poke, execute, advise start or advise stop on a conversation, and waits for its answer in a modal loop or, with TIMEOUT_ASYNC, answers at once and reports the outcome to the callback later.
versions:
  '3.1': exact
probes: [ddexact, progdde]
records: [xact, request, transaction, execute]
source: src/win16/ddeml/xact.ts
topics: [ddeml-transactions, program-manager-dde]
---

## Observed behaviour

[[probe:ddexact]] makes every kind of transaction against a DDEML server of its own, synchronously and asynchronously; [[probe:progdde]] sends Program Manager its execute strings and requests through it. Both engines agree with all 92 records of [[probe:ddexact]], WinBox's own DDEML answering.

- [[measured]] A request answers a data handle; a poke, an execute, an advise start or stop answers 1; anything refused, busy or timed out answers nought, with the reason in [[fn:DDEML.DdeGetLastError]]: `DMLERR_NOTPROCESSED`, `DMLERR_BUSY`, `DMLERR_DATAACKTIMEOUT` and the like. The table is on [[topic:ddeml-transactions]].
- [[measured]] `pdwResult` gets the acknowledgement's status in its low word, and its high word is left as it was: AAAAAAAAh becomes AAAA8000h for a poke acknowledged. A request answered with data does not write it.
- [[measured]] With `TIMEOUT_ASYNC` it answers 1, and `pdwResult` holds the transaction's identifier; the callback is later handed `XTYP_XACT_COMPLETE` with the same identifier in `dwData1` and the acknowledgement's status in `dwData2`.
- [[measured]] No item for a request, no format for a request or a poke, or an unknown type: nought and `DMLERR_INVALIDPARAMETER`, and nothing sent.
- [[measured]] Inside its wait, the program's own posted messages and timers are dispatched, and a `WM_QUIT` is taken and lost.
- [[measured]] A synchronous transaction on a conversation already waiting on one answers nought with `DMLERR_SERVER_DIED` (400Eh).

## Nuances

- [[read out]] `XTYP_ADVSTART | XTYPF_NODATA | XTYPF_ACKREQ` is not checked for an item (`DDEML.DLL` seg1 `130a`); [[measured]] it is sent with item nought and the server makes the link.
- [[read out]] `cbData` of -1 means `pData` is a data handle, which DDEML then owns; one it could not send is freed unless it is `HDATA_APPOWNED` (`12c5`-`12f7`, `1340`-`1363`).
- [[measured]] An execute given an item and a format is made into a block with DDE's header, and the server reads the command from the header: an empty string.
- [[read out]] For a conversation within one DDEML, a server that fails the type with `CBF_FAIL_*` is answered `DMLERR_NOTPROCESSED` without a message (`129a`-`12c2`).
- [[measured]] Program Manager's `[ExitProgman(0)]` is carried out, but its acknowledgement never comes: the call waits out its whole time-out and answers `DMLERR_EXECACKTIMEOUT` ([[topic:program-manager-dde]]).

## Inside Windows

- [[read out]] `DDEML.DLL` seg1 `1204` checks the conversation (`2dac`) and the type, `3672` sends the message (`3886`) and either queues an asynchronous record or waits in `59cc`: `SetTimer` of the time-out on the conversation's window, then `GetMessage`, `CallMsgFilter(MSGF_DDEMGR)` and `DispatchMessage` until the answer, the timer or the conversation's end. `4356` turns the state reached into the answer or the time-out's error.
- [[read out]] The client's window procedure (`4614`) matches acknowledgements and data to the transaction (`4b8e`) and records them (`4c6a`).

## Implementation

WinBox's own: `clientTransaction` in `src/win16/ddeml/xact.ts` and `client_transaction` in `crates/winbox-win16/src/ddeml/xact.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. Its parameters are laid out below the stack as the file's frame holds them, for the conversation to point to; a synchronous transaction waits in `modalLoop` (`modal_loop`), seg1 `59cc`, on the conversation's timer 1, and an asynchronous one takes a record of the conversation's queue. Both engines agree with [[probe:ddexact]] and [[probe:progdde]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
