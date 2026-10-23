---
kind: topic
name: Program Manager's DDE interface
summary: The DDE server installers drive in Windows 3.1's Program Manager — how it starts and ends and what it writes then, the conversations it offers, the execute strings it reads (CreateGroup, AddItem, ReplaceItem, DeleteItem, ShowGroup, DeleteGroup, ExitProgman, Reload) with their exact syntax, defaults and failures, the text it answers for "Groups" and for a group, and what it writes to its group files and PROGMAN.INI.
probes:
  [progdde, postend, pmatom, ddeinst, pmbare, pmraw, pmsyntax, pmgroups, pmfiles, pmshell, pmstart]
---

Installers tell Program Manager about the programs they put in by DDE: they connect to the service and topic `PROGMAN`, and send execute strings such as `[CreateGroup(Games)][AddItem(C:\GAMES\GAME.EXE,Game)]`. A WinBox stand-in for this service, for a launcher, is planned in [[guide:without-windows]]; this page is what it follows.

[[probe:progdde]] is a DDEML client, as installers are. It runs as Windows' shell, so it starts `PROGMAN.EXE` with `WinExec` and waits for its window, class `Progman`, and a conversation; Program Manager is then not the shell, which is what lets `[ExitProgman]` end it. It records every answer, the text of every request, and after each change PROGMAN.INI's `[Groups]` and `Order=` and the sizes of the group files. The installation's own groups are Main, Accessories and StartUp.

