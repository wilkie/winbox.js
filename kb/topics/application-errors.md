---
kind: topic
name: Application errors
summary: What Windows 3.1 does when a program faults — the box that offers to ignore it, the Application Error box, how each is drawn and answered, and how the program is ended — read out of KRNL386.EXE and USER.EXE and recorded from the screen.
probes: [fault, nullds, badarg]
---

A program that faults -- a general protection fault, from a selector that does not exist, say -- is stopped by KERNEL's handler, which shows up to two boxes and then ends the program, or lets it go on. [[probe:fault]] starts a program of its own and has it load the selector `FFF7h` into ES.

Nothing of Windows' own can see these boxes: they have no window, and no program runs while one is up. The probe is left stopped until they are gone. So they were recorded as the screen itself, taken under DOSBox on a virtual display while the box was up, and answered with keys pressed there (`record.mjs --shoot`). winbox.js draws both boxes the same, pixel for pixel, as the nearest of the sixteen colours.

## Whether it can be ignored

- [[read out]] KERNEL offers the first box when it can step over the instruction (`KRNL386.EXE` seg1 `9ff7`):
  - `WIN.INI`'s `[KERNEL]` `GPContinue`, 1 when it is not there, has its lowest bit set;
  - the stack pointer is 80h or more;
  - KERNEL's decoder knows the instruction's length. It knows prefixes, the ModR/M forms, immediates and addresses, but not `mov` into CS or SS;
  - the fault is not in KERNEL's code or USER's, and Dr. Watson is not running.
- [[measured]] The first box's caption is the program's module name, `FAULTC`. Its text:

  > An error has occurred in your application.
  > If you choose Ignore, you should save your work in a new file.
  > If you choose Close, your application will terminate.

  It has two buttons: Close on the left, with the focus, and Ignore on the right.
- [[measured]] **Ignore** steps over the instruction. The program goes on, with its window still there. [[read out]] The step is the instruction's whole length, prefixes and all: 2 for `mov es, ax`.
- [[measured]] **Close** goes on to the second box.

## Application Error

- [[measured]] The second box's caption is `Application Error`, and its text:

  > FAULTC caused a General Protection Fault in
  > module FAULTC.EXE at 0001:001D.

  It has one button, Close, in the middle.
- [[read out]] The first number is which of the module's segments the code was in, counted from 1; the second is where the instruction began. Both are four hexadecimal digits. The text KERNEL builds goes on to a blank line and `Choose close. FAULTC will close.`, which USER never shows: its box shows three lines at most.
- [[read out]] A program that has set `SEM_NOGPFAULTERRORBOX` with [[fn:KERNEL.SetErrorMode]] is shown no second box.
- [[measured]] After Close, the program has ended: its window is gone, and [[fn:KERNEL.GetModuleUsage]] of its instance answers nought. [[read out]] KERNEL ends it as a program returning to DOS does, with exit code FFh.

## The box

[[fn:USER.SysErrorBox]] draws the box straight on the screen, over every window (`USER.EXE` seg1 `9325`). [[read out]] Its layout, in System font characters, `cxC` wide and `cyC` high:

- The text is split at each line feed into three lines at most; the rest is dropped.
- The box is `10 cyC` high: 160 pixels on the VGA. It is wide enough for the widest line or the caption with `6 cxC` to spare, and for three button places at least: 459 on the VGA. It sits in the middle of the screen.
- It is white, framed by one pixel of `COLOR_WINDOWFRAME` and four of `COLOR_ACTIVECAPTION`.
- The caption is a row down, in the middle. The lines start at the fourth row, or the third when there are three, one a row.
- There are three places for buttons, each a quarter of the way along and `2 cyC` above the bottom; a place with no button stays empty. A button is `2 cyC` high and wide enough for Ignore with a digit to spare on each side and `2 cyC` more. It has round corners and a three-dimensional face; the button with the focus has a frame two pixels thick and a dotted rectangle around its label.

How it is answered:
- [[measured]] Enter chooses the button with the focus. Tab moves the focus, and the thick frame with it, to the next button: [[read out]] always onwards, whatever Shift says.
- [[read out]] A press and release of the mouse on a button chooses it. Space is as Enter. A button's letter, with Alt or without, chooses it at once. Escape chooses Cancel, if there is one.
- [[read out]] It answers the place chosen, 1 to 3. Nothing under it is kept: what it covered is drawn again once it goes.

## The null selector

[[probe:nullds]] measures what DOSBox does where a real processor faults: reached through the null selector, memory answers without a fault. winbox.js follows the processor, so a program that does that meets these boxes ([[topic:dynamic-link-libraries]]).

## Arguments that are turned away

[[measured]] Not every bad pointer faults. [[probe:badarg]] passes a string whose selector, `FFF7h`, names no segment. [[fn:USER.LoadCursor]], [[fn:USER.LoadIcon]], [[fn:USER.FindWindow]] and [[fn:GDI.GetTextExtent]] answer nought and the program goes on. `RegisterWindowMessage` given the same pointer does not come back, so the probe does not ask it. Championship Slots of the corpus hands `LoadCursor` such pointers from a table it never filled, and runs on Windows. winbox.js checks a string argument's selector and limit before it reads the string, and answers nought when it cannot be read.

## In winbox.js

`src/win16/kernel/fault.ts` takes the fault, `src/win16/kernel/instruction-length.ts` finds the instruction's length, and `src/win16/user/sys-error-box.ts` draws the box and waits for its answer. While it is up, the mouse and the keyboard go to it alone (`RasterInput.modal`), and no task has the processor. The processor now checks a segment register as it is loaded: an empty or unsuitable descriptor faults, as `FFF7h` does on Windows.

Not followed: a debugger's Cancel, Dr. Watson, the other faults' boxes (a stack fault, an illegal instruction), and a fault in KERNEL's or USER's own code, which winbox.js has none of.
