---
kind: topic
name: WaveMix
summary: Microsoft's 1993 waveform mixer, WAVMIX16.DLL, which SimTower plays its sounds through — the files it needs, how it sizes its blocks, how it takes the device and keeps it fed from MM_WOM_DONE, how it tells a program a sound has ended — read out of the library and measured with the Sound Blaster; and why SimTower plays nothing without SIMTOWER.INI.
probes: [wavemix]
---

WaveMix is a library Microsoft gave away for games: it mixes up to eight waves into one stream and plays that on a single waveform device. It was never part of Windows. A game ships it, and its installer puts it in `C:\WINDOWS\SYSTEM`. The copy here is SimTower's `WAVMIX16.DLL`, "Wavmix.dll V 2 by Angel M. Diaz, Jr. (c) Microsoft 1993", built Oct 6 1994. It is a program's library like any other: winbox.js runs the file, and has nothing of its own for it. What it needs from Windows is MMSYSTEM's waveform devices ([[topic:sound-devices]]) and a driver under them: the Sound Blaster's on the oracle, WinBox's own card in winbox.js.

The addresses below are in `WAVMIX16.DLL`'s one code segment, seg1; its data segment's offsets are given as `DS:`.

## Its exports

| Ordinal | Export                 | Where       |
| ------- | ---------------------- | ----------- |
| 2       | `WNDPROC`              | seg1 `3dc0` |
| 3       | `WaveMixInit`          | seg1 `3e2e` |
| 4       | `WaveMixActivate`      | seg1 `0fd4` |
| 5       | `WaveMixOpenWave`      | seg1 `2d20` |
| 6       | `WaveMixOpenChannel`   | seg1 `115a` |
| 7       | `WaveMixPlay`          | seg1 `1a66` |
| 8       | `WaveMixFlushChannel`  | seg1 `1f36` |
| 9       | `WaveMixCloseChannel`  | seg1 `2054` |
| 10      | `WaveMixFreeWave`      | seg1 `2114` |
| 11      | `WaveMixCloseSession`  | seg1 `3b1e` |
| 12      | `WaveMixPump`          | seg1 `16f6` |
| 13      | `FIGUREPROC`           | seg1 `3e08` |
| 14      | `WaveMixGetInfo`       | seg1 `3e60` |
| 15      | `WaveMixConfigureInit` | seg1 `36ea` |

A session is a block of its local heap, marked `5432h` at its start and at `8Ch`. Every call but `WaveMixInit`, `WaveMixPump` and `WaveMixGetInfo` checks the mark, and with a bad handle beeps ([[fn:USER.MessageBeep]] of -1) and answers 5.

## The session: WAVEMIX.INI and the device

[[read out]] `WaveMixInit` is `WaveMixConfigureInit` of a configuration of ten bytes, all nought but its size. That makes the session from `WAVEMIX.INI`, in the Windows directory:

- The file must be there: it is looked for with [[fn:KERNEL.OpenFile]] and `OF_EXIST` (seg1 `35fe`), and without it there is no session; with `ShowDevices` set, a box says so first (`3636`). A game's installer writes the file. SimTower's folder has none, so it has to be made by hand: `[general] ShowDevices=0` is enough.
- `[general] ShowDevices` (default 0) puts up a box of the devices, and of each failure. With it 0, no box is ever shown.
- `[general] WaveOutDevice` (default 0) is the device; one past the last is the wave mapper.
- The device's capabilities are asked, and its name is the section its settings are read from, each defaulting to `[default]`'s: `Remix` (1), `GoodWavePos` (0), `WaveBlocks` (3, held to 2 to 6), `WaveBlockLen` (0) and `SamplesPerSec` (11: 11, 22 or 44 thousand). A device whose capabilities have `WAVECAPS_SYNC` makes no session, and nor does one named under `[not compatible]`.
- The format is 8-bit PCM, one channel, at `SamplesPerSec`; two channels where the configuration asks for them and the device has two.