Six more probes take it further, each with Microsoft's Program Manager. [[probe:pmbare]] deletes `PROGMAN.INI` and the installation's group files first, as a drive that has never run it, and records on the VGA and the EGA what it writes as it starts, an installer's script and Caribbean Treasure's exact strings, and each group file whole in hexadecimal. [[probe:pmraw]] talks to it by plain messages. [[probe:pmsyntax]] and [[probe:pmgroups]] take the strings and the groups to their edges; [[probe:pmfiles]] gives it group files an installer copied in itself; and [[probe:pmshell]] is started by it, Program Manager kept as the shell (the recorder's preset `pmshell.progman.ini`, its `[oracle shell]`). The file format is [[format:grp]].

Everything read out here is `PROGMAN.EXE`. Its DDE code is segment 7; its data segment is segment 8.

## Starting

- [[read out]] `WinMain` (seg1 `0010`): a command line makes the show command 7, `SW_SHOWMINNOACTIVE`; then the start-up (seg3 `09fd`), then the message loop.
- [[read out]] **A second instance** gets the first's frame by `GetInstanceData`, sends it 464h, and ends (seg3 `0a12`-`0a3e`). The first, given 464h while it starts an item, takes that item's title, icon and hot key; otherwise it is restored if it is an icon and brought to the top (seg2 `2762`-`287f`). [[measured]] A second `WinExec` of it answered an instance, and after it there was one frame, the first ([[probe:pmstart]]).
- [[read out]] **The shell**: Program Manager is the shell when it is the only task as it starts, or when `SYSTEM.INI`'s `shell=` holds `PROGMAN.EXE`, compared without case at each place along the line (seg3 `0b88`-`0c0a`).
- [[read out]] **Settings**, from `PROGMAN.INI`'s `[Settings]`: `MinOnRun`, `AutoArrange` and `SaveSettings`, defaults 0, 0 and 1; and `[Restrictions]` `NoRun`, `NoClose`, `NoSaveSettings`, `EditLevel`, `NoFileMenu` (seg3 `036e`-`040b`, `04fc`). A read-only `PROGMAN.INI` is said so in a box (`0329`-`0369`).
- [[read out]] **The frame** is placed by `Window=`, five numbers, left, top, right, bottom and a show command; with none it is `CW_USEDEFAULT` and shown normally. A show command given to Program Manager other than `SW_SHOWNORMAL` wins over the file's (seg3 `08ff`-`09d4`, `045c`). [[measured]] With no `PROGMAN.INI` the frame came to 4, 0, 636, 408 on the VGA and 4, 0, 636, 284 on the EGA ([[probe:pmbare]]).
- [[read out]] **The groups** are `[Groups]`' keys of `Group` and digits, not beginning with nought: those `Order=` names, in its order, then the rest in the file's order (seg3 `06c1`-`0806`). Each is loaded from its file ([[format:grp]]): its items listed in slot order, each put first from the last slot down (seg4 `1735`-`1777`), none with a program's instance (`0f92`); its window titled with the group's name (`1efd`) and placed by `SetWindowPlacement` where the file's `nCmdShow` is not nought (`1f04`-`1f51`); the group linked last in the list of groups and made the current one (`1f6a`-`1f78`); and, with `AutoArrange`, its icons arranged (`177f`-`178e`). Then `[Settings]` `display.drv=` is written with `SYSTEM.INI`'s `[boot]` `display.drv=` (seg3 `0809`-`08f7`).
- [[measured]] With no `PROGMAN.INI` and no groups, that is all it writes: `[Settings]`, `display.drv=vga.drv` (`ega.drv` on the EGA) and nothing more: no `Window=`, no `Order=`, no `[Groups]`. Asked for `Groups`, it answers no names ([[probe:pmbare]]). With `display.drv=` already the same, nothing is written at all, KERNEL leaving an unchanged value alone ([[fn:KERNEL.WritePrivateProfileString]]): the installation's `Order= 2 3 1` kept its space ([[probe:pmshell]]).
- [[measured]] Two `GroupN=` naming copies of MAIN.GRP and ACCESSOR.GRP, written before it starts with `Order=` left alone, are loaded after the groups `Order=` names: `Groups` answered Accessories, StartUp, Main, Main, Accessories. `Group07=` and `Groupx=` are not loaded and stay in the file. Asked for `Main`, it answered the copy, the one loaded last ([[probe:pmfiles]]).
- [[read out]] **As the shell** it then starts what `WIN.INI`'s `load=` names, minimized, and `run=`, shown normally, each by `ShellExecute` from the Windows directory, a box for each that fails (seg3 `0221`, `0142`; seg5 `01b3`). Then its command line, if any, and then the StartUp group's items: as the shell, or not the shell with Ctrl held; Shift held skips them; the group is `[Settings]` `startup=`, else its own name for it (seg3 `0ece`-`0ee3`, `00a6`). [[measured]] Started so by `run=`, [[probe:pmshell]] was shown normally, with Program Manager its only other task.

## Ending

- [[read out]] `WM_CLOSE` (seg2 `236d`): with `NoClose`, nothing. With Shift held, the settings are saved and nothing more. Otherwise they are saved where `SaveSettings` is on; the shell then asks whether to end Windows and ends it, and Program Manager not the shell is destroyed.
- [[measured]] Not the shell, with no `PROGMAN.INI` before it started and no groups, closed by a `WM_CLOSE` posted to its frame: its window went, `GetModuleHandle("PROGMAN")` then answered nought, and `PROGMAN.INI` had gained only `Window=4 0 636 408 1` after its `display.drv=` ([[probe:pmstart]]).
- [[read out]] `WM_ENDSESSION` saves the settings where Windows is ending, `SaveSettings` is on and `NoClose` is not (seg2 `2353`-`236a`). `WM_QUERYENDSESSION` is `DefFrameProc`'s, 1. [[measured]] Sent them by [[probe:pmshell]]: `WM_QUERYENDSESSION` answered 1; `WM_ENDSESSION` with nought wrote nothing; with 1 it wrote `Window=10 20 410 320 1`, the frame's new place.
- [[read out]] Saving the settings (seg4 `2845`): nothing with `NoSaveSettings`; else `Window=` from `GetWindowPlacement`, a show command of 7 written as 1; `[Groups]` and `Order=` again; and each group's file with its window's place ([[format:grp]]). [[measured]] After `[ExitProgman(1)]` with no `PROGMAN.INI` before: `display.drv=vga.drv`, `Order= 1 2 3`, `Window=4 0 636 408 1`, `[Groups]` ([[probe:pmbare]]).

## The conversations it offers

- [[read out]] Program Manager answers DDE with its frame window, the one of class `Progman`, and keeps no state for a conversation: messages 3E0h-3E8h go to segment 7's dispatcher (seg2 `228c`-`2296`, seg7 `1416`, table `155e`), and the frame then answers nought (seg2 `2496`, `29d4`). The table: `WM_DDE_INITIATE` `1427`, `WM_DDE_TERMINATE` `145b`, `WM_DDE_ADVISE`, `WM_DDE_UNADVISE`, `WM_DDE_DATA` and `WM_DDE_POKE` `153d`, `WM_DDE_ACK` nothing, `WM_DDE_REQUEST` `14a3`, `WM_DDE_EXECUTE` `1472`. Nothing holds DDE back while it starts.
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

- [[measured]] By plain messages ([[probe:pmraw]]): a `WM_DDE_INITIATE` sent to every window for `PROGMAN`, `PROGMAN`, and for `Shell`, `AppProperties`, each had one answer, Program Manager's. A posted `WM_DDE_EXECUTE` was answered 8000h, or 0 for `[Bogus]`, from the frame and with the same block, which was then whole: its size and flags as before. Two posted before either was answered had an answer each, in turn, each with its own block. An execute posted after a terminate was answered as before.
- [[measured]] A `WM_DDE_REQUEST` for `Groups` was answered `WM_DDE_DATA` with the same atom, its block's first words 3000h and 1, `CF_TEXT`. Asked in `CF_OEMTEXT`, or for a group not there, a negative acknowledgement with the same atom. `WM_DDE_POKE`, `WM_DDE_ADVISE`, `WM_DDE_UNADVISE` and a stray `WM_DDE_DATA` each had a negative acknowledgement with the same atom, and what they carried was left whole ([[probe:pmraw]]).
- [[read out]] `WM_DDE_TERMINATE` is answered with a terminate sent back, with the `lParam` it came with, whether or not there was a conversation (`145b`). It deletes no atom.
- [[read out]] **The atoms**, as the protocol has them: for each pair it might answer, Program Manager adds both names (`0b2a`-`0b3f`) and compares the initiator's atoms with them; on a match it sends `WM_DDE_ACK` with them and keeps no count of its own, as they are the receiver's to delete (`0b64`-`0b73`), and otherwise deletes both (`0b7a`-`0b85`).
- [[measured]] [[probe:pmatom]] counts them by name, deleting each until `GlobalFindAtom` no longer finds it and adding it back. A plain client sending `PROGMAN`, `PROGMAN` counted `Progman` 4 inside Program Manager's acknowledgement -- its own two and Program Manager's two -- and nought once it had deleted its own and the acknowledgement's; `Shell`, `AppProperties` 2 each, then nought. A server of the probe's own, answering the same names the same way, counted the same.
- [[measured]] A DDEML client is another matter: each `DdeConnect` to Program Manager left two counts of `Progman` behind after `DdeDisconnect`, its string handle freed and its instance ended. That is DDEML's, by the atom's number and not by the server: it left the same two for the probe's own server answering `Progman`, and nothing for one answering another name ([[topic:dynamic-data-exchange]], [[fn:DDEML.DdeConnect]]).
- [[read out]] `WM_DDE_ADVISE`, `WM_DDE_UNADVISE`, `WM_DDE_POKE` and a stray `WM_DDE_DATA` are answered with a negative acknowledgement naming the item; nothing they carry is freed (`153d`, `0000`-`0011`). [[measured]] A DDEML poke and advise start are refused with `DMLERR_NOTPROCESSED`.

## Execute strings

[[read out]] The string is parsed whole before anything is done (`01c8`), then the commands are carried out in order (`0313`). The acknowledgement is posted after all of it, files written and all (`1472`-`149b`): 8000h when every command succeeded, else 0, never busy, and with the command's block, which Program Manager does not free. While it works, every message box it would show is suppressed (flag `[22h]`, seg1 `00fa`), so a failure only fails.

### Syntax

- [[read out]] A command is `[`, a name, optionally `(` arguments `)`, and `]`. Whitespace — any byte up to 20h, compared signed, so bytes 80h-FFh count as whitespace too — may come before and after each part and between commands (`001c`). The name is a run of letters (`IsCharAlpha`), matched without regard to case (`003d`-`00ca`).
- [[read out]] An argument in double quotes runs to the next double quote, commas and brackets included, with no escape; after it, spaces and one comma are skipped, and anything else starts the next argument (`00cd`-`01c5`). An argument without quotes runs to the next comma or `)`, may not contain `[`, `]` or `(`, and loses its trailing whitespace. A comma with nothing before it is an empty argument.
- [[read out]] Any error anywhere in the string fails the parse, and then nothing at all is done. [[measured]] `[AddItem(TERMINAL.EXE,Three)][Bogus][AddItem(CALENDAR.EXE,Four)]` is refused and neither item is made.
- [[read out]] Once parsed, a command that fails stops the rest; those before it stay done (`0aee`-`0afa`).
- [[read out]] Numbers are an optional `-` and decimal digits, read up to the first other character; an empty argument is 0 (seg3 `0285`).
- [[read out]] The name is looked up by USER's `lstrcmpi` against the table, a nought put after it for that and taken away again (`0079`, `00bf`). Its letters are `IsCharAlpha`'s, so ANSI letters with accents are letters: `[CreateGroupé(x)]` names no command and is refused.
- [[read out]] After a quoted argument, the whitespace passed is the parser's, bytes 80h-FFh too, and then one comma (`0154`-`016e`).
- [[read out]] The string is read in the client's own block, and written into: each argument is ended by a nought over the comma, the `)`, the closing quote or the first of its trailing whitespace (`010b`-`0116`, `014d`-`0150`, `01b2`-`01b8`), and `CreateGroup`'s cut of its name to 30 characters and `AddItem`'s to 40 are noughts written there too (`03be`, `0512`). The client has its block back so. Not measured: no probe reads its block back.
- [[read out]] An argument without quotes that runs to the end of the string leaves the reader one byte past the string's nought (`02bc`), where it goes on looking for the `]`: `[AddItem(x` is read on into what follows the string in its block.
- [[read out]] The commands read are kept in a block of 100h bytes, `GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT)` (`01dd`), a word each for a command's index, its count of arguments and each argument's offset, and -1 after the last; nothing checks its room. The block is freed once they are done (`0aff`). Where the client's block cannot be locked the answer is 0 and nothing is read (`0333`).
- [[measured]] Bytes of 80h and above are whitespace to the parser: at either end of a name without quotes they go, `Café` making `Caf` and `étGamesAbc été` making `tGamesAbc ét`; inside quotes they stay, `"Quotedabc für é"`. In the middle of a name they stay: `Spielesammlung für` ([[probe:pmsyntax]]).
- [[measured]] Tabs and line ends between commands are whitespace. A missing `]`, text after the last `]`, a second `]`, a `[` or a `(` inside a name without quotes, `[]`, `[(x)]`, `[AddItem()]` and `[AddItem]` are refused. A quote inside a name without quotes is kept, `Ca"lc`; `"Ca""lc"` is two arguments, `Ca` and `lc`; `"Quoted" , "Icon"` two, the comma and spaces between them skipped; `Comma,` with nothing after the comma, accepted ([[probe:pmsyntax]]).

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

- [[read out]] One or two arguments. The name is cut to 30 characters. A group of that name, without regard to case, is brought to the top and the command succeeds with nothing made (`03e9`-`0430`): each group window's title, `GetWindowText` into 101h bytes, compared by `lstrcmpi`, the MDI client's children walked from the top and icons' titles -- windows with an owner -- passed over. `DeleteGroup`, `ShowGroup` and `Reload` find their group so too. [[measured]] `[CreateGroup("probe group")]` after `Probe Group`: 8000h, and nothing in PROGMAN.INI or on disk changes.
- [[read out]] Otherwise the group file is named from the first eight letters and digits of the name with `.GRP`, in the Windows directory, and where that file exists the eighth character becomes `0`, then `1` and on (seg4 `0d92`-`0ea5`). Given a path, its spaces become `_` and `.GRP` is added where it has no extension; a file there already is loaded (seg4 `2044`, `21b9`-`21e2`). At 40 groups no more are made, and the command still succeeds (seg4 `214e`; its answer is not checked).
- [[measured]] A name of more than thirty characters is cut, and a second name the same in its first thirty is the group already there: nothing made. A name with no letter or digit, `!!!` or `"..."`, makes nothing and still succeeds. `Collision One`, `Two`, `Three` and `Collisio` made `COLLISIO.GRP`, `COLLISI0`, `COLLISI1` and `COLLISI2` ([[probe:pmsyntax]]).
- [[measured]] Given the path of a group file not loaded, it is loaded and given the name: `[CreateGroup(Not Its Name,C:\WINDOWS\COPIED.GRP)]`, a copy of ACCESSOR.GRP, made a group of that name with Accessories' thirteen items. Given MAIN.GRP's path, loaded already, nothing was made. `NOEXT` became `NOEXT.GRP`, `A B.GRP` `A_B.GRP`; one in a folder not there, `C:\TEMP\ELSE.GRP`, was not made. Each was answered 8000h ([[probe:pmgroups]]).
- [[measured]] At forty groups, nine more `[CreateGroup]`s were answered 8000h and made nothing; an AddItem went to the fortieth. With one deleted, the next made took the free `Group10=` and went last in `Order=` ([[probe:pmgroups]]).
- Not measured: names with a byte of 80h and above among their first eight letters and digits, which go into the file's name. DOSBox's DOS refuses such a byte in a file's name (its `dos_files.cpp`, `DOS_MakeName`), where MS-DOS takes it, so under the recorder no such group can be made.
- [[measured]] `Probe Group` made `C:\WINDOWS\PROBEGRO.GRP` of 48 bytes; `lower`, `Spaced` and `Named By` (with its path given) made files of 42, 43 and 45 bytes: 37 bytes and the name.
- [[read out]] The group becomes the current one, and PROGMAN.INI is rewritten: `[Groups]` `GroupN=` for every group, and `[Settings]` `Order=` as a space and a number for each, bottom of the window order first (seg4 `2662`-`2826`). [[measured]] `Group4=C:\WINDOWS\PROBEGRO.GRP` was added, and `Order=` read back as `2 3 1 4`.

**AddItem(command[, name[, icon path[, icon index[, x, y[, directory[, hot key[, minimized]]]]]]])** (`0479`)

- [[read out]] One to four arguments, or six to nine: five, an x with no y, is refused (`0486`-`0496`). [[measured]] `[AddItem(C:\WINDOWS\CLOCK.EXE,Clock,,,5)]` is refused. An empty command is refused (`04b1`); [[measured]] `[AddItem(,Empty)]` is.
- [[read out]] With no name, it is made from the command: after the last `\`, before the last `.`, and lower case after a capital (seg5 `00ed`). [[measured]] `C:\WINDOWS\NOTEPAD.EXE` becomes `Notepad`.
- [[read out]] With no directory, it is the command's directory (seg6 `0398`); with no icon path, `FindExecutable`'s answer for the command (`0681`-`0698`); [[measured]] with neither found, the icon path is empty. Without x and y the item is placed where there is room.
- [[read out]] An icon index of 666 or more is less 666 and puts the item at the end of the group; otherwise it goes at the start (`05f8`-`060b`). [[measured]] So items come out newest first: of nine added, the one with index 668 came last, its index 2.
- [[read out]] The group file is written at once (seg4 `147c`). With auto-arrange on, the icons are arranged (`0728`-`0756`).
- [[read out]] It works on the current group: the one last made, or the one last activated (seg2 `1d43`-`1d6c`, seg4 `1f78`). [[measured]] It is Program Manager's, not the conversation's: an AddItem in a later conversation went to the group current before it. With no group at all, AddItem, DeleteItem and ReplaceItem are refused ([[probe:pmgroups]], [[probe:pmbare]]).
- [[read out]] The place is the arguments' x and y where there are six or more, and an empty argument is 0; but after a ReplaceItem it is the place ReplaceItem kept, -1, -1 where it found nothing, and -1 is "where there is room" (seg7 `05e1`-`05f2`, `08ad`-`08b9`). [[measured]] `[AddItem(C:\WINDOWS\CALC.EXE,Empty xy,,,,,)]` came at 0, 0; Caribbean Treasure's AddItem, after its ReplaceItem failed, at 21, 0. Negative places and 32000 are kept ([[probe:pmsyntax]], [[probe:pmbare]]).
- [[read out]] Where there is room: icon cells of `SPI_ICONHORIZONTALSPACING` by `SPI_ICONVERTICALSPACING`, the first, left to right and then down, that no other item's cell overlaps; the first starts at half the spacing less half an icon's cell, `SM_CXICON` and four borders, and two borders more (seg2 `1325`-`15cb`). The width is the group's client area, or its restored rectangle where it is minimized (`1345`-`1366`, `WS_MINIMIZE`). [[measured]] On the VGA six to a row, 21 to 396, rows 72 apart; on the EGA seven, rows 66 apart ([[probe:pmbare]]); and into a minimized group, rows as wide as when it was restored ([[probe:pmgroups]]).
- [[measured]] A name is cut to forty characters; six to nine arguments are taken and ten refused; an icon index past the program's icons, or -1, makes the item's index 6 ([[probe:pmsyntax]]).

**DeleteItem(name)** (`08bc`) and **ReplaceItem(name)** (`08ad`)

- [[read out]] One argument. The current group's first item of that name, without regard to case, is deleted and the file written. ReplaceItem keeps the item's position for the next AddItem, even in a later execute; if the item is not found it fails, and the next AddItem is placed where there is room (`08ad`, `05e1`-`05f2`). ReplaceItem sets its flag and -1, -1 before it looks at its arguments, so one with the wrong count also leaves the next AddItem where there is room; DeleteItem keeps the place too, unused without the flag (`08ad`-`08c7`, `094a`-`0953`)..
- [[measured]] Of three items named `Twin`, `Twin` and `twin`, `[DeleteItem(TWIN)]` deleted the newest, the first in the group's order; `[ReplaceItem(Twin)][AddItem(C:\WINDOWS\SOL.EXE,Replaced)]` put `Replaced` where the next `Twin` was ([[probe:pmgroups]]).
- [[measured]] `[ReplaceItem(Notepad)]` took `Notepad` out; `[AddItem(C:\WINDOWS\NOTEPAD.EXE,New Pad)]` then came at Notepad's 21, 0. `[DeleteItem("my calc")]` deleted `My Calc`; `[DeleteItem(Nope)]` and `[ReplaceItem(Nope)]` were refused.

**ShowGroup(name, show)** (`0821`)

- [[read out]] Exactly two arguments; `ShowWindow` of the group with the number as it is (seg7 `0821`-`08a8`, seg3 `0285`). The answer is whether the group was found; `ShowWindow`'s is not looked at (`089e`-`08a5`), nor `DeleteGroup`'s deleting (`07c1`-`07c7`). [[measured]] `[ShowGroup(Probe Group)]` and an unknown group are refused; 2, 3 and 1 change what a request says of the group (below). `-1`, `1x` and `x` are answered 8000h.
- [[measured]] What each show command did to a group `Shown`, the group `Other` current before, in turn from hidden ([[probe:pmgroups]]). A group's window, a child of the MDI client, is shown by `ShowWindow` without being made active or brought up, but minimized, maximized or restored as `MinMaximize` does it ([[topic:mdi]]).

| Command                 | `Shown` after               | Current group |
| ----------------------- | --------------------------- | ------------- |
| 0, `SW_HIDE`            | hidden                      | Other         |
| 1, `SW_SHOWNORMAL`      | shown, behind Other         | Other         |
| 2, `SW_SHOWMINIMIZED`   | an icon, in front           | Shown         |
| 3, `SW_SHOWMAXIMIZED`   | maximized                   | Shown         |
| 4, `SW_SHOWNOACTIVATE`  | restored                    | Shown         |
| 5, `SW_SHOW`            | as it was                   | Shown         |
| 6, `SW_MINIMIZE`        | an icon, behind every group | Other         |
| 7, `SW_SHOWMINNOACTIVE` | as it was                   | Other         |
| 8, `SW_SHOWNA`          | as it was, still behind     | Other         |
| 9, `SW_RESTORE`         | restored, in front          | Shown         |
| 10, 11                  | as it was                   | Shown         |

**DeleteGroup(name)** (`075e`)

- [[read out]] One argument. The group's window goes, its file is deleted, and its `GroupN=` key is written away; `Order=` is not rewritten (seg4 `23af`-`2417`). [[measured]] The four groups deleted lost their files and keys, and `Order= 2 3 1 4 5 6 7` stayed as it was; an unknown group was refused.
- [[measured]] `[CreateGroup(Probe Group)][AddItem(C:\WINDOWS\NOTEPAD.EXE)][DeleteGroup(Probe Group)]` is accepted and leaves no file, the `Order=` its CreateGroup wrote.

**ExitProgman(save)** (`07cf`)

- [[read out]] Refused when Program Manager is the shell (seg3 `0b88`-`0c0a`, above). It needs one argument; one beginning with `1` saves the settings first (`0802`, seg4 `2845`). It posts itself `WM_CLOSE` and succeeds; `WM_CLOSE` saves them again where `SaveSettings` is on, as it is with none in the file, so `[ExitProgman(0)]` saves too (seg2 `2382`-`2389`). [[measured]] As the shell, `[ExitProgman(1)]`, `[ExitProgman(0)]` and `[ExitProgman]` were all refused, Program Manager still running and `PROGMAN.INI` as it was ([[probe:pmshell]]).
- [[measured]] `[ExitProgman]` is refused. `[ExitProgman(0)]` ends Program Manager, but no acknowledgement comes: the DDEML client waited its ten seconds and was answered `DMLERR_EXECACKTIMEOUT`, and a plain client, waiting until Program Manager's window was gone and after, was posted neither an acknowledgement nor a terminate. [[read out]] Program Manager posts the acknowledgement after `WM_CLOSE`, giving its frame window in `wParam` (`080d`-`0819`, `148e`-`149b`); by the time the client's loop takes it the frame is gone, and `DispatchMessage`'s validation of a DDE message's `wParam` refuses it ([[fn:USER.DispatchMessage]]; `USER.EXE` seg1 `a727`, `af70`, `b34a`). [[measured]] [[probe:postend]] shows the same of a program of its own that posts `WM_DDE_ACK` and ends.
- [[measured]] After it, `Order=` was ` 2 3 1`: rewritten for the groups left.

**Reload([name])** (`0988`)

- [[read out]] With no argument every group is unloaded and loaded again from PROGMAN.INI, the MDI client hidden meanwhile, and `display.drv=` written again; with a name, that group from its file, the name compared with the first 30 characters of each title (`GetWindowText` into 1Fh, `0a66`) (seg7 `0988`-`0acf`, seg3 `0809`).
- [[measured]] [[probe:pmraw]]: a group whose file was replaced by a copy of ACCESSOR.GRP, reloaded, became `Accessories` with its thirteen items, at Accessories' icon place, its file name its own. A group whose file was deleted, reloaded, was answered 8000h and was gone, its `GroupN=` left in the file. `[Reload(Nope)]` and `[Reload(a,b)]` were refused; `[Reload()]` and `[Reload]` were answered 8000h, the groups whose files were there back and the deleted one not. After them `Groups` answered no names, though their windows were there.
- [[read out]] Why: unloading a group (seg4 `1f9a`) takes it out of the list of groups that starts at `[13Ah]` (`2010`-`202f`) but leaves `[13Eh]`, the list's last, alone. Loading links a group after `[13Eh]` (`1f6e`-`1f74`). Once the last group is unloaded, `[13Eh]` is a structure freed, and every group loaded after is linked from it, not from `[13Ah]`: `[Reload]` unloads every group, so the list is empty and stays so, though each group has its window. A group reloaded by name while another was loaded after it is linked last, as the measured `Groups` above has `Accessories` after `Reload Two`.

## Requests

[[read out]] `WM_DDE_REQUEST` (`14a3`): the items `Groups` and `Progman` answer the list of groups; `GetIcon`, `GetDescription` and `GetWorkingDir` answer for the program Program Manager is starting, as `Shell`'s `AppProperties`; any other item is a group's name. Anything but `CF_TEXT` is refused. The data's header is 3000h, `fResponse` and `fRelease`, without `fAckReq` (`0bb0`-`0be5`). The items are found by `GlobalFindAtom` of `Progman`, `Groups`, `GetIcon`, `GetDescription` and `GetWorkingDir`, in that order; none is added. The data is posted with the request's own atom.

- [[read out]] The list of groups (`0b90`-`0c83`): a block of six bytes, `GMEM_DDESHARE | GMEM_MOVEABLE`, the header, `CF_TEXT` and a nought; for each group in the list's order (above), grown by `GlobalReAlloc(GMEM_MOVEABLE)` by its title's length and two, and the title, `GetWindowText` of its window, and a carriage return and line feed put at the end of the text. So the block is six bytes and the text's.

- [[measured]] `Groups` and `PROGMAN` both answer the groups' names, each ending in a carriage return and line feed, in the order they were loaded and then made: `Accessories`, `StartUp`, `Main` for `Order= 2 3 1`, and new groups after. `Groups` in `CF_OEMTEXT`, and an item that names no group, are refused.
- [[read out]] `GetIcon`, `GetDescription` and `GetWorkingDir` take the low word of `lParam` as the asking program's instance, not a format: they answer for the item Program Manager is starting, or for the item whose program has that instance, and otherwise a negative acknowledgement (seg7 `0c8b`-`0cdf`). [[measured]] Asked with nothing being started, by a program it did not start, with either `CF_TEXT` or the instance there, each had a negative acknowledgement naming the item ([[probe:pmraw]]).
- [[read out]] An item has no instance, nought, until its program is started (seg4 `0f92`), so a request whose low word is nought finds the first item of the top group; not measured. `GetDescription` answers the item's name; `GetWorkingDir` its working directory made OEM, its environment variables put in (`DoEnvironmentSubst`, 80h), made ANSI and upper case; `GetIcon` its icon's header, by `GetInternalIconHeader`, and its two planes; each in a block of `GMEM_DDESHARE | GMEM_MOVEABLE | GMEM_ZEROINIT` (`0d64`-`0f8d`).
- [[read out]] A group's text (`10ad`-`13da`) is the group's whose name, as its file has it, `GlobalFindAtom` finds to be the request's atom, the MDI client's children walked from the top and icons' titles passed over; so a name no program has made an atom of has no text. Each field is put on by `0f99`, which grows the block by `GlobalReAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT)` and writes over the text's nought, numbers by `wsprintf`'s `%d`; the block ends in the text's nought and one byte more. An item's place is its place in memory (`[item+6]`, `[item+8]`), and its hot key and minimized are its tags as seg4 `0c5a` reads them: none 0, a record of six bytes 1, of seven its byte, of eight its word. It is a first line, `"name",file,items,show`, and a line for each item in the group's order: `"name","command",directory,icon path,x,y,icon index,hot key,minimized`. Only the names and the command are quoted, numbers are `%d`, and every line ends in a carriage return and line feed. `show` is 3 for a maximized group, 2 for the current group minimized and 7 for another, 1 for the current group otherwise and 4 for another.

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
- [[measured]] `Order=` is written with a space before each number. Read back by another program straight after the first CreateGroup it was `2 3 1 4`, the file loaded again; after later ones it was ` 2 3 1 4 5 6 7`, the written buffer still held ([[topic:profile-files]], [[probe:profhold]]). [[read out]] Program Manager's start-up `display.drv=` is the value the file has, which KERNEL leaves alone and does not write (`KRNL386.EXE` seg1 `6df2`-`6e03`, `7150`), so nothing was held as written before that first CreateGroup. The engines once wrote it, and these three records disagreed; they follow it now ([[fn:KERNEL.WritePrivateProfileString]]).

## Caribbean Treasure's strings

[[measured]] Caribbean Treasure's `SETUP.EXE`, run in an engine with Microsoft's Program Manager already running, does not start Program Manager. For each command it calls `DdeConnect` with `PROGMAN` as service and topic, sends one `XTYP_EXECUTE` with a second's timeout and the string's length counting its nought, and disconnects:

1. `[CreateGroup(Games)]`
2. `[ReplaceItem(Caribbean Treasure)]`
3. `[AddItem(c:\windows\games\carrib.exe,Caribbean Treasure,,,,,c:\windows\games)]`

[[probe:pmbare]] sends them so, on a drive with no group files. The CreateGroup was answered 8000h; the ReplaceItem refused, `DMLERR_NOTPROCESSED`, the new group having no such item; the AddItem answered 8000h, a separate execute, so the failure stops nothing. The item came at 21, 0, where there was room, its command and directory in the installer's lower case, its directory tag `c:\windows\games\`, and, with no program there in the probe, icon index 6. `GAMES.GRP` was 806 bytes, and `Order=` became ` 1 2`. A stand-in answers the ReplaceItem 0 and still takes the AddItem, placing it where there is room, as after any ReplaceItem.

## In winbox.js

Program Manager is Microsoft's program, run from the installation, and both engines run [[probe:progdde]] whole, its `SYSTEM.INI` naming the probe as the shell, as the recorder has it. What Program Manager asks of the engines underneath, and what had to be followed for it:

- `SHELL`'s `ExtractAssociatedIcon` and `USER`'s `DumpIcon`, for each item's icon ([[fn:SHELL.ExtractAssociatedIcon]], [[fn:USER.DumpIcon]]).
- `DispatchMessage` refusing a DDE message whose sender's window is gone ([[fn:USER.DispatchMessage]]), for `[ExitProgman]`.
- `WM_MDINEXT` walking the children in the order they lie (`USER.EXE` seg15 `0c7f`): deleting the active group makes the one below it active, and `Order=` is written as Windows writes it.
- `_lwrite` of nought bytes ending the file where it is, as DOS's write does: [[read out]] Program Manager writes a group file again and ends it so (seg4 `05e9`), and [[measured]] the probe's group file, recorded byte for byte in its header, items and tags, has nothing after its end.
- A child minimized, maximized or restored by `ShowWindow` as `MinMaximize` does it, with `WM_CHILDACTIVATE` and the MDI child made active; a child minimized with `SW_MINIMIZE` put behind its brothers and the first other made active; and `GWL_STYLE` holding `WS_MINIMIZE` and `WS_MAXIMIZE` ([[topic:mdi]]), for [[probe:pmgroups]]' `[ShowGroup]`s and a minimized group's room.
- `SetWindowPlacement`'s `WPF_SETMINPOSITION`, for a group's icon where its file says; `ExtractIcon` of a file beginning with a word of nought, a PIF's, answering nought ([[fn:SHELL.ExtractAssociatedIcon]]); an icon's colours on the EGA matched as its driver matches them ([[topic:window-states]]); a caption's bytes of 80h and above given back as they were set; a profile's unchanged value not written ([[fn:KERNEL.WritePrivateProfileString]]); `DefWindowProc`'s `WM_QUERYENDSESSION`, 1; and, in the TypeScript engine, a file not made over a folder.
- The atoms of a connection, as above: [[probe:pmatom]] runs whole on both engines, Program Manager Microsoft's and DDEML WinBox's own, and every record agrees, the two counts DDEML leaves for each connection included.

DDEML is WinBox's own ([[topic:dynamic-data-exchange]]): [[probe:progdde]]'s execute strings and requests reach Program Manager through it, with `DDEML.DLL` on the drive and with none, in both engines (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`). [[probe:ddeinst]] is an installer's last step on its own: Program Manager started if it is not running, one execute string -- `[CreateGroup(WinBox Games)]`, two `[AddItem]`s, `[ShowGroup]` -- and the group's text asked for. [[measured]] It was answered 8000h, and the group's text named `C:\WINDOWS\WINBOXGA.GRP`, its two items placed at 21,0 and 96,0, newest first, each with icon index 6 and no icon path. A session in each engine (`crates/winbox-web/tests/program_manager_dde.rs`, and `ddeinst` in `test/win16/ddeml_test.ts`) runs it beside Program Manager, with the file and with none. Both look for the same windows as it runs: Program Manager's frame, titled "Program Manager", the window that answers DDE (seg2 `228c`-`2296`, seg7 `1416`); and the group's, which `[CreateGroup]` makes and `[ShowGroup]` shows (seg7 `036f`, `0821`). The group's file holds the two items, and `PROGMAN.INI` names it.

