---
kind: function
module: DDEML
name: DdeGetLastError
ordinal: 20
summary: The last DMLERR_ code an instance's calls set, cleared as it is read.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/instance.ts
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: an id of nought answers `DMLERR_DLL_NOT_INITIALIZED`, 4003h; an id whose serial is not the instance's, `DMLERR_INVALIDPARAMETER`, 4006h.
- [[measured]] Read once, the error is gone: the next read is nought.

## Nuances

- [[read out]] Almost every call of DDEML's clears its instance's last error as it starts (`mov word [pInst+2Ah],0`), so the error read is the last call's; a call that fails before it has found its instance -- an id that is not one -- sets none.
- [[read out]] A call given a conversation or list that is not one sets the error on every instance of the calling task ([[fn:DDEML.DdeDisconnect]]).
- [[read out]] Each error set is told to the monitors with `MF_ERRORS`, a `MONERRSTRUCT` of 10 bytes with the time and the task (`DDEML.DLL` seg1 `3304`-`3362`).

| Code | Name                         | Set by, as read out and recorded                                                                            |
| ---- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 4003 | `DMLERR_DLL_NOT_INITIALIZED` | `DdeGetLastError` of nought                                                                                 |
| 4004 | `DMLERR_DLL_USAGE`           | a fifth monitor; `DdeNameService` of a client-only instance                                                 |
| 4006 | `DMLERR_INVALIDPARAMETER`    | a reserved word; a code page; a `CONVCONTEXT`'s `cb`; a list or `DdeEnableCallback` command that is not one |
| 4008 | `DMLERR_MEMORY_ERROR`        | a conversation's memory, or a post kept, that could not be had                                              |
| 400A | `DMLERR_NO_CONV_ESTABLISHED` | no server answered; a conversation that is not one                                                          |
| 400D | `DMLERR_REENTRANCY`          | `DdeEnableCallback` enabling inside a callback                                                              |
| 400F | `DMLERR_SYS_ERROR`           | a window that could not be made                                                                             |
| 4011 | `DMLERR_UNFOUND_QUEUE_ID`    | a transaction id that is no transaction's                                                                   |

The codes of transactions are on the knowledge base's page of DDEML transactions.

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `14a8`: 4003h for nought, 4006h for a serial that does not match, otherwise the word at 2Ah of the instance, cleared.

## Implementation

WinBox's own: `getLastError` in `src/win16/ddeml/instance.ts` and `get_last_error` in `crates/winbox-win16/src/ddeml/instance.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. The error is the instance's word 2Ah, cleared as it is read. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
