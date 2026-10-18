---
kind: function
module: DDEML
name: DdeInitialize
ordinal: 2
summary: Makes a program a DDEML instance -- a client, a server or a monitor -- with its callback and the flags that keep callbacks away; or, given the instance's own id again, changes those flags.
probes: [ddemgmt, ddefail, ddeterm]
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: `DdeInitialize` answers nought and writes the instance's id; the id's high word is a serial, 2 for the first instance made after Windows started, then 3, 4 and on, the same count that numbers conversations and lists ([[topic:dynamic-data-exchange]]).
- [[measured]] A reserved word other than nought answers `DMLERR_INVALIDPARAMETER`, 4006h, and leaves the id as it was.
- [[measured]] Four monitors, `APPCLASS_MONITOR`, may be at once; the fifth answers `DMLERR_DLL_USAGE`, 4004h.
- [[measured]] Called again with the instance's own id it answers nought and keeps the id. With an id whose serial is not the instance's it answers 4006h.
- [[measured]] An instance made with no `APPCMD_` flags still filters: until its server registers a name, no client's `DdeConnect` reaches it ([[fn:DDEML.DdeNameService]]).
- [[measured]] [[probe:ddefail]]: a server calling it again with new `CBF_` flags answered nought, and the flags held at once, for the conversations already open too: `CBF_FAIL_REQUESTS` and the rest failed their kind, `CBF_FAIL_CONNECTIONS` new connections, `CBF_FAIL_SELFCONNECTIONS` its own alone, `CBF_SKIP_ALLNOTIFICATIONS` its `XTYP_CONNECT_CONFIRM` and `XTYP_DISCONNECT`.
- [[measured]] [[probe:ddeterm]]: `ShutdownTimeout` and `ShutdownRetryTimeout` written to `WIN.INI` by the program before its first call were the times [[fn:DDEML.DdeUninitialize]] then waited.

## Nuances

- [[read out]] **Called again** (`DDEML.DLL` seg1 `006a`-`00b0`), only the `CBF_` and `MF_` flags are taken: the `APPCLASS_` and `APPCMD_` bits, 0FFFh, and the high word's 00C0h are kept as they were. The callback is not changed. [[measured]] An instance made `APPCMD_CLIENTONLY` and called again with nought was still refused [[fn:DDEML.DdeNameService]], with `DMLERR_DLL_USAGE`.
- [[read out]] Every instance starts with `APPCMD_FILTERINITS` on (`021f`), whatever it was given; `DNS_FILTEROFF` turns it off.
- [[read out]] A monitor's flags are forced to `CBF_FAIL_ALLSVRXACTIONS`, `CBF_SKIP_CONNECT_CONFIRMS` and `CBF_SKIP_DISCONNECTS` (`0062`, 27F000h): not `CBF_SKIP_REGISTRATIONS`, so a monitor is called back `XTYP_REGISTER` and `XTYP_UNREGISTER` as any instance is.
- [[read out]] An instance that cannot be made answers `DMLERR_SYS_ERROR`, 400Fh, after undoing what was made (`0352`-`0360`).

## Inside Windows

[[read out]] The function (seg1 `0010`, the work at `0048`):

1. The first instance in the system (`00b4`) reads `[DDEML]` `ShutdownTimeout=` (3000 ms unless set) and `ShutdownRetryTimeout=` (30000 ms) from `WIN.INI`, adds the global atom `Progman`, and registers DDEML's classes.
2. The instance is 3Ch bytes of DDEML's local heap (`019b`), with a local heap of its own of 4 KB (`01ae`). It keeps the callback, the flags, the task (`GetCurrentTask`), and a serial counted up at DDEML's `[24h]` (`0232`). The id is `MAKELONG(` its offset `,` the serial `)` (`0263`-`026c`).
3. Its window: a `DMGClass` window at the top, style nought, so invisible, its creation's parameter the instance (`0270`-`0296`).
4. A monitor: a `DMGMonitorClass` window, and with the first monitor the hooks `DDEPOSTHOOKPROC` (`WH_GETMESSAGE`) and `DDESENDHOOKPROC` (`WH_CALLWNDPROC`), by [[fn:USER.SetWindowsHook]] (`02a9`-`0310`).
5. Otherwise, unless `APPCMD_CLIENTONLY`: a `DMGFrame` pop-up, `WS_POPUP`, which is the window that answers `WM_DDE_INITIATE` (`0318`-`0348`).

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation. What it needs underneath -- `CreateWindow` of classes registered by a DLL, `GetProfileString`, `GlobalAddAtom`, `SetWindowsHook` -- is winbox.js's own, and agrees with all of [[probe:ddemgmt]]'s records in both engines.
