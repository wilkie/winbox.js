---
kind: guide
name: A compatibility database
summary: A design for a database of how Windows 3.x games and applications run on WinBox — a committed catalog of archive.org's Windows 3.x software library, metadata only; what each program needs, found from its files; an automated first pass that fetches, installs and runs each on the survey's clock and groups the failures into a work queue; ratings by people; a table on the site — with a prototype's counts and a sample of ten games, and the decisions still open.
---

This page is a design, with a prototype. The prototype is built: `scripts/catalog/catalog.mjs` writes the catalog, `scripts/catalog/sample.mjs` takes ten games of it through the pipeline once (2026-11-14), and `scripts/catalog/titles.mjs` finds titles from the programs themselves (2026-11-14). Nothing else here is built. It follows the model of [[guide:launcher]] and [[guide:enhanced-mode]].

The corpus (`corpus/README.md`) is some forty programs, chosen for what they exercise and held to what Windows recorded of them under DOSBox, call for call and pixel for pixel. It finds what the probes did not think to ask. A compatibility database is wider and shallower: every Windows 3.x program that can be found, each tried once, with a one-word answer and the reason. It says which programs run, and it turns the ones that do not into a list of gaps, the most common first. A program it turns up that needs a closer look goes into the corpus, and is held to the oracle from then on.

## The catalog

The catalog is a committed file of metadata, one entry for each program. It never holds a program's files, its screens or its call logs: like the corpus's manifest, it says where a program is published and how to check the bytes, and nothing more.

It is `catalog/catalog.json`, at the top of the repository. It is not in `corpus/`, because everything there but the manifest and its README is ignored, and because the two lists differ: the corpus is a sample held to the oracle, and the catalog is everything published. An entry that joins the corpus is copied into `corpus/manifest.json` with its `run`, `survey` and SHA-256, as now.

### Its fields

| Field                 | What it holds                                                                                                                                                                                                                                                                                                                                                                     | From                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `id`                  | The archive.org item's identifier, unchanged. It is unique and stable, and it is what the download's URL is built from.                                                                                                                                                                                                                                                           | the search                                  |
| `title`               | The program's name, chosen from the candidates in `titles` by the rules below ("Titles"). archive.org's own titles are poor: "Windows 3.1 Shareware: nails", after the archive's name.                                                                                                                                                                                            | the program, else `title`                   |
| `titleSource`         | Where `title` came from: `productName`, `fileDescription`, `caption`, `fileIdDiz`, `description`, `setupInf`, `archiveOrg` or `correction`.                                                                                                                                                                                                                                       |                                             |
| `titles`              | Every candidate found, by source, so that a choice can be checked; `archiveOrg` is archive.org's title as it has it.                                                                                                                                                                                                                                                              | the program, `title`                        |
| `version`             | The version found with the title: the version resource's `ProductVersion` (else `FileVersion`), or one split off the chosen text ("v1.2"). `null` if none.                                                                                                                                                                                                                        | the program                                 |
| `copyright`, `credit` | A copyright notice or a year split off the chosen text, or the version resource's `LegalCopyright`; and "by" whom, where a line says so. Only where found.                                                                                                                                                                                                                        | the program                                 |
| `publisher`           | The item's `publisher`, else its `creator`. For shareware, `creator` is usually the author.                                                                                                                                                                                                                                                                                       | `publisher`, `creator`                      |
| `year`                | The first year that `year` or `date` names.                                                                                                                                                                                                                                                                                                                                       | `year`, `date`                              |
| `kind`                | `game` if the item is in the games collection, otherwise `application`.                                                                                                                                                                                                                                                                                                           | `collection`                                |
| `collections`         | The Windows 3.x collections the item is in, without the `softwarelibrary_win3_` prefix.                                                                                                                                                                                                                                                                                           | `collection`                                |
| `form`                | `disc` if a download is a disc's image (`.iso`, `.cue`, `.bin`, `.img` and the like); `installer` if the program the item starts is a setup (`SETUP`, `INSTALL`, `_SETUP` and the like); `loose` if it is run as it is; `none` if the item has no download that holds a program, or is not run in DOSBox (the collection also has Flash items, which archive.org runs in Ruffle). | the file list, `emulator`, `emulator_start` |
| `emulator`            | The emulator archive.org runs the item in: `dosbox` for Windows 3.x programs.                                                                                                                                                                                                                                                                                                     | `emulator`                                  |
| `run`                 | The program archive.org's DOSBox starts: `d:\runapp NAILS.EXE` is `NAILS.EXE`. The first pass checks it against the download.                                                                                                                                                                                                                                                     | `emulator_start`                            |
| `source`              | Each download that holds a program: its file name, size, and archive.org's SHA-1 and MD5.                                                                                                                                                                                                                                                                                         | the file list                               |
| `size`                | The downloads' sizes added together. archive.org's `item_size` is not used: it includes screenshots, thumbnails and derived files, and runs to gigabytes for some items whose program is a few megabytes.                                                                                                                                                                         | the file list                               |
| `sha256`              | Empty until the program is fetched. The first pass fills it as the corpus does (`fetch.mjs --hash`), after checking the download against archive.org's SHA-1.                                                                                                                                                                                                                     | the download                                |
| `needs`               | What the program needs, below. Filled by the first pass; not in the prototype's catalog yet.                                                                                                                                                                                                                                                                                      | the program's files                         |

