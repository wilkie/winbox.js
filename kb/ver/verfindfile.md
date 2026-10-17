---
kind: function
module: VER
name: VerFindFile
ordinal: 8
summary: Where a file is and where it should go — looked for in the program's, Windows' and the system folder -- the program's last for a shared file -- then where OpenFile looks; a shared file to go in the system folder, another in the program's; whether they differ, and whether it is in use.
versions:
  '3.1': exact
probes: [verinst]
source: src/win16/ver/ver.ts
topics: [version-information]
---

## Observed behaviour

[[probe:verinst]] asks for Windows' files, a file of its own, a file only in the current folder and a file not there, shared and not, with buffers of several sizes; it gives `X:\NOT\WINDOWS` for Windows' folder each time.

- [[measured]] The folder where the file was found is given back without its last backslash, `C:\WINDOWS\SYSTEM`, its length with its nought (18); nothing, and 1, where it is not found.
- [[measured]] Not shared, the folder to install in is the program's, without a backslash at its end (`C:\ORACLE\VI\DST\` gives `C:\ORACLE\VI\DST`, its length 18 counting the backslash); the root `C:\` gives `C:`, length 4.
- [[measured]] Shared, it is the system folder.
- [[measured]] The answer: 1 (`VFF_CURNEDEST`) where the two folders differ, by `lstrcmpi` -- `c:\oracle\vi\dst` is the same as `C:\ORACLE\VI\DST`; 2 (`VFF_FILEINUSE`) where a module loaded is that file (`USER.EXE`, `GDI.EXE`, `COMMDLG.DLL` once loaded); 4 (`VFF_BUFFTOOSMALL`) where either buffer is too small, that buffer untouched, the length it needs given.
- [[measured]] Windows' folder given is passed over: `NOTEPAD.EXE` is found in `C:\WINDOWS`.
- [[measured]] A file only in the current folder is found there (`cwd`).
- [[measured]] No buffer for the folder to install in: it is not written, and its length is left.

## Nuances

- [[read out]] The arguments: the flags, far pointers to the file's name, Windows' folder, the program's folder, the current folder's buffer, its length's word, the buffer for the folder to install in and its length's word; it pops 30 bytes and answers a `UINT`.
- [[read out]] `szWinDir` is never read: VER asks KERNEL for Windows' folder (seg3 `1333`).
- [[read out]] A folder too long for the name, 103h bytes or more together, is passed over.
- [[read out]] A shared file goes in the system folder where it is inside Windows' folder -- its first bytes Windows' folder, a backslash next -- and in Windows' folder otherwise (seg3 `1429`); VER keeps what it found (`[38h]`, `[52h]`) for its next call.
- Not followed: no program folder for a file not shared, where VER gives `lstrlen` and `lstrcpy` a null pointer; the probe does not ask it.

## Inside Windows

[[read out]] `VER.DLL` seg3 `1315`:

1. `GetWindowsDirectory` and `GetSystemDirectory`, Windows' folder for the system's where that answers nought.
2. The file looked for (seg3 `1200`): in the program's folder, Windows' and the system's -- Windows', the system's and the program's for `VFFF_ISSHAREDFILE` -- a null folder ending the list; in each by `OpenFile`'s `OF_EXIST` of the folder and name joined (seg3 `1192`); then the name alone. Found, `OpenFile`'s path is cut at its last backslash -- after it, for the root -- and made ANSI with `OemToAnsi`; the length is that backslash's place.
3. The current folder copied where the length given is more than the one found; `VFF_BUFFTOOSMALL` otherwise; the length written.
4. The folder to install in the same way, a backslash at its end taken off once copied, and compared with the current folder by `lstrcmpi`.
5. A file found: in use where `GetModuleHandle` of its name gives a module whose file is that path (seg3 `113a`).

## Implementation

`VerFindFile` in `src/win16/ver/ver.ts` and `ver_find_file` in `crates/winbox-win16/src/ver/mod.rs` call KERNEL, USER and KEYBOARD as VER calls them. Both engines agree with [[probe:verinst]], with `VER.DLL` on the drive and without it.
