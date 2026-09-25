---
kind: function
module: KERNEL
name: GetProfileString
ordinal: 58
summary: Reads one value from WIN.INI into a caller's buffer, falling back to a supplied default string.
versions:
  '3.1': exact
probes: [profile]
source: src/win16/kernel/GetProfileString.ts
topics: [profile-files]
---

## Observed behaviour

- [[measured]] All 6 records of [[probe:profile]] agree with Windows.
- [[measured]] On the recorded installation, `[intl]` gives `s1159` = `AM` (2), `s2359` = `PM` (2), `sTime` = `:` (1) and `sShortDate` = `M/d/yy` (6).
- [[measured]] `[windows] device` reads as an empty string with count 0 rather than the default, so that installation has the entry with nothing after it.
- [[measured]] A missing section and entry copy the default, `<default>`, count 9.

## Nuances

- [[inferred]] The file is read the same way as by [[fn:KERNEL.GetPrivateProfileString]]; the rules for case, whitespace and quotes are measured through that call on a file the probe wrote, not through `WIN.INI`. See [[topic:profile-files]].
- Not yet measured: truncation, the list form with a NULL entry, and whether the answer follows a change another program writes to `WIN.INI`.

## Implementation

winbox.js reads `WIN.INI` through the same `Profile` class as the private calls (`src/win16/profile.ts`). Clock asks for `[intl] s1159` before it can draw, which is why this call was implemented.