All six pm probes run whole in both engines, Program Manager Microsoft's, and every record agrees: [[probe:pmbare]] on the VGA and the EGA, [[probe:pmshell]] with Program Manager the shell as the recorder makes it (`run-probe.ts`, `tests/support`: the preset's `[oracle shell]`).

### WinBox's own

Where a program starts `PROGMAN.EXE` -- by `WinExec` or `LoadModule` -- and no such file is found, both engines start WinBox's own Program Manager in its place: a task with no file, module `PROGMAN`, described "WinBox Program Manager". An installation's own `PROGMAN.EXE` is found first and is Microsoft's. Nothing else starts it, so an ordinary run, a probe's or the corpus's never has it (`crates/winbox-win16/src/progman/`, `src/win16/progman/`).

It is made as a program and a library it calls are:

- **The program** is an executable made in memory, the same 2,504 bytes in both engines, and loaded, linked and made a task as any program's file is, so its data segment is its instance, `hPrevInstance` and `GetModuleFileName` are a program's (`C:\WINDOWS\PROGMAN.EXE`), and it ends as a program ends. Its header has `PROGMAN.EXE`'s sizes: a data segment of 8A3h bytes and a word more, a heap of 200h, a stack of 17D0h, Windows 3.10. Its one code segment is a C program's start-up: `InitTask`, `WaitEvent(0)`, `InitApp`, a far call to `WinMain`, and DOS's function 4Ch with its answer.
- **WinBox's code** is a module WinBox keeps once Program Manager first starts, as it keeps its sound card's driver: its exports are `WinMain`, whose address the start-up finds in the program's data, and the frame's window procedure. `GetModuleHandle("PROGMAN")` answers its handle, which the program's module is given while an instance runs. Each is engine code calling KERNEL, USER and SHELL through their exports as the file calls them, as WinBox's DDEML does ([[topic:dynamic-data-exchange]]), and keeping what `PROGMAN.EXE` keeps in its data segment at the same offsets in its own: the frame at 126h, which a second instance reads by `GetInstanceData`, the MDI client at 76Ch, the settings at 12h-2Eh.

