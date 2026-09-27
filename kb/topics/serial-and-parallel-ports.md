---
kind: topic
name: Serial and parallel ports
summary: USER's comm functions and the COMM driver behind them — which names open which ports, the settings a port opens with, how BuildCommDCB reads a string, how bytes are queued and leave, and what a port with nothing connected answers — read out of USER.EXE and COMM.DRV and recorded on COM1, COM2 and LPT1.
probes: [comms]
---

A program reaches the serial and parallel ports through USER: [[fn:USER.OpenComm]], [[fn:USER.WriteComm]], [[fn:USER.ReadComm]], [[fn:USER.GetCommError]] and the rest. USER keeps a table of the ports that are open and passes the work to `COMM.DRV`, the driver `SYSTEM.INI` names in `comm.drv=`. The driver owns the UART and its interrupts. Terminal uses all of it.

[[probe:comms]] opens ports by many names, builds and sets their settings, writes to them, reads from them, and asks about them. It runs under DOSBox, whose BIOS lists COM1 at 3F8h, COM2 at 2F8h and LPT1 at 378h. Nothing is connected to any of them. The probe runs whole in winbox.js, and all 178 records agree.

## Names and ids

- [[read out]] USER reads a name by its first letter: `COM`, `LPT`, `AUX` or `PRN`, in any case (USER seg40 `073C`). A digit follows, then an optional colon, then nothing more. `COMn` is id n − 1, and `LPTn` is 80h + n − 1. `AUX` is COM1 and `PRN` is LPT1.
- [[measured]] `com1` and `COM1:` open COM1, and so does `AUX`. `LPT1`, `lpt1:` and `PRN` answer 128. `COM1 ` with a space, `COM1:9600`, `COM0`, `COM10`, `COM` and `XYZ` answer -1.
- [[read out]] The digit is not checked, only its range: `COM:` is read as COM10, because `:` is the character after `9`. USER takes COM1 to COM10 and LPT1 to LPT3. The driver only has COM1 to COM4.
- [[measured]] So `COM5` and `COM9` answer -1, and so does `LPT4`. `LPT2` and `LPT3` answer -10: the BIOS has no address for them.
- [[measured]] A port already open answers -2. Two queues of size nought answer -4. Any other sizes are taken as they are, from 1 byte to 65,535.
- [[read out]] A serial port's address comes from the BIOS, or else from `SYSTEM.INI`'s `[386Enh]` `COMnBase`. COM3 has 3E8h when neither gives one, and COM4 has none, which answers -10. The UART is never tested for being there.
- Not recorded: COM3 and COM4. Under DOSBox there is no UART at 3E8h, and opening COM3 never returns.

## The settings a port opens with

- [[read out]] Every serial port opens with the settings `BuildCommDCB` makes of `COM1:9600,E,7,1` (USER seg40 `005F`). OpenComm does try the name itself first, but a name it accepts is never one `BuildCommDCB` can read. So `WIN.INI`'s `[ports]` lines play no part.
- [[measured]] The DCB just opened is 9600 baud, 7 bits, even parity and one stop bit. Only binary mode is set, XON and XOFF are 11h and 13h, both limits are 10, and the timeouts are nought.
- [[measured]] [[fn:USER.SetCommState]] checks the baud rate, the parity, the byte size and the stop bits, in that order. It answers -12, -5, -11 and -5, and changes nothing when one is wrong.
  - A baud rate of 0 or 1 is refused. Anything from 2 up is 115,200 over it.
  - An index from FF10h on is looked up in the driver's own table. It has holes, so `CBR_256000`, FF27h, is refused.
  - Parity may be 0 to 4, and bytes 5 to 8. 1.5 stop bits are taken only with 5 bits.
  - A DCB naming a port that is not open answers -3.
- [[measured]] [[fn:USER.GetCommState]] copies back the DCB as it was set, flags and all.
- [[measured]] A parallel port keeps its DCB unchecked. Only its Id is ever written: the rest is whatever was on USER's stack when it opened, so the probe records only the Id.

## BuildCommDCB

[[fn:USER.BuildCommDCB]] reads a string in USER alone (seg40 `048F`). [[read out]] It empties the DCB, then reads fields split at a space, a colon or a comma, with any spaces after the split skipped.

