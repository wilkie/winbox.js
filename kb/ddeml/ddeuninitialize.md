---
kind: function
module: DDEML
name: DdeUninitialize
ordinal: 3
summary: Ends a DDEML instance -- its names unregistered, its conversations ended and waited for, its string handles freed -- answering TRUE.
probes: [ddemgmt, pmatom]
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: it answers TRUE; called again with the same id, FALSE. An id of nought, or one whose serial is not the instance's, answers FALSE.
- [[measured]] A server's instance ended with two conversations open to the probe: the probe was called back `XTYP_UNREGISTER` for the server's name, then `XTYP_DISCONNECT` for each conversation, and the server's call answered TRUE once the probe had taken its messages. After it, a `DdeConnect` to that server found no one.
- [[measured]] A monitor saw `MH_CLEANUP`, then 7, for each string handle the ending instance still had.

## Nuances

- [[read out]] It does not answer until every conversation it ended has been answered with `WM_DDE_TERMINATE` (`DDEML.DLL` seg1 `040c`-`0513`): it takes and dispatches every message for the task meanwhile, with timer 2 on its `DMGClass` window set to `ShutdownTimeout`, 3000 ms unless `[DDEML]` in `WIN.INI` says otherwise. A partner whose task is waiting on this one -- in a `SendMessage` to it, say -- does not take the posted `WM_DDE_TERMINATE` meanwhile, so the probe posts its order to end the server, and takes its messages, rather than sending it.
- [[read out]] When the time is up, it shows its `TermDialog`, "Windows DDE": "An application using DDE did not respond to the system's exit command", with Retry, Continue and Close (`049c`-`04cb`, `TERMDLGPROC`). Close, or a dialog that could not be made, stops the waiting; Retry waits `ShutdownRetryTimeout` more, 30000 ms; Continue waits on with no timer. Not yet recorded.
- [[read out]] An instance in a synchronous transaction is posted `WM_TIMER` 1, so the transaction's own loop ends (`051e`-`0537`).
- [[read out]] The last instance in the system deletes the atom `Progman` (`066f`): the number the first `DdeInitialize` since DDEML was loaded kept at DS `00A4`, deleted by every last instance whether or not it still names `Progman`. [[measured]] [[probe:pmatom]]: the held instance's end took `Progman` from 11 counts to 10; with `Progman` gone and added again under the same number, each later last instance deleted one more ([[topic:dynamic-data-exchange]]).

## Inside Windows

[[read out]] Seg1 `03ae`: the last error cleared; every name unregistered, as [[fn:DDEML.DdeNameService]] with nought and `DNS_UNREGISTER`; every conversation ended, `WM_USER + CEh` with 2000h sent to each of the instance's windows' children; the wait above; the monitor's window destroyed, and the hooks taken out with the last monitor (`0551`-`0566`); its windows destroyed; its data handles freed; its string handles each told to the monitors and deleted (`05c7`-`060a`); its heap freed; its serial counted down (`063c`), so the old id no longer matches; and the instance freed.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation. Its wait rests on winbox.js's own `GetMessage`, `DispatchMessage`, `SetTimer` and posting across tasks, which agree with all of [[probe:ddemgmt]]'s records in both engines. The `TermDialog` path is not exercised.
