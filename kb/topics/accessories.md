---
kind: topic
name: The Windows 3.1 accessories
summary: Every Windows program that comes with Windows 3.1, run on winbox.js's raster desktop — which open their windows, and for the rest, what each one stops at and what it needs.
probes:
  [
    loadstr,
    winhelp,
    rectops,
    dialogs,
    accinit,
    lwrhuge,
    ulcolour,
    cardview,
    accsys,
    openfile,
    swpframe,
    deskwall,
    dblrect,
    menuwnd,
  ]
---

Windows 3.1 installs about 25 Windows programs, from Clock and Notepad to File Manager and Paintbrush. They're a good test of an emulation: each is a real program, written against the documented API with the usual shortcuts. winbox.js runs each one in turn on the raster desktop, lets it run a while, and records what it called, what it stopped at, and which windows it opened. Where a program has an error box of its own, the box says what it wanted.

## Programs that open their windows

All 25 of them. Clock, Notepad, Write, Calendar, Cardfile, the Registration Editor, PIF Editor, Paintbrush, Sound Recorder, Recorder, Control Panel, Object Packager, Program Manager, File Manager, Print Manager, the Clipboard Viewer, Windows Help, the Windows Tutorial, Terminal, Character Map, Media Player, Task Manager, About Windows, Calculator, and Dr. Watson, which starts minimized. Character Map, Task Manager and About Windows are dialog boxes ([[topic:dialog-boxes]]). Character Map fills its font list with `EnumFontFamilies` ([[topic:font-enumeration]]). Media Player opens: it reads its controls' names back from their `CREATESTRUCT` in `WM_CREATE`, and a dialog control's name is a pointer to its text, empty or not, never NULL. Calendar and Cardfile open once they have their temporary files ([[topic:temporary-files]]). Cardfile's card hides the scroll bars it was made with ([[topic:scroll-bars]]). Windows Help opens to its title screen, now that a local block that grows keeps its bytes ([[topic:global-and-local-memory]]). Nine of them put in a message filter, which USER now calls in their dialog boxes and menus ([[topic:hooks]]). The Clipboard Viewer joins the chain of viewers ([[topic:clipboard]]). Write justifies its text with `SetTextJustification` ([[topic:text-justification]]). Windows Help makes a palette as it starts ([[topic:palettes]]). PIF Editor opens now that showing a window sends the activation messages, and asking for the client rectangle of no window writes nothing, as on Windows ([[topic:activation-and-focus]]). Calendar's paint needed a device context that starts with the System font selected, as every new one does. The Registration Info Editor opens on the installation's database ([[topic:registration-database]]). File Manager opens its directory window, and Program Manager its groups, inside their MDI frames ([[topic:mdi]]). Calculator's buttons are drawn with `RoundRect` ([[topic:ellipses]]). Notepad takes typing in its multi-line edit control ([[topic:multi-line-edit-controls]]), and its Find and Open dialogs are `COMMDLG.DLL` itself, loaded from the disk ([[topic:dynamic-link-libraries]]). The Open dialog lists the disk through DOS ([[topic:directory-lists]]). A file chosen there opens in Notepad, read into the edit control's own block in Notepad's heap. Its scroll bars scroll it: pressed, held and dragged ([[topic:scroll-bars]]). File Manager and Program Manager are MDI programs, whose document windows live inside a frame ([[topic:mdi]]). Program Manager draws each item's icon by writing it into an icon's own block of memory ([[topic:window-states]]), and its titles with [[fn:USER.DrawText]]. Its minimized groups sit along the bottom of the MDI client. They show their class's icon because USER sends them `WM_PAINTICON` and not `WM_PAINT` ([[topic:window-states]]). Before that, Program Manager's own paint had erased them white. Program Manager's client shows scroll bars when a group reaches past its edges, as USER works them out ([[topic:mdi]]).

## Used as a person uses them

Each program has been driven as a person at the page drives it, with the mouse and the keys: its menus, its dialogs' controls, typing and selecting, the clipboard between programs, saving. `crates/winbox-web/tests/accessories.rs` and `test/win16/accessories_test.ts` keep the sessions. What that found:

- Control Panel faulted as it started: its empty window and its scroll bar sent each other `WM_SIZE` without end ([[topic:scroll-bars]]).
- File Manager stopped at `INT 25h` on the Rust engine ([[topic:drives-and-disks]]); its tree selected nothing ([[topic:list-boxes]]); its Copy box took no keys ([[topic:hooks]]) and read its From field short ([[topic:edit-controls]]). It would not copy: its drives told no free space, "Not enough disk space", and then its extended open was not answered, "Invalid file handle" ([[topic:drives-and-disks]]).
- Calculator's Control and C and V did nothing ([[topic:keyboard-input]]).
- Notepad saved noughts ([[topic:multi-line-edit-controls]]); Control and Shift with Insert and Delete did nothing in any edit control ([[topic:edit-controls]]).
- Write's Save As took no name: the focus stayed in the document ([[topic:activation-and-focus]]).
- Notepad's Find box, after its "Cannot find" box, gave its focus to its field with the text selected, and what was typed next replaced the text to be found. The box is now made active while it is still hidden, as Windows makes it ([[topic:activation-and-focus]]).
- Program Manager's group icons opened Program Manager's system menu, and a double click did not restore them ([[topic:mdi]]).
- A group window's system menu opened neither by Alt and the hyphen nor by its box nor its icon: USER gives a document window a system menu of its own, and its keys reach it ([[topic:mdi]]).
- Windows Help, opening Notepad's help, said "Unable to add button.": `LocalHandle` answered nought ([[topic:global-and-local-memory]]). Its `EnableMenuItem` calls answering -1 are Windows' answers too ([[topic:menus]]).
- Notepad's Undo stayed grey: the edit controls kept nothing to undo ([[topic:edit-controls]]).
- Control Panel's Date & Time took no Escape, and typed a tab into its field for Tab. Its fields are multi-line edit controls, which take those keys as a dialog's only once the dialog manager has asked them `WM_GETDLGCODE` with a message, and winbox.js asked with none ([[topic:multi-line-edit-controls]]). Its AM and PM list was drawn two pixels high: `WM_SETFONT` had not made its rows the dialog font's height ([[topic:list-boxes]]).
- Alt and Tab, and Alt and Escape, did nothing: `DefWindowProc` runs a loop of its own for them, which shows the program Tab comes to in a box while Alt is held and switches to it as Alt is let go ([[topic:task-list]]). Both engines' sessions switch between Notepad, Clock and Calculator with them.
- Control and Escape went to the window with the focus, and Task Manager never started: USER's system queue takes the key for itself, and `DefWindowProc` starts `TASKMAN.EXE` for `SC_TASKLIST` ([[topic:task-list]]). Its Switch To did nothing, for `SwitchToThisWindow` was a stub, and its Cascade and Tile moved nothing, for the desktop window was no parent to arrange. A double click on the desktop was thrown away. Print Screen was handed to the program with the focus. Now the Task List switches, tiles, cascades, arranges the icons and ends a program, a double click on the desktop opens it there, and Print Screen copies the screen.
- Paintbrush draws, fills and saves; Cardfile adds, renames and saves cards; Calendar takes appointments and saves; Character Map's characters paste into Notepad; Terminal's and PIF Editor's dialogs answer their radio buttons, check boxes and lists.

## A second sweep: Paintbrush, Write and Cardfile

Paintbrush's dialogs and tools, Write's formatting, finding and files, and Cardfile's cards, views and merging were driven again in depth: `crates/winbox-web/tests/sweep_paint_write_card.rs` and `test/win16/sweep_paint_write_card_test.ts` keep the sessions. Each failure was in USER, GDI or KERNEL, and was the same in both engines:

- In Paintbrush's Font box, Tab in a combo box's field went nowhere, and the size, read with `GetDlgItemInt`, was always "not a number": the dialog manager looked for the field among the dialog's own controls, and `GetDlgItemInt` read the combo box's own text, not its field's ([[topic:dialog-boxes]]).
- Over a dialog's controls the cursor stayed Paintbrush's hourglass: USER's own classes had no cursor ([[topic:cursor]]).
- Paintbrush's Control and V right after Control and C did nothing: `TranslateAccelerator` sent no `WM_INITMENUPOPUP`, in which Paintbrush enables Paste ([[topic:keyboard-input]], [[probe:accinit]]).
- Paintbrush saved the bottom of its picture in place of its middle: `_lwrite` wrapped a buffer that runs past 64 KiB ([[topic:dos-handles]], [[probe:lwrhuge]]).
- Paintbrush's underlined text had no underline: the rules were drawn black whatever the text colour, and the System font's strikeout ignored where the text was drawn ([[topic:text-ground-and-rules]], [[probe:ulcolour]]).
- Dragging across Write's text selected nothing: `GetKeyState` did not follow the mouse buttons ([[fn:USER.GetKeyState]]).
- Cardfile's File Merge said "Filename not valid": `OpenFile` with `OF_PARSE` opened the file and answered its handle ([[topic:finding-files]]).
- Passed: Paintbrush's Image Attributes, Brush Shapes, Edit Colors, Page Setup and Font boxes, its text tool, the box, line, curve and polygon tools, the eraser and the colour eraser with the right button's background, the pick tool's cutout dragged, copied and pasted and its Pick menu, the zoom in and out, View Picture, the scroll bars of a picture larger than the window, and Save As with Info and Open; Write's Character, Paragraph and Document menus and their boxes, its header, ruler and tabs, Find, Replace, Go To and Repaginate, the selection bar and double clicks, and a document saved and opened again with its bold and centring; Cardfile's Index, Add, Duplicate, Delete, Go To, Find and Find Next, the list view, Autodial, a picture pasted from Paintbrush, and cards merged and saved.

