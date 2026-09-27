---
kind: topic
name: Sound devices
summary: What MMSYSTEM answers on a Windows 3.1 installation with no sound driver — no waveform, MIDI or auxiliary devices, every open refused as a bad device, and its own error texts — measured.
probes: [mmdevs, mcidevs]
---

A Windows 3.1 installation has only the multimedia devices its `SYSTEM.INI` names drivers for. The installation winbox.js runs, and the oracle records, names only the timer and the MIDI mapper: there is no sound card driver. So there is nothing to play waveform sound on or record it from. Programs ask before they try, and must be told the truth.

[[measured]] [[probe:mmdevs]] counts each kind of device, opens waveform devices each way there is, asks their capabilities, and asks for the error texts. winbox.js agrees with all 26 of its records.

## No devices

- [[measured]] [[fn:MMSYSTEM.waveOutGetNumDevs]], [[fn:MMSYSTEM.waveInGetNumDevs]], [[fn:MMSYSTEM.midiOutGetNumDevs]], [[fn:MMSYSTEM.midiInGetNumDevs]] and [[fn:MMSYSTEM.auxGetNumDevs]] all answer 0.
- [[measured]] [[fn:MMSYSTEM.waveOutOpen]] and [[fn:MMSYSTEM.waveInOpen]] answer 2, `MMSYSERR_BADDEVICEID`, whether asked for device 0 or the mapper, and whether querying a format or opening for real. Where a handle is asked for, it is written, as 0.
- [[measured]] [[fn:MMSYSTEM.waveOutGetDevCaps]] and [[fn:MMSYSTEM.waveInGetDevCaps]] of device 0 answer 2 as well.

## Error texts

- [[measured]] [[fn:MMSYSTEM.waveOutGetErrorText]] and [[fn:MMSYSTEM.waveInGetErrorText]] answer 0 and copy the error's text, for 0, 2, 6 and 32: "The specified command was carried out.", "A device ID has been used that is out of range for your system.", "There is no driver installed on your system." and the text for an unsupported format.
- The texts are `MMSYSTEM.DLL`'s string table, numbered as the errors are: 0 to 11 for the general errors, 32 to 35 for the waveform ones, 64 to 69 for MIDI, and from 257 for MCI. winbox.js keeps them itself, with MCI's device types and words, since no Windows file is shipped (`src/win16/mmsystem/strings.ts`).
- Not yet measured: the text for an error outside those numbers, which the documentation says answers `MMSYSERR_BADERRNUM`, and a buffer too small for the text.

## Why it mattered

winbox.js answered 1 for `waveOutGetNumDevs`, and 0 -- success -- for opening a device. Sound Recorder asks whether it can record in its usual format, and it was told yes. It showed an empty recording as 65.53 seconds long, then failed in its own arithmetic ([[topic:accessories]]). With the devices answered as Windows answers them, and the arithmetic fixed, it shows 0.00 seconds and greys out its Play and Record buttons. Which of the two changed the length is not separated out.

## MCI

The media control interface sits above the devices. A program opens a device by its type and sends it commands with [[fn:MMSYSTEM.mciSendCommand]]. MMSYSTEM opens the device's driver as an installable driver ([[topic:installable-drivers]]) and passes the commands on to it.

- [[measured]] [[probe:mcidevs]] opens each device `SYSTEM.INI`'s `[mci]` names by its type, as Media Player does as it starts. It asks each for its capabilities and its product, then closes it. winbox.js runs the probe whole, and all 12 records agree.
- [[measured]] WaveAudio and Sequencer open, though there is no device under them. They say they can neither play nor record. The waveform device has audio, uses files, is compound and can save, and the sequencer is none of these. Their products are "Sound" and "MIDI Sequencer".
- [[measured]] CDAudio answers 10Ah, "There is an undetectable problem in loading the specified device driver", because its driver, `MCICDA.DRV`, is not there. A type `[mci]` does not name answers 107h.
- [[read out]] MMSYSTEM looks the type up in `[mci]`: as a key, as a key with a digit after it, or as a driver's file name (`MMSYSTEM.DLL` seg5 `1e77`). It opens the driver in the section `mci`, handing it the new device's ID, which counts from 1. It then sends the driver `MCI_OPEN_DRIVER`. `MCI_CLOSE`, `MCI_SYSINFO` and `MCI_BREAK` it answers itself. Every other command goes to the driver as it is.
- [[read out]] A driver answers a capability as the value with a string's number in its high word, and a flag of 10000h, and MMSYSTEM clears that high word in the caller's `dwReturn`. That is why the device type reads 20Ah, not 20A020Ah.
- [[inferred]] Media Player, finding no device it can play, says there are no MCI device drivers installed. It asks exactly the questions the probe does, and the answers match.

## In winbox.js

`src/win16/mmsystem/devices.ts` holds the device counts, the opens, the capabilities and the error texts.

MCI is `src/win16/mmsystem/mci.ts`. `MCIWAVE.DRV` and `MCISEQ.DRV` are winbox.js's own drivers, in `src/win16/mmsystem/mci-drivers.ts`, as `TIMER.DRV` is. They are found by their files' names with no file on the drive, and their names are their own. Opening a file on them is not followed: it answers 108h, as when their own task cannot be made.
