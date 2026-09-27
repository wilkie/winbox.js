---
kind: topic
name: Several programs at once
summary: How Windows 3.1 runs several programs on one processor — when a task gives it up and takes it back, how a program starts another with WinExec and how far the other runs before WinExec answers, and what the new program is given — recorded by a probe that starts a program of its own twice.
probes: [winexec]
---

Windows 3.1 runs its programs one at a time, each until it gives the processor up. A task does that only where it waits: for a message, in `GetMessage`, `PeekMessage`, `WaitMessage` or a dialog box's loop; in `Yield`; or for another task to answer a message it sent. The next task waiting for the processor then has it, with its registers as it left them.

## Starting a program

[[probe:winexec]] starts a program of its own, `WINEXECC.EXE`, with [[fn:KERNEL.WinExec]]. The program writes a line at each step: what `WinMain` was given, its window made, its first message taken, and its end. The probe counts the lines at each point. All 12 records agree with winbox.js.

- [[measured]] **The new program runs before `WinExec` answers.** It goes through its `WinMain`, makes and shows its window, and takes its first message, all before the call returns. It stops at the point where it waits for a message with none waiting. Three lines are written by then, and a `Yield` after changes nothing.
- [[measured]] `WinExec` answers the new program's instance, the same one its window has.
- [[measured]] The command line is split at its first space. Before it is the program's name, and after it is what the program is given, spaces and all: `WINEXECC.EXE alpha  beta` gives `WinMain` the text `alpha  beta`. A name with no extension is given `.EXE`, so `WINEXECC` starts the same program.
- [[measured]] `WinMain` is given the way to show its window that `WinExec` was asked for: 7 (`SW_SHOWMINNOACTIVE`) for the first start, 1 for the second.
- [[measured]] The second start of a program already running is another instance, with the first as its previous. It does not register its class again, and makes its window with the class the first registered.
- [[measured]] A program that is not found answers 2, a directory that is not there 3, and an empty command line 2.
- [[measured]] Asked to start `WIN.INI`, Windows answered an instance. It starts a file that is not a Windows program as a DOS program, which winbox.js does not. The probe leaves that out.

## Messages between programs

- [[documented]] A message sent to another program's window is not called on the sender's stack. Windows switches to the window's task, which runs the window procedure, while the sender waits for the answer. [[measured]] The probe closes each program by sending `WM_CLOSE` to its window. Each program's window procedure then destroys its window, and each program writes its last line and ends.
- A task waiting in `SendMessage` answers what is sent to it meanwhile, so two programs sending to each other do not wait for ever.

## In winbox.js

`Scheduler` in `src/win16/scheduler.ts` keeps one task's state in the processor at a time:
- `release` gives the processor up and keeps the task's registers, flags and floating-point unit;
- `acquire` takes it back;
- the tasks waiting are granted it in turn.

`nextMessage` in `src/win16/user/queue.ts` gives the processor up while it waits. It gives a task only its own windows' paints and timers, and it answers messages sent from other tasks first. `sendAcross` hands a window procedure to its task. `WinExec` is in `src/win16/kernel/WinExec.ts`.

Not followed:
- which task runs first after a `DirectedYield`;
- a program's current directory, when another program started it;
- a DOS program;
- `LoadModule`.

[[fn:SHELL.ShellExecute]] starts what it finds through `WinExec` ([[topic:programs-and-their-files]]).