What it does, as read out above: `WinMain`'s show command; a second instance's 464h and its end; the shell test; `SetErrorMode(1)`; the four registered messages; the class `Progman`; the settings and `Window=`; the frame, `CreateWindow` of `Progman` titled "Program Manager", `WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN`, `CW_USEDEFAULT` with no `Window=`, with `PROGMAN.EXE`'s menu, made from its menu 5, `E&xit Windows...` made `E&xit` where it is not the shell, and the options checked; in its `WM_CREATE`, `RegisterShellHook` and the MDI client over its client; `[Groups]` and `Order=` read; `display.drv=` written; the MDI client shown; the message loop with `TranslateMDISysAccel`; and its frame's `WM_SIZE`, `WM_CLOSE` not the shell, `WM_DESTROY`, `WM_ENDSESSION`, `WM_SYSCOMMAND` with `NoClose`, 464h and `ACTIVATESHELLWINDOW`, the rest `DefFrameProc`'s.

- **Hidden**, by the owner's decision: the frame is never shown, so the show command -- `WinMain`'s, or `Window=`'s -- is not used, and the frame is not painted, made active or given the keyboard. `GetWindowRect` still answers its place, `IsWindowVisible` nought. Its keys are not translated: it has no accelerators, and the frame's own key handling is for when it is active.
- [[measured]] [[probe:pmstart]], run with `PROGMAN.EXE` taken off the installation and on the asset bundle's base, which has none, agrees with Windows' records, Microsoft's Program Manager running, in every record but two: `IsWindowVisible`, nought; and `PROGMAN.INI` after it closed, which lacks `Window=`, as it does not yet save. Its module found by name, its instance's file, its title, its frame at 4, 0, 636, 408 and its MDI client 624 by 362, the menu's line taken from its client as from Microsoft's, `[Settings]` `display.drv=vga.drv` as it started, a second instance ending with one frame left, and its window and module gone once closed, agree (`crates/winbox-win16/tests/progman.rs`, `test/win16/progman_test.ts`). With the file, Microsoft's agrees but for `GetModuleHandle`, which WinBox answers nought for a program loaded from its file ([[fn:KERNEL.GetModuleHandle]]).

