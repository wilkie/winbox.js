---
kind: topic
name: USER's exports for Windows' own components
summary: The map of USER's and SHELL's exports that no SDK header declares -- who imports each across the Windows installations and the corpus, what each does inside Windows 3.1 as read out of USER.EXE and SHELL.DLL, how they fit together, and what WinBox answers for each and why.
probes:
  [
    userint,
    usermore,
    sysdbg,
    iconid,
    intpos,
    aboutdp,
    iextract,
    wplace,
    systimer,
    strfunc,
    hwevent,
    userproc,
    filport,
    dragobj,
    findexe,
    oemlayer,
  ]
---

USER exports some sixty functions no program is meant to call: KERNEL calls them as tasks start and end, the display and keyboard drivers as they switch the screen, WINOLDAP for DOS programs' windows, the debuggers, and USER itself through its own dialogs' procedures, which are exported only so that `DialogBox` can be given them. Some are named in jest -- `Bear` and a number, `BozosLiveHere`, `WinOldAppHackOMatic`. SHELL has a handful of its own. WinBox keeps its own USER and SHELL ([[guide:without-windows]]), and answers such an export where what it does can be seen by a program and read out whole, as a program finds it where Windows' answer depends on Windows' own innards, and leaves it -- not applicable -- where it is no function a program can call.

## How the census was made

`scripts/kb/kernel-callers.mjs`, the census [[topic:kernel-internals]] describes, now takes `--module`: `--module USER --out kb/data/user-callers.json` and `--module SHELL --out kb/data/shell-callers.json` read the same twelve installations under `oracle/build/drive-c*` and the corpus, and list for each export the `NE` files that import it by ordinal or by name. The headers' rule for "documented" is the same: declared as a function in Open Watcom's `h/win/*.h`.

- 129 Windows `NE` files and 62 corpus `NE` files were read (USER's own file is left out of USER's census, SHELL's of SHELL's).
- **USER**: 413 exports, 90 of them named and declared by no header. 43 of those 90 are imported by some file, and the corpus imports four: [[fn:USER.InitApp]] (every program, from the C start-up), [[fn:USER.EndMenu]], [[fn:USER.GetDesktopHWnd]] and `_wsprintf`.
- **SHELL**: 51 exports, 11 named and undeclared and 19 with no name at all. Six of the eleven are imported, by Program Manager, File Manager, Packager and the enhanced mode's `WINOA386.MOD`; the corpus imports only [[fn:SHELL.ShellAbout]] (Reversi). The nameless ones are SHELL's own entries, reached by its own segments.
- Of the 22 stubs this wave began with, four are imported: [[fn:USER.EnableOEMLayer]] and [[fn:USER.DisableOEMLayer]] by standard mode's `WINOLDAP.MOD`, [[fn:USER.LoadIconHandler]] by `SHELL.DLL` and `WINHELP.EXE`, [[fn:USER.DragObject]] by File Manager and Program Manager. [[fn:USER.GetFilePortName]] is found by printers' drivers with `GetProcAddress`; [[fn:SHELL.FindExeDlgProc]] is SHELL's own dialog procedure. The rest have no caller outside their module. No corpus program imports any of them.

## How the pieces fit together

**Tasks, modules and their resources.** KERNEL tells USER of a task's end and of a module loaded or freed through [[fn:USER.SignalProc]]. A module loaded has its icon and cursor resource types given USER's handlers -- [[fn:USER.LoadDibIconHandler]] and [[fn:USER.LoadDibCursorHandler]] for a Windows 3 module, [[fn:USER.LoadCursorIconHandler]] for a Windows 2 one -- so that `LoadResource` of an icon or a cursor gives USER's own block, not the file's DIB ([[probe:userproc]]). [[fn:USER.LoadIconHandler]] makes the same of a block SHELL's `ExtractIcon` or WinHelp read themselves. As Windows starts, KERNEL calls [[fn:USER.FinalUserInit]] last.

**A DOS program full screen.** Standard mode's WINOLDAP gives the screen and the input to a DOS program with [[fn:USER.DisableOEMLayer]] -- the cursor hidden, every driver disabled, the system queue emptied, GDI's [[fn:GDI.Death]] -- and takes them back with [[fn:USER.EnableOEMLayer]] -- GDI's [[fn:GDI.Resurrection]], the drivers enabled, the key states cleared and the whole screen repainted ([[probe:oemlayer]]).

