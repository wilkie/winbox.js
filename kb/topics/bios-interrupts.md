---
kind: topic
name: BIOS interrupts
summary: What a Windows program is answered when it issues the BIOS's video and disk interrupts, INT 10h and INT 13h, or the Virtual DMA Services' INT 4Bh itself in protected mode -- DOSX's handlers in standard mode, WIN386's in enhanced mode, DOSBox's BIOS below them, the VGA's palette registers and DAC as VGA.DRV leaves them -- and how WinBox answers each.
probes: [biosint, biosintm]
---

Programs of the catalog ask the BIOS things Windows' API does not tell them. Microsoft's `DISPDIB.DLL`, shipped beside programs that show a DIB on the whole screen, asks `INT 10h` 1A00h as it loads and counts a VGA by the display code it is given (its library entry, `cd 10 3c 1a`; `win3_ZWARS`, `win3_OOTW3x`, `win3_hbcc`, `win3_DEFENDER`); Visual Basic programs' controls ask 1A00h and then 12h with BL 10h (`MEDLEY_SEC40020`, `win3_journal`); a screen saver's DLL reads the sixteen colours through 1007h and 1015h and changes them through 1010h, where `GetDeviceCaps` says four planes of one bit and no palette (`DANGH.DLL` of `DANGHEAD_WIN`, `0a46`-`0abe`, called from `09e0`); a database program asks 0Fh. The Paradox engine (`PXENGWIN.DLL`) asks `INT 13h` 08h of drive 80h, the first hard disk (`win3_FM`, `win3_NAMETHAT`, `win3_SCORCARD`, `xgcm_SoftwareLibrary`), and `win3_winpark` asks 10h of it, whether it is ready, before it parks its heads. Living Books' programs (`SEUSS_ABC_WIN`, `CAT_HAT_WIN`, `arthurca_202106` and their kin) ask `INT 4Bh` 8102h, the Virtual DMA Services' version, as they note down the machine, keeping AX and never testing the carry (`ABC.EXE` at its `1c4e`-`1c5c`).

None of these is an API call: each is an `INT` in the program's code, which Windows' DOS extender handles in protected mode and passes on to the BIOS in real mode.

## Standard mode: DOSX

- [[read out]] DOSX's protected-mode handlers of `INT 00h`-`1Fh` are in a table of far pointers at `0000h:2964h` of its unpacked image (places as [[topic:dpmi-functions]] names them): `INT 10h` at 186Bh:`1693`, `INT 13h` at `34a0`, `INT 15h` at `1770`; the rest at stubs from `0e30` that pass the interrupt down as it is. Each makes a frame of the caller's registers (`1899`-`18f8`), the real-mode ES and DS DOSX's own data segment (`[cs:2]`, `18e4`-`18e9`), runs a routine before the call into real mode and one after.
- [[read out]] `INT 10h` (`16a9` before, `16fd` after): 1002h's seventeen bytes and 1012h's CX times three are copied from the caller's ES:DX into DOSX's buffer at 1FCh, and the BIOS given that; 1009h's and 1017h's are copied back after; 1130h's ES is made a selector; 1Bh's state's 40h bytes are copied to ES:DI. **Every 10h function comes back with DX as the caller gave it** (`1769`-`176c`: the frame's DX from the caller's own), so 1015h's DH, the red, is lost.
- [[read out]] `INT 13h` (`34da` before, `3514` after): 02h and 03h move their sectors through DOSX's buffer, AL set after to the count it moved; 04h's ES:BX given as F000h:0000h; 05h's 512 bytes copied in; BX given back as it came after 02h-05h; and after 08h or 18h that succeeded, ES is DOSX's data segment made a selector with 0002h's routine (`1f7f`): the BIOS sets no ES.
- [[read out]] `INT 4Bh` (`37c6`) answers the Virtual DMA Services itself: AH 81h with AL 02h-0Ch goes through a table at `37b0`; AL out of that range is error 0Fh and DX with a bit of `FF81h` set error 10h, each with the carry (`3807`, `380d`); 02h, the version, answers 1.0, product 2, revision 1, a buffer of no bytes, flags 8, unless real Virtual DMA Services were found beneath as it started (`3986`-`39c8`). Another AH goes to the real-mode vector, which DOSBox's leaves as it was (`3813`-`384f`). Its real-mode code sets bit 5 of the BIOS data area's byte 7Bh, the services there, each time it goes into protected mode (150Ch:`0a70`-`0a75`), and puts back the bit as it found it on the way out (`0c47`-`0c56`).
- [[measured]] [[probe:biosint]]: 0Fh answers AX 5012h, BH nought and BL as it was; 1A00h AX 001Ah and BX 0008h; 12h with BL 10h BX 0003h, CX 0009h; 1007h of the sixteen palette registers `00 0C 0A 0E 01 15 23 07 0F 24 12 36 09 2D 1B 3F`; 1015h CH and CL, and DX as given; 1010h writes what 1015h reads back. The data area's byte 7Bh is 20h; `INT 4Bh` 8102h AX 0100h, BX 2, CX 1, DX 8, SI and DI nought, the carry clear.

## 386 enhanced mode: WIN386

- [[measured]] [[probe:biosint]], enhanced: the video BIOS answers as in standard mode, but 1015h gives DH, the red, as well. The data area's byte 7Bh is 28h, and `INT 4Bh` 8102h answers WIN386's own services: 1.0, product 3, revision 2.00, a buffer of 4000h bytes (SI:DI), no flags.
- [[measured]] `INT 13h` of a hard disk, 80h or 81h, comes back with the carry set and every register as it was, whatever the function and whether the disk is there ([[probe:biosintm]] with a hard disk image as 80h): WIN386 does not take it to the BIOS. A floppy drive's is the BIOS's answer, as in standard mode, but after 08h, whether it succeeded or not, ES is a selector for C000h.
- WIN386's handlers -- the virtual display device, BIOSXLAT, the DMA device's services, the block device -- are not read out.

