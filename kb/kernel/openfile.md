---
kind: function
module: KERNEL
name: OpenFile
ordinal: 74
summary: Opens, makes, deletes, looks for or parses a file as its flags say, answering DOS's handle -- even for OF_EXIST and OF_DELETE, which close it first -- and filling an OFSTRUCT with the path, a count, the file's date and time, and DOS's error.
versions:
  '3.1': exact
probes: [openfile, search, mmio, devinfo]
source: src/win16/kernel/OpenFile.ts
---

## Observed behaviour

[[probe:openfile]] calls `OpenFile` with each of its actions and records the answer and the whole `OFSTRUCT`, filled with EEh before each call. Both engines agree with all 38 records.

- [[measured]] **The answer is DOS's handle, whatever the action.** With the probe's own file open as handle 5, a file opened is 6, and 7 while another is held open. `OF_EXIST` answers 6 too, the handle it opened and closed, and so does `OF_DELETE`, and `OF_CREATE | OF_EXIST`. winbox.js had answered 1 for `OF_EXIST`. Failing, the answer is `HFILE_ERROR`, -1. `OF_PARSE` answers nought.
- [[measured]] **The structure of a file opened** (and of a name parsed): `cBytes` is the length of the path and 8, the offset of the path's nought, not the structure's size: 28 for `C:\ORACLE\OFTEST.DAT`. `fFixedDisk` is 1 on drive C:. `nErrCode` is nought. The four reserved bytes are the file's date and time as DOS's function 5700h gives them, the date's word first. `szPathName` is the path made whole, in capitals.
- [[measured]] **The structure of a call that fails** has only `nErrCode` and `szPathName` written: the count, the fixed disk and the reserved bytes are left as the caller had them. The error is DOS's: 2 for a file not there, 3 for a directory not there. The path is the name made whole before the search, so `OFTEST.DAT` asked without a directory and not found reads `C:\WINDOWS\OFTEST.DAT`, the current directory's ([[topic:finding-files]]).
- [[measured]] **Access and sharing flags** are handed to DOS's open, function 3Dh, as its mode. Under DOSBox none of them failed: `OF_WRITE` and `OF_READWRITE` opened a read-only file, and `OF_EXIST` opened a file held open with `OF_SHARE_EXCLUSIVE`. That is DOSBox's DOS, not a rule of KERNEL's; a DOS with SHARE loaded would refuse them.
- [[measured]] **`OF_CREATE`** makes the file empty if it is there: 0 bytes after `abc` was written. It answers the handle, open, and with `OF_EXIST` closed.
- [[measured]] **`OF_DELETE`** opens the file, closes it and deletes it, and answers the handle. A file not there is `HFILE_ERROR` and error 2, as for any open.
- [[measured]] **`OF_REOPEN`** opens the path the structure holds; the name given is not looked at. It writes only the reserved bytes, the date and time; the count, the fixed disk, the error and the path stay as they were. A path not there is `HFILE_ERROR` with error 2. With `OF_CREATE` it makes the file the structure names; with `OF_DELETE` it deletes it.
- [[measured]] **`OF_VERIFY`** with `OF_REOPEN`: the file opened is closed again and `HFILE_ERROR` answered when its date or time is not the structure's reserved bytes, with error nought and the bytes left alone. With them the same, it answers the handle.
- [[measured]] **`OF_PARSE`** answers nought and fills the structure as for a file opened, the count, the fixed disk and the path, for a file there or not. The reserved bytes are neither the caller's nor the file's date: see below.
- [[measured]] **`OF_PROMPT`** with a file not found brings up USER's system error box, "File Error", "Cannot find NOFILE.DAT" with a Close button, before `OpenFile` answers `HFILE_ERROR`. It says the name after the last `\`, whether the file or its directory was missing. A file that is there brings up nothing.
- [[measured]] **`OF_CANCEL`** changes nothing: with `OF_EXIST` it fails as `OF_EXIST` does, and with `OF_PROMPT` the box has Close alone, no Cancel.

