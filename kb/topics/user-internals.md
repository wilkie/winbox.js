---
kind: topic
name: USER's exports for Windows' own components
summary: The exports of USER, KEYBOARD and SHELL that only Windows' own programs and drivers call -- KERNEL's signals, the display driver's, WINOLDAP's, the debugger's, the dialogs' own procedures -- what each is, which WinBox answers, and why the rest are left.
probes: [userint, usermore, sysdbg, iconid, intpos, aboutdp, iextract, wplace]
---

USER exports some sixty functions no program is meant to call: KERNEL calls them as tasks start and end, the display and keyboard drivers as they switch the screen, WINOLDAP for DOS programs' windows, the debuggers, and USER itself through its own dialogs' procedures, which are exported only so that `DialogBox` can be given them. Some are named in jest -- `Bear` and a number, `BozosLiveHere`, `WinOldAppHackOMatic`. WinBox keeps its own USER ([[guide:without-windows]]), and answers such an export where what it does can be seen by a program and read out whole.

## Answered

- [[fn:USER.GetUserLocalObjType]], [[fn:USER.Bear285]], [[fn:USER.Bear86]], [[fn:USER.Bear51]], [[fn:USER.GetMouseEventProc]], [[fn:USER.SetEventHook]] and [[fn:USER.WinOldAppHackomatic]], [[measured]] by [[probe:userint]].
- [[fn:USER.LookupMenuHandle]] and [[fn:USER.GetInternalIconHeader]], [[measured]] by [[probe:usermore]]; [[fn:USER.GetIconID]], the choice of a group's member, by [[probe:iconid]].
- [[fn:USER.GetSystemDebugState]], [[measured]] by [[probe:sysdbg]] through each of its states: the word at `[0DAh]` is `DefDlgProc`'s, a dialog active.
- [[fn:USER.GetInternalWindowPos]] and [[fn:USER.SetInternalWindowPos]], parts of a window's placement, [[measured]] by [[probe:intpos]].
- [[fn:USER.GetMessage2]], the body of `GetMessage` and `PeekMessage`, and [[fn:USER.ControlPanelInfo]], Windows 3.0's `SystemParametersInfo`.
- [[fn:USER.OldSetDeskPattern]] and [[fn:USER.OldExitWindows]], [[read out]]: the desktop's pattern made again from `WIN.INI`, and Windows left as DOS ends a program.
- [[fn:USER.WEP]], [[fn:SHELL.WEP]], [[fn:COMMDLG.WEP]], [[fn:KEYBOARD.WEP]], [[fn:SOUND.WEP]] and [[fn:SYSTEM.WEP]].

## Left, and why

- [[read out]] `SignalProc` (seg1 `09bc`): KERNEL's notice to USER of a task's start, end or module loaded -- the last sets USER's resource handlers for icons and cursors (`SetResourceHandler`, KERNEL 67, with `LoadDIBCursorHandler` and `LoadDIBIconHandler`). WinBox's KERNEL and USER are one program and tell each other directly.
- [[read out]] `LoadCursorIconHandler`, `LoadDIBCursorHandler`, `LoadDIBIconHandler`, `LoadIconHandler` (seg12): the procedures KERNEL's `LoadResource` calls for icon and cursor resources. WinBox's `LoadResource` calls a handler a program sets ([[fn:KERNEL.SetResourceHandler]]), but USER's own icons and cursors are read without one.
- [[read out]] `FinalUserInit` (seg3 `2570`), `EnableOEMLayer` and `DisableOEMLayer` (seg5 `0165`, `01a2`): USER's last step as Windows starts, and giving the screen and the keyboard up to a full-screen DOS program and back (`Death` and `Resurrection`). WinBox runs no DOS program full screen.
- [[read out]] `BozosLiveHere` (seg26 `0000`) and `Bear306` (seg10 `1587`): window procedures -- the desktop's and the pop-up menu's -- exported for USER's own classes. WinBox's desktop and menus are its own.
- [[read out]] `UserSeeUserDo` (seg41 `181e`): `LocalAlloc`, `LocalFree` and `LocalCompact` in USER's own heap, and two of USER's words, by a request's number; -1 for another. WinBox keeps USER's objects in itself, and USER's data segment holds no heap.
- [[read out]] `StringFunc` (seg11 `02e7`): a table of string helpers chosen by CX, not by its arguments.
- [[read out]] `_FFFE_FARFRAME` (seg1 `1798`): begins with `INT 3`, a debugger's breakpoint.
- [[read out]] `DCHook` (seg1 `8a00`): the procedure USER gives GDI for its windows' device contexts; for `DCHC_INVALIDVISRGN` it makes the context's visible region again. It waits on GDI's visible regions: designed in [[topic:visible-regions]].
- [[read out]] `Hardware_Event` (seg1 `4d6c`): a driver's registers put into the system queue as a message, the time `GetSystemMSecCount`'s, a beep where the queue is full. WinBox's drivers are its own and put input in the queue themselves.
- [[read out]] `Bear11` and `Bear182` (seg1 `744c`, `74f4`): USER's own timers looked up by window and identifier, and one killed or its count let go. They reach USER's timer table, which WinBox keeps itself.
- [[read out]] `GetFilePortName` (seg1 `9c7c`): USER's "Print To File" box (its dialog 10) for a printer's driver writing to FILE:, its file's name checked with `OpenFile` and a box asking before one there is replaced; -1 while one is up. Not yet done: it needs USER's dialog and strings laid out for WinBox's own USER.
- [[read out]] `DragObject` (seg14 `00f2`): File Manager's drag of an object, a loop of its own over the mouse that asks the windows under it with `WM_QUERYDROPOBJECT`, `WM_DRAGSELECT`, `WM_DRAGMOVE` and `WM_DRAGLOOP` and drops with `WM_DROPOBJECT`. Not yet done.
- `__GP`: not read out.
- [[read out]] SHELL's `FindExeDlgProc` (seg8 `010e`), the procedure of its box for finding a program, and `WCI` (seg9 `0829`) and `HERETHARBETYGARS` (seg4 `0550`), a control's subclass procedure of the About box and the window procedure of SHELL's DDE conversations. WinBox's `ShellExecute` shows no such box, and its About box's controls are its own.
- SHELL's nineteen exports with no name (104 to 128) and COMMDLG's twenty-two (32 to 53): entries of their own procedures and data, exported without names for their own segments to reach; a program has no name to import them by.

SHELL's [[fn:SHELL.AboutDlgProc]] and [[fn:SHELL.InternalExtractIcon]], [[fn:USER.GetWindowPlacement]]'s icon and maximized points, and KEYBOARD's [[fn:KEYBOARD.Enable]] and [[fn:KEYBOARD.Disable]] are done ([[probe:aboutdp]], [[probe:iextract]], [[probe:wplace]], [[probe:kbenable]]). The member of an icon group WinBox shows is the one [[fn:USER.GetIconID]] chooses, for every icon it loads.

## Not yet done

- Every export of the list just above.
- [[fn:USER.GetDCEx]]'s `DCX_PARENTCLIP` and `DCX_USESTYLE`: read out and recorded in [[topic:visible-regions]], phases 2 and 3.
