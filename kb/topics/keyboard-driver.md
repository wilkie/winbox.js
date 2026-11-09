---
kind: topic
name: The keyboard driver
summary: KEYBOARD.DRV's exports besides the character sets -- what the keyboard is, the characters keys type, keys' names and scan codes -- read out of the US driver, recorded, and kept by WinBox's own keyboard module with the driver's tables.
probes: [kbdrv, kbenable]
---

`KEYBOARD.DRV` takes the keyboard's interrupt for USER and turns keys into characters. A program imports it for the character sets ([[fn:KEYBOARD.AnsiToOem]], [[fn:KEYBOARD.OemToAnsi]]), for [[fn:KEYBOARD.VkKeyScan]] and [[fn:KEYBOARD.MapVirtualKey]], and now and then for the rest: [[fn:KEYBOARD.ToAscii]], [[fn:KEYBOARD.GetKeyNameText]], [[fn:KEYBOARD.OemKeyScan]], [[fn:KEYBOARD.GetKeyboardType]].

## WinBox's own

WinBox's keyboard module answers them all from the US driver's own tables, made from the installation by `scripts/oracle/keyboard-tables.mjs` ([[guide:without-windows]]). [[measured]] [[probe:kbdrv]] calls every export a program would, and WinBox agrees with all its records.

- [[read out]] The driver's state is kept in the module's data where the driver keeps it: the type at 0Ch, the Alt numbers [[fn:KEYBOARD.ToAscii]] keeps at 128h and 129h, the SysRq flags at 130h, what [[fn:KEYBOARD.Inquire]] copies at 131h.
- [[read out]] USER enables the driver as Windows starts, which reads the keyboard's type from `SYSTEM.INI` ([[fn:KEYBOARD.NewTable]]); WinBox lays the state out as the driver is first called.
- [[fn:KEYBOARD.Enable]] and [[fn:KEYBOARD.Disable]] keep the event procedure, set the key-state table from the BIOS's shift flags and mark the driver enabled or not, as the driver does ([[probe:kbenable]]); USER enables it with its `keybd_event`. The keyboard's interrupt is not taken: WinBox's input does not come through a keyboard driver ([[topic:keyboard-input]]).

## Not yet done

- A layout library (`keyboard.dll=`), `oemansi.bin`, dead keys and the Caps Lock tables, which the US layout has none of.
- The BIOS's shift flags at 40:17h, which [[fn:KEYBOARD.ToAscii]] sets where it types nothing; WinBox has no BIOS.
- [[fn:KEYBOARD.GetBIOSKeyProc]], which answers nought here.
- Who sets the SysRq flags to 2 as Windows starts.