The uploader's address, which every item's metadata carries, is dropped before the metadata is even cached, and never reaches the catalog. Descriptions are not kept either: they are long, often HTML, and add nothing the table needs.

### What a program needs

These are found from the program's own files where possible, before it runs, and checked against the run where not:

| Need                            | How it is found                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode** (standard or enhanced) | A WATCOM Win386 program or library is bound to the Win386 supervisor, which refuses standard mode with "Not running on a 386 DPMI implementation" ([[topic:win386]]). That string, or a library exporting `Win386LibEntry`, among the program's files names it. The prototype looks for the string in the program and in the libraries of its folder, and runs such a program in enhanced mode. Anything else is standard mode until a run says otherwise. |
| **Display** (16 or 256 colours) | Not decidable from the files alone. A program that imports GDI's palette functions (by ordinal, from its relocations) may want 256 colours; one that only works there says so in a box or in its README. The first pass runs on the 16-colour VGA. A program that asks for more there is tried again on `vga256` ([[guide:launcher]]: a display is kept with an install). [[inferred]]                                                                     |
| **WinG**                        | A module reference to `WING`, read from the New Executable's module reference table, or `GetProcAddress` on WinG's names at run time ([[topic:wing]]).                                                                                                                                                                                                                                                                                                     |
| **Video for Windows**           | A module reference to `MSVIDEO` or `AVIFILE`; `.AVI` files in the download; a setup that installs VfW's runtime.                                                                                                                                                                                                                                                                                                                                           |
| **QuickTime**                   | `.MOV` files in the download, or a setup that installs QuickTime for Windows. Which modules a QuickTime program imports is to be read from one such program before a rule is written for it.                                                                                                                                                                                                                                                               |
| **Win32s**                      | The program's header is `PE`, not `NE` ([[topic:win32s]]), or the setup installs Win32s (its `W32SYS` and `WIN32S` files).                                                                                                                                                                                                                                                                                                                                 |
| **CD**                          | The item's form is `disc`, or the install leaves a program that reads its files from the disc's letter.                                                                                                                                                                                                                                                                                                                                                    |
| **Sound or MIDI**               | A module reference to `MMSYSTEM` or `SOUND`; `.WAV` and `.MID` files in the download; calls to `waveOut` and `midiOut` in the run.                                                                                                                                                                                                                                                                                                                         |
| **Libraries it does not bring** | Every module reference that is neither Windows' own, nor WinBox's, nor in the download (`VBRUN300`, `BWCC`, `CTL3D`, ...). The corpus leaves such programs out. The catalog records them, and a missing library becomes a classification of its own.                                                                                                                                                                                                       |

A setup's `SETUP.INF`, or an `.INF` of its own, lists the files it copies and where, and so names the runtimes it brings (WinG, Win32s, VfW). It is read as data, never run, to fill `needs` before the install, and the install itself confirms it.

The module references are read without running anything: the New Executable header's module reference table (a word each, at 28h in the header, their count at 1Eh) points into its imported names table (at 2Ah), each name a length and its bytes. The prototype's `importsOf` reads them. Imports by ordinal (GDI's palette functions, for example) need the segments' relocation records as well, which it does not read yet.

### Titles

archive.org's titles are poor. [[measured]] Of the 2,284, 1,311 carry the collection's prefix ("Windows 3.1 Shareware: ", 983; "Windows 3.1: ", 328), and 532 are, once it is stripped, exactly the name of the program the item runs: `win3__dare` is "Windows 3.1 Shareware: \_dare", and runs `DARE2DRM.EXE`, which is "Dare To Dream". The owner decided (2026-11-14) that a title comes from the program itself, and that MobyGames and Wikipedia are used later, only to confirm a title and link to it.

`scripts/catalog/titles.mjs` finds the candidates. Each source is tried in this order, and the first that gives a name is taken; the entry keeps every candidate in `titles`, and names the one taken in `titleSource`:

| Source            | What is read                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `productName`     | The main program's version resource (type 16, from the New Executable's resource table at 24h): the `ProductName` of its first string table, in the code page the table's key names (`040904E4`: page 04E4h, 1252).                                                                                                                                                                                          |
| `fileDescription` | The same table's `FileDescription`, where it has no `ProductName`.                                                                                                                                                                                                                                                                                                                                           |
| `caption`         | The program run in WinBox for five seconds of the survey's clock, as the sample runs one, with `trace --captions`, which prints the windows at the top as the run left them, each its class, whether it is shown, whether it is one of USER's message boxes, and its caption. Taken: the first shown window not a dialog (`#32770`), else the first not a dialog, else the first shown; never a message box. |
| `fileIdDiz`       | `FILE_ID.DIZ`'s first line with words in it, read in DOS's code page 437, its frame and decoration taken off, and the part before a dash, a colon, a comma or a full stop.                                                                                                                                                                                                                                   |
| `description`     | The module description: the first entry of the non-resident names table (its file offset at 2Ch in the header, its length at 20h), the part before a dash, a colon or a comma.                                                                                                                                                                                                                               |
| `setupInf`        | A setup's `.INF` (Microsoft's setup toolkit's `[progman.groups]`): the Program Manager item that starts the program; the group's name only where the program is the setup itself, as another program's folder may hold an `.INF` not its own (one item's is Windows' own `SETUP.INF`, whose group is Main).                                                                                                  |
| `archiveOrg`      | archive.org's title, its prefix stripped. The fallback.                                                                                                                                                                                                                                                                                                                                                      |

