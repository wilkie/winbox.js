---
kind: topic
name: The MIDI Mapper
summary: How Windows 3.1's MIDI Mapper, MIDIMAP.DRV, keeps its setups, patch maps and key maps in MIDIMAP.CFG, which setup is current, and how it maps each short message on its way to a device -- read out of the driver and held write for write against DOSBox's OPL with the "Ad Lib general" setup current.
probes: [mididev, adlibmap, adlibgm]
---

A program that opens `MIDI_MAPPER` (`FFFFh`) is given Windows' MIDI Mapper, `MIDIMAP.DRV`, the driver `SYSTEM.INI` names as `[drivers]` `midimapper=`. It sends each channel to the device its current setup names, as another channel there, and through a patch map that changes programs, keys and volume. This page says how it keeps its setups and what it does with a message, so that a mapper of WinBox's own can do the same.

[[read out]] Everything below is read out of `MIDIMAP.DRV` (52,784 bytes), cited as segment and offset: seg1 holds `CPlApplet`, seg2 `DriverProc` and `modMessage`, seg3 the rest of its code, seg6 its data. The probes are [[probe:mididev]], [[probe:adlibmap]] and [[probe:adlibgm]], recorded on the oracle's installation with a Sound Blaster and its Ad Lib (`--display vgasound`, [[topic:adlib]]).

## MIDIMAP.CFG

[[read out]] The setups are kept in `MIDIMAP.CFG` in Windows' system directory: `GetSystemDirectory`, then string 73h of the driver's resources (seg3 `4063`). The file begins with seven words (seg3 `16ee`, `3aaa`):

| Offset | Word                             | The installation's |
| ------ | -------------------------------- | ------------------ |
| 0      | A version                        | 1                  |
| 2, 4   | Not read by the mapper           | 1780h, 0           |
| 6      | The current setup's number       | 7, "Ad Lib"        |
| 8      | Where the table of setups is     | 0Eh                |
| 10     | Where the table of patch maps is | 152Ah              |
| 12     | Where the table of key maps is   | 2A46h              |

[[read out]] Each table is a word of room, a word of entries in use, then its room of entries of 36h bytes (seg3 `3b8e`). An entry is a name of 16 bytes, a description of 32, the entry's number (a word) and where in the file what it names is kept (a doubleword). An entry is found either by its number, counted from 1 (seg3 `3d41`), or by its name, compared with each named entry's without regard to case by `lstrcmpi` (seg3 `3d8b`-`3dba`). [[measured]] The installation's tables have room for 100 entries each. Its setups' entry 1 is empty, so its eight setups are numbered 2 to 9.

[[read out]] A setup is 284h bytes (seg3 `1b7f`). For each of the 16 channels in turn it has 28h bytes:

- the channel it is sent as, a word, counted from nought;
- the device's name, 32 bytes, empty for a channel sent nowhere;
- the number of its patch map, a word, nought for none;
- its flags, a doubleword: 1, the channel is sent; 2, it goes through its patch map.

[[read out]] A patch map is 20Bh bytes (seg3 `1de2`). It is a word, then a byte that the volume is divided by, then two bytes for each of the 128 programs (the program it is sent as, and its volume), then a word for each program naming its key map (seg3 `1e39`, `1e8b`). A key map is 86h bytes (seg3 `1fb5`): a word, then the key that each of the 128 keys is sent as.

[[measured]] The installation's setups:

