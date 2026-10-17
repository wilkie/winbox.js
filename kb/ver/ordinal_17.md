---
kind: function
module: VER
name: Ordinal 17
ordinal: 17
summary: A folder and a name joined — the folder copied, a backslash added where it ends in neither one nor a colon, the name after; the folder's length answered.
versions:
  '3.1': stub
topics: [version-information]
---

## Observed behaviour

- [[read out]] `VER.DLL` seg3 `1192`, popping 12 bytes: `lstrcpy` of the folder into the buffer, `lstrlen`, a backslash where the last character is neither `\\` nor `:` and the folder is not empty, `lstrcpy` of the name after it. It answers the folder's length with its backslash, where [[fn:VER.VerInstallFile]] puts its temporary file's name.
- [[read out]] The entry table gives it flags 0: it is an entry for VER's own far calls into a moveable segment, not a function VER offers programs.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/ver/index.ts`, named `Unknown`, popping 12 bytes), with no arm in `crates/winbox-win16/src/ver/mod.rs`. WinBox's own VER does what it does where VER does it, in its own code.