## A second sweep: Terminal, Control Panel and the rest

Terminal, Control Panel's applets, Recorder, the Clipboard Viewer, PIF Editor, Character Map, Sound Recorder, Calendar and Clock were driven again in depth, beside the sweep above: every one of Terminal's settings dialogs and its window, its scroll-back and its clipboard, its settings saved and opened; each applet of Control Panel's, its dialogs and what it writes to `WIN.INI` and `CONTROL.INI`. `crates/winbox-web/tests/sweep_terminal_control.rs` and `test/win16/sweep_terminal_control_test.ts` keep the sessions. What that found:

- A program started beside Terminal never showed its window: Terminal polls its port with `PeekMessage`, which on the Rust engine answered nothing without letting the other programs run ([[topic:several-programs]]).
- Terminal saved its settings as `C:\WINDOWS\.TRM`, its window named `Terminal - .TRM`: KERNEL's `OpenFile`, failing, leaves the name made whole in its structure, which COMMDLG's Save As hands the program, and winbox.js left it as given ([[topic:finding-files]]).
- Control Panel's Color showed no sample of the screen's elements and none of its colours' boxes: it draws them over statics of `SS_USERITEM`, which winbox.js filled white ([[topic:standard-controls]]); made wider, the dialog was due only beside its children ([[topic:painting]]). Its sample and its boxes took no clicks, the statics keeping them ([[topic:hit-testing]]), and after a press on the sample nothing in the dialog took a click: it lets the mouse go with `SetCapture(0)`, which winbox.js refused ([[topic:hit-testing]]).
- Control Panel faulted in Fonts as a font was chosen: VER.DLL took `IsRomModule`'s answer, left as it was by a stub, for a selector; and Fonts showed its first font's sample whatever was chosen, `LB_GETSELITEMS` answering nought ([[topic:small-queries]], [[topic:list-boxes]]). Add Fonts listed nothing: Fonts fills the list as it is told the box is idle, with `WM_ENTERIDLE`, which no dialog's loop sent ([[topic:dialog-boxes]]), and names a TrueType font with GDI's `UnicodeToAnsi`, a stub ([[topic:small-queries]]).
- Fonts said a font file had a problem, and Add Fonts could install nothing. GDI's `AddFontResource` and `RemoveFontResource` were stubs. They now keep GDI's font table, and Fonts installs and removes a screen font and a TrueType one ([[topic:font-resources]], [[probe:fontres]]).
- Color listed no "Windows Default" scheme. It builds that scheme from the display driver's `OEMBIN` resource, which it finds with `FindResource` on `GetModuleHandle("DISPLAY")`. winbox.js's `DISPLAY` had no resources. It now has its driver file's ([[topic:display-driver-resources]], [[probe:drvres]]).
- In Ports' Settings, Tab never left the baud rate, a drop-down combo box's edit control, and over the Mouse applet the cursor stayed the hourglass: the same two faults Paintbrush's Font box and Image Attributes showed above ([[topic:dialog-boxes]], [[topic:cursor]]).
- Desktop's wallpaper field showed nothing: a combo box's edit control was clipped by its parent's sibling, the group box over them ([[topic:standard-controls]]). Its spin buttons did nothing: `GetMessagePos` answered the place of the last message a program took, not the one the dialog's loop took ([[topic:dialog-boxes]]).
- Clock double-clicked kept its menu bar: a window at the top keeps its menu in `GWW_ID`'s word ([[topic:window-calls]]). Then it kept its caption: Clock takes it out of its style and asks [[fn:USER.SetWindowPos]] with `SWP_DRAWFRAME` to draw its frame again, which winbox.js did not follow. Its client area is now laid out again and its frame drawn without the caption ([[topic:window-frames]], [[probe:swpframe]]).
- Control Panel's Desktop set a pattern and a wallpaper that were kept and written, and the desktop was painted its colour alone. The desktop is now drawn with them, the icons' titles over them in the desktop's brush ([[topic:system-parameters]], [[probe:deskwall]]). And a double click needed both presses at one point: USER takes any press in a rectangle about the first, `DoubleClickWidth` by `DoubleClickHeight`, on the same window with the same button, and decides as the press is taken, not as it is put in ([[topic:system-queue]], [[probe:dblrect]]).
- Desktop given a wallpaper of 24 bits a pixel left the desktop its colour: winbox.js refused a wallpaper of more than eight bits, and read no DIB of 24. USER loads one as any other, and the display driver matches each pixel ([[topic:system-parameters]], [[probe:deskdeep]]).
- Sound Recorder could not open or save a file, and said there was not enough disk space: `MMSYSTEM`'s file functions were stubs. It opens a file, plays it on WinBox's own sound card, changes it with its Effects menu and saves it, through them ([[topic:multimedia-files]]). [[probe:sndrec]] has Windows' own Sound Recorder save three changed files, and winbox.js writes every byte the same; [[probe:sndbig]] has it save one of 100,001 samples, past a segment, the same. `crates/winbox-web/tests/sound_recorder.rs` and `test/win16/sound_recorder_test.ts` keep the sessions, one of them reversing that file and saving it.
- A menu's pop-ups were drawn in no window a program could find. Notepad's File menu now comes up in USER's own window of the class `#32768`, owned by Notepad's window and in front of every window while it is up, hidden again after ([[topic:menus]], [[probe:menuwnd]]). The sessions `notepads_menu_shows_in_users_menu_window` (`crates/winbox-web/tests/accessories.rs`) and its twin in `test/win16/accessories_test.ts` keep it.
- Recorder, told to record, minimizes itself with `SW_MINIMIZE`, and left its icon active: what was typed after went nowhere. Windows takes the focus from it and activates the window active before ([[topic:activation-and-focus]]).
- Recorder recorded nothing: it records and plays through journal hooks, `WH_JOURNALRECORD` and `WH_JOURNALPLAYBACK`, which were kept and never called. USER now calls them as its system queue gives out the input ([[topic:system-queue]]), and Recorder records what is typed into Notepad and plays it back on its shortcut key, which its keyboard hook sees. It plays a macro only to the program it was recorded in, which it finds by the path of the active window's instance, asked from its own task: the Rust engine's [[fn:KERNEL.GetModuleFilename]] answered the asking task's path for another task's instance, and Recorder flashed its icon and played nothing.
- Keys pressed together faster than the program took them went to the window that had the focus when they were pressed: in Ports' Settings, Up, Tab, Down and Enter at once moved the first list's selection both ways. A key is now given its window as it is taken ([[topic:keyboard-input]], [[topic:system-queue]]).
- Control Panel's Desktop showed a granularity of 8307 and a border of 268, Keyboard's sliders stood at their ends, and nothing Mouse, Desktop or Keyboard set reached `WIN.INI`: [[fn:USER.SystemParametersInfo]] answered three of USER's 36 actions. It now keeps every setting as USER does, reads them from `WIN.INI` as USER starts, writes them back under their names and sends `WM_WININICHANGE` as asked ([[topic:system-parameters]]).
- Desktop given a border width of 1 shrank Control Panel's window, but drew its frame as at 3, crowded: the frame is now drawn at each width as Windows draws it, two pixels across at 1 ([[topic:system-parameters]], [[probe:bdrwidth]]). A program's own moves through `MOUSE_EVENT` now follow Mouse's tracking speed, and Desktop's screen saver's delay starts the screen saver `SYSTEM.INI` names ([[probe:spiidle]]).
- International's Change dialogs, Date & Time, Drivers, Sound, the Clipboard Viewer's formats and `.CLP` files, PIF Editor's fields and `.PIF` files, Character Map's grid, keys, fonts and copying, and Calendar's views, alarms and special times work as a person uses them. Calendar keeps to 1980 to 2099: on a machine whose clock says 1970, its month starts on the wrong day and its day has no date, as it would on Windows.

- Cardfile's window is three pixels shorter in its list view than in its card view, and stays so back in the card view: so it is in Windows. [[probe:cardview]] starts Cardfile and records its window and children in each view: 323 pixels high, then 320 and 320, the card window and the list box each three shorter. What differed was the window's place. Cardfile asks for `CW_USEDEFAULT` with a class of `CS_BYTEALIGNCLIENT`, and USER moves such a window on until its client area starts at a multiple of 8: Windows put it at 4, winbox.js at 0 ([[topic:window-states]]).

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