Then `catalog/titles.json`: corrections by hand, keyed by identifier, each a title and its reason, applied last (`titleSource` is then `correction`).

**What is split off.** A version ("v1.2", "Version 2", "1.20a") becomes `version`; a copyright notice or a year, and what follows it, `copyright`; "by" whom, `credit`. From a caption, "About " is taken off the front, what follows a dash or a spaced colon ("Notepad - [Untitled]", "UW Window : Command Protocol : 0"), a closing bracket's or parenthesis's part ("(Unregistered)") and a game's number ("Solit #233") off the end.

**What is refused**, so the next source is tried:

- a file name: one with an extension, an all-capitals 8.3 name, one with an underscore and no space, a path; or the program's, its module's or the item's own name written all in capitals or all in small letters. Written in mixed case ("DDEWatch", "BartEyes"), the program's own name is the author's spelling of it, and is taken;
- a generic word: "Setup", "Install", "Readme", "Microsoft Windows", "Windows Application", "Untitled", "Warning", "Welcome", "Standard Mode" and their like;
- not a name: a shareware notice's caption ("Please Register", "Shareware Notice", "Unregistered ..."), a setup's ("... Installation"); a compiler sample's description ("Sample Microsoft Windows Application", "My First C++ Windows program"); Visual C++ AppWizard's defaults, the project's name in capitals and "Application" or "MFC Application" ("HANOI MFC Application"); the Klik & Play runtime's own strings, which every game it made carries ("Klik & Play Stand Alone Game"); a program's state in its caption, a time ("Next Break: 01:59") or its keys ("HELP = H ...");
- a sentence, from the program's text: most of its words of four letters or more begin in small letters ("Concentration game with flags of the world"). archive.org's titles are never refused as sentences.

Where every source is refused, the title is archive.org's, stripped.

**Code pages.** Text from a program is data: decoded in the code page its version table names, else Windows-1252, and its control characters made spaces. A text holding a byte Windows-1252 leaves undefined (81h, 8Dh, 8Fh, 90h, 9Dh), or one of the punctuation marks it puts at 80h-9Fh between two letters, was written in a DOS editor, and is read in code page 437 instead: `cmm.exe`'s module description is ",Cin‚tic Mail Manager" in Windows-1252, "Cinétic" in DOS's page. A caption is printed by `trace` a character a byte, and decoded the same way.

[[measured]] 2026-11-14, the 532 items above, one more whose prefix is "Windows 3.1 Freeware: " (`win31_cups`), and `win3__dare`: 534 items. 521 were fetched (77.6 MB) and 13 were already, all matched archive.org's SHA-1; 531 hold a New Executable that was read and run (one names a `.bat`, one a program not in its download, one a file that is not an `MZ` executable).

| Title from                      | Items |
| ------------------------------- | ----: |
| `caption`                       |   335 |
| `description`                   |    74 |
| `fileIdDiz`                     |    43 |
| `productName`                   |     8 |
| `fileDescription`               |     1 |
| `correction`                    |     2 |
| `archiveOrg`, a name            |     2 |
| `archiveOrg`, still a file name |    69 |

Of the 71 left with archive.org's title: 44 ran, and their task ended before they showed a window with a caption (why, program by program, is the first pass's to classify), 4 ran their five seconds without one, 3 stopped at an interrupt WinBox does not answer yet, 2 were not read (above), and in 18 every candidate was refused (an all-capitals caption such as "ATMOIDS", a description "OWLCHESS.EXE"). The candidates found in all: 395 captions, 523 module descriptions, 158 `FILE_ID.DIZ` lines, 11 `ProductName`s, 12 `FileDescription`s, 1 `.INF` item.

A sample, the first 24 by the SHA-1 of the identifier and `win3__dare`:

