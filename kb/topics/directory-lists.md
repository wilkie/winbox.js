---
kind: topic
name: Directory lists
summary: How Windows 3.1 lists a directory into a list box or combo box — DlgDirList, LB_DIR and CB_DIR, the DOS calls under them, the OEM and ANSI character sets between them, and the Open dialog COMMDLG builds from them — read out of USER.EXE, KEYBOARD.DRV and KRNL386.EXE.
---

A program lists the files on a disk with `DlgDirList`, or by sending `LB_DIR` to a list box or `CB_DIR` to a combo box. `COMMDLG.DLL`'s Open dialog uses all of them. It also makes DOS calls of its own through `Dos3Call`, to find the drives and the current directory. USER does the same through INT 21h. Nothing on this page has been measured yet: it is read out of the binaries, and the DOS calls are DOS as it is documented.

## DOS underneath

- [[documented]] Several INT 21h calls take part:
  - **The drive.** Function 0Eh makes a drive current and answers the number of drive letters. 19h answers which drive is current. A drive that is not there is not made current, so a program finds the drives there are by selecting each in turn and asking 19h which is current.
  - **The directory.** 3Bh changes a drive's current directory, and 47h writes it out, without its drive or its first `\`.
  - [[documented]] 47h leaves AX 0100h when it succeeds, which the DOS references record though DOS's own documentation does not. [[measured]] Write finds the end of the path it was given by scanning for the byte in AL, 0. winbox.js left AX as the program set it, and Write took the path to end at its first `C`.
  - **The search.**
    - 4Eh finds the first entry matching a name, which may hold `*` and `?`, among the attributes asked for.
    - 4Fh finds the next. Each answers into the disk transfer area, which 1Ah sets and 2Fh answers.
    - The answer is a 43-byte record. Its first 21 bytes are for DOS's own use and hold what the next call carries on from; then come the attribute byte, the time, the date, the size and the name.
    - Ordinary files are always found. Hidden, system and directory entries are found only when their bit is asked for, and the volume label only when it is asked for alone.
    - Error 12h, "no more files", ends the search.
- [[documented]] DOSBox, where the oracle's Windows runs, answers 26 drive letters to 0Eh, and winbox.js does the same. MS-DOS answers its `LASTDRIVE`.
- [[measured]] Without these calls, `COMMDLG`'s Open dialog never finished opening. It asked 19h which drive each selection had made current and found none of them. Its loop of 4Fh calls then never met the carry flag that ends it.

## OEM and ANSI

- [[read out]] DOS names files in the OEM character set, code page 437 here. Windows draws in ANSI. `KEYBOARD.DRV` translates between them:
  - The functions are `AnsiToOem` and `OemToAnsi`, and their `Buff` forms (seg10 `0843`, `086c`, `08eb`, `0913`).
  - Bytes 80h to FFh are each looked up in a table of 128, and bytes 01h to 1Fh in a table of 32 before it. 00h and 20h to 7Fh pass unchanged.
  - The tables are in the driver's own code: the code page word at seg10 `06fc`, then ANSI to OEM at `06fe`, then OEM to ANSI at `079e`.
  - A byte is read before it is written, so a string can be translated in place.
- [[read out]] The string forms copy up to and including the null. They carry a pointer that runs off the end of its segment on into the next, and answer FFFFh. The `Buff` forms translate a count of bytes, nulls and all, within their segments; a count of 0 does nothing.
- [[read out]] `SYSTEM.INI`'s `oemansi.bin=` can replace the tables when the driver starts (seg3 `00cd`). The installation leaves it empty.
- [[read out]] `IsDBCSLeadByte` answers FALSE for every byte without looking at it (`KRNL386.EXE` seg1 `8425`). This build has no two-byte characters.

## LB_DIR and CB_DIR

