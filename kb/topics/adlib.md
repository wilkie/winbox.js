---
kind: topic
name: The Ad Lib synthesizer
summary: How Windows 3.1's Ad Lib driver, MSADLIB.DRV, turns MIDI into writes to an OPL2 — its instrument bank, its voices and percussion, its pitch and volume arithmetic, the order and timing of its writes, and its bugs — read out of the driver and held write for write against DOSBox's OPL as the driver played.
probes: [adlibout, adlibmap, adlibseq]
---

Windows 3.1 plays MIDI on an Ad Lib, or the Ad Lib part of a Sound Blaster, through `MSADLIB.DRV`. The driver takes MIDI messages and writes the registers of a Yamaha YM3812 (OPL2). This page says what it writes, and when, so that a synthesizer of WinBox's own can write the same and sound the same.

The evidence is three probes, recorded on the oracle's installation with a Sound Blaster (`--display vgasound`) while DOSBox captured what its OPL was sent:

- [[probe:adlibout]] opens the Ad Lib's own device and sends it single notes, drums, programs, pitch bends, velocities, controllers, more notes than it has voices, running status, long messages and resets.
- [[probe:adlibmap]] sends notes through the MIDI Mapper, as a program that opens `MIDI_MAPPER` does.
- [[probe:adlibseq]] plays a MIDI file of its own through MCI's sequencer.

[[read out]] Everything below is read out of `MSADLIB.DRV` (22,064 bytes), cited as segment and offset: seg1 is its fixed code, seg2 the code that loads, enables and resets it, seg3 its data.