**Timers and input.** USER's own timers -- the caret's blink, a scroll bar's repeat, the screen saver's look -- are system timers, which come as `WM_SYSTIMER` and which [[fn:USER.Bear11]] and [[fn:USER.Bear182]] set and kill as `SetTimer` and `KillTimer` do theirs ([[probe:systimer]]). [[fn:USER.Hardware_Event]] is the routine the keyboard's and the mouse's events are put in the system queue with, entered in registers with DS USER's segment 44; from a program it faults inside USER and answers nought, which [[fn:USER.__GP]]'s table of USER's own fault handlers makes possible ([[probe:hwevent]]).

**Helpers.** [[fn:USER.StringFunc]] puts four string routines behind one entry, chosen by CX ([[probe:strfunc]]); [[fn:USER.UserSeeUserDo]] runs `LocalAlloc`, `LocalFree` and `LocalCompact` in USER's own heap, or answers two of its words.

**USER's and SHELL's own boxes.** A printer's driver asks for a file to print to with [[fn:USER.GetFilePortName]], USER's "Print To File" box ([[probe:filport]]). `ShellExecute` of a document whose registry association names a program it cannot find shows SHELL's "Program Not Found", whose procedure is [[fn:SHELL.FindExeDlgProc]]; an association in `WIN.INI` shows none ([[probe:findexe]]). SHELL's About box subclasses one of its controls with [[fn:SHELL.WCI]] for its credits, and `ShellExecute`'s DDE conversations have windows of [[fn:SHELL.HERETHARBETYGARS]]'s.

**Drag and drop.** File Manager and Program Manager drag files and items with [[fn:USER.DragObject]]: a loop over the mouse that asks the windows under the cursor with `WM_QUERYDROPOBJECT`, tells the source and the windows it passes with `WM_DRAGLOOP`, `WM_DRAGSELECT` and `WM_DRAGMOVE`, and drops with `WM_DROPOBJECT` ([[probe:dragobj]]).

**Window procedures.** [[fn:USER.Bear306]] is the procedure of USER's class `#32768`, the menus' pop-ups, as `GetClassInfo` gives it ([[probe:userproc]]); [[fn:USER.BozosLiveHere]] is the body of the edit control's procedure, entered with USER's data segment in AX by USER's own code, and the procedure of no class.

## Answered

