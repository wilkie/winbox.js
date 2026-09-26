---
kind: topic
name: Temporary files
summary: How Windows 3.1 names and makes a temporary file — GetTempFileName and GetTempDrive — and the DOS file calls under them, read out of KRNL386.EXE.
---

Calendar, Cardfile and Write each make a temporary file as they start. They refuse to go on without one. KERNEL names it and makes it through DOS. Nothing on this page has been measured: it is read out of `KRNL386.EXE`, and the DOS calls are DOS as documented.

## GetTempDrive

- [[read out]] `GetTempDrive` answers a drive letter in its low byte and a colon in its high byte (seg3 `0508`).
  - With `TF_FORCEDRIVE` (80h), the answer is the drive given, or the current drive for nought.
  - Otherwise the answer is the first fixed disk, A: to Z:, **whatever drive was given**. Only when there is no fixed disk is it the drive given.
  - `TEMP` is not looked at.

## GetTempFileName

- [[read out]] **The directory** (seg3 `056a`):
  - With `TF_FORCEDRIVE`: that drive alone, `X:`, relative to its current directory.
  - Otherwise: the task's `TEMP` variable as it is written, or, without one, the Windows directory. A `TEMP` with no drive of its own takes `GetTempDrive`'s.
  - A backslash follows if the directory has none.
- [[read out]] **The name** is `~`, then up to three characters of the prefix as given, then four upper-case hexadecimal digits, then `.TMP`. For example, `C:\WINDOWS\~CAL1A2B.TMP`.
- [[read out]] **With `uUnique` nought:**
  - The number is the time's seconds and hundredths exclusive-ored with its hours and minutes (DOS 2Ch), or 1 if that comes to nought.
  - The file is made with DOS 5Bh, "create new", and closed, left empty on the disk.
  - A file there already (error 50h) moves the number on by one, and it tries again.
  - Any other error answers nought.
- [[read out]] **With `uUnique` given:** the name is only formatted with it, and nothing is made.
- [[read out]] The name is written to the buffer either way, and the number is the answer.
- [[measured]] With `GetTempFileName` a stub, Calendar and Cardfile said they could not make their temporary file, and Write gave up.

## The DOS calls

- [[documented]] Programs make and write files through the same DOS functions:
  - 3Ch creates a file, emptying one that is there;
  - 5Bh creates one only if it is not there, and fails with 50h if it is;
  - 40h writes at the file's position;
  - 41h deletes a file.

  A path that does not begin at the root is taken from the drive's current directory.
- [[documented]] `OpenFile` with `OF_CREATE` makes a file there already empty again, and `OF_DELETE` deletes it.

## Not yet done

- The DOS attribute (43h) and rename (56h) calls.
- The file's attributes, which 3Ch and 5Bh take and winbox.js ignores.

## In winbox.js

- `src/win16/kernel/GetTempFileName.ts` holds both functions.
- `src/dos/syscall/files.ts` holds the DOS calls.