## Below Windows: DOSBox's BIOS

- [[read out]] The video BIOS (`ints/int10.cpp`): 0Fh answers the mode, its columns and the page from the BIOS's data (135-139); 1A00h the entry of the video ROM's display-combination table the data names, AX 001Ah (449-466); 12h with BL 10h the controller's port as colour or mono, 256 KB, and the switches' byte (319-328); 1007h, 1010h and 1015h the palette registers and DAC through the ports (`int10_pal.cpp` 123-166), six bits of each colour kept (`vga_dac.cpp` 105-106).
- [[read out]] `VGA.DRV`'s `Enable` sets mode 12h (seg4 `00d0`), then all the palette registers with 1002h from its table (seg4 `00ec`-`00f6`, the table at `0263`), then DAC registers 7 and 0Fh to its greys, `21 22 23` and `30 31 32`, with 1010h (`00f8`-`0112`). Setting mode 12h, DOSBox's BIOS had put its 64 EGA colours in the DAC (`text_palette`, `int10_modes.cpp` 255-264, 1159-1160): each register's six bits `rgbRGB`, the low three at 2Ah and the high three at 15h. The palette registers name the dark colours with a third of another: `0Ch` is dark red, `2Ah 00h 15h`. DAC registers 40h-FFh stay nought ([[probe:biosint]]).
- [[read out]] The disk BIOS (`ints/bios_disk.cpp` 301-492) has a disk only for an image `IMGMOUNT` mounted: a floppy image, of a size its table knows (32-44), as drive 00h, the last one mounted; the first two hard disk images as 80h and 81h (`dos_programs.cpp` 1269-1283), each of whole cylinders of 16 heads and 63 sectors (1213-1236). A folder mounted with `MOUNT` is no disk to it. 08h of a drive with no disk is status 7 and the carry; of one, AX nought, BL the floppy's type, the last cylinder, sector count and last head in CX and DH, and DL how many such disks; 00h resets with no error where no image is mounted at all, else needs the disk; 01h answers the last status; 10h, 15h and anything else unknown AH FFh and the carry. Its status is kept from call to call.
- [[read out]] DOSBox's real-mode `INT 4Bh` answers 8102h AX 1 with the carry (`ints/ems.cpp` 1252-1263): Windows never reaches it.
- [[measured]] [[probe:biosintm]], a floppy image as A: and a hard disk image as D:: 08h of 00h answers BX `xx04h`, CX 4F12h, DX 0101h; of 80h, BX `xx00h`, CX 053Fh, DX 0F01h; 00h of 01h, with images mounted, the carry; then 01h AH 01h.

## Implementation

WinBox answers the three interrupts as Windows and DOSBox's BIOS answer them in each mode (`crates/winbox-win16/src/bios.rs`), from the program's own `INT`:

- `INT 10h` on the VGA display alone: 0Fh, 1A00h, 12h with BL 10h, 1007h (the attribute controller's registers to 14h), 1008h, 1010h and 1015h, from the palette registers and DAC as `VGA.DRV` leaves them (`VideoBios`), each through the ports' own state as DOSBox's BIOS goes through the ports ([[topic:io-ports]]), laid out from DOSBox's rule for its 64 colours and the driver's table by colour; 1015h's DH given in enhanced mode alone. Another function, or another display, still stops the run.
- `INT 13h`: the BIOS's disks found among the drives' images (`Files::disk_images`, a disk image's size `Volume::image_size`) as `IMGMOUNT` makes them; 00h, 01h, 04h, 08h, 11h and 17h as DOSBox answers them, anything else AH FFh and the carry, the last status kept (`DiskBios`); ES after 08h as each mode leaves it; in enhanced mode a hard disk's call refused. 02h and 03h, reading and writing sectors, still stop the run.
- `INT 4Bh`: 8102h as DOSX's and WIN386's own services answer, DOSX's errors for a number out of its range; another AH passes in standard mode. The data area's byte 7Bh is set for the mode as the first task starts.

[[measured]] WinBox agrees with every record of [[probe:biosint]] and [[probe:biosintm]] in both modes.

## Not yet done

- The DAC a program writes through 1010h is kept and read back, but the screen is not shown through the palette registers and DAC: WinBox shows the 16-colour screen in the driver's colours, so a screen saver's colour cycling (`DANGHEAD_WIN`) is not seen. The same holds for the ports themselves, 3C0h-3C9h ([[topic:io-ports]]).
- A full-screen program that sets a video mode itself -- `XPDLL.DLL` of `win3_hbcc` asks 0013h, mode 13h, after [[fn:GDI.Death]] -- stops the run: WinBox has no VGA of its own to set.
- Other video functions (1002h, 1009h, 1012h, 1017h, 11h, 1Bh, text output), the video BIOS on displays other than the VGA, and `INT 13h` 02h and 03h through DOSX's buffer.
- The Virtual DMA Services' calls past the version (03h-0Ch: locking and unlocking regions, buffers) in either mode, and another AH in enhanced mode.
- WIN386's handlers of the three interrupts, measured and not read out: why a hard disk is refused and why ES is C000h's.
- DOSBox's BIOS status before Windows' first call is taken as nought; and where several floppy images are mounted, the one DOSBox makes drive 00h is the last mounted, taken here as the last by letter.