[[read out]] With no `WaveBlockLen`, the block is measured (seg1 `3284`). Under Windows NT (`GetWinFlags` with 4000h) it is worked out from the rate instead. Elsewhere WaveMix opens the device with `CALLBACK_FUNCTION`, `FIGUREPROC`. It prepares 512 headers of 16 bytes of silence, pauses the device, and writes them, all 512 unless one is done first. It restarts the device and spins until `FIGUREPROC` has counted an `MM_WOM_DONE`. The count is how many 16-byte headers the driver finished in one go, at its first interrupt; eight bytes for each is the block, held to 512 to 4,096. Then it resets the device, unprepares the headers and closes it. These are the 512 prepares and writes a program using WaveMix is first seen to make. The spin is in the foreground with interrupts on: it ends only because the driver calls back from its interrupt. A driver that finished headers only when asked would hang it.

[[read out]] `WaveMixGetInfo` takes a structure of 20 bytes, its size first; of any other size it answers 20 and copies nothing. Else it copies its own: version 2, the date "Oct 6 1994", formats `FFFh`.

## Channels and waves

- [[read out]] `WaveMixOpenWave(session, name, instance, flags)`: flag 2 is a `WAVE` resource of the instance's, by name or number; otherwise a file, read with MMSYSTEM's `mmio` functions ([[topic:multimedia-files]]). Each wave is converted to the session's format, and asked of the device first with `WAVE_FORMAT_QUERY`. A file that is not there answers a null pointer, with no box.
- [[read out]] `WaveMixOpenChannel(session, channel, flags)` (seg1 `115a`): flags 0, the one channel; 1, all eight; 2, the first `channel` of them. It answers 4 for a channel open already, 11 for a channel past 7, and 10 for other flags.
- [[read out]] `WaveMixPlay` takes a structure of 18 bytes: its size, the session, the channel, the wave, a window to tell, flags and a count of loops. Flag 1 clears the channel's queue, 2 takes the channel used longest ago, 4 starts the wave at once rather than after the last block mixed, and 8 holds the wave until the next play without it. It answers 4 while the session does not have the device, and 5 for no channel open, a channel not open or no wave.

## The device: activation, mixing and MM_WOM_DONE

[[read out]] `WaveMixActivate(session, TRUE)` (seg1 `0fd4`) takes the device for the session; one session at a time has it. It stops [[fn:MMSYSTEM.sndPlaySound]]'s sound, makes a hidden window of class `WavMix16`, and opens the device with `CALLBACK_WINDOW` to it (`0ef6`). It prepares six blocks (`0c5e`), and sets its clock from [[fn:MMSYSTEM.waveOutGetPosition]] in bytes and [[fn:MMSYSTEM.timeGetTime]] (`0a56`). Then it writes each free block that has something in it to mix. With nothing playing there is nothing to write, and none is written. `FALSE` (`0e70`) resets the device, unprepares, closes it and destroys the window.

[[read out]] Where a wave is in its play is WaveMix's own clock, not the device's: with `GoodWavePos` 0, the default, the bytes the time since the clock was set comes to at the session's rate (seg1 `09a4`). With `GoodWavePos` 1 it is the device's position in bytes. Waves are laid at that position or after, and mixed (seg1 `125e`) a block at a time into the blocks it owns, each written with [[fn:MMSYSTEM.waveOutWrite]]. `WaveMixPlay` pauses the device if no block was queued, writes every block it can fill, and restarts it.

[[read out]] Its window's procedure (seg1 `3dc0`) does one thing: at `MM_WOM_DONE` it calls `WaveMixPump`. The pump (seg1 `16f6`) frees each block the driver has set `WHDR_DONE` in. It tells each wave's window that its wave has ended, with `MM_WOM_DONE` posted to it: the channel as its wParam, the wave as its lParam (seg1 `166c`). Then it mixes and writes every free block it can fill. A program may call `WaveMixPump` itself too. SimTower does after each sound it starts (seg58 `02b4`), and after taking its own `MM_WOM_DONE`s from its queue (seg61 `0ee7`). So the mixer is kept going by the driver's done messages to WaveMix's window. Nothing else wakes it: it sets no timer.

[[read out]] `WaveMixCloseSession` gives the device back and closes the channels, then frees the session with [[fn:KERNEL.LocalFree]]. It answers 5 when the block is freed and 0 when it is not, the other way about from every other call (seg1 `3b97`).

## What was measured