| Item            | archive.org                     | Title                                                  | From          |
| --------------- | ------------------------------- | ------------------------------------------------------ | ------------- |
| `win3__dare`    | Windows 3.1 Shareware: \_dare   | Dare To Dream                                          | `caption`     |
| `win3_doorway`  | Windows 3.1: doorway            | DOS Doorway                                            | `caption`     |
| `win3_WINANT`   | Windows 3.1 Shareware: WINANT   | WinAnt                                                 | `caption`     |
| `win3_macaw`    | Windows 3.1: macaw              | Multiple Alignment Construction and Analysis Workbench | `description` |
| `win3_SOLUS`    | Windows 3.1 Shareware: SOLUS    | Solus (`version` 1.0)                                  | `caption`     |
| `win3_WLIFE`    | Windows 3.1 Shareware: WLIFE    | W-Life                                                 | `caption`     |
| `win3_modman`   | Windows 3.1: modman             | Module Manager                                         | `description` |
| `win3_WEYES`    | Windows 3.1 Shareware: WEYES    | wEYES!!                                                | `caption`     |
| `win3_WINDOG`   | Windows 3.1 Shareware: WINDOG   | Prairie Dog Hunt for Win                               | `description` |
| `win3_MEGAPIX`  | Windows 3.1 Shareware: MEGAPIX  | MEGAPIX                                                | `archiveOrg`  |
| `win3_SQPLAY`   | Windows 3.1 Shareware: SQPLAY   | SqueezePlay                                            | `caption`     |
| `win3_MONTANA`  | Windows 3.1 Shareware: MONTANA  | Montana Solitaire Game                                 | `caption`     |
| `win3_winfilex` | Windows 3.1: winfilex           | WinFileX                                               | `caption`     |
| `win3_MJSHEL40` | Windows 3.1 Shareware: MJSHEL40 | MJSHEL40                                               | `archiveOrg`  |
| `win3_ABSTRACT` | Windows 3.1 Shareware: ABSTRACT | Abstraction                                            | `caption`     |
| `win3_HEARTS`   | Windows 3.1 Shareware: HEARTS   | Hearts Card Playing Game For Windows                   | `description` |
| `win3_FOOTBALL` | Windows 3.1 Shareware: FOOTBALL | Football for Windows                                   | `caption`     |
| `win3_RACETRK`  | Windows 3.1: RACETRK            | RACETRK                                                | `archiveOrg`  |
| `win3_stopw`    | Windows 3.1: stopw              | stopw                                                  | `archiveOrg`  |
| `win3_ARROW`    | Windows 3.1 Shareware: ARROW    | ARROW                                                  | `archiveOrg`  |
| `win3_cadv`     | Windows 3.1: cadv               | CAD Vantage                                            | `caption`     |
| `win3_fsr`      | Windows 3.1: fsr                | Free System Resources                                  | `caption`     |
| `win3_SQUIRMER` | Windows 3.1 Shareware: SQUIRMER | Squirmer The Game                                      | `caption`     |
| `win3_WCDBRK2`  | Windows 3.1 Shareware: WCDBRK2  | Code Breaker II                                        | `caption`     |
| `win3_dsize`    | Windows 3.1: dsize              | DSize                                                  | `caption`     |

The same reading, without a run, of the 33 other items already fetched (the corpus's and the sample's) gave 26 a title from the program; the rest of the catalog, some 1,750 items, has archive.org's title with its prefix stripped until the first pass fetches it. Over the whole catalog: [[measured]] 489 titles from the programs (335 captions, 89 module descriptions, 53 `FILE_ID.DIZ` lines, 9 `ProductName`s, 1 `FileDescription`), 2 corrections, 1,795 archive.org's.

**Where the order is questionable.** The order puts a program's text before archive.org's title even where archive.org's was already a name: "Tut's Tomb" becomes "Tuts Tomb" (the module description), "Hearts for Windows" "Hearts Card Playing Game For Windows", "Missile Attack!" "Missile Attack". A rule that kept archive.org's title where it is not a file name, and used the program's only to replace a file name, would avoid that; it is the owner's to choose. A module description is often a description, not a name ("Prairie Dog Hunt for Win", "Windows BOGGLE"), and a caption may be a version of the name ("Abstraction" for `ABSTRACT`); MobyGames and Wikipedia are to confirm these.

## Sources

