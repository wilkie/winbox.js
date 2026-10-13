---
kind: function
module: DDEML
name: DdeAbandonTransaction
ordinal: 12
summary: Forgets an asynchronous transaction, or all of a conversation's or an instance's, so that its answer, if it comes, is thrown away.
probes: [ddexact]
topics: [ddeml-transactions]
---

## Observed behaviour

- [[measured]] For a transaction still waiting it answers 1. Abandoned again, it answers nought with `DMLERR_UNFOUND_QUEUE_ID` (4011h).
- [[measured]] `QID_SYNC` answers nought with `DMLERR_INVALIDPARAMETER`: a synchronous transaction cannot be abandoned.
- [[measured]] An identifier of nought abandons every transaction waiting on the conversation and answers 1.
- [[measured]] The server, once its blocked callbacks run, still sees the transactions; the client's callback is handed nothing for them.

## Nuances

- [[read out]] A conversation of nought abandons on every conversation of the instance: each child window of the instance's window is visited (`DDEML.DLL` seg1 `1c45`-`1c8b`).
- [[read out]] An identifier of nought with nothing waiting answers 1; one that matches nothing answers nought with `DMLERR_UNFOUND_QUEUE_ID` (`1d74`-`1d8e`).
- [[read out]] Abandoning frees a request's data if the application was not given it, and deletes the transaction's item atom (`1d06`-`1d4b`). [[measured]] A poke that the server had queued then reached its callback with an item that no longer had a name.
- [[read out]] A bad instance identifier answers nought and sets no error (`1bfd`-`1c14`).

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `1bf0`; each conversation's list is searched by `1cb6`, with `60a0` finding the record and `6004` freeing it.

## Implementation

Not WinBox's own: both engines run `DDEML.DLL` from the installation.
