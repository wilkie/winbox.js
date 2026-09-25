---
kind: topic
name: The Windows 3.1 accessories
summary: Every Windows program that comes with Windows 3.1, run on winbox.js's raster desktop — which open their windows, and for the rest, what each one stops at and what it needs.
probes: [loadstr, winhelp, rectops, dialogs]
---

Windows 3.1 installs about 25 Windows programs, from Clock and Notepad to File Manager and Paintbrush. They're a good test of an emulation: each is a real program, written against the documented API with the usual shortcuts. winbox.js runs each one in turn on the raster desktop, lets it run a while, and records what it called, what it stopped at, and which windows it opened. Where a program has an error box of its own, the box says what it wanted.

## Programs that open their windows

Clock, Notepad, Control Panel, Program Manager, File Manager, Print Manager, the Clipboard Viewer, Windows Help, the Windows Tutorial, Terminal, Character Map, Media Player, Task Manager, About Windows, Calculator, and Dr. Watson, which starts minimized. Character Map, Task Manager and About Windows are dialog boxes ([[topic:dialog-boxes]]). Character Map's font list is a combo box, which is not done yet, so it opens without it. Calculator's buttons are drawn with `RoundRect`, which is not done yet either. File Manager and Program Manager are MDI programs, whose document windows live inside a frame. They open their frames, but the MDI functions, `DefFrameProc` and `DefMDIChildProc`, are not done yet.

## What stops the rest

| Program | What it stops at |
| --- | --- |
| Sound Recorder | Not yet examined, now that its dialog is made. |
| Registration Editor | Not yet examined: it closes itself after making its dialog. |
| Write, Calendar, Cardfile | A temporary file, from `GetTempFileName`, which needs a drive that can be written to. Calendar says "Cannot create the temporary change file", and Cardfile "Cannot create temporary file". |
| Paintbrush | Its own `PBRUSH.DLL`, and `OLESVR.DLL`. |
| Object Packager | `OLECLI.DLL`, `OLESVR.DLL` and `TOOLHELP.DLL`. |
| Recorder | Its own `RECORDER.DLL`: "An incompatible version of RECORDER.DLL is on your system." |
| PIF Editor | Not yet examined: it loops in its own code after reading its menus. |

A program that imports a library winbox.js does not have jumps to `0000:FFFF` at its first call into it. That's the end of a relocation chain the loader could not fill. Windows would load the library from the installation, or refuse to start the program.

## What the survey found along the way

- An unimplemented function used to leave AX as it was. Programs then carried on with answers they never got. Write got a module handle of 1234, and Cardfile drew with a device context that was its own last result. Unimplemented functions now answer zero, which programs read as failure, and several then show their own error boxes.
- [[measured]] [[fn:USER.LoadString]] never writes past the buffer it's given. winbox.js's did, and the Clipboard Viewer lost its instance handle to it.
- [[measured]] [[fn:USER.WinHelp]] with `HELP_QUIT` succeeds when Help is not running. Notepad makes that call as it closes, and stays open if it fails.
- [[read out]] [[fn:USER.GetKeyState]] answers the key's byte from USER's key-state table, sign-extended.
- Calculator needed the floating-point unit ([[topic:floating-point]]), and its dialog brought onto the screen.
- File Manager scans every drive letter before it opens. It needed three things:
  - `Dos3Call`, KERNEL's way for a program to make a DOS call;
  - `GetDriveType`;
  - an INT 2Fh that does nothing, as DOS's own does. File Manager asks through INT 2Fh whether MSCDEX, the CD-ROM driver, is installed for each drive. With no handler, the interrupt went into unrelated code.
- Also needed and now done:
  - the standard cursors, which are the display driver's;
  - accelerator tables;
  - window and class words, including subclassing;
  - `GetModuleHandle` and `GetProcAddress`;
  - window DCs;
  - `EnableWindow`, `InsertMenu`, and `CreateDC` and `CreateIC` for the display;
  - the rectangle arithmetic, whose edges [[topic:rectangles]] records.
