---
kind: topic
name: Where KERNEL looks for a file
summary: The directories Windows 3.1's KERNEL searches for a file named without a directory, in order — for OpenFile, WinExec, LoadModule, LoadLibrary and the libraries a program imports — recorded by a probe that puts a copy in each place and deletes the one found, round after round, and read out of KRNL386.EXE.
probes: [search, curdir, sysdirs, loadenv]
---

A program names a file without a directory all the time: `WinExec("NOTEPAD.EXE")`, `LoadLibrary("BWCC.DLL")`, `OpenFile("GAME.DAT", ...)`, and every library its own module imports, which KERNEL loads by the module's name with `.DLL` added. KERNEL has one search for all of them. `LoadModule` opens the file through `OpenFile`, and `WinExec` and `LoadLibrary` both go through `LoadModule`, so the order is the same wherever a program asks.

## The order

[[probe:search]] makes a directory for each place KERNEL might look and puts a copy of a file in each. It deletes the copy found and asks again, until none is found. It asks this of every entry point: an import, as `SEARCHC.EXE` is started; `LoadLibrary`; `WinExec`; `OpenFile`; and `OpenFile` with `OF_SEARCH`. `SEARCHC.EXE` is started from its own directory, `C:\ORACLE\OWN`. The probe sets PATH to `C:\ORACLE\SP;C:\ORACLE\SQ` in its own environment first. All 51 records agree with winbox.js.

- [[measured]] Every entry point finds the copies in the same order. The search ends with DOS's error 2 once none is left:
  1. the current directory (`C:\ORACLE\SC`);
  2. Windows' directory;
  3. the system directory;
  4. the directory of a program's file;
  5. each directory of PATH, in order.
- [[measured]] **Which program's directory.** For `LoadLibrary`, `WinExec` and `OpenFile` it is the directory of the program that asks. For the libraries a program imports, it is the directory of the program being started. `SEARCHC.EXE` imports `SEARCHD.DLL`, and finds it when the only copy is beside `SEARCHC.EXE`. The probe that starts it lives in `C:\WINDOWS`.
- [[measured]] **PATH is the asking task's own.** PATH is read from the environment of the task that asks, as that environment holds it at the time. A program can change PATH in its own environment, and the change counts. A program it then starts is given the changed block ([[topic:several-programs]]).
- [[measured]] **A name with a directory is not looked for.** `OpenFile("C:\ORACLE\SN\SEARCH2.DAT", OF_EXIST)` fails with DOS's error 3 when `SN` is not there, whatever copies are elsewhere. With `OF_SEARCH`, the search is made for the name alone. The directory named takes the current directory's place: from `C:\ORACLE\SC`, a search for `C:\ORACLE\SQ\SEARCH2.DAT` finds the copy in `SQ` first. After that it goes to Windows', the system directory, the program's, then `SP`, and never to `SC`.
- [[measured]] **One of the first four can be passed over.** KERNEL skips a directory it takes for one it has already looked in. It takes two directories for the same when they are the same length and agree in every letter but the last. A file only in `C:\ORACLE\OWN` is not found from the current directory `C:\ORACLE\OWX`. It is found from `C:\ORACLE\XWN`.
- [[measured]] **A copy already loaded is found by its module's name.** Once a library is loaded, loading it by another directory's path gives the same handle. Freed, it is looked for again from its file. A library a program imported is let go when the program ends, and found again the next time the program starts.
- [[measured]] **A program whose library cannot be found is not started.** Once no copy of `SEARCHD.DLL` is left, `WinExec` of `SEARCHC.EXE` answers 2. This was measured for a library the program imports itself. A library imported by another library has not been measured.

## Inside KERNEL

- [[read out]] `OpenFile` is at `KRNL386.EXE` seg1 `5390`. A name with no directory, or any name given with `OF_SEARCH`, is looked for through a list of four kinds of place (data `0aed`: 1, 2, 3, 4). Kind 1 is the directory the name was made whole against: the current one, or the one named. Kind 2 is Windows' directory, kind 3 the system directory, and kind 4 the directory of a module's file (seg1 `55a3`). An error above 3 from DOS ends the search.
- [[read out]] For kind 4, the module is the running task's, or the task being made while a load is nested inside another (data `246` two or more, data `22a`). `LoadModule` counts that nesting (seg2 `15b6`). It makes the new task before it loads the program's imports (seg2 `181a`, then `1923`), so the imports see the new program's directory. `LoadLibrary` is `LoadModule` with a parameter block of -1 (seg2 `1560`). Inside it no task is being made, so a library's own imports see the directory of the task that asked.
- [[read out]] **The passed-over directory** (seg1 `5610`). Each directory tried goes into a table. A new one is compared with each before it, by length and then `repe cmpsb`. The code takes a count of nought after the compare to mean the two are the same. A difference in the last letter also leaves nought to count, so that directory is skipped.
- [[read out]] **PATH** (seg1 `588e`) is read from the running task's environment: its task database's PDB, then the PDB's environment segment (seg1 `586e`). With no task, KERNEL's own PDB is used. The variable must start with exactly `PATH=`. Each directory runs to a `;` or the end. A `\` is added unless it ends in one. An empty directory leaves `\` alone, the root of the current drive. Every directory is tried, and a failure is error 2.
- [[read out]] **While Windows starts**, before the shell's `InitTask` clears data `32c` (seg2 `26f7`), the list is the system directory and then Windows' (data `0aea`: 3, 2). The shell's own imports are found only there.
- [[read out]] `WinExec` adds `.EXE` to a name with no dot after its last `\` or `/`. It then calls DOS's function 4B00h, which KERNEL takes as `LoadModule` (seg2 `05d0`). `LoadModule` opens a file without `.EXE` with `OF_PROMPT` and `OF_CANCEL` unless the task's error mode has `SEM_NOOPENFILEERRORBOX` (seg2 `1747`). That is why the probe sets that mode.
- [[read out]] KRNL286.EXE has the same lists in its data segment (`0a2a`). DOSBox runs on a 386, so the oracle's standard mode runs KRNL386.EXE. [[probe:environ]] finds `C:\WINDOWS\SYSTEM\KRNL386.EXE` after the environment's strings.
- [[measured]] **Windows' directory lives in the environment.** KERNEL keeps it as a pointer to `windir`'s value in the environment it was given (seg1 `ab63`), and the shell's environment is that same block. When the probe wrote over `windir` while setting PATH, `GetWindowsDirectory` answered `ZZZZZZZZZZ`, and Windows' directory dropped out of every search. The probe now writes PATH into the room the variables before `windir` had, and leaves `windir` where it was.

## In winbox.js

The search is one function in each engine: `searchPlaces` and `searchFile` in `src/win16/kernel/search.ts`, and `search_places` and `search_file` in `crates/winbox-win16/src/search.rs`. `OpenFile`, `WinExec`, `LoadModule`, `LoadLibrary`, SHELL's `locate` and the loading of a program's imports all go through it.

The environment winbox.js gives a program has no PATH, only `windir` ([[topic:task-startup]]), so out of the box the search ends at the program's directory. Windows' directory is a constant in winbox.js, so a program that writes over its environment does not lose it. Nothing records a program doing that apart from the probe.

Not followed:

- the list used while Windows starts. The first program winbox.js runs stands for one started from the shell, so its imports are searched for as any program's are;
- the `WEP` of a library let go as its program ends. It would run after the task has ended;
- a missing library imported by another library, which has not been measured.