| Source                                                                   | What it gives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | What can be used                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **archive.org's Software Library: Windows 3.x** (`softwarelibrary_win3`) | The programs themselves, each an item with a download, a title, a creator, often a year, and the program its DOSBox starts. The games are `softwarelibrary_win3_games`. There is no single applications collection: the applications are `softwarelibrary_win3_productivity` and `softwarelibrary_win3_desktoptoys`, and two curated collections, `softwarelibrary_win3_showcase` and `softwarelibrary_win3_shareware`, overlap both. `softwarelibrary_win3_winhelp` is help files, not programs, and is left out. The public advanced-search API lists them, and the metadata API gives each item's metadata and file list. No key is needed. | The metadata, which is all the catalog keeps. The programs are fetched only to run them, and are never committed, as with the corpus. Each item's own rights are those of its publisher: the catalog links to the item, and the site does not host any program. |
| **Wikipedia's "List of Windows 3.x games"**                              | Some 880 rows, each a title, a release date and a developer or publisher, as of 2026-11-14 (counted from its wikitext, read through the MediaWiki API). "Index of Windows games" is for Windows 95 onwards and points to this list.                                                                                                                                                                                                                                                                                                                                                                                                            | A checklist for coverage: which known titles the catalog lacks, and a year and publisher where archive.org gives none. Facts such as titles and dates can be used, and any text quoted from it is CC BY-SA, which the kb's own licence matches.                 |
| **MobyGames**                                                            | Games by platform, with publishers, developers and release dates. Its API answers 401 "You must have an API key to use this resource" without one, and its documentation page refused the prototype's request with a 403 (2026-11-14), so its terms were not read here.                                                                                                                                                                                                                                                                                                                                                                        | Nothing yet. If the owner wants it: a key in the owner's name, its terms read first (rate limits, attribution, and whether its data may be stored in a public repository), and it used only for gaps archive.org and Wikipedia leave.                           |

## The automated first pass

Each program goes through the same steps, on WinBox, with nothing run on the host:

1. **Fetch** through the corpus's fetch path (`scripts/corpus/fetch.mjs`, which takes another manifest with `--manifest`). The download is checked against archive.org's SHA-1, its SHA-256 recorded, and a zip unpacked into a folder of its own in `corpus/programs/<id>/`. The unpacker refuses any member whose name leaves that folder. A disc's image is kept whole, to be mounted.
2. **Read** what it needs (above): the header, the module references, `.INF` files, the kinds of files it brings.
3. **Install** where its form is `installer` or `disc`: the setup run as Program Manager starts it, `WIN D:\SETUP.EXE` (`trace --shell`, as the corpus installs Widget Workshop), with a scripted answer to each question: Enter at each box, the default folder. An install leaves a drive whose new program, found from the Program Manager group it made ([[topic:program-manager-dde]]), is what is run next. An installer that asks for more than Enter needs steps of its own, as the corpus's `survey.steps`; the first pass does not write them, and records "installer fails" with the question it stopped at.
4. **Run** for N virtual seconds on the survey's clock, from `C:\CORPUS\<ID>\` on the 16-colour VGA, as the corpus does, with Enter at up to three of USER's boxes. N is ten, as for the corpus. The seconds are instructions run (3,000 a millisecond, each call charged 15; [[topic:timing]]), not the host's time, so the same commit gives the same answer every time.
5. **Classify** the run, from what `trace` printed: the line saying why it stopped, the faults KERNEL reported, and its last calls.

