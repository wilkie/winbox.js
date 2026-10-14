---
kind: topic
name: Program Manager's DDE interface
summary: The DDE server installers drive in Windows 3.1's Program Manager — the conversations it offers, the execute strings it reads (CreateGroup, AddItem, ReplaceItem, DeleteItem, ShowGroup, DeleteGroup, ExitProgman, Reload) with their exact syntax, defaults and failures, the text it answers for "Groups" and for a group, and what it writes to its group files and PROGMAN.INI.
probes: [progdde, postend]
---

Installers tell Program Manager about the programs they put in by DDE: they connect to the service and topic `PROGMAN`, and send execute strings such as `[CreateGroup(Games)][AddItem(C:\GAMES\GAME.EXE,Game)]`. A WinBox stand-in for this service, for a launcher, is planned in [[guide:without-windows]]; this page is what it follows.

[[probe:progdde]] is a DDEML client, as installers are. It runs as Windows' shell, so it starts `PROGMAN.EXE` with `WinExec` and waits for its window, class `Progman`, and a conversation; Program Manager is then not the shell, which is what lets `[ExitProgman]` end it. It records every answer, the text of every request, and after each change PROGMAN.INI's `[Groups]` and `Order=` and the sizes of the group files. The installation's own groups are Main, Accessories and StartUp.

Everything read out here is `PROGMAN.EXE`. Its DDE code is segment 7; its data segment is segment 8.

## The conversations it offers

- [[read out]] Program Manager answers DDE with its frame window, the one of class `Progman`, and keeps no state for a conversation: messages 3E0h-3E8h go to segment 7's dispatcher (seg2 `228c`-`2296`, seg7 `1416`, table `155e`). Nothing holds DDE back while it starts.
- [[read out]] A `WM_DDE_INITIATE` is matched twice (seg7 `1427`): against application `Shell`, topic `AppProperties`, where a missing application matches; and against `Progman`, `Progman`, where it does not. A missing topic matches either. A match is answered with `WM_DDE_ACK` **sent**, not posted, carrying the two names as new atoms (`0b24`-`0b73`). Before matching, it dispatches every registered message waiting in its queue (`13e9`-`1410`).

[[measured]] What a plain `WM_DDE_INITIATE`, sent to every window, brought back:

| Application, topic       | Conversations offered    |
| ------------------------ | ------------------------ |
| `PROGMAN`, `PROGMAN`     | `Progman`, `Progman`     |
| `progman`, none          | `Progman`, `Progman`     |
| none, none               | `Shell`, `AppProperties` |
| `Shell`, none            | `Shell`, `AppProperties` |
| `Shell`, `AppProperties` | `Shell`, `AppProperties` |
| none, `PROGMAN`          | none                     |

- [[read out]] `WM_DDE_TERMINATE` is answered with a terminate sent back, whether or not there was a conversation (`145b`).
- [[read out]] `WM_DDE_ADVISE`, `WM_DDE_UNADVISE`, `WM_DDE_POKE` and a stray `WM_DDE_DATA` are answered with a negative acknowledgement naming the item; nothing they carry is freed (`153d`, `0000`-`0011`). [[measured]] A DDEML poke and advise start are refused with `DMLERR_NOTPROCESSED`.

## Execute strings

[[read out]] The string is parsed whole before anything is done (`01c8`), then the commands are carried out in order (`0313`). The acknowledgement is posted after all of it, files written and all (`1472`-`149b`): 8000h when every command succeeded, else 0, never busy, and with the command's block, which Program Manager does not free. While it works, every message box it would show is suppressed (flag `[22h]`, seg1 `00fa`), so a failure only fails.

### Syntax

- [[read out]] A command is `[`, a name, optionally `(` arguments `)`, and `]`. Whitespace — any byte up to 20h, compared signed, so bytes 80h-FFh count as whitespace too — may come before and after each part and between commands (`001c`). The name is a run of letters (`IsCharAlpha`), matched without regard to case (`003d`-`00ca`).
- [[read out]] An argument in double quotes runs to the next double quote, commas and brackets included, with no escape; after it, spaces and one comma are skipped, and anything else starts the next argument (`00cd`-`01c5`). An argument without quotes runs to the next comma or `)`, may not contain `[`, `]` or `(`, and loses its trailing whitespace. A comma with nothing before it is an empty argument.
- [[read out]] Any error anywhere in the string fails the parse, and then nothing at all is done. [[measured]] `[AddItem(TERMINAL.EXE,Three)][Bogus][AddItem(CALENDAR.EXE,Four)]` is refused and neither item is made.
- [[read out]] Once parsed, a command that fails stops the rest; those before it stay done (`0aee`-`0afa`).
- [[read out]] Numbers are an optional `-` and decimal digits, read up to the first other character; an empty argument is 0 (seg3 `0285`).