- [[measured]] The baud rate is read from its **first two digits**, so `96` is 9600 and `12345` is 1200. `14400` and `57600` are refused.
- [[measured]] Parity is `E`, `M`, `N`, `O` or `S`. The byte size is `7` or `8`, and `5` is refused. The stop bits are `1` or `2`, and `1.5` reads as one.
- [[measured]] The sixth field must be `P`, which sets all three timeouts to FFFFh. **`WIN.INI`'s own `x` makes the call answer -1**, with the DCB filled up to the stop bits.
- [[measured]] A field left out leaves nought, so `COM1:9600` answers 0 with a byte size of nought, which [[fn:USER.SetCommState]] would refuse. XON, XOFF, their limits and binary mode are set once the baud rate is read.
- [[measured]] `COM1` and `COM1:` answer -1: with no baud field, the name is read as the baud rate. `LPT1:...` answers 0 with only the Id.
- [[read out]] A field followed by a separator and nothing else is dropped. `COM1:9600,e,` leaves the parity at nought.

## Writing and reading

- [[measured]] [[fn:USER.WriteComm]] queues what fits and answers how many. When not all of it fits, it answers minus that and sets `CE_TXFULL`, 100h: 400 bytes into a queue of 128 holding 5 answers -123. It never waits for the port.
- [[measured]] **A byte leaves at once, and each next when the one before has gone.** Just after five bytes are written at 110 baud, four are still queued. A second later the queue is empty, and `EV_TXEMPTY` has been set.
- [[measured]] [[fn:USER.TransmitCommChar]] sends one byte ahead of the queue and answers nought. It answers 4000h while one is still waiting.
- [[measured]] A line with a timeout in the DCB is waited on while it is low. With nothing connected, all three are low: a write with `RlsTimeout`, `CtsTimeout` or `DsrTimeout` set answers nought, with 80h, 20h or 40h in the errors.
- [[measured]] A flow flag whose line is low holds all output. [[fn:USER.GetCommError]]'s status then shows the line it waits for: 1 for CTS, 2 for DSR. **Restoring the settings does not release it.** Only the line rising does, and with nothing connected it never rises. Output queued before stays queued.
- [[measured]] [[fn:USER.ReadComm]] answers nought: nothing is ever received. A character put back with [[fn:USER.UngetCommChar]] is copied into the buffer and is **not counted**. [[fn:USER.GetCommError]] counts it in the receive queue until then. A second one answers -1.
- [[read out]] While any error is waiting for `GetCommError`, the driver gives `ReadComm` nothing (COMM seg2 `0D25`).
- [[measured]] [[fn:USER.GetCommError]] answers the errors and clears them. The COMSTAT is a status byte and the two queues' counts: 40h in the status while a transmitted byte waits.

## Everything else

- [[measured]] [[fn:USER.EscapeCommFunction]] looks at only the low byte of its code.
  - 1 to 6 set or clear XOFF, XON, RTS and DTR, and answer the errors.
  - 8 answers 82h and 9 answers 3, on a serial port. On a parallel port they answer the errors.
  - 10 and 11 answer the port's interrupt and address, 403F8h for COM1.
  - 7, the printer reset, runs on a serial port too. It reads the UART's interrupt register as if it were a printer's status, and sets 800h, "not selected", in the errors.
- [[measured]] [[fn:USER.SetCommEventMask]] answers a far pointer to the port's event word. [[fn:USER.GetCommEventMask]] answers the word and clears the events it names.
- [[measured]] [[fn:USER.FlushComm]], [[fn:USER.SetCommBreak]] and [[fn:USER.ClearCommBreak]] answer the errors, without clearing them. [[fn:USER.EnableCommNotification]] answers 1, or nought for a port the driver does not have.
- [[measured]] [[fn:USER.CloseComm]] answers -2 for a port whose output was held for a missing line, and closes it anyway. Otherwise it answers nought once the queue has gone. A second close answers -1.
- [[measured]] The driver does not check that a port is open. On a port just closed, `TransmitCommChar` still answers 4000h for its waiting byte, and `SetCommEventMask` still answers a pointer.
- [[measured]] The parallel port with no printer answers every write with nought bytes, and sets C00h, "I/O error" and "not selected", in the errors.

## In winbox.js

`src/win16/user/comm.ts` is USER's side: the table of ports, the names, and `BuildCommDCB`. `src/win16/comm.ts` is the driver's side, written in TypeScript since no Windows file is shipped. It keeps each port's settings, queues, errors and handshake state, with the event words in a data segment of its own.

Its ports have nothing connected. A byte sent goes nowhere, one character time after the last, at the port's baud rate. The line under them is an interface, `SerialLine`, so that a port could one day be the browser's.

Not followed:
- the 16550's FIFO;
- the 200 ms `SetCommState` spends reading and dropping what arrives;
- the waits on a handshake line, and on a busy printer, which are answered at once since nothing will change;
- closing a task's serial ports when it ends, which USER does. Its parallel ports it never closes, since it passes their table index as the id.