#### Its DDE

Its frame answers 3E0h-3E8h as seg7 does, as read out above (`dde.rs`, `dde.ts`): the queued registered messages dispatched and the two pairs offered with `WM_DDE_ACK` sent; a terminate sent back; advise, unadvise, poke and a stray data refused naming the item; an execute's string read whole in the client's block by the parser as read out (`parse.rs`, `parse.ts`), each command decided by its handler's checks (`commands.rs`, `commands.ts`), the acknowledgement posted after with the block; a request answered with the list of groups, a group's text or an `AppProperties` item, or refused. Its calls are the file's: `IsCharAlpha` and `lstrcmpi` for names, `GlobalFindAtom` for items, `GlobalAlloc` and `GlobalReAlloc` for the data.

Its groups are read as start-up reads them -- `[Groups]`' keys in `Order=`'s order, each file by `_lopen` and `_lread` -- into the group model ([[format:grp]]; `loaded.rs`, `loaded.ts`), in the order loaded, the last current and on top, each window's state the one its file's `nCmdShow` would give it. They have no windows yet. The list of groups, a group's text and the items `DeleteItem` and `ReplaceItem` look for are read from them.

What a command changes is not done yet: no group, item, window or file is made, shown, deleted or written, and `Reload` loads nothing again. A command's answer follows the file where it does not hang on that: `CreateGroup`, `ExitProgman` and `Reload` with no argument are done; `DeleteGroup`, `ShowGroup` and `Reload` of a group are done where the group is found, `DeleteItem` and `ReplaceItem` where the item is; their arguments are checked as the file checks them. `AddItem`, whose answer is the item made, fails once its arguments are checked.