[[measured]] Strings and their acknowledgements:

| String                                              | Answer                                            |
| --------------------------------------------------- | ------------------------------------------------- |
| empty                                               | 8000h                                             |
| three spaces                                        | refused                                           |
| `CreateGroup(Bare)`, no brackets                    | refused                                           |
| `[CreateGroup2(Bad)]`                               | refused                                           |
| `[createGROUP(lower)]`                              | 8000h                                             |
| `  [ CreateGroup ( Spaced )  ]  `                   | 8000h, group `Spaced`                             |
| `[CreateGroup("Unclosed)]`                          | refused                                           |
| `[CreateGroup(a,b,c)]`, `[CreateGroup]`             | refused                                           |
| `[AddItem(SOL.EXE,One)] [AddItem(WINMINE.EXE,Two)]` | 8000h, both made                                  |
| `[AddItem(RECORDER.EXE,"Five"x)]`                   | 8000h: `x` is the third argument, the icon's path |

- [[read out]] An empty string is accepted because the parser's loop ends at once on the terminating nought and answers an empty list (`02ef`-`030b`); a string of only whitespace enters the loop, finds no command and fails (`0211`-`021d`).

### The commands

[[read out]] The names, in the table at DS `02A8`: `CreateGroup`, `AddItem`, `DeleteGroup`, `ExitProgman`, `ShowGroup`, `DeleteItem`, `ReplaceItem`, `Reload` (handlers by the table at seg7 `0ade`).

**CreateGroup(name[, path])** (`036f`)

- [[read out]] One or two arguments. The name is cut to 30 characters. A group of that name, without regard to case, is brought to the top and the command succeeds with nothing made (`03e9`-`0430`). [[measured]] `[CreateGroup("probe group")]` after `Probe Group`: 8000h, and nothing in PROGMAN.INI or on disk changes.
- [[read out]] Otherwise the group file is named from the first eight letters and digits of the name with `.GRP`, in the Windows directory, and where that file exists the eighth character becomes `0`, then `1` and on (seg4 `0d92`-`0ea5`). Given a path, its spaces become `_` and `.GRP` is added where it has no extension; a file there already is loaded (seg4 `2044`, `21b9`-`21e2`). At 40 groups no more are made, and the command still succeeds (seg4 `214e`; its answer is not checked).
- [[measured]] `Probe Group` made `C:\WINDOWS\PROBEGRO.GRP` of 48 bytes; `lower`, `Spaced` and `Named By` (with its path given) made files of 42, 43 and 45 bytes: 37 bytes and the name.
- [[read out]] The group becomes the current one, and PROGMAN.INI is rewritten: `[Groups]` `GroupN=` for every group, and `[Settings]` `Order=` as a space and a number for each, bottom of the window order first (seg4 `2662`-`2826`). [[measured]] `Group4=C:\WINDOWS\PROBEGRO.GRP` was added, and `Order=` read back as `2 3 1 4`.

**AddItem(command[, name[, icon path[, icon index[, x, y[, directory[, hot key[, minimized]]]]]]])** (`0479`)