- [[read out]] `LB_DIR` is 40Eh. `CB_DIR` is 405h, and the combo box passes it to its list. The list box fills itself (`USER.EXE` seg37 `0832`):
  - The attributes' low bits go to DOS as they are, so they choose what DOS finds.
  - With `DDL_EXCLUSIVE`, an entry is kept only if it has one of the attributes asked for. `DDL_DIRECTORY | DDL_EXCLUSIVE` therefore lists directories alone.
  - The entry `.` is never kept, and `..` is.
  - Each entry is added as `LB_ADDSTRING` adds, so a sorted list sorts them.
  - With `DDL_DRIVES`, the drives follow, appended in order after the rest whether the list is sorted or not.
- [[read out]] An entry's text depends on what it is:
  - a directory's name in brackets, `[system]` or `[..]`;
  - a file's name bare, `readme.txt`;
  - a drive's letter between dashes in brackets, `[-c-]`.

  Every entry is lowercased, and a name goes through `OemToAnsi` first (seg37 `0a7d`).
- [[read out]] The answer is the list's count less one, or `LB_ERRSPACE`. `LB_ADDFILE` (417h) adds one file's entry and answers its index.

## DlgDirList

- [[read out]] `DlgDirList` and `DlgDirListComboBox` share their code (seg37 `0150`). The path is uppercased where it lies and passed to DOS in OEM characters:
  - **A drive** at its start is made current. A drive that is not there fails, and the drive that was current is restored.
  - **A path with no `*`** is tried as a directory first. If that works, the name listed is `*.*`.
  - **Otherwise** the path must hold a `*` or `?`, or end in `\`, or the call answers FALSE. The directory before its last separator is changed to, and the name after the separator is what is listed.
  - That name is written back over the path, and the call answers TRUE.
- [[read out]] The static control is given the drive and current directory, lowercased: `c:\windows`. When the text does not fit, it is shortened to the drive, `\...\` and as many of the last parts as fit, or to `c:\...` alone (seg37 `0000`).
- [[read out]] The list is emptied, then filled with the files the attributes ask for, less directories and drives. The directories and drives come in a second pass of their own, with `*.*` and `DDL_EXCLUSIVE`. That way the directories show whatever name the files were listed by. With `DDL_POSTMSGS`, the messages are posted instead of sent.
- [[read out]] `DlgDirSelect` and its relatives turn the selected entry back into a path (seg37 `066a`):
  - a directory's brackets become a `\` after its name;
  - `[-c-]` becomes `c:`;
  - a file name without a dot is given one.

  They answer whether the entry was a directory or a drive. The `Ex` forms copy at most the buffer's length, and never more than 128.

## The Open dialog

- [[measured]] Notepad's File Open is `COMMDLG.DLL`'s dialog, running as it is. It needed:
  - these calls;
  - `ScreenToClient`, to place its file name box;
  - a local heap that grows ([[topic:dynamic-link-libraries]]).

  With them it opens the way Windows draws it: the files of the type chosen, the directories from the root down to the current one, the drives, and the file name selected.
- [[read out]] The dialog manager selects a control's text whenever it moves the focus there (seg25 `0000`): the first control when a dialog is made, Tab, the arrows, a mnemonic, `WM_NEXTDLGCTL`. A control that answers `DLGC_HASSETSEL` is sent `EM_SETSEL` before it gets the focus, from 0 to FFFEh for a program made for Windows 3 and to 7FFFh for an older one. Restoring the focus a dialog had when it was last active does not select anything.

## Not yet done

- The details a negative static control identifier asks `DlgDirList` for: each entry's size, date, time and attributes, after tabs.
- `LB_DIR` points the program's disk transfer area into USER's own data and leaves it there. winbox.js leaves the program's alone.
- The disk transfer area is kept for the whole machine, not for each task as KERNEL keeps it.

## In winbox.js

- `src/dos/syscall/find.ts` and `src/dos/syscall/directory.ts` hold the DOS calls.
- `src/win16/keyboard/oem.ts` reads the translation tables out of the driver on the disk.
- `src/win16/user/dlgdir.ts` holds `DlgDirList`, `LB_DIR` and the `DlgDirSelect` family.
- `dlgSetFocus` in `src/win16/user/dialogs.ts` moves the focus the way the dialog manager does.
