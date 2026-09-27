---
kind: topic
name: Installable drivers
summary: The drivers USER loads and keeps a list of — MMSYSTEM and the timer it opens — how a driver is opened, asked and closed, and what it is sent, as USER.EXE does it and a driver of the probe's own recorded it.
probes: [drivers, drvmsg]
---

An installable driver is a library that exports a function named `DriverProc`, which USER calls with messages. USER keeps a list of them. [[fn:USER.OpenDriver]] adds one, [[fn:USER.SendDriverMessage]] asks it something, and [[fn:USER.CloseDriver]] lets it go. Windows 3.1's multimedia system is built on them, and Control Panel walks the list looking for applets.

[[probe:drivers]] walks the list Windows starts with. [[probe:drvmsg]] brings a driver of its own, `DRVMSGD.DLL`, which logs every call it is given to a file. The probe opens it by its file's name and by an alias, asks it, and closes it again, and reads the log after each step. Both probes run whole in winbox.js, on a copy of the installation's drive, and every record agrees.

## The list

- [[read out]] USER keeps its drivers in a row of slots, and a driver's handle is its slot's place plus one (`USER.EXE` seg41 `165`). An open takes the first free slot.
- [[read out]] The slots are linked into a list, and a new one goes on its end once its library has loaded and `DRV_LOAD` has succeeded.
- [[measured]] Walked forwards, the installation's list is `timer`, then `mmsystem.dll`. Backwards it is the other way round. [[fn:USER.GetNextDriver]] with `GND_FIRSTINSTANCEONLY` gives the same two, since each is the first instance of its module.
- [[measured]] The probe's driver, opened twice, is added to the end twice. Asked for first instances only, the list shows it once.

## Where the list comes from

- [[read out]] The first program's `InitApp` loads the drivers named in `SYSTEM.INI`'s `[boot]` `drivers=`, split at spaces and commas (seg3 `2644`, called from seg5 `484`). They are loaded and enabled but not opened, and each keeps the name as written. The installation names `mmsystem.dll`.
- [[read out]] MMSYSTEM's `DriverProc` answers its first `DRV_LOAD` by opening `timer` (`MMSYSTEM.DLL` seg2 `6ec`). It then opens the wave, MIDI and auxiliary drivers that `[drivers]` names, their mappers if any of them has a device, and `joystick`.
- [[read out]] `timer` opens and is linked while MMSYSTEM, whose load opened it, is not linked yet. So `timer` is first, though MMSYSTEM loaded first. The installation names no wave, MIDI or auxiliary driver, so `midimapper` is never opened, and there is no `JOYSTICK` file.

## Opening

- [[measured]] A driver's name is looked up in `SYSTEM.INI`, in `[drivers]` unless another section is named. The value is its file, and the words after the file's name are the text `DRV_OPEN` is handed. A name that is not there is taken as the file itself, with no words.
- [[read out]] The library is loaded with `LoadLibrary`, and the entry point is its export named `DriverProc`.
- [[measured]] A module's first open sends four calls: one of message nought, then `DRV_LOAD` and `DRV_ENABLE`, each with an identifier of nought, then `DRV_OPEN`. `DRV_OPEN`'s identifier is the new handle. [[read out]] The call of message nought is a check that the driver takes exactly 16 bytes of arguments off the stack.
- [[measured]] What `DRV_OPEN` answers is the identifier every later message carries. A second open of the same module sends only `DRV_OPEN`, and gets a handle of its own.
- [[measured]] An answer of nought to `DRV_OPEN` refuses the open, and [[fn:USER.OpenDriver]] answers nought. If that was the module's only instance, `DRV_DISABLE` and `DRV_FREE` follow and the library goes.
- [[measured]] Each open loads the library once more: two opens count 2.

## Asking and closing

- [[measured]] [[fn:USER.SendDriverMessage]] hands the driver its identifier, its handle, the message and both parameters, and answers what the driver answers.
- [[measured]] `CloseDriver` sends `DRV_CLOSE` with the caller's two parameters, and answers what the driver answers. The last instance then gets `DRV_DISABLE` and `DRV_FREE`, with an identifier of nought, and the library goes. [[read out]] A driver that answers `DRV_CLOSE` with nought is not closed.
- [[measured]] [[fn:USER.GetDriverInfo]] gives the handle, the module and the name the driver was opened by. [[fn:USER.GetDriverModuleHandle]] gives the library's instance, not the module `GetModuleHandle` finds: they are two numbers for one library.
- [[measured]] [[fn:USER.DefDriverProc]], asked about an open driver, answers 1 for `DRV_LOAD`, `DRV_ENABLE`, `DRV_DISABLE`, `DRV_FREE` and `DRV_INSTALL`, and nought for the rest. So a driver that leaves `DRV_OPEN` to it can never be opened.

## Control Panel

- [[read out]] Control Panel sends drivers no messages. It walks the list with `GND_FIRSTINSTANCEONLY`, loads each driver's file as a library, and looks for an applet export, `CPlApplet`, as it does in its `.CPL` files. Neither `TIMER.DRV` nor `MMSYSTEM.DLL` exports one. The MIDI Mapper's applet is in `MIDIMAP.DRV`, which this installation never opens, so there is no MIDI Mapper in Control Panel.

## Not yet done

- The messages USER sends every driver as Windows ends (`DRV_EXITSESSION`, then `DRV_DISABLE` and `DRV_FREE`) and as a program ends (`DRV_EXITAPPLICATION`).
- The stack check around the call of message nought. A driver that fails it is still loaded.
- MMSYSTEM's wave, MIDI and auxiliary drivers from files, and their mappers.

## In winbox.js

`src/win16/user/drivers.ts` keeps the table, and `InitApp` loads the boot drivers. MMSYSTEM's `DriverProc` is in `src/win16/mmsystem/driver.ts`. `TIMER.DRV` is kept by winbox.js, as MMSYSTEM is, in `src/win16/timer.ts`. Its `DriverProc` answers as the file's does, and drives nothing, since winbox.js's MMSYSTEM keeps its own time. A driver winbox.js keeps is called as the function it is. One from a file runs on the processor.
