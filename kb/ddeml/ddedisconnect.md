---
kind: function
module: DDEML
name: DdeDisconnect
ordinal: 8
summary: Ends a conversation, from either side: the other side is called back XTYP_DISCONNECT, this side is not, and the conversation is gone once both have answered.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/conv.ts
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: it answered TRUE with the conversation's window still there. The server was called back `XTYP_DISCONNECT`, `dwData2` nought, and the client nothing. Once both programs had taken their messages the conversation was gone: [[fn:DDEML.DdeQueryConvInfo]] answered nought, `DMLERR_NO_CONV_ESTABLISHED`.
- [[measured]] Called again it answered FALSE, and `DMLERR_NO_CONV_ESTABLISHED`, 400Ah, was set for the client instance; the probe's monitor instance, of the same task, had no error after.
- [[measured]] Called by the server on its side, the client was called back `XTYP_DISCONNECT`.
- [[measured]] A conversation of an instance with itself: `XTYP_DISCONNECT` on the server's side, `dwData2` 1.

## Nuances

- [[read out]] For a handle that is not a conversation's, `DMLERR_NO_CONV_ESTABLISHED` is set on every instance of the calling task (`DDEML.DLL` seg1 `0b5d`-`0b7c`): the task's instances are looked for by `GetCurrentTask` (`20a0`). [[measured]] The probe's monitor, of the same task, read nought after. [[inferred]] Each error set is told to the monitors, `MF_ERRORS` (`3304`), and the monitor's callback reads the notice with `DdeAccessData`, which clears the last error of the instance the data is the monitor's (`18a1`).
- [[read out]] Inside a callback, the ending is posted to the conversation, `WM_USER + CEh`, to be done after (`0ba3`-`0bb9`).
- [[read out]] The side that ends posts `WM_DDE_TERMINATE` and counts it on its instance until answered (`4f9e`-`5081`); [[fn:DDEML.DdeUninitialize]] waits on that count. The other side, handed it, calls back `XTYP_DISCONNECT` and answers (`50be`-`51f3`). The window goes when both are done: flags 2000h and `ST_TERMINATED` (`50a6`, `5220`).

## Inside Windows

[[read out]] Seg1 `0b4a`: the handle checked (`2dac`: `IsWindow`, and its word 4 the handle's high word); the instance from the conversation; posted where a callback is under way; otherwise ended (`4f9e`) with flag 2000h, to be destroyed once answered.

## Implementation

WinBox's own: `disconnect` in `src/win16/ddeml/conv.ts` and `disconnect` in `crates/winbox-win16/src/ddeml/conv.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. Inside a callback it posts the conversation `WM_USER + CEh`; otherwise it ends it at once (`terminate`, seg1 `4f9e`). Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