[[measured]] [[probe:wavemix]] uses WaveMix as SimTower does, on the installation with the Sound Blaster. It writes `WAVEMIX.INI` itself first, and the recorder puts SimTower's `WAVMIX16.DLL` in `SYSTEM`. The wave is half a second of a square wave, 11,025 samples a second.

- `WaveMixInit` makes a session. The file opens, a missing one answers null.
- Play before the device is taken answers 4, with a channel open or not. Channel 0 opens (0), again 4, channel 8 11.
- Activation answers 0, and again 0.
- The wave played on channel 0 is told ended 0.4 seconds after the play. Played on channels 0 and 1 together, both are told at 0.4 seconds, channel 0 first. Looped once, it is told at 0.7 seconds. These are WaveMix's clock, not the sound's: why its clock is a tenth ahead of the half second is not pinned down [[inferred]].
- Flushed a tenth of a second in, the channel's wave is never told ended.
- Deactivating, closing channels and freeing the wave answer 0, and closing the session 5.

winbox.js agrees with all 30 records on the Rust engine, with WinBox's driver taking the Sound Blaster's part as the oracle's other sound recordings have it. It agrees with all 30 again on WinBox's own card, as `winbox-native --sound` installs it. There the card hands the host the square wave, its samples 40h either side of silence (`wavemix_on_winboxs_own_card`). The TypeScript engine has no sound card, and does not run recordings made with one.

## SimTower plays nothing without SIMTOWER.INI

[[read out]] SimTower decides whether it has sound from its own settings file, `SIMTOWER.INI`. It reads the file at start-up in seg38 `03ad`–`0545`. It looks first in the Windows directory ([[fn:KERNEL.GetWindowsDirectory]] and `\SIMTOWER.INI`), then in its own folder, opening the file with its C library to see that it is there. Only if it is does it read the file's `[Sound]` section: `BeepOnly` (default 0; 1 turns all sound off), `AllSounds` (1), `Elevator`, `Events` and `Background` (each 1). With no file at all, all four flags are set to nought: `DS:2ACh`, which is `AllSounds`, and the three the Options ▸ Sound menu shows. SimTower never writes the file: it imports [[fn:KERNEL.GetPrivateProfileString]] and [[fn:KERNEL.GetPrivateProfileInt]] but not `WritePrivateProfileString`. So its installer must have [[inferred]].

[[read out]] Its routine that plays a sound (seg58 `0167`) returns at once while `DS:2ACh` is nought. The menu's items set only the three other flags (seg44 `07c1`–`086c`), and nothing but the file sets `DS:2ACh`. So with no `SIMTOWER.INI`, SimTower makes its WaveMix session at start-up (seg58 `006b`: `WaveMixInit`, `WaveMixActivate`) and never plays a wave, whatever the menu says. With the file, even an empty `[Sound]`, it plays its title's tune, and the tower's sounds as the game goes on.

[[read out]] The session is taken back while SimTower is not the active program. Each time its message loop finds nothing waiting (seg76 `018e`), it gives the device back if its main window is inactive (`DS:31AAh`, set from `WM_ACTIVATE`) or iconic, and takes it again when it is active once more (`DS:252h`).

What was seen on winbox.js: on `winbox-native --sound`, with `WAVMIX16.DLL` in `SYSTEM` and `WAVEMIX.INI`, SimTower made the 512 writes of the block's measure, took the device, and then made no other wave call in a minute and more, menu or no menu. With an empty `SIMTOWER.INI` put in `C:\WINDOWS`, the card handed the host its title's tune at once, and the tower's sounds while a new tower ran. That was so on Linux, and on Windows through WASAPI, whose default device the run named and whose stream was kept with `--sound-dump`.

## Not yet done

- What SimTower's installer writes in `SIMTOWER.INI`. Only the keys SimTower reads are known.
- SimTower itself recorded under DOSBox with sound. The oracle's installation with a sound card is the 16-colour VGA, and SimTower wants the 256-colour display and WinG. The SIMTOWER.INI finding is a read-out of SimTower's own code, held by its runs on winbox.js with the file and without.
- The block's measure, under the Sound Blaster and under WinBox's card, is not recorded as a number. No call answers it, and only `ShowDevices`' box would show it.
- `GoodWavePos` 1, `WaveBlockLen` given, two channels and 22 or 44 thousand samples a second are not exercised.
