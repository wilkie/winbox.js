---
kind: function
module: DDEML
name: DdeSetUserHandle
ordinal: 10
summary: Keeps a double word of the program's with a conversation, or with one of a client's asynchronous transactions, for DdeQueryConvInfo's hUser.
probes: [ddemgmt]
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: with `QID_SYNC` it answered TRUE, and [[fn:DDEML.DdeQueryConvInfo]] gave the value back as `hUser`.
- [[measured]] With a transaction id that is no transaction's, 5, it answered FALSE and `DMLERR_UNFOUND_QUEUE_ID`, 4011h.

## Nuances

- [[read out]] An id other than `QID_SYNC` is looked for only in a client's conversation; a server's answers FALSE with `DMLERR_INVALIDPARAMETER` (`DDEML.DLL` seg1 `109d`-`10b0`, `1102`).
- [[read out]] A handle that is not a conversation's sets `DMLERR_INVALIDPARAMETER` on every instance of the calling task.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation.