- [[measured]] Run with `PROGMAN.EXE` taken off the installation, so that WinBox's answers, both engines agree with Windows' records, Microsoft's Program Manager running, in every record that does not hang on a command's change (`crates/winbox-win16/tests/progman_dde.rs`, `test/win16/progman_dde_test.ts`): [[probe:pmatom]] whole, 100 records; [[probe:progdde]] 45 of 83 -- its initiates, the list of groups and Main's text before anything is made, the refused poke and advise, every execute refused by the parser or a handler's checks, `CreateGroup`s, `[ExitProgman]` refused and `[ExitProgman(0)]` ending it with no acknowledgement; [[probe:pmraw]] 26 of 46 -- the broadcast initiates, the posted executes' blocks, `[Bogus]` and the empty string, every refusal naming its item and leaving what came whole, the `AppProperties` items, the terminate; [[probe:ddeinst]] 4 of 6; and [[probe:pmsyntax]] 27 of 106 -- every name of `CreateGroup` and every string the parser refuses. The records left out, each with why, are in `test/win16/progman-dde-gaps.json`, which both tests read.

## Not yet done

- The `AppProperties` items for a program Program Manager started, and the boxes it shows as it starts for a group file it cannot load (system-modal, [[format:grp]]).
- `load=`, and the StartUp group's items, measured.
- WinBox's own Program Manager, beyond starting, ending and its DDE: what its commands change -- a group made (seg4 `210e`), an item made (`105d`), deleted (`15a8`), a group deleted (`23af`), shown, unloaded and loaded again (`1f9a`, `1d4d`), the files and `PROGMAN.INI` written -- on which `AddItem`'s answer and much of [[probe:progdde]], [[probe:pmraw]] and [[probe:pmsyntax]] hang; `GetIcon` for an item; the boxes it shows for a group file it cannot load; the parser's list past 100h bytes; its groups' windows and icons, and arranging them with `AutoArrange`; saving its settings and group files (seg4 `2845`), `Window=` first; as the shell, `load=`, `run=` and the StartUp group, and `WM_CLOSE` asking to end Windows -- it does nothing yet; its command line; the classes `PMGroup` and `pmhotkey`; its `WH_MSGFILTER` hook; its menus' commands, `WM_INITMENU`, `WM_MENUSELECT`, `WM_WININICHANGE`, `ShellHelp`, 465h and 466h; and 464h and `OTHERWINDOWCREATED` for a program one of its items started. And it as the shell in install runs.