| Number | Name            | Description          | Channels                                                                     |
| ------ | --------------- | -------------------- | ---------------------------------------------------------------------------- |
| 2      | LAPC1           | Extended-level setup | 1-8 as 2-9, 10 as 10, to "Roland MPU-401", patch maps MT32 and MT32 Perc     |
| 3      | Proteus/1       | Extended-level setup | 1-10 to "Creative Labs Sound Blaster 1.5", patch maps Prot/1 and Prot/1 Perc |
| 4      | MT32            | Extended-level setup | 1-8 as 2-9, 10 as 10, to the Sound Blaster, patch maps MT32 and MT32 Perc    |
| 5      | General MIDI    | General MIDI setup   | 1-16 to the Sound Blaster                                                    |
| 6      | Extended MIDI   | Extended-level setup | 1-10 to the Sound Blaster                                                    |
| 7      | Ad Lib          | Base-level setup     | 13-16 to "Ad Lib"                                                            |
| 8      | Ad Lib general  | General MIDI setup   | 1-16 to "Ad Lib", 10 as 16 and 16 as 10                                      |
| 9      | Proteus general | General MIDI setup   | 1-16 to the Sound Blaster, patch maps Prot/1 and Prot/1 Perc                 |

[[measured]] Its four patch maps divide the volume by 100, and every program's volume in them is 100. Its nine key maps include "+1 octave", "-1 octave", "+2 octaves", single keys ("all keys to key 55"), and the Proteus/1's and the MT32's drums.

## The current setup

[[read out]] The current setup is the one the file's word at 6 names, by number. The mapper reads it each time it is opened: the header first, then the setup's entry, to find its name (seg3 `16ca`), and then the setup by that name (seg3 `1b0f`). Its routine that makes a setup current, given the setup's name, writes the setup's number into that word and writes the header back (seg3 `15fe`). The mapper keeps nothing about the setup in `SYSTEM.INI` or `WIN.INI`.

[[read out]] An open whose setup cannot be read answers as `MIDIMAP` turns its reasons into errors (seg3 `db8`):

- a setup that is not in the table answers `MIDIERR_INVALIDSETUP` (69);
- a device the setup names that no MIDI output device is named answers `MIDIERR_NODEVICE` (68);
- running out of memory answers `MMSYSERR_NOMEM` (7);
- a file it cannot read answers `MIDIERR_NOMAP` (66).

## Opening

[[read out]] Opening the mapper (seg3 `1188`) reads the setup into memory (seg3 `1b0f`-`1d57`). It reads each channel's patch map, and every key map that the patch map names, once, however many channels share them (seg3 `379c`). It finds each device the setup names by asking each MIDI output device for its capabilities, until one has the same name without regard to case (seg3 `1c47`). It looks for every channel's device before failing.

[[read out]] Its capabilities' channel mask (seg3 `efa`) is the channels whose flag 1 is set, as the last open found them (seg3 `1254`). [[measured]] Before the mapper is ever opened the mask is nought ([[probe:mididev]]). Opened with "Ad Lib general" it is FFFFh ([[probe:adlibgm]]).

## A short message

[[read out]] `MODM_DATA` (seg2 `3c2`) keeps a running status of its own. A status from F8h is sent to every device. A status from F0h is sent to every device and clears the running status. A channel's status sets it. A message that starts with a data byte uses the running status, or goes nowhere if there is none. A channel message is then mapped (seg2 `24b`):

1. A channel whose flag 1 is clear goes nowhere.
2. Where the message has its status, the status's channel becomes the one the setup gives. A message by running status keeps only its data bytes, and the device uses its own running status.
3. A channel whose flag 2 is set goes through its patch map. The key of a note off, a note on or a key pressure goes through the key map of the channel's program, if that program has one. A program change keeps the program asked for as the channel's (seg6 `25Eh`), and is sent as the patch map's program. Controller 7, the volume, is multiplied by the channel's program's volume and divided by the map's divisor (seg3 `4aa0`).
4. The message goes to the channel's device.

[[read out]] Nothing else is changed. A note's velocity is not scaled, and no controller but 7 is touched. The programs kept for the channels start at nought when the driver is loaded, and are kept past each close.

[[read out]] A long message is broken into short messages and system-exclusive ones in a buffer of the mapper's own (seg2 `169`, `4ab`).

## Through "Ad Lib general"