[[measured]] The read-out is also a program, `scripts/oracle/msadlib.mjs`. Given what each probe sent, it predicts every write DOSBox's OPL was sent, in order: all 2,103 of `adlibout`'s, from Windows starting to Windows ending, and all 1,045 of `adlibmap`'s. For `adlibseq` it predicts all 706, given what MCI's sequencer is inferred to have sent (see [The sequencer](#the-sequencer)).

## The reference

[[measured]] The oracle runs DOSBox 0.74-3 with `[sblaster] sbtype=sb2`, at a fixed 3,000 cycles a millisecond.

- [[read out]] DOSBox's `oplmode=auto` gives a Sound Blaster 2.0 a single OPL2 (`sblaster.cpp`, `Find_Type_And_Opl`).
- [[read out]] `oplemu=default` is DOSBox's own emulator, `DBOPL` (the same as `fast`; `adlib.cpp`, `Module::Module`). It runs at `oplrate=44100`, and the mixer at 44,100 as well.
- [[read out]] DOSBox renders the OPL a millisecond at a time, on its timer tick (`mixer.cpp`, `MIXER_Mix`). Every write made within a millisecond is in force for the whole of it.
- [[read out]] The status port reads `06h` in its low bits, as an OPL2's does. The timer registers, 02h to 04h, go to DOSBox's timers and not to the chip.

### Capturing

DOSBox 0.74 captures sound only when keys of its own are pressed. `record.mjs --capture` runs it on a virtual X display, and presses the keys once the probe writes a `capture` record. The probe then waits three seconds before it plays.

- [[read out]] Ctrl+Alt+F7 captures the OPL's register writes to a `.dro` file. Ctrl+F6 captures the mixer's output to a `.wav` file, 16-bit stereo at 44,100 a second. Both go to `[dosbox] captures=`. DOSBox closes both as it exits.
- [[measured]] On Xvfb the X server's keyboard map turns Ctrl+Alt+F7 into "switch to console 7", and DOSBox is never sent F7. The recorder remaps F7 with `xmodmap` first.

[[read out]] The `.dro` is version 2.0 (`adlib.cpp`, class `Capture`). It has a 26-byte header, a table that turns codes into registers, then pairs of bytes. One code means "wait n+1 milliseconds", another means "wait (n+1) × 256 milliseconds", and the rest are register writes. `scripts/oracle/dro.mjs` decodes it into `{ms, register, value}`, in `oracle/fixtures/opl/<probe>.json`. The `.wav` stays in `oracle/build/captures/<probe>/`, and the fixture keeps its rate, length and hash.

The `.dro` does not hold every write, and some of what it holds is not real:

- [[read out]] It starts at the first key-on after the key is pressed. It begins with a snapshot of the registers, all at nought milliseconds.
- [[measured]] DOSBox never clears its register cache. A register nothing has written yet holds whatever was in memory. The snapshot shows those values, and it shows registers of a second chip (100h and up) that an OPL2 does not have. Because of them the header calls the hardware an OPL3. All three recordings say so.
- [[read out]] A write of the value the cache already holds is left out. A first write that happens to equal what was in memory is left out too.
- [[read out]] Timer writes, status reads, and register 00h are not recorded. Time is in whole milliseconds. More than 30 seconds between writes closes the file.

[[measured]] So the oracle also runs a build of DOSBox that writes every port access to a file, with its time to the microsecond (`scripts/oracle/build-dosbox-trace.mjs`, `record.mjs --dosbox`). It is kept as `oracle/fixtures/opl/<probe>-trace.json`. Filtered as DOSBox filters its capture, the trace gives the stock DOSBox's `.dro` write for write and millisecond for millisecond: 614, 340 and 157 writes. It differs only in the first writes the uncleared cache happened to hide (7, 6 and 3). The register stream on this page is the trace's.

## The driver

[[read out]] `MSADLIB.DRV` exports `DriverProc` (seg2 `628`) and `modMessage` (seg1 `b37`). It has one output device, "Ad Lib", MIDI output technology 4 (an FM synthesizer). [[measured]] Its capabilities are manufacturer 1, product 9, version 1.01, 11 voices, 11 notes and channel mask `FFh` (`mididev`).

[[read out]] `DriverProc` (seg2 `628`):

- `DRV_LOAD` sets the write delay (seg2 `5ba`, `5fe`). [[fn:KERNEL.GetWinFlags]] gives 8 on a 286, 14 on a 386 and 41 on a 486. `SYSTEM.INI`'s `[adlib.drv] WriteDelay=` replaces it if it is not nought. [[measured]] The oracle's DOSBox is a 486 (flags `419h`), and the installation names no `WriteDelay`, so the delay is 41.
- The first `DRV_ENABLE` looks for the card (seg2 `15a`) and, if it is there, resets it and loads the instruments (seg2 `55e`). A later `DRV_ENABLE` only resets. Under 386 enhanced mode the driver first claims the card from the virtual device `VADLIBD` (`INT 2Fh` `AX=1684h` `BX=0446h`, seg2 `14`). In standard mode there is no such device.
- `DRV_DISABLE` resets the chip (seg2 `59e`). Windows sends it as it ends. `DRV_INSTALL` answers `DRVCNF_RESTART`. `DRV_CONFIGURE` and `DRV_QUERYCONFIGURE` answer nought.

[[read out]] `modMessage` (seg1 `b37`) answers 2 for any device but 0. Until the driver is enabled it answers 3, or 0 devices.

- `MODM_GETNUMDEVS` answers 1. `MODM_GETDEVCAPS` copies the capabilities (seg2 `60`). The voices and notes are 11 in percussion mode and 9 without it, and the driver is always in percussion mode.
- `MODM_OPEN` answers 4 if the device is already open. Otherwise it resets the chip (seg2 `11b`), page-locks the driver's code and data, and calls back `MOM_OPEN`.
- `MODM_CLOSE` lets every note go, as `MODM_RESET` does, and calls back `MOM_CLOSE`.
- `MODM_DATA` and `MODM_LONGDATA` parse MIDI bytes (seg1 `56a`). A long message that is not prepared answers `MIDIERR_UNPREPARED` (40h). A message sent while one is being played answers `MIDIERR_NOTREADY` (43h). A long message is marked done and called back `MOM_DONE`.
- Everything else answers `MMSYSERR_NOTSUPPORTED` (8). That includes preparing headers, which MMSYSTEM then does itself, the volume, and caching patches.

## Writing to the chip

[[read out]] Every write goes through one routine (seg1 `6`). It writes the register's number to port 388h and counts the write delay down in a loop (`dec cx` / `jnz`). It then writes the value to 389h and counts down seven times the delay. The driver never waits on the status port.

[[measured]] With a delay of 41, DOSBox at 3,000 cycles a millisecond shows 90 cycles from the address to the value (0.030 ms). From the value to the next address it shows at least 587, mostly 594 to 621, by caller. A note with a new instrument is about 20 writes, so it takes about 4.5 ms of the emulated machine's time.

[[read out]] The driver reads the status port only to look for the card (seg2 `15a`). It writes 60h then 80h to 04h and reads the status. It writes FFh to 02h and 21h to 04h, counts to 200, and reads the status again. It then writes 60h and 80h to 04h. The card is there if the first read has none of E0h set and the second has C0h exactly. [[measured]] DOSBox answers `06h`, then `C6h`. At DOSBox's full speed the count of 200 ends before the timer's 80 µs do, the second read has no C0h, and the driver finds no card. That is why the oracle runs at 3,000 cycles.

## Reset

[[read out]] The chip is reset when the driver is enabled, on every `MODM_OPEN`, and on `DRV_DISABLE` (seg2 `11b`). The writes are, in order:

1. BDh, with the tremolo and vibrato depths cleared, percussion mode as it was, and the drum bits as they were. 08h = 0.
2. For channels 0 to 8 in turn: A0h+c = 0, B0h+c = 0.
3. The tom-tom's and snare's frequencies, with no key: voice 8 at note 18h, then voice 7 at note 1Fh (seg2 `1cc`, by seg1 `73`, below). Percussion mode is now on, and no drum is struck.
4. E0h+offset = 0 for each of the 18 operators, in the driver's operator order (seg3 `14`: 00h-05h, 08h-0Dh, 10h-15h). Then 01h = 20h, which allows waveforms.

[[read out]] A reset also sets each operator's volume to 127, puts every voice back in tune, and sets the bend range to 2 semitones (seg2 `254`, `262`, `2de`). It clears the drum bits the driver keeps (seg2 `1cc`), but only after writing BDh, so the chip keeps them until BDh is next written. It does not touch the voices' allocation or the channels' programs and bends. [[measured]] `adlibout` ends with `BDh=38h`, the bass drum and snare keys still down after Windows' last reset.

## Instruments

[[read out]] The instruments are resource 1 of type 256, an Ad Lib instrument bank (`.BNK`, "ADLIB-", version 1.0) of 192 records with 175 names. The driver copies the first 180 records, 30 bytes each, into its data segment at `424h` (seg2 `3ba`). Each record is two bytes and two operators. The first byte says whether it is a percussion instrument, and the second which voice a percussion instrument plays on. Each operator has 13 parameters, then a waveform: KSL, multiple, feedback, attack, sustain level, sustaining (EG type), decay, release, total level, tremolo, vibrato, KSR, and FM. The two waveforms come last.

[[read out]] Records 0 to 127 are the programs, named "001" to "128". Records 128 to 174 are the drums, named for their keys, "00035" to "00081". Resource 1 of type 257 maps each key from 35 to 81 to a drum record and the note it is played at (seg2 `48f`). Key 35, the bass drum, is record 128 at note 47.

[[read out]] Two more tables are in the data segment. Each program has a transposition in semitones (seg3 `11e`): program 1 plays an octave down, program 2 an octave up, and so on. Each velocity has a volume (seg3 `9e`): 0 and 1 give 0, and from 2 the volume is 64 plus half the velocity, so 127 gives 127.

The bank, the drum keys, both tables, the operator tables and the F-numbers are extracted by `scripts/oracle/adlib-patches.mjs` into `crates/winbox-win16/data/adlib-patches.json`.

[[read out]] An instrument is set operator by operator (seg1 `183`, `32`, `418`). Each operator's writes are, in order:

1. BDh, as it stands. 08h = 0.
2. 40h+o: KSL in the top two bits, the total level scaled by the operator's volume below (see [Volume](#volume)).
3. For a modulator only: C0h+channel = feedback × 2, plus 1 if FM is nought.
4. 60h+o = attack × 16 + decay. 80h+o = sustain level × 16 + release.
5. 20h+o = 80h if tremolo, 40h if vibrato, 20h if sustaining, 10h if KSR, plus the multiple.
6. E0h+o = the waveform's low two bits. Waveforms are always allowed after a reset.

[[read out]] A melodic voice sets its modulator from the first operator, then its carrier from the second. A percussion voice is set the same way. The bass drum (voice 6) uses both operators of channel 6. The snare, tom-tom, cymbal and hi-hat each use one operator with the record's first operator: 14h, 12h, 15h and 11h.

[[measured]] DOSBox's trace has these writes, in this order, for every note that needed an instrument. They include the two writes of BDh and 08h before each operator, which repeat what the chip already holds.

## Channels and voices

[[read out]] The driver plays all 16 channels. Channel 16 is percussion; the other 15 are melodic. Programs start at 0, channel 16's at 81h, and every bend at 2000h (seg3 `6e`). The driver is always in percussion mode, with six melodic voices (0 to 5) and five drums: the bass drum (6), snare (7), tom-tom (8), cymbal (9) and hi-hat (10).

[[read out]] A note on (seg1 `702`) with velocity nought is a note off. Otherwise:

1. A melodic channel's note is moved by its program's transposition, unless that would leave 0 to 127 (seg1 `6a3`).
2. On channel 16, a key outside 35 to 81 is ignored. Otherwise the channel's program becomes the key's drum record, and the note becomes the record's note.
3. A melodic note already playing on the channel is struck again on its own voice. The voice is keyed off and keeps its instrument. On channel 16, the voice of the drum struck is keyed off if it is in use, and set up again either way.
4. Otherwise a voice is allocated (seg1 `9c4`). A percussion record takes its own voice. A melodic note takes the first free voice of the six. If none is free, it takes the one whose note was struck longest ago, keying that note off first. Each strike takes a stamp from a counter, and finding a playing note renews it. The voice's instrument is then set, whether it was already set or not.
5. If the voice's volume is not the note's, the volume is set.
6. The channel's bend is applied, which writes the voice's old note again, unkeyed (seg1 `1fc`). The note is then keyed on (seg1 `2b3`).

[[measured]] Eight notes in a row on one channel used voices 0 to 5, then stole voice 0, then voice 1. A note off for a stolen note writes nothing.

[[read out]] A note off (seg1 `7d8`) moves the note as a note on does and looks for the voice. If one is found, it is keyed off and freed. A program change (seg1 `8ce`) keys off and frees every voice of its channel, except on channel 16, then sets the program. A pitch bend (seg1 `861`) is applied to every voice of its channel, and kept for the next note.

## Notes and F-numbers

[[read out]] A note is played an octave down: 12 is taken off, and below 12 it becomes nought (seg1 `2b3`). The bend's whole semitones are added, and anything above 5Fh becomes 5Fh (seg1 `73`). The addition is a byte, so a downward bend below nought also becomes 5Fh. The block is the note over 12, and the F-number comes from the note's place in the octave. Then A0h+v = the F-number's low byte, and B0h+v = 20h if keyed, plus the block × 4, plus the F-number's top two bits.

[[read out]] The F-numbers are worked out at every reset (seg2 `262`, `2fc`, `367`), in 25 rows of 12, one row for each 25th of a semitone. For row r the driver computes x = ⌊⌊(10000 + 24r) × 52088 / 250000⌋ × 147456 / 111875⌋, then x = ⌊x × 106 / 100⌋ for each next semitone. Each F-number is (x + 4) / 8, rounded down. Row 0 runs 343, 364, 385, 408, 433, 459, 486, 515, 546, 579, 614, 650.

The semitone is 106/100 rather than 2^(1/12), 1.0595, so the notes climb sharp through each octave. B is 1.06^11 = 1.898 times C rather than 1.888, about 9 cents sharp, and the next block starts again at C. [[measured]] Middle C, key 60, played block 4 and F-number 343 (`B0h=31h`, `A0h=57h`), about 260.2 Hz on a 49,716 Hz chip.

## Pitch bend

[[read out]] The bend range is 2 semitones, kept as 50 25ths (seg2 `2de`). A bend b (0 to 3FFFh; more is cut to 3FFFh) becomes s = ⌊(b − 2000h) × 50 / 8192⌋ 25ths of a semitone, with an arithmetic shift (seg1 `361`). For s ≥ 0, the voice's semitone offset is s / 25 and its row is s mod 25. For s < 0, the offset is −⌊(24 − s) / 25⌋ and the row is 25 − (−s mod 25), or 0 when that is 25. The last s and its offset and row are kept in one place for every voice.

[[measured]] Bends of 2001h and 2040h wrote the same F-number as 2000h. 2100h moved the F-number from 343 to 344, row 1. 3FFFh played 1 semitone up and row 24, and 0 played 2 semitones down and row 0.

## Volume

[[read out]] A note's velocity becomes a volume V through the velocity table, and an operator's total level L becomes 63 − ⌊((63 − L) × V × 2 + 127) / 254⌋ (seg1 `13b`). At V 127 that is L itself; at V 0 it is 63, silence. The volume is set on the carrier, and on the modulator as well when the instrument adds its operators (FM nought) (seg1 `23c`). A drum other than the bass drum has only its one operator.

[[measured]] On piano, whose carrier's level is nought, velocities 1, 2, 16, 32, 64, 96 and 127 wrote carrier levels 3Fh, 1Fh, 1Bh, 17h, 0Fh, 07h and 00h. Velocity 3 has velocity 2's volume and wrote no level of its own: the driver keeps each voice's last volume and writes the level again only when it changes.

## Percussion

[[read out]] A drum is struck by setting its bit in BDh: 10h bass drum, 08h snare, 04h tom-tom, 02h cymbal, 01h hi-hat (seg3 `38`, seg1 `2b3`). BDh is written whole each time: 20h for percussion mode, and the bits.

- The bass drum's note is written to channel 6, unkeyed.
- The tom-tom's note is written to channel 8, and the same note plus 7 to channel 7, the snare's. Striking the tom-tom retunes the snare.
- The snare, cymbal and hi-hat write no frequency of their own. The cymbal and hi-hat sound at channel 8's and 7's.
- Letting a drum go clears its bit and writes BDh.

[[read out]] A drum's note off is not reliable (seg1 `931`). To find the voice, the driver uses the drum last struck on channel 16, not the key being let go. It lets the voice go only if that voice still holds the key's drum record. [[measured]] In the probe's sequence, a hi-hat was struck after a bass drum, and the bass drum's note off then wrote nothing. Its bit stayed set until it was struck again, which keyed it off first. After the first beat's note offs BDh was 30h, the bass drum's bit still set; after the second's, 38h, the snare's as well.

## Controllers and resetting

[[read out]] Controllers 0 to 7Ah are ignored, volume (7) and sustain (64) among them (seg1 `8be`). [[measured]] They wrote nothing, and a note let go while sustain was down stopped at once. Channel pressure and key pressure are ignored as well.

[[read out]] Controllers 7Bh to 7Fh (all notes off, omni off and on, mono, poly) let every note on every channel go, not only the channel's (seg1 `65e`). So does `midiOutReset`, and closing. For each voice in use, the driver sends a note off of the voice's channel and note. [[measured]] Controllers 78h (all sound off) and 79h (reset controllers) wrote nothing.

[[read out]] The voice's note has already been moved by the program's transposition, and the note off moves it again. A note of a transposed program is therefore not found, and keeps sounding. [[measured]] After program 1 (an octave down) and key 60, `midiOutReset` and then controller 7Bh wrote nothing for it; the program change that followed keyed it off. A drum is let go by this route only if it was the drum last struck, and the probe's was. Through the mapper, two notes of transposed programs kept sounding past `midiOutReset` until the device was closed and opened again, whose reset keys every channel off. The driver still held their voices in use, and the next program changes on their channels keyed them off a second time.

## Parsing

[[read out]] Bytes are parsed one at a time with running status (seg1 `56a`). Bytes from F8h are skipped. A status from F0h clears running status. Its length comes from its own table (seg3 `1b6`), and there is no handler, so system-exclusive bytes are dropped until the next status. The message lengths are 3, 3, 3, 3, 2, 2 and 3 for 8xh to Exh (seg3 `1ae`). A short message starting with a data byte uses the running status, or is dropped if there is none (seg1 `c65`).

[[measured]] A short message of only data bytes, after a note on, played a note. A long message holding a chord played three notes. One holding system exclusive and then a note on played the note.

## The MIDI Mapper

[[read out]] The installation's current mapper setup is "Ad Lib", a "Base-level setup" (the seventh in `MIDIMAP.CFG`). It sends channels 13 to 16 to the device named "Ad Lib", each to the same channel there, with no patch map and no key map. Channels 1 to 12 go nowhere (`MIDIMAP.DRV` seg3 `16ee`-`1738`; WinBox's mapper, `crates/winbox-win16/src/wbmapper/mod.rs`, has the read-out). Through the mapper, channel 16 is the percussion channel, as the Ad Lib has it. General MIDI's channel 10 is lost.

[[measured]] Through the mapper, channel 1 wrote nothing, and channels 13 to 16 wrote what they write sent to the Ad Lib directly. Opening the mapper reset the chip as opening the Ad Lib does, and `midiOutReset` reached the Ad Lib as a reset. [[read out]] Closing the mapper resets each device and then closes it (`wbmapper`'s read-out); the recording agrees, but cannot tell the two apart, since each lets every note go.

## The sequencer

[[inferred]] MCI's sequencer opened the device, through the mapper, when each `play` began, and closed it when the play ended. The model needs exactly that to predict all 706 writes of `adlibseq`. For `play ... from 0 to 1000`, it also needs the sequencer to have sent the first event at the end time, then a note off for each note still sounding, by channel and then key. This is not read out of `MCISEQ.DRV`.

- [[read out]] MCISEQ warns that a file "may not play correctly with the default MIDI setup" unless it begins with the sequencer-specific event `00 00 41` (`MCISEQ.DRV` seg3 `18de`-`191c`). `adlibseq`'s file has the event, and no box came up.

## What a reimplementation needs

To write what `MSADLIB.DRV` writes, a synthesizer of WinBox's own needs:

- The data in `adlib-patches.json`: the 180 bank records, the drum key map, the transpositions, the velocity table, the operator tables, and the F-number rows.
- The driver's state, as it starts:
  - each channel's program (channel 16's 81h) and bend (2000h);
  - each voice's note, key, semitone offset, row, use, channel, volume and stamp;
  - each operator's parameters and volume;
  - BDh's depths and drum bits, percussion mode, and the bend range;
  - the one shared bend cache, which starts at −1;
  - the stamp counter;
  - the parser's running status.
- Its lifecycle: enabled once at boot (looking for the card, then a reset), a reset at every open, every note let go on reset and close, and a reset when Windows ends.
- Every write in the order above, including the writes that repeat what a register holds, and its bugs:
  - re-transposed note offs;
  - drum note offs found by the last drum struck;
  - all notes off on every channel;
  - the stolen voice's instrument always set again;
  - the bend written before the note.
- For DOSBox's timing to the millisecond, the delay loops around each write: 41 and 287 counts on a 486.

`scripts/oracle/msadlib.mjs` is the read-out in that form. It is not a synthesizer: what the chip makes of the writes is DOSBox's `DBOPL`, at 44,100 a second, updated a millisecond at a time. The `.wav` files under `oracle/build/captures/` are what that sounded like.

Not yet measured: the 286 and 386 write delays, `WriteDelay=` in `SYSTEM.INI`, and 386 enhanced mode with `VADLIBD`.

## WinBox's synthesizer

WinBox's sound driver, `WBSOUND`, has a synthesizer of its own name, "WinBox MIDI Synthesizer", that writes what `MSADLIB.DRV` writes: the read-out above, in Rust (`crates/winbox-win16/src/wbsound/synth.rs`), with the tables of `adlib-patches.json`. It writes to the machine's FM chip (`crates/winbox-win16/src/fm.rs`), `winbox-opl`'s port of DOSBox's Adlib module and `DBOPL`, at ports 388h and 389h. Each write takes the driver's time on the machine's clock: 90 instructions from the register's number to its value, and 618 from the value to the next number, the routine's 587 at least and its caller's own code, 618 on average over the three traces' 3,480 writes made back to back.

[[measured]] Run on the Rust engine with `WBSOUND` installed, each probe's writes are DOSBox's write for write, from Windows starting to Windows ending (`crates/winbox-win16/tests/adlib.rs`): `adlibout` 2,103 of 2,103, `adlibmap` 1,045 of 1,045, and `adlibseq` 706 of 706. `adlibout` finds the Ad Lib by its name, so for that run the synthesizer gives the name "Ad Lib"; WinBox's own name otherwise.

[[measured]] The times agree within each message and not between them. Of `adlibout`'s 204 bursts of writes, 183 last as long as DOSBox's to 0.05 ms, as do 79 of `adlibmap`'s 90. The gaps between the bursts are each a few milliseconds short of DOSBox's: 171 of 203 within 5 ms, none within 1. What comes between two messages is the probe's own work and Windows': its record written to the disk at once (`PROBE_FLUSH`), its `pump` and the calls into MMSYSTEM, which WinBox charges as calls, 15 instructions each, where Windows ran them. Over `adlibout`'s 33 seconds the gaps add up to some 0.7 seconds, and its `at` records disagree with Windows' by as much.

[[inferred]] For `adlibseq`, WinBox's sequencer does at `to` what the trace needs it to have done ([The sequencer](#the-sequencer)): the first message at `to` sent, then each channel's sustain and each note still sounding let go, as a stop lets them go.

### Its sound

[[read out]] The chip's sound is made as DOSBox's mixer makes it: once a millisecond is over, that millisecond's samples, 44 or 45 of them, every write made within it in force for all of it; each sample through the FM channel's scale of 2, clipped to 16 bits. None is made while DOSBox's FM channel would be off: from a write until 30 seconds pass with no write and no key held. The host is given the samples ten milliseconds at a time (`Sound::Fm`), and adds them to the card's waveform: through cpal natively (`crates/winbox-native/src/speaker.rs`), and through Web Audio on the page, each in a lane of its own (`src/run/engines/sound.ts`).

[[measured]] Each trace's writes and reads made at their times give the samples DOSBox captured in the same run (`oracle/build/captures/<probe>-traced`), once the first sounds are lined up and the mixer's place in its pattern of 44s and 45s is found (it depends on how DOSBox ran before the capture began): `adlibseq`'s 182,882 samples all equal; `adlibout`'s first 112,105 and `adlibmap`'s first 80,574 equal, up to the first snare, cymbal or hi-hat. Those sound the chip's noise generator, which runs on by every sample the chip makes, as its vibrato and tremolo do; DOSBox made a number of samples before the first note that the recordings do not tell, and so its noise is elsewhere in its sequence. All three `.wav` files are mono: left and right are the same.

[[measured]] Making the sound in percussion mode takes about 1.9 million samples a second natively, some 43 times as fast as it plays.

Not yet done: the chips of a Sound Blaster Pro or 16 (two OPL2s, an OPL3), which the oracle's Sound Blaster 2.0 does not have; General MIDI's percussion on channel 10, which the stock "Ad Lib" setup sends nowhere; and `MCISEQ.DRV`'s length of a file, 2,000 ms in Windows for `adlibseq`'s, where WinBox counts to the end of the track, 2,500.
