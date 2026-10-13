---
kind: function
module: DDEML
name: DdeCreateStringHandle
ordinal: 21
summary: A string handle for a name -- a global atom, counted for the instance -- in the Windows character set or the keyboard's code page.
probes: [ddemgmt]
topics: [dynamic-data-exchange, atoms]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: the handle's low word is the string's global atom -- [[fn:USER.GlobalFindAtom]] finds the same -- and its high word nought.
- [[measured]] The same string in other capitals is the same handle, as atoms are ([[topic:atoms]]).
- [[measured]] The code page may be nought, `CP_WINANSI` (1004), or the keyboard's: 437 under the US driver, and [[fn:KEYBOARD.GetKbCodePage]] gave the same handle. 850, 1200 (`CP_WINUNICODE`) and -1 answer nought with `DMLERR_INVALIDPARAMETER`, 4006h.
- [[measured]] An empty string, or none, answers nought and sets no error.
- [[measured]] A monitor with `MF_HSZ_INFO` is told 5, the atom added, then `MH_CREATE`.

## Nuances

- [[read out]] Nothing converts between code pages: a string given in the OEM code page is added as it is (`DDEML.DLL` seg1 `19d2`-`19fe`). The code page is only checked.
- [[read out]] The instance is not checked for nought before it is read: an id of nought reads the serial from DDEML's own data, at offset 30h.
- [[read out]] Each handle is a count on the atom, added with `GlobalAddAtom` (`2f26`), and kept in the instance's list of string handles (`1a27`): [[fn:DDEML.DdeUninitialize]] deletes those left.

## Inside Windows

[[read out]] Seg1 `19a4`: the instance checked, its last error cleared; the string checked; the code page checked against `CP_WINANSI` and `GetKbCodePage`; `GlobalAddAtom` (`2f26`, telling the monitors 5); `MH_CREATE` to the monitors (`326e`); the handle added to the instance's list; `MAKELONG(atom, 0)` answered.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation, over winbox.js's own atoms. For it winbox.js's `GetKbCodePage` answers 437, the US driver's ([[topic:dynamic-data-exchange]]).