- [[fn:USER.GetUserLocalObjType]], [[fn:USER.Bear285]], [[fn:USER.Bear86]], [[fn:USER.Bear51]], [[fn:USER.GetMouseEventProc]], [[fn:USER.SetEventHook]] and [[fn:USER.WinOldAppHackomatic]], [[measured]] by [[probe:userint]].
- [[fn:USER.LookupMenuHandle]] and [[fn:USER.GetInternalIconHeader]], [[measured]] by [[probe:usermore]]; [[fn:USER.GetIconID]], the choice of a group's member, by [[probe:iconid]].
- [[fn:USER.GetSystemDebugState]], [[measured]] by [[probe:sysdbg]] through each of its states: the word at `[0DAh]` is `DefDlgProc`'s, a dialog active.
- [[fn:USER.GetInternalWindowPos]] and [[fn:USER.SetInternalWindowPos]], parts of a window's placement, [[measured]] by [[probe:intpos]].
- [[fn:USER.GetMessage2]], the body of `GetMessage` and `PeekMessage`, and [[fn:USER.ControlPanelInfo]], Windows 3.0's `SystemParametersInfo`.
- [[fn:USER.OldSetDeskPattern]] and [[fn:USER.OldExitWindows]], [[read out]]: the desktop's pattern made again from `WIN.INI`, and Windows left as DOS ends a program.
- [[fn:USER.WEP]], [[fn:SHELL.WEP]], [[fn:COMMDLG.WEP]], [[fn:KEYBOARD.WEP]], [[fn:SOUND.WEP]] and [[fn:SYSTEM.WEP]].
- This wave: [[fn:USER.EnableOEMLayer]] and [[fn:USER.DisableOEMLayer]] ([[probe:oemlayer]]); [[fn:USER.Bear11]] and [[fn:USER.Bear182]] ([[probe:systimer]]); [[fn:USER.StringFunc]] and [[fn:USER.UserSeeUserDo]] ([[probe:strfunc]]; the second as a program finds it on WinBox's USER, whose data segment holds no heap); [[fn:USER.Hardware_Event]] ([[probe:hwevent]]); [[fn:USER.GetFilePortName]] ([[probe:filport]]); [[fn:USER.DragObject]] ([[probe:dragobj]]); [[fn:SHELL.FindExeDlgProc]] and `ShellExecute`'s box ([[probe:findexe]]); [[fn:USER.Bear306]], the procedure WinBox's own `#32768` windows have; [[fn:USER.FinalUserInit]], an exact no-op. KERNEL's [[fn:KERNEL.K403]] and [[fn:KERNEL.K404]] beside them ([[probe:kowner]]).

## Left, and why

- [[fn:USER.SignalProc]], [[fn:USER.LoadCursorIconHandler]], [[fn:USER.LoadDibCursorHandler]], [[fn:USER.LoadDibIconHandler]] and [[fn:USER.LoadIconHandler]]: **not yet done**. Measured by [[probe:userproc]] -- the handlers set and the converted block a program reads -- and read out; WinBox's `LoadResource` of an icon still calls KERNEL's own handler.
- [[fn:USER.BozosLiveHere]]: **not applicable**. Entered from a program, DS is whatever AX holds.
- [[fn:USER._FFFE_FARFRAME]]: **not applicable**. Its first instruction is `INT 3`.
- [[fn:USER.__GP]]: **not applicable**. A table of data for KERNEL's fault handling; WinBox's USER has no code of Windows' to fault in.
- [[fn:SHELL.WCI]]: **not applicable** while WinBox's About box has no subclassed control; its credits are not yet done.
- [[fn:SHELL.HERETHARBETYGARS]]: **not applicable** while `ShellExecute` does not follow an association that asks for DDE.
- [[read out]] `DCHook` (seg1 `8a00`): the procedure USER gives GDI for its windows' device contexts; for `DCHC_INVALIDVISRGN` it makes the context's visible region again. Designed in [[topic:visible-regions]].
- SHELL's nineteen exports with no name (104 to 128) and COMMDLG's twenty-two (32 to 53): entries of their own procedures and data, exported without names for their own segments to reach; a program has no name to import them by. SHELL's 119 is the routine that shows the box for finding a program ([[fn:SHELL.FindExeDlgProc]]).
- MMSYSTEM's [[fn:MMSYSTEM.mciParseCommand]] stays a stub: its entry is a near procedure, and a far call of it returns into MMSYSTEM's own segment.

SHELL's [[fn:SHELL.AboutDlgProc]] and [[fn:SHELL.InternalExtractIcon]], [[fn:USER.GetWindowPlacement]]'s icon and maximized points, and KEYBOARD's [[fn:KEYBOARD.Enable]] and [[fn:KEYBOARD.Disable]] are done ([[probe:aboutdp]], [[probe:iextract]], [[probe:wplace]], [[probe:kbenable]]). The member of an icon group WinBox shows is the one [[fn:USER.GetIconID]] chooses, for every icon it loads.

## The map

Every named USER and SHELL export no header declares, with the files that import it -- Windows' by name, the corpus counted by program -- what WinBox does, and where it stands. "Done this wave" marks the ones this page's latest work answered.

### USER

| Ord | Export                               | Callers                                                              | WinBox      | State                            |
| --- | ------------------------------------ | -------------------------------------------------------------------- | ----------- | -------------------------------- |
| 2   | [[fn:USER.OldExitWindows]]           | none                                                                 | implemented | done                             |
| 3   | [[fn:USER.EnableOEMLayer]]           | WINOLDAP.MOD                                                         | implemented | done this wave                   |
| 4   | [[fn:USER.DisableOEMLayer]]          | WINOLDAP.MOD                                                         | implemented | done this wave                   |
| 5   | [[fn:USER.InitApp]]                  | CALC.EXE, CALENDAR.EXE, CARDFILE.EXE and 28 more; 37 corpus programs | implemented | done                             |
| 11  | [[fn:USER.Bear11]]                   | none                                                                 | implemented | done this wave                   |
| 51  | [[fn:USER.Bear51]]                   | none                                                                 | implemented | done                             |
| 86  | [[fn:USER.Bear86]]                   | none                                                                 | implemented | done                             |
| 172 | [[fn:USER.SwitchToThisWindow]]       | WINOA386.MOD, TASKMAN.EXE                                            | implemented | done                             |
| 182 | [[fn:USER.Bear182]]                  | none                                                                 | implemented | done this wave                   |
| 187 | [[fn:USER.EndMenu]]                  | 2 corpus programs                                                    | implemented | done                             |
| 198 | [[fn:USER.CascadeChildWindows]]      | TASKMAN.EXE                                                          | implemented | done                             |
| 199 | [[fn:USER.TileChildWindows]]         | TASKMAN.EXE                                                          | implemented | done                             |
| 216 | [[fn:USER.UserSeeUserDo]]            | none                                                                 | implemented | done (no heap in USER's segment) |
| 217 | [[fn:USER.LookupMenuHandle]]         | none                                                                 | implemented | done                             |
| 273 | [[fn:USER.ControlPanelInfo]]         | none                                                                 | implemented | done                             |
| 274 | [[fn:USER.GetNextQueueWindow]]       | WINOA386.MOD, WINOLDAP.MOD                                           | implemented | done                             |
| 275 | [[fn:USER.RepaintScreen]]            | none                                                                 | implemented | done                             |
| 276 | [[fn:USER.LockMyTask]]               | none                                                                 | implemented | done                             |
| 278 | [[fn:USER.GetDesktopHWnd]]           | 1 corpus program                                                     | implemented | done                             |
| 279 | [[fn:USER.OldSetDeskPattern]]        | none                                                                 | implemented | done                             |
| 280 | [[fn:USER.SetSystemMenu]]            | none                                                                 | implemented | done                             |
| 285 | [[fn:USER.Bear285]]                  | none                                                                 | implemented | done                             |
| 289 | [[fn:USER.Keybd_Event]]              | none                                                                 | implemented | done                             |
| 299 | [[fn:USER.Mouse_Event]]              | none                                                                 | implemented | done                             |
| 301 | [[fn:USER.BozosLiveHere]]            | none                                                                 | stub        | not applicable                   |
| 306 | [[fn:USER.Bear306]]                  | none                                                                 | implemented | done this wave                   |
| 314 | [[fn:USER.SignalProc]]               | none                                                                 | stub        | not yet done                     |
| 320 | [[fn:USER.SysErrorBox]]              | DRWATSON.EXE                                                         | implemented | done                             |
| 321 | [[fn:USER.SetEventHook]]             | none                                                                 | implemented | done                             |
| 322 | [[fn:USER.WinOldAppHackomatic]]      | WINOA386.MOD                                                         | implemented | done                             |
| 323 | [[fn:USER.GetMessage2]]              | none                                                                 | implemented | done                             |
| 324 | [[fn:USER.FillWindow]]               | none                                                                 | implemented | done                             |
| 325 | [[fn:USER.PaintRect]]                | none                                                                 | implemented | done                             |
| 326 | [[fn:USER.GetControlBrush]]          | none                                                                 | implemented | done                             |
| 332 | [[fn:USER.UserYield]]                | none                                                                 | implemented | done                             |
| 333 | [[fn:USER.IsUserIdle]]               | none                                                                 | implemented | done                             |
| 336 | [[fn:USER.LoadCursorIconHandler]]    | none                                                                 | stub        | not yet done                     |
| 337 | [[fn:USER.GetMouseEventProc]]        | none                                                                 | implemented | done                             |
| 341 | [[fn:USER._FFFE_FARFRAME]]           | none                                                                 | stub        | not applicable                   |
| 343 | [[fn:USER.GetFilePortName]]          | none                                                                 | implemented | done this wave                   |
| 356 | [[fn:USER.LoadDibCursorHandler]]     | none                                                                 | stub        | not yet done                     |
| 357 | [[fn:USER.LoadDibIconHandler]]       | none                                                                 | stub        | not yet done                     |
| 362 | [[fn:USER.DCHook]]                   | none                                                                 | implemented | done                             |
| 372 | [[fn:USER.GetInternalIconHeader]]    | PROGMAN.EXE                                                          | implemented | done                             |
| 400 | [[fn:USER.FinalUserInit]]            | none                                                                 | implemented | done this wave                   |
| 408 | [[fn:USER.CreateCursorIconIndirect]] | none                                                                 | implemented | done                             |
| 420 | [[fn:USER._WSPRINTF]]                | CARDFILE.EXE, CHARMAP.EXE, CLOCK.EXE and 33 more; 27 corpus programs | implemented | done                             |
| 455 | [[fn:USER.GetIconID]]                | SHELL.DLL                                                            | implemented | done                             |
| 456 | [[fn:USER.LoadIconHandler]]          | SHELL.DLL, WINHELP.EXE                                               | stub        | not yet done                     |
| 459 | [[fn:USER.DumpIcon]]                 | PROGMAN.EXE                                                          | implemented | done                             |
| 460 | [[fn:USER.GetInternalWindowPos]]     | none                                                                 | implemented | done                             |
| 461 | [[fn:USER.SetInternalWindowPos]]     | none                                                                 | implemented | done                             |
| 462 | [[fn:USER.CalcChildScroll]]          | PROGMAN.EXE                                                          | implemented | done                             |
| 463 | [[fn:USER.ScrollChildren]]           | none                                                                 | implemented | done                             |
| 464 | [[fn:USER.DragObject]]               | PROGMAN.EXE, WINFILE.EXE                                             | implemented | done this wave                   |
| 465 | [[fn:USER.DragDetect]]               | none                                                                 | implemented | done                             |
| 470 | [[fn:USER.StringFunc]]               | none                                                                 | implemented | done this wave                   |
| 480 | [[fn:USER.GetUserLocalObjType]]      | none                                                                 | implemented | done                             |
| 481 | [[fn:USER.Hardware_Event]]           | none                                                                 | implemented | done this wave                   |
| 484 | [[fn:USER.__GP]]                     | none                                                                 | stub        | not applicable                   |
| 499 | [[fn:USER.WNetErrorText]]            | WINFILE.EXE                                                          | implemented | done                             |
| 501 | [[fn:USER.WNetOpenJob]]              | PRINTMAN.EXE                                                         | implemented | done                             |
| 502 | [[fn:USER.WNetCloseJob]]             | PRINTMAN.EXE                                                         | implemented | done                             |
| 503 | [[fn:USER.WNetAbortJob]]             | none                                                                 | implemented | done                             |
| 504 | [[fn:USER.WNetHoldJob]]              | PRINTMAN.EXE                                                         | implemented | done                             |
| 505 | [[fn:USER.WNetReleaseJob]]           | PRINTMAN.EXE                                                         | implemented | done                             |
| 506 | [[fn:USER.WNetCancelJob]]            | PRINTMAN.EXE                                                         | implemented | done                             |
| 507 | [[fn:USER.WNetSetJobCopies]]         | none                                                                 | implemented | done                             |
| 508 | [[fn:USER.WNetWatchQueue]]           | PRINTMAN.EXE                                                         | implemented | done                             |
| 509 | [[fn:USER.WNetUnwatchQueue]]         | PRINTMAN.EXE                                                         | implemented | done                             |
| 510 | [[fn:USER.WNetLockQueueData]]        | PRINTMAN.EXE                                                         | implemented | done                             |
| 511 | [[fn:USER.WNetUnlockQueueData]]      | PRINTMAN.EXE                                                         | implemented | done                             |
| 513 | [[fn:USER.WNetGetCaps]]              | PRINTMAN.EXE, MAIN.CPL, OLECLI.DLL and 1 more                        | implemented | done                             |
| 514 | [[fn:USER.WNetDeviceMode]]           | MAIN.CPL                                                             | implemented | done                             |
| 515 | [[fn:USER.WNetBrowseDialog]]         | MAIN.CPL, WINFILE.EXE                                                | implemented | done                             |
| 516 | [[fn:USER.WNetGetUser]]              | PRINTMAN.EXE                                                         | implemented | done                             |
| 519 | [[fn:USER.WNetGetError]]             | PRINTMAN.EXE, MAIN.CPL                                               | implemented | done                             |
| 520 | [[fn:USER.WNetGetErrorText]]         | PRINTMAN.EXE, MAIN.CPL, OLECLI.DLL                                   | implemented | done                             |
| 521 | [[fn:USER.WNetEnable]]               | none                                                                 | implemented | done                             |
| 522 | [[fn:USER.WNetDisable]]              | none                                                                 | implemented | done                             |
| 523 | [[fn:USER.WNetRestoreConnection]]    | PRINTMAN.EXE, WINFILE.EXE                                            | implemented | done                             |
| 524 | [[fn:USER.WNetWriteJob]]             | none                                                                 | implemented | done                             |
| 525 | [[fn:USER.WNetConnectDialog]]        | WINFILE.EXE                                                          | implemented | done                             |
| 526 | [[fn:USER.WNetDisconnectDialog]]     | WINFILE.EXE                                                          | implemented | done                             |
| 527 | [[fn:USER.WNetConnectionDialog]]     | MAIN.CPL, WINFILE.EXE                                                | implemented | done                             |
| 528 | [[fn:USER.WNetViewQueueDialog]]      | PRINTMAN.EXE                                                         | implemented | done                             |
| 529 | [[fn:USER.WNetPropertyDialog]]       | WINFILE.EXE                                                          | implemented | done                             |
| 530 | [[fn:USER.WNetGetDirectoryType]]     | WINFILE.EXE                                                          | implemented | done                             |
| 531 | [[fn:USER.WNetDirectoryNotify]]      | WINFILE.EXE                                                          | implemented | done                             |
| 532 | [[fn:USER.WNetGetPropertyText]]      | WINFILE.EXE                                                          | implemented | done                             |

### SHELL

| Ord | Export                             | Callers                                                            | WinBox      | State          |
| --- | ---------------------------------- | ------------------------------------------------------------------ | ----------- | -------------- |
| 22  | [[fn:SHELL.ShellAbout]]            | CALC.EXE, CALENDAR.EXE, CARDFILE.EXE and 17 more; 1 corpus program | implemented | done           |
| 32  | [[fn:SHELL.WCI]]                   | none                                                               | stub        | not applicable |
| 33  | [[fn:SHELL.AboutDlgProc]]          | none                                                               | implemented | done           |
| 36  | [[fn:SHELL.ExtractAssociatedIcon]] | PACKAGER.EXE, PROGMAN.EXE                                          | implemented | done           |
| 37  | [[fn:SHELL.DoEnvironmentSubst]]    | PROGMAN.EXE, WINOA386.MOD                                          | implemented | done           |
| 38  | [[fn:SHELL.FindEnvironmentString]] | WINFILE.EXE                                                        | implemented | done           |
| 39  | [[fn:SHELL.InternalExtractIcon]]   | PROGMAN.EXE                                                        | implemented | done           |
| 100 | [[fn:SHELL.HERETHARBETYGARS]]      | none                                                               | stub        | not applicable |
| 101 | [[fn:SHELL.FindExeDlgProc]]        | none                                                               | implemented | done this wave |
| 102 | [[fn:SHELL.RegisterShellHook]]     | PROGMAN.EXE, WINOA386.MOD                                          | implemented | done           |
| 103 | [[fn:SHELL.ShellHookProc]]         | none                                                               | implemented | done           |

## Not yet done

- USER's resource handlers for icons and cursors -- [[fn:USER.SignalProc]]'s module notice, [[fn:USER.LoadDibIconHandler]], [[fn:USER.LoadDibCursorHandler]], [[fn:USER.LoadCursorIconHandler]] and [[fn:USER.LoadIconHandler]] -- so that `SetResourceHandler` answers USER's handler for a module's icons and `LoadResource` gives USER's block ([[probe:userproc]]).
- [[fn:USER.SignalProc]]'s task end and module freed, called by a program for a task that is still running.
- [[fn:SHELL.FindExeDlgProc]]'s Locate button, which asks COMMDLG's `GetOpenFileName` for the program.
- SHELL's About box's credits ([[fn:SHELL.WCI]]).
- The classes `#32768` to `#32772` registered whatever the desktop, their procedures USER's addresses ([[probe:userproc]]).
- [[fn:USER.GetDCEx]]'s `DCX_PARENTCLIP` and `DCX_USESTYLE`: read out and recorded in [[topic:visible-regions]], phases 2 and 3.
