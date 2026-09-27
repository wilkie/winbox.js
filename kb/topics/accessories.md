---
kind: topic
name: The Windows 3.1 accessories
summary: Every Windows program that comes with Windows 3.1, run on winbox.js's raster desktop — which open their windows, and for the rest, what each one stops at and what it needs.
probes: [loadstr, winhelp, rectops, dialogs]
---

Windows 3.1 installs about 25 Windows programs, from Clock and Notepad to File Manager and Paintbrush. They're a good test of an emulation: each is a real program, written against the documented API with the usual shortcuts. winbox.js runs each one in turn on the raster desktop, lets it run a while, and records what it called, what it stopped at, and which windows it opened. Where a program has an error box of its own, the box says what it wanted.

## Programs that open their windows

All 25 of them. Clock, Notepad, Write, Calendar, Cardfile, the Registration Editor, PIF Editor, Paintbrush, Sound Recorder, Recorder, Control Panel, Object Packager, Program Manager, File Manager, Print Manager, the Clipboard Viewer, Windows Help, the Windows Tutorial, Terminal, Character Map, Media Player, Task Manager, About Windows, Calculator, and Dr. Watson, which starts minimized. Character Map, Task Manager and About Windows are dialog boxes ([[topic:dialog-boxes]]). Character Map fills its font list with `EnumFontFamilies` ([[topic:font-enumeration]]). Media Player opens: it reads its controls' names back from their `CREATESTRUCT` in `WM_CREATE`, and a dialog control's name is a pointer to its text, empty or not, never NULL. Calendar and Cardfile open once they have their temporary files ([[topic:temporary-files]]). Cardfile's card hides the scroll bars it was made with ([[topic:scroll-bars]]). Windows Help opens to its title screen, now that a local block that grows keeps its bytes ([[topic:global-and-local-memory]]). PIF Editor opens now that showing a window sends the activation messages, and asking for the client rectangle of no window writes nothing, as on Windows ([[topic:activation-and-focus]]). Calendar's paint needed a device context that starts with the System font selected, as every new one does. The Registration Info Editor opens on the installation's database ([[topic:registration-database]]). File Manager opens its directory window, and Program Manager its groups, inside their MDI frames ([[topic:mdi]]). Calculator's buttons are drawn with `RoundRect` ([[topic:ellipses]]). Notepad takes typing in its multi-line edit control ([[topic:multi-line-edit-controls]]), and its Find and Open dialogs are `COMMDLG.DLL` itself, loaded from the disk ([[topic:dynamic-link-libraries]]). The Open dialog lists the disk through DOS ([[topic:directory-lists]]). A file chosen there opens in Notepad, read into the edit control's own block in Notepad's heap. Its scroll bars scroll it: pressed, held and dragged ([[topic:scroll-bars]]). File Manager and Program Manager are MDI programs, whose document windows live inside a frame ([[topic:mdi]]). Program Manager draws each item's icon by writing it into an icon's own block of memory ([[topic:window-states]]), and its titles with [[fn:USER.DrawText]]. Its minimized groups sit along the bottom of the MDI client. They show their class's icon because USER sends them `WM_PAINTICON` and not `WM_PAINT` ([[topic:window-states]]). Before that, Program Manager's own paint had erased them white.

## What is not yet right

- Sound Recorder's window is a dialog with its own menu, and its buttons are disabled with no sound driver: not yet compared with Windows.
- None of them has been measured against Windows as a whole; each fix is held to a probe of the part it touched.

## What the survey found along the way

- Paintbrush, Sound Recorder and Cardfile stopped on `VERR`, which the emulated processor did not have. `OLESVR.DLL` checks every pointer a server gives it with `VERR`, `VERW` and `LSL`. Then the servers failed to register, until the global atoms ([[topic:atoms]]) and Windows' own descriptors, privilege 3 with real limits, were in place ([[topic:global-and-local-memory]]).
- Paintbrush needed its own `PBRUSH.DLL`, whose functions it imports by name, and its program's module name, `PbrushX`, not its file's ([[topic:dynamic-link-libraries]]). Its toolbox was empty: it shrinks one tall bitmap of its tools into the box with [[fn:GDI.StretchBlt]], which was a stub.
- Sound Recorder's buttons were blank. Each draws its picture with [[fn:GDI.StretchBlt]], and a disabled one greys it with a brush made by [[fn:GDI.CreatePatternBrush]]; both were stubs. It draws inside a clip it narrows and then puts back ([[topic:clip-regions]]).
- Message boxes now show on the raster desktop ([[topic:message-boxes]]). Before, a program that asked one waited on a box nobody could see. Sound Recorder's says it cannot record or play back without a sound driver. Control Panel's said it could not find its components, the `.CPL` files: `GetSystemDirectory` was a stub, and `LoadLibrary` could not load a library from the disk. It now opens with all twelve applets ([[topic:dynamic-link-libraries]]).
- Paintbrush's canvas showed black: its `PBRUSH.DLL` tells its own bitmaps from DCs by a handle's low bit, and winbox.js's DC handles were odd ([[topic:global-and-local-memory]]).
- Sound Recorder, on an installation with no sound driver, asks whether it can record, and was told yes ([[topic:sound-devices]]). Then its arithmetic went wrong in the emulated processor: every 32-bit `ADD`, `SUB` and `CMP` left the carry clear, as JavaScript's bitwise operators work in 32 bits. It opens its window, a dialog whose template names its menu ([[topic:dialog-boxes]]).
- Recorder opens now, and no longer calls its `RECORDER.DLL` incompatible. What cured it is not separated out from the fixes above.
- Write needed three things ([[topic:global-and-local-memory]], [[topic:directory-lists]]):
  - its local handles as words in its data segment, where it reads them itself;
  - INT 21h 47h leaving AX 0100h, as DOS does, without which it said it had not enough memory;
  - `GetUpdateRect`, a stub answering that there was nothing to paint, so Write never validated its window and was sent `WM_PAINT` without end.
- Object Packager and Dr. Watson import `TOOLHELP.DLL`, which walks KERNEL's private structures that winbox.js's KERNEL does not have. It is kept as a module of winbox.js's own ([[topic:dynamic-link-libraries]]). Packager registers for notifications, and Dr. Watson for faults, and said it could not install itself while the stub answered no.
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