## Nuances

- [[documented]] `OF_VERIFY` and `OF_SEARCH` are the same bit, 400h. KERNEL reads it as `OF_VERIFY` only with `OF_REOPEN`, and as `OF_SEARCH` otherwise.
- [[read out]] `OF_PARSE` closes no file but asks DOS's 5700h about handle nought, the console, and keeps whatever it answers in the reserved bytes (seg1 `57bb`, the handle given nought at `53fc`). Under DOSBox that is date nought and a time. winbox.js writes nought for both, as its DOS keeps no date for the console: the probe records only that the bytes are neither the caller's nor the file's.
- [[read out]] `OF_PARSE` given with `OF_EXIST` or `OF_DELETE` would close handle nought, and with `OF_DELETE` delete the file named, since the same tail runs (`57ce`). Not yet measured.
- [[read out]] A name KERNEL cannot make whole (seg1 `53cc`) fails with error 2 and no box, whatever the flags.

## Inside Windows

[[read out]] `KRNL386.EXE` seg1 `5390`.

1. `OF_REOPEN` (`539c`) goes to its own routine, `54ad`: DOS's 3Dh with the low byte of the flags as the mode, or 3Ch with `OF_CREATE`; 5700h for the date and time; with `OF_VERIFY` (`54f1`) the two compared with the reserved bytes, and a difference closed and answered -1 with error nought (`5544`); the date and time stored; then, for `OF_EXIST` or `OF_DELETE` (`5509`), the handle closed, and for `OF_DELETE` the path deleted with 41h. A failing DOS call puts DOS's extended error, from 59h, in `nErrCode` (`552d`). The handle is answered.
2. Otherwise the name is made whole into KERNEL's buffer (`5565`, `5a34`). Failing, error 2 (`53d3`).
3. `OF_PARSE` (`53f1`) goes straight to the structure's filling with handle nought.
4. A name with a directory and no `OF_SEARCH` is opened in that directory alone; any other is looked for through KERNEL's list of places and the PATH ([[topic:finding-files]]). Each try (`5690`) is 3Dh, or 3Ch with `OF_CREATE`, which takes the first place tried. An error above 3 ends the search (`5457`).
5. Found, the structure is filled (`575f`): the path copied in, `cBytes` the path's length and 8 (`5768`-`5776`), `nErrCode` nought, `fFixedDisk` nought only for a drive that KERNEL's drive check calls removable (`579d`-`57b7`), and the date and time from 5700h in the reserved bytes, date first (`57c6`). Then `OF_EXIST` or `OF_DELETE` (`57ce`) closes the handle, and `OF_DELETE` deletes the file (`57e9`); after a delete that works, a 1 is loaded and at once replaced by the handle (`57f0`-`580a`). The handle is answered.
6. Not found (`5814`): an error of nought is made 2. With `OF_PROMPT`, once KERNEL has started (data `281h`) and when the name after the last `\` is not empty, the box is shown (`5994`): the caption "File Error" and the text "Cannot find " and the name, from KERNEL's data `640h` and `64Bh`, through USER's `SysErrorBox` (data `2D0h`) with Close as the middle button, default (8008h), if USER has given KERNEL that function. No flag adds a Cancel button. Then `nErrCode` and the path made whole are written, and -1 answered.

## Implementation

`OpenFile` in `src/win16/kernel/OpenFile.ts` and `open_file` in `crates/winbox-win16/src/files_kernel.rs`, whose box is shown by `open_file` in `crates/winbox-win16/src/kernel_calls/file_cdr.rs`. DOS's 5700h, which both use for the date and time, is `fileStamp` in `src/dos/syscall/files.ts` and `handle_stamp` in `crates/winbox-win16/src/dos.rs`. The search is [[topic:finding-files]]'s.

Not followed: DOS's sharing and read-only refusals, which DOSBox's DOS does not make either.