| Status        | Meaning                                                                                                                                                                                                                                                                                                                                                | Signature                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `idle`        | Its seconds passed with a window made and shown, and the program waiting for a message: `GetMessage`, `WaitMessage` or `PeekMessage` among its last thousand calls, or so few instructions run (under a tenth of its seconds') that it spent its time in one. A `GetMessage` still waiting is not in the trace, which prints a call as it is answered. | none                                            |
| `box`         | Its seconds passed in a `MessageBox` of its own, unanswered: the survey answers only USER's boxes that let no program run.                                                                                                                                                                                                                             | its last calls; the box's text is on its screen |
| `running`     | Its seconds passed otherwise: busy, or no window shown.                                                                                                                                                                                                                                                                                                | its last calls                                  |
| `missing`     | It called a function WinBox does not answer yet.                                                                                                                                                                                                                                                                                                       | `MODULE.Name`                                   |
| `unsupported` | An interrupt, a DOS function or something else the engine does not do yet.                                                                                                                                                                                                                                                                             | what it was                                     |
| `fault`       | KERNEL reported a fault, or the processor stopped.                                                                                                                                                                                                                                                                                                     | the fault, and where                            |
| `ended`       | Its task ended within its seconds: done, or a refusal.                                                                                                                                                                                                                                                                                                 | its last calls                                  |
| `win32s`      | It is a Win32 program.                                                                                                                                                                                                                                                                                                                                 | `PE`                                            |
| `library`     | It imports a module that neither WinBox, nor the installation's `WINDOWS` and `SYSTEM`, nor its own folder has: a library it does not bring. Found before it runs.                                                                                                                                                                                     | the modules                                     |
| `installer`   | Its setup did not leave a program to run.                                                                                                                                                                                                                                                                                                              | where the setup stopped                         |
| `fetch`       | Its download failed, did not match archive.org's SHA-1, or does not hold the program the item names.                                                                                                                                                                                                                                                   | why                                             |
| `not-windows` | The program is a DOS program, not a Windows one.                                                                                                                                                                                                                                                                                                       | its header                                      |

A program that needs 386 enhanced mode is not a failure of its own: the Win386 supervisor's refusal among its files (its program or a library in its folder) says so, and it is run in enhanced mode (`trace --mode enhanced`, [[guide:enhanced-mode]]). Its status is that run's, and its `needs` says `enhanced`, so the table can show both. A Win32 program is `win32s`, as WinBox does not run Win32s ([[topic:win32s]]).

`idle` is not "works". It means the program reached the point where a person would start using it, and nothing stopped it on the way. The rest is for people (below).

### What is committed

For each program and each run, a record: the status, the signature, the needs, the WinBox commit it ran on, and the date. It goes in `catalog/results.json`, one line per program, replaced when the program is run again. Nothing of the program is kept: no screen, no call log, no file. Those stay in the gitignored `corpus/cache/catalog/` of whoever ran it, so they can be compared on the next run.

### The work queue

Failures are grouped by signature, and the groups sorted by how many programs each holds: "`USER.Foo` missing, 37 programs", "fault in `WIN87EM` at ..., 12 programs". Each group is a piece of work for the knowledge base's usual method, a read-out and a probe before any change ([[guide:contributing]]). When a commit fixes a signature, the programs that had it are run again, and those that now get further join whatever group they reach next. The queue is made from `catalog/results.json` by a script, and shown on the site (below). It is never edited by hand.

## Human verification

`idle` says a program started. Whether it can be played or used takes a person. A rating is one of:

- **perfect**: no difference from Windows that the person saw;
- **playable**: usable from start to end, with small differences (a colour, a sound, timing);
- **runs with problems**: it runs, but something that matters is wrong or missing;
- **fails**: it cannot be used.

Each rating carries the WinBox commit it was made on, the display and mode, the date, a note, and who made it (a name they choose, or none). A rating made on an older commit is shown as such, and is a reason to look again, not a result.

How ratings are kept, two options:

- **A. Files in the repository.** `catalog/ratings/<id>.json`, a list of ratings for each program, added by pull request. A rating is reviewed like any other change, sits next to the commit it was made on, and is published under the kb's licence with everything else. The cost: a person needs a GitHub account and the patience for a pull request, so fewer people will rate.
- **B. A page people fill in.** A form on the site, or a hosted page with shared storage, where anyone rates in a minute. The cost: storage outside the repository, ratings that nobody reviews, spam to deal with, a privacy notice for whatever is collected, and a way to bring the ratings back into the repository to publish them.

Recommended: **A** first. There will be a handful of people rating at the start, and the repository keeps ratings reviewed and tied to commits at no extra cost. **B** can be added later as a way in that ends in A: a form whose submissions become pull requests, or are copied in by a maintainer.

## Publishing

A page on the kb site, `/compatibility/`, built by `pnpm kb` from `catalog/catalog.json`, `catalog/results.json` and the ratings. It is a sortable, filterable table: title, publisher, year, kind, form, needs, the first pass's status, the latest rating, and the commit of each. Each row links to:

- the archive.org item, where the program is published (never a copy of it);
- for a failure, its signature's group in the work queue, and from there the kb page that explains the gap or the probe that measures it, once one exists ([[topic:win386]] for `enhanced`, [[topic:win32s]] for `win32s`, the function's own page for `missing`);
- the corpus entry, if the program is in the corpus.

The work queue is a second page, the signatures sorted by how many programs each holds.

## Costs

Counted by the prototype on 2026-11-14 (`node scripts/catalog/catalog.mjs --counts`):

[[measured]] 2,284 items: 1,486 games and 798 applications. The collections overlap, so their counts add up to more:

| Collection (`softwarelibrary_win3_...`) | Items |
| --------------------------------------- | ----: |
| `games`                                 | 1,486 |
| `productivity`                          |   525 |
| `desktoptoys`                           |    97 |
| `shareware`                             |    85 |
| `showcase`                              |    57 |
| the parent alone                        |    34 |

| Form        | Games | Applications |   All |
| ----------- | ----: | -----------: | ----: |
| `loose`     | 1,392 |          774 | 2,166 |
| `installer` |    62 |            4 |    66 |
| `disc`      |    13 |            6 |    19 |
| `none`      |    19 |           14 |    33 |

- **Bytes:** 36,359,057,032 in all (33.9 GiB): the games 29.5 GiB, the applications 4.4 GiB. The 114 items over 50 MB hold 34.4 GB of it; the other 2,170 hold some 1.9 GB. The median item is 95 KB, and nine in ten are under 2.3 MB.
- **Year and publisher:** 2,117 name a year, 2,167 a publisher or creator, 2,062 both.
- **The corpus:** 35 of the corpus's 36 archive.org items are in the catalog.
- **`none`:** all 33 are items archive.org runs in an emulator other than DOSBox (Ruffle for Flash, and others), or with no emulator named.
- **Forms are a first guess.** Only 66 items start a program named as a setup, but a large loose item is often a disc's files zipped, and some programs install themselves: the sample's `NICKWART.EXE` is a setup ("Disgruntled Warthog Setup ... Please wait"). The `.img` images may be floppies rather than discs. The first pass corrects `form` from what it finds.