- [[read out]] One to four arguments, or six to nine: five, an x with no y, is refused (`0486`-`0496`). [[measured]] `[AddItem(C:\WINDOWS\CLOCK.EXE,Clock,,,5)]` is refused. An empty command is refused (`04b1`); [[measured]] `[AddItem(,Empty)]` is.
- [[read out]] With no name, it is made from the command: after the last `\`, before the last `.`, and lower case after a capital (seg5 `00ed`). [[measured]] `C:\WINDOWS\NOTEPAD.EXE` becomes `Notepad`.
- [[read out]] With no directory, it is the command's directory (seg6 `0398`); with no icon path, `FindExecutable`'s answer for the command (`0681`-`0698`); [[measured]] with neither found, the icon path is empty. Without x and y the item is placed where there is room.
- [[read out]] An icon index of 666 or more is less 666 and puts the item at the end of the group; otherwise it goes at the start (`05f8`-`060b`). [[measured]] So items come out newest first: of nine added, the one with index 668 came last, its index 2.
- [[read out]] The group file is written at once (seg4 `147c`). With auto-arrange on, the icons are arranged (`0728`-`0756`).
- [[read out]] It works on the current group: the one last made, or the one last activated (seg2 `1d43`-`1d6c`, seg4 `1f78`).

**DeleteItem(name)** (`08bc`) and **ReplaceItem(name)** (`08ad`)

- [[read out]] One argument. The current group's first item of that name, without regard to case, is deleted and the file written. ReplaceItem keeps the item's position for the next AddItem, even in a later execute; if the item is not found it fails, and the next AddItem is placed where there is room (`08ad`, `05e1`-`05f2`).
- [[measured]] `[ReplaceItem(Notepad)]` took `Notepad` out; `[AddItem(C:\WINDOWS\NOTEPAD.EXE,New Pad)]` then came at Notepad's 21, 0. `[DeleteItem("my calc")]` deleted `My Calc`; `[DeleteItem(Nope)]` and `[ReplaceItem(Nope)]` were refused.

**ShowGroup(name, show)** (`0821`)

- [[read out]] Exactly two arguments; `ShowWindow` of the group with the number as it is. [[measured]] `[ShowGroup(Probe Group)]` and an unknown group are refused; 2, 3 and 1 change what a request says of the group (below).

**DeleteGroup(name)** (`075e`)

- [[read out]] One argument. The group's window goes, its file is deleted, and its `GroupN=` key is written away; `Order=` is not rewritten (seg4 `23af`-`2417`). [[measured]] The four groups deleted lost their files and keys, and `Order= 2 3 1 4 5 6 7` stayed as it was; an unknown group was refused.
- [[measured]] `[CreateGroup(Probe Group)][AddItem(C:\WINDOWS\NOTEPAD.EXE)][DeleteGroup(Probe Group)]` is accepted and leaves no file, the `Order=` its CreateGroup wrote.

**ExitProgman(save)** (`07cf`)

- [[read out]] Refused when Program Manager is the shell: when it was the only task as it started, or `SYSTEM.INI`'s `shell=` begins with `PROGMAN.EXE` (seg3 `0b88`-`0c0a`). It needs one argument; a `1` saves the settings first (seg4 `2845`). It posts itself `WM_CLOSE` and succeeds.
- [[measured]] `[ExitProgman]` is refused. `[ExitProgman(0)]` ends Program Manager, but no acknowledgement comes: the DDEML client waited its ten seconds and was answered `DMLERR_EXECACKTIMEOUT`, and a plain client, waiting until Program Manager's window was gone and after, was posted neither an acknowledgement nor a terminate. [[read out]] Program Manager posts the acknowledgement after `WM_CLOSE`, giving its frame window in `wParam` (`080d`-`0819`, `148e`-`149b`); by the time the client's loop takes it the frame is gone, and `DispatchMessage`'s validation of a DDE message's `wParam` refuses it ([[fn:USER.DispatchMessage]]; `USER.EXE` seg1 `a727`, `af70`, `b34a`). [[measured]] [[probe:postend]] shows the same of a program of its own that posts `WM_DDE_ACK` and ends.
- [[measured]] After it, `Order=` was ` 2 3 1`: rewritten for the groups left.

**Reload([name])** (`0988`)

- [[read out]] With no argument every group is unloaded and loaded again from PROGMAN.INI; with a name, that group from its file. Not yet measured.

## Requests

[[read out]] `WM_DDE_REQUEST` (`14a3`): the items `Groups` and `Progman` answer the list of groups; `GetIcon`, `GetDescription` and `GetWorkingDir` answer for the program Program Manager is starting, as `Shell`'s `AppProperties`; any other item is a group's name. Anything but `CF_TEXT` is refused. The data's header is 3000h, `fResponse` and `fRelease`, without `fAckReq` (`0bb0`-`0be5`).

- [[measured]] `Groups` and `PROGMAN` both answer the groups' names, each ending in a carriage return and line feed, in the order they were loaded and then made: `Accessories`, `StartUp`, `Main` for `Order= 2 3 1`, and new groups after. `Groups` in `CF_OEMTEXT`, and an item that names no group, are refused.
- [[read out]] A group's text (`10ad`-`13da`) is a first line, `"name",file,items,show`, and a line for each item in the group's order: `"name","command",directory,icon path,x,y,icon index,hot key,minimized`. Only the names and the command are quoted, numbers are `%d`, and every line ends in a carriage return and line feed. `show` is 3 for a maximized group, 2 for the current group minimized and 7 for another, 1 for the current group otherwise and 4 for another.

[[measured]] The installation's Main:

```
"Main",C:\WINDOWS\MAIN.GRP,7,1
"File Manager","WINFILE.EXE",,C:\WINDOWS\WINFILE.EXE,21,0,0,0,0
"Control Panel","CONTROL.EXE",,C:\WINDOWS\CONTROL.EXE,96,0,0,0,0
"Print Manager","PRINTMAN.EXE",,C:\WINDOWS\PRINTMAN.EXE,171,0,0,0,0
"Clipboard Viewer","CLIPBRD.EXE",,C:\WINDOWS\CLIPBRD.EXE,246,0,0,0,0
"MS-DOS Prompt","DOSPRMPT.PIF",,PROGMAN.EXE,321,0,9,0,0
"Windows Setup","SETUP.EXE",,C:\WINDOWS\SETUP.EXE,21,72,0,0,0
"PIF Editor","PIFEDIT.EXE",,C:\WINDOWS\PIFEDIT.EXE,96,72,0,0,0
```

[[measured]] The probe's group, after its AddItems:

```
"Probe Group",C:\WINDOWS\PROBEGRO.GRP,8,1
"Five","RECORDER.EXE",,x,225,72,6,0,0
"Two","WINMINE.EXE",,,150,72,6,0,0
"One","SOL.EXE",,,300,0,6,0,0
"Spaced name","C:\WINDOWS\PBRUSH.EXE",C:\WINDOWS,C:\WINDOWS\PBRUSH.EXE,225,0,0,0,0
"Write, it","C:\WINDOWS\WRITE.EXE C:\A,B.WRI",C:\WINDOWS,C:\WINDOWS\WRITE.EXE,0,0,0,1601,0
"My Calc","C:\WINDOWS\CALC.EXE",C:\TEMP,C:\WINDOWS\CALC.EXE,10,20,0,0,1
"Notepad","C:\WINDOWS\NOTEPAD.EXE",C:\WINDOWS,C:\WINDOWS\NOTEPAD.EXE,21,0,0,0,0
"Last","C:\WINDOWS\CARDFILE.EXE",C:\WINDOWS,C:\WINDOWS\PROGMAN.EXE,150,0,2,0,0
```

- [[measured]] An item whose icon could not be found — a program not on the drive, or an icon path of `x` — has icon index 6.
- [[measured]] A quoted command keeps its comma and its argument: `C:\WINDOWS\WRITE.EXE C:\A,B.WRI`, its directory the program's, `C:\WINDOWS`. An unquoted name keeps its inner space and loses the trailing ones: `Spaced name`.
- [[measured]] After `[ShowGroup(Probe Group,2)]` the first line ends in 2, after 3 in 3, after 1 in 1.

## What it writes

- [[measured]] The group files and PROGMAN.INI's `[Groups]` and `Order=` change as each command above says, at once, before the acknowledgement.
- [[measured]] `Order=` is written with a space before each number. Read back by another program straight after the first CreateGroup it was `2 3 1 4`, the file loaded again; after later ones it was ` 2 3 1 4 5 6 7`, the written buffer still held. [[read out]] KERNEL drops a held profile when the file's DOS date and time have changed since it opened it ([[topic:profile-files]], [[probe:profhold]]), and DOS's clock steps every two seconds: under DOSBox, Program Manager's first rewrite came in a later step than its start-up write. The engines' virtual clock does not cross that step there, so these records are a known gap of time, not of the rule.

## In winbox.js

Program Manager is Microsoft's program, run from the installation, and both engines run [[probe:progdde]] whole, its `SYSTEM.INI` naming the probe as the shell, as the recorder has it. What Program Manager asks of the engines underneath, and what had to be followed for it:

- `SHELL`'s `ExtractAssociatedIcon` and `USER`'s `DumpIcon`, for each item's icon ([[fn:SHELL.ExtractAssociatedIcon]], [[fn:USER.DumpIcon]]).
- `DispatchMessage` refusing a DDE message whose sender's window is gone ([[fn:USER.DispatchMessage]]), for `[ExitProgman]`.
- `WM_MDINEXT` walking the children in the order they lie (`USER.EXE` seg15 `0c7f`): deleting the active group makes the one below it active, and `Order=` is written as Windows writes it.
- `_lwrite` of nought bytes ending the file where it is, as DOS's write does: [[read out]] Program Manager writes a group file again and ends it so (seg4 `05e9`), and [[measured]] the probe's group file, recorded byte for byte in its header, items and tags, has nothing after its end.
- [[read out]] Program Manager adds the two atoms it acknowledges an initiate with (seg7 `0b2a`-`0b3f`) and does not delete them (`0b64`-`0b73`); [[topic:dynamic-data-exchange]] has DDEML adding them once more for the service `Progman`.

## Not yet done

- `Reload`, and the `AppProperties` items, measured.
- The `.GRP` file's format, on a page of its own.
- What `ExitProgman`'s `WM_CLOSE` saves when told not to.
- A WinBox stand-in for this service.