[[measured]] The oracle recorded [[probe:adlibmap]] again, and [[probe:adlibgm]], with "Ad Lib general" made current. `record.mjs --midimap "Ad Lib general"` writes 8 to the word at 6 of the scratch drive's copy of `MIDIMAP.CFG`, and the installation keeps its own. The recordings are `adlibmap-adlibgeneral` and `adlibgm-adlibgeneral`, with OPL traces beside them in `oracle/fixtures/opl/`.

- Opened, the mapper's channel mask was FFFFh.
- Channel 1, which "Ad Lib" sends nowhere, played on the Ad Lib.
- General MIDI's drums on channel 10 played on the Ad Lib's percussion channel, 16.
- Channel 16 played as a melodic channel, the Ad Lib's 10.
- A note on by running status after `99h` reached the Ad Lib as data bytes, and struck the drum on its channel 16.

## WinBox's mapper

WinBox's own mapper, `WBMAPPER` (`crates/winbox-win16/src/wbmapper/`), reads the same file in the same way as it opens (`setups.rs`), and maps each message as above. The installation's setups name Windows' devices. Where a setup names the Ad Lib, "Ad Lib", the mapper finds WinBox's synthesizer, which writes what the Ad Lib's driver writes. Where it names the Sound Blaster 1.5's MIDI port, "Creative Labs Sound Blaster 1.5", it finds WinBox's card's port. A setup naming another device, as "LAPC1" names the "Roland MPU-401", finds none, as Windows' mapper finds none without that card.

The current setup is the one named in WinBox's mapper's own section of `SYSTEM.INI`:

```ini
[wbmapper.drv]
setup=Ad Lib general
```

With none named, the file's current setup is used. With no `MIDIMAP.CFG`, the setups that need no patch map and name only devices WinBox has ("Ad Lib", "Ad Lib general", "General MIDI" and "Extended MIDI") are kept in code, and "Ad Lib general" is used where none is named. The sound card's installation names the setup with the card: "Ad Lib general" for WinBox's own card, which the page and `winbox-native --sound` install, so that General MIDI plays; "Ad Lib" for the Sound Blaster 1.5's, which the probe survey installs, so that what the oracle recorded through the mapper is met.

[[measured]] Run on the Rust engine with the Sound Blaster's card and "Ad Lib general" current, each recording's writes are DOSBox's write for write (`crates/winbox-win16/tests/adlib.rs`). `adlibmap-adlibgeneral` makes 1,134 of 1,134, and `adlibgm-adlibgeneral` 1,175 of 1,175. Of their bursts of writes, 85 of 92 and 106 of 113 last as long as DOSBox's to 0.05 ms. Of the gaps between bursts, 85 of 91 and 109 of 112 are within a millisecond of DOSBox's.

[[measured]] Opening the mapper takes longer the more channels name a device: each channel asks the devices for their capabilities in turn until it finds its own, and the Ad Lib is the second device. With "Ad Lib general" current, 16 channels ask 32 times, against "Ad Lib"'s 8. The first open's reset began 9.169 ms later in `adlibmap-adlibgeneral`'s trace than in `adlibmap`'s, which is 27,507 instructions at 3,000 a millisecond, or 1,146 for each ask. WinBox's mapper charges that much for each ask. With it, every record of the two recordings but the `at` times agrees, and the `at` times are within 4 ms of Windows'. `adlibmap`'s own are within 5 ms.

[[measured]] On the page's machine, `adlibgm`'s first note, on channel 1, is heard 3,000 ms after the mapper's open sounds the chip. With "Ad Lib" current, nothing is heard until its note on channel 16, 7,980 ms after (`crates/winbox-web/tests/sound.rs`).

Not followed: long messages, which stop the run. Control Panel's MIDI Mapper is not followed either. `MIDIMAP.DRV` exports it as `CPlApplet` (seg1 `11f`), with its dialogs among the driver's resources. Control Panel looks for `CPlApplet` in each installed driver, and finds none in WinBox's mapper, so it shows no MIDI Mapper. The setup is chosen in `SYSTEM.INI`.