Reading the metadata took 48 minutes (14:31 to 15:19), a request every 1.3 seconds with the half-second pause. The catalog is 981,342 bytes, an entry a line.

**Time per run.** [[measured]] The sample's nine runs (below) took 117 ms to 1.6 s of the host's time each for their ten virtual seconds, 555 ms on average. A program that waits for messages is quick, as the engine passes idle time without running instructions; a busy one runs its 20 to 30 million instructions and takes about 1.5 s. The corpus's 38 programs take 98 to 105 seconds together ([[topic:timing]]), about 2.7 s each, as their reports hold them to more calls. At 1.5 s each, all 2,284 items would take under an hour of runs on one core, before installs. Installs take longer: Lode Runner's setup draws its menu some 27 virtual seconds in, before its system test and its copying ([[topic:win386]]).

**Downloads** dominate. 36.4 GB is about an hour at a sustained 10 MB/s; what archive.org sustains for this was not measured. The 2,170 items under 50 MB are 1.9 GB.

## The prototype

```sh
node scripts/catalog/catalog.mjs            # list, fetch metadata not yet cached, write catalog/catalog.json, count
node scripts/catalog/catalog.mjs --counts   # count the catalog already written
cargo build --release -p winbox-win16 --example trace
node scripts/catalog/sample.mjs             # ten games, fetched, run and classified
node scripts/catalog/titles.mjs --filenames # the items titled by a file name: fetched, read, run for their captions
node scripts/catalog/titles.mjs --fetched   # every item fetched so far read again, without a run
node scripts/catalog/catalog.mjs --titles   # the titles chosen again, and the catalog written
```

`catalog.mjs` lists the collections with archive.org's advanced search, then asks the metadata API for each item, half a second apart, with the User-Agent "WinBox catalog" and no credentials. Each item's answer is cached in `corpus/cache/catalog/` (gitignored), so running it again only asks for new items. `sample.mjs` chooses loose games of DOSBox's, in a single zip of at most 3 MiB and not already in the corpus, in the order of their identifiers' SHA-1 (a spread that is the same each time, not picked by hand). It fetches them through `fetch.mjs --manifest`, checks archive.org's SHA-1, reads each program's header and module references, runs it with `trace` as the corpus does, and classifies the run. Its traces and screens stay in `corpus/cache/catalog/`. `titles.mjs` fetches with the same User-Agent and pause, holds each download to archive.org's SHA-1, unpacks it with the corpus's unpacker into `corpus/programs/catalog/<id>/`, and keeps what it finds of each item in `corpus/cache/catalog/titles/<id>.json`, the run's windows with it, from which `catalog.mjs --titles` chooses; all of it gitignored. Only the chosen title and the short candidate strings reach the catalog.

### The sample

[[measured]] 2026-11-14, WinBox at this page's commit, on the VGA's 16 colours in standard mode. The ten are the first ten `sample.mjs` chooses.

| Item             | Title                      | Publisher (creator)  | Year | Imports beyond Windows' own | Status    | Signature                                                       |   Calls | Host ms |
| ---------------- | -------------------------- | -------------------- | ---- | --------------------------- | --------- | --------------------------------------------------------------- | ------: | ------: |
| `win3_CAN241`    | CAN241 (`CANASTA.EXE`)     | Mark-Jan Harte       | 1994 | `CTL3D`                     | `box`     | after `AnsiToOem`, `OemToAnsi`: "Initialisation Error"          |      24 |     117 |
| `win3_WINANT`    | WINANT                     | David Morrissey      | 1994 |                             | `idle`    |                                                                 |  70,658 |   1,621 |
| `NICKWART_WIN`   | Disgruntled Warthog        | Nickelodeon          | 1995 |                             | `running` | `GetTickCount` again and again, under its setup's "Please wait" | 143,261 |   1,481 |
| `win3_OMYWD1E`   | OMYWD1E (`OHMYWORD.EXE`)   | Greg Martin          | 1993 | `VBRUN200`                  | `idle`    |                                                                 |  10,506 |     297 |
| `win3_SOLUS`     | SOLUS                      | Yorgo Vergos         | 1991 |                             | `idle`    |                                                                 |     567 |     125 |
| `win3_macbla11`  | macbla11 (`MACBLAST.EXE`)  | Earl Gehr            | 1992 |                             | `idle`    |                                                                 |   2,399 |     122 |
| `STONE_Win`      | Stones 1.0 Windows Version | Michael C. Miller    | 1991 | `WEPUTIL`                   | `idle`    |                                                                 |   1,397 |     137 |
| `win3_GettheGi`  | Get the Girl!              | Aldo Baiocchi et al. | 1993 | `VBRUN200`                  | `idle`    |                                                                 |  16,815 |     304 |
| `win3_WLIFE`     | WLIFE                      | Glen Summers         | 1994 |                             | `idle`    |                                                                 |     214 |     788 |
| `win3_Blimp_knp` | Blimp Raid-Weird War I     | Mr. Crispy           |      | `KNPG`, `KNPS`              | `library` | `KNPG`, `KNPS`: Klik & Play's runtime, not in its download      |         |         |

