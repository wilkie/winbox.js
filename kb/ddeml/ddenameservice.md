---
kind: function
module: DDEML
name: DdeNameService
ordinal: 27
summary: Registers or unregisters a server's service name, telling every DDEML instance with XTYP_REGISTER or XTYP_UNREGISTER, and turns the filter of WM_DDE_INITIATE by registered names on and off.
probes: [ddemgmt]
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: `DNS_REGISTER` answers 1. Every instance in the system is called back `XTYP_REGISTER` -- the server's own, the probe's client-only instance and its monitor alike -- with `hsz1` the name and `hsz2` the instance's own name: the same atom, its high word the server's `DMGFrame` window, written `MgmtSrv:(hhhh)` by [[fn:DDEML.DdeQueryString]].
- [[measured]] `DNS_UNREGISTER` of a name answers 1 and calls back `XTYP_UNREGISTER` likewise, the server's own instance included.
- [[measured]] `DNS_UNREGISTER` with no name unregisters every name the instance has: each other instance is called back `XTYP_UNREGISTER` for each, and the instance's own is not.
- [[measured]] `DNS_UNREGISTER` of a name never registered still answers 1 and calls everyone back `XTYP_UNREGISTER` -- and deletes a count of the name's atom: the server's own string handle for it was gone afterwards.
- [[measured]] `DNS_FILTEROFF` and `DNS_FILTERON` alone answer nought, though they do their work: with the filter off, a client's `DdeConnect` to a service never registered reached the server's callback as `XTYP_CONNECT`; on again, it did not.
- [[measured]] A client-only instance, `APPCMD_CLIENTONLY`, is refused with `DMLERR_DLL_USAGE`, 4004h, and nought.
- [[measured]] Until a name is registered, an instance answers no `WM_DDE_INITIATE`: [[fn:DDEML.DdeInitialize]] turns the filter on for every instance.
- [[measured]] Inside the probe's `XTYP_REGISTER` callback, `DdeEnableCallback` with `EC_ENABLEALL` answered FALSE, `DMLERR_REENTRANCY`.

## Nuances

- [[read out]] The flags are taken in this order (`DDEML.DLL` seg1 `1f01`-`1f21`): `DNS_FILTERON` sets `APPCMD_FILTERINITS`, `DNS_FILTEROFF` clears it, and only then, with neither `DNS_REGISTER` nor `DNS_UNREGISTER`, the call answers nought.
- [[read out]] `DNS_REGISTER` with no name is refused with `DMLERR_INVALIDPARAMETER` (`1f48`).
- [[read out]] The notices are sent to each instance's `DMGClass` window, `WM_USER + C8h` to register and `C9h` to unregister, `wParam` the registering instance's `DMGFrame` window, `lParam` the name (`2054`-`2070`). An instance with `CBF_SKIP_REGISTRATIONS` or `CBF_SKIP_UNREGISTRATIONS` is not sent them. The receiving window adds a count to the atom for the callback's own name, and deletes one after (`55b6`-`55fa`).
- [[read out]] Registering adds a count to the name's atom, which unregistering deletes (`1ff6`, `2087`): unregistering a name that was not registered deletes a count someone else holds.

## Inside Windows

[[read out]] Seg1 `1ed4`: the instance checked and its last error cleared; the filter flags; a client-only instance refused; with no name and `DNS_UNREGISTER`, each registered name in turn sent to every other instance and deleted (`1f5a`-`1fc2`); with a name, added to or taken from the instance's list of names, sent to every instance, and with `DNS_UNREGISTER` deleted.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation. Its notices are `SendMessage` across tasks, which winbox.js does as Windows does: all of [[probe:ddemgmt]]'s records agree in both engines.
