---
kind: topic
name: The Windows 3.1 accessories
summary: Every Windows program that comes with Windows 3.1, run on winbox.js's raster desktop — which open their windows, and for the rest, what each one stops at and what it needs.
probes: [loadstr, winhelp]
---

Windows 3.1 installs about 25 Windows programs, from Clock and Notepad to File Manager and Paintbrush. They're a good test of an emulation: each is a real program, written against the documented API with the usual shortcuts. winbox.js runs each one in turn on the raster desktop, lets it run a while, and records what it called, what it stopped at, and which windows it opened. Where a program has an error box of its own, the box says what it wanted.

## Programs that open their windows

Clock, Notepad, Control Panel, Program Manager, Print Manager, the Clipboard Viewer, Windows Help, the Windows Tutorial, Terminal, and Dr. Watson, which starts minimized.

## What stops the rest

| Program | What it stops at |
| --- | --- |
| Calculator | Its main window is a dialog box, from `CreateDialog`. |
| Character Map | A dialog box, from `CreateDialog`. |
| Media Player, Sound Recorder | Dialog boxes, from `CreateDialogParam`. |
| Registration Editor | A dialog box, from `CreateDialog`. |
| Task Manager, About Windows | Modal dialog boxes, from `DialogBox` and `DialogBoxParam`. |
| Write, Calendar, Cardfile | A temporary file, from `GetTempFileName`, which needs a drive that can be written to. Calendar says "Cannot create the temporary change file", and Cardfile "Cannot create temporary file". |
| Paintbrush | Its own `PBRUSH.DLL`, and `OLESVR.DLL`. |
| Object Packager | `OLECLI.DLL`, `OLESVR.DLL` and `TOOLHELP.DLL`. |
| Recorder | Its own `RECORDER.DLL`: "An incompatible version of RECORDER.DLL is on your system." |
| File Manager | `Dos3Call`, KERNEL's way for a program to make a DOS call. |
| PIF Editor | Not yet examined: it loops in its own code after reading its menus. |

A program that imports a library winbox.js does not have jumps to `0000:FFFF` at its first call into it. That's the end of a relocation chain the loader could not fill. Windows would load the library from the installation, or refuse to start the program.

## What the survey found along the way

- An unimplemented function used to leave AX as it was. Programs then carried on with answers they never got. Write got a module handle of 1234, and Cardfile drew with a device context that was its own last result. Unimplemented functions now answer zero, which programs read as failure, and several then show their own error boxes.
- [[measured]] [[fn:USER.LoadString]] never writes past the buffer it's given. winbox.js's did, and the Clipboard Viewer lost its instance handle to it.
- [[measured]] [[fn:USER.WinHelp]] with `HELP_QUIT` succeeds when Help is not running. Notepad makes that call as it closes, and stays open if it fails.
- [[read out]] [[fn:USER.GetKeyState]] answers the key's byte from USER's key-state table, sign-extended.
- Also needed and now done:
  - the standard cursors, which are the display driver's;
  - accelerator tables;
  - window and class words, including subclassing;
  - `GetModuleHandle` and `GetProcAddress`;
  - window DCs;
  - `EnableWindow`, `InsertMenu`, and `CreateDC` and `CreateIC` for the display.