All ten fetched, matched archive.org's SHA-1 and unpacked; none was a Win32 or a Win386 program. What the ten show, and what each would mean as a work queue's entry:

- **`idle` is reached and means something.** SOLUS's screen shows its window with its shareware box over it, waiting; its 567 calls are all it makes before it waits in `GetMessage`. WINANT animates on a timer, `GetMessage` among its last calls.
- **CAN241** puts up its own box, "C:\CORPUS\WIN3CAN2\CANASTA.EXE has been corrupted !", 24 calls in, just after `GetModuleFileName`, `AnsiToOem` and `OemToAnsi`. Why is not followed here. It is a queue entry: a self-check reading its own file, which needs a read-out before anything is said of it.
- **Disgruntled Warthog** is a self-installing program whose `run` is not named as a setup. It shows its setup's box and calls `GetTickCount` for all ten seconds. Whether that is its own wait for more time than ten seconds, or a wait for something WinBox does not give, is not followed.
- **Blimp Raid** needs Klik & Play's runtime, which its archive does not bring (the corpus's `bubgirl` brings its own). It is found from the module references alone, without a run.
- **`MACBLAST.EXE` lists `KERNEL`, `USER` and `KEYBOARD` twice each** in its module reference table: the module names are de-duplicated.

[[measured]] The same classifier on the corpus's 36 programs that are run without steps or a disc, the same way (not held to their reports): 35 `idle`, and `starmerc` `running`. Its window is shown, and then it calls `Dos3Call` some 36,000 times in its ten seconds, 9.6 million instructions, with no message call among its last thousand calls. That is busy by the rule, whether or not Windows does the same; its corpus report is what says whether WinBox agrees with Windows. The 36 runs took 34 seconds of the host's time together, 944 ms each on average; `bubgirl`, Klik & Play, alone took 18 s.

## Phases

1. **The catalog** (the prototype, done): metadata of archive.org's collections, committed.
2. **The first pass on loose programs**: `needs` from the files, run, classify, `catalog/results.json` and the work queue. No installs. A sample first, then all, as the owner's download budget allows.
3. **Installs**: setups and discs run with Enter at each question, the program they leave found from the group they made, then run as in phase 2. Steps of their own for setups that need more.
4. **The site's pages**: the table and the work queue, built by `pnpm kb`.
5. **Ratings**: the chosen way of keeping them, and the table showing them.
6. **Coverage**: Wikipedia's list matched against the catalog by title and year, and what is missing looked for elsewhere. MobyGames if the owner wants it.
7. **Enhanced mode and 256 colours**: programs that need them run again in that mode or display, as each becomes ready ([[guide:enhanced-mode]]).

## Open questions for the owner

1. **Scope**: games first, or games and applications together? The games are 1,486 items (29.5 GiB) and the applications 798 (4.4 GiB). Applications need more steps to be useful (a document opened, a file saved), and their `idle` says less.
2. **Publishing**: the table public on the kb site from the start, or kept local until the first pass covers everything? A public table names programs that fail, by commit.
3. **Download budget**: everything (36.4 GB), everything under 50 MB (2,170 items, 1.9 GB), or a sample first (for example the 1,274 loose games of 3 MiB or less, 366 MB)?
4. **Ratings**: files in the repository (A, recommended), a page people fill in (B), or A with B added later?
5. **MobyGames**: worth a key and its terms, or are archive.org and Wikipedia enough?

## Not yet done

Titles for the some 1,750 items not yet fetched: they have archive.org's title with its prefix stripped until the first pass fetches and runs them, when `titles.mjs` is to read each as it does the 534. The 69 titles still a file name, and the order's question ("Where the order is questionable"). MobyGames and Wikipedia to confirm titles and link to them. `.INF` files of other setup programs than Microsoft's toolkit are not read.

Everything after phase 1. `needs` is not filled in the catalog: the sample reads module references (`importsOf`) and the Win386 supervisor's string, and nothing reads `.INF` files or imports by ordinal yet. The sample does not install, and takes only loose games in one zip. A box's text is not in the trace (the call is printed without its arguments), so the `box` signature is its last calls; the text is on its screen. CAN241's box and Disgruntled Warthog's wait are not followed. The classifier's `idle` rule (a message call among the last thousand, or under a tenth of the seconds' instructions) was checked against the sample's ten screens and the corpus's 36 programs; a program that is busy after showing its window, as `starmerc` is, is `running`, and whether that is right for a given program takes a person.
