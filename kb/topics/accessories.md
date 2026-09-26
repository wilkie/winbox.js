---
kind: topic
name: The Windows 3.1 accessories
summary: Every Windows program that comes with Windows 3.1, run on winbox.js's raster desktop — which open their windows, and for the rest, what each one stops at and what it needs.
probes: [loadstr, winhelp, rectops, dialogs]
---

Windows 3.1 installs about 25 Windows programs, from Clock and Notepad to File Manager and Paintbrush. They're a good test of an emulation: each is a real program, written against the documented API with the usual shortcuts. winbox.js runs each one in turn on the raster desktop, lets it run a while, and records what it called, what it stopped at, and which windows it opened. Where a program has an error box of its own, the box says what it wanted.

## Programs that open their windows

Clock, Notepad, Calendar, Cardfile, the Registration Editor, Control Panel, Program Manager, File Manager, Print Manager, the Clipboard Viewer, Windows Help, the Windows Tutorial, Terminal, Character Map, Media Player, Task Manager, About Windows, Calculator, and Dr. Watson, which starts minimized. Character Map, Task Manager and About Windows are dialog boxes ([[topic:dialog-boxes]]). Character Map fills its font list with `EnumFontFamilies` ([[topic:font-enumeration]]). Media Player opens: it reads its controls' names back from their `CREATESTRUCT` in `WM_CREATE`, and a dialog control's name is a pointer to its text, empty or not, never NULL. Calendar and Cardfile open once they have their temporary files ([[topic:temporary-files]]). Calendar's paint needed a device context that starts with the System font selected, as every new one does. The Registration Info Editor opens on the installation's database ([[topic:registration-database]]). File Manager opens its directory window, and Program Manager its groups, inside their MDI frames ([[topic:mdi]]). Calculator's buttons are drawn with `RoundRect` ([[topic:ellipses]]). Notepad takes typing in its multi-line edit control ([[topic:multi-line-edit-controls]]), and its Find and Open dialogs are `COMMDLG.DLL` itself, loaded from the disk ([[topic:dynamic-link-libraries]]). The Open dialog lists the disk through DOS ([[topic:directory-lists]]). A file chosen there opens in Notepad, read into the edit control's own block in Notepad's heap. Its scroll bars scroll it: pressed, held and dragged ([[topic:scroll-bars]]). File Manager and Program Manager are MDI programs, whose document windows live inside a frame ([[topic:mdi]]). Program Manager draws each item's icon by writing it into an icon's own block of memory ([[topic:window-states]]), and its titles with [[fn:USER.DrawText]]. Its minimized groups sit along the bottom of the MDI client. They show their class's icon because USER sends them `WM_PAINTICON` and not `WM_PAINT` ([[topic:window-states]]). Before that, Program Manager's own paint had erased them white.

## What stops the rest

| Program | What it stops at |
| --- | --- |
| Sound Recorder, Paintbrush | An error object neither reports, at the same place in each. Not yet examined. |
| Write | Loops in its own string-length code after listing its fonts with `EnumFonts`. Not yet examined. |
| Object Packager | A general protection fault after `GlobalMasterHandle`, which winbox.js only stubs. |
| Recorder | Its own `RECORDER.DLL`: "An incompatible version of RECORDER.DLL is on your system." |
| PIF Editor | `GetClientRect` of window nought. Not yet examined. |

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
