---
kind: topic
name: Several programs at once
summary: How Windows 3.1 runs several programs on one processor — when a task gives it up and takes it back, how a program starts another with WinExec and how far the other runs before WinExec answers, and what the new program is given — recorded by a probe that starts a program of its own twice.
probes: [winexec, tasks2, loadenv]
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

## Taking turns

[[probe:tasks2]] starts two instances of a program of its own. It posts each a message and lets them run in different ways, and records the order in which they take the messages. All 20 records agree with winbox.js.

- [[measured]] **A task waiting for a message is in line for the processor from the moment it is woken.** Waking can be a message posted or sent, a window to paint, or a timer. Tasks run in the order they were woken. Messages posted to A and then B are taken A then B, and posted to B and then A, B then A.
- [[measured]] One [[fn:KERNEL.Yield]] runs every task waiting, each until it waits again, before the caller goes on.
- [[measured]] [[fn:KERNEL.DirectedYield]] runs the task it names first, then the rest, then the caller. [[read out]] KERNEL takes its argument by moving its return address over it and dropping the word, then goes on as `Yield` (`KRNL386.EXE` seg1 `7cff`). So its `RETF` takes nothing, though its argument is two bytes.
- [[measured]] [[fn:KERNEL.GetNumTasks]] counts the programs running: 3 with two started, 2 after one is closed, 1 after both. [[fn:KERNEL.GetModuleUsage]] of a program counts its instances running: 2, then 1.

## Where a program starts

- [[measured]] The current directory is DOS's, one for all. When the first program starts, it is the directory Windows was started in, `C:\WINDOWS`, and not the program's own.
- [[measured]] A program started by another is in the directory the other was in. The probe changes to `C:\ORACLE`, and the programs it starts find themselves there.
- [[measured]] [[fn:KERNEL.LoadModule]] starts a program as `WinExec` does, from a parameter block instead of a command line. The block holds an environment's segment, a far pointer to the command's tail, and a far pointer to two words: 2, and the way to show the window. The tail is its length in a byte, then its characters: a tail of `B and more` is given to `WinMain` as `B and more`. A file that is not there answers 2.
- [[measured]] The environment's segment in the block may name an environment of the caller's making. [[probe:loadenv]] gives one of two strings. The program is given those strings alone, then a count of nought and no path, and not the path that followed them in the block.
- [[measured]] A segment of nought gives the program its parent's environment whole: the same strings, then the count of 1 and the kernel's path ([[topic:task-startup]]). `WinExec` does the same.

## Messages between programs

- [[documented]] A message sent to another program's window is not called on the sender's stack. Windows switches to the window's task, which runs the window procedure, while the sender waits for the answer. [[measured]] The probe closes each program by sending `WM_CLOSE` to its window. Each program's window procedure then destroys its window, and each program writes its last line and ends.
- A task waiting in `SendMessage` answers what is sent to it meanwhile, so two programs sending to each other do not wait for ever.

## In winbox.js

`Scheduler` in `src/win16/scheduler.ts` keeps one task's state in the processor at a time:
- `release` gives the processor up and keeps the task's registers, flags and floating-point unit;
- `acquire` takes it back;
- the tasks waiting are granted it in turn.

`nextMessage` in `src/win16/user/queue.ts` gives the processor up while it waits. It gives a task only its own windows' paints and timers, and it answers messages sent from other tasks first. `sendAcross` hands a window procedure to its task. An API call's answer goes to the task that made the call, taken before the call runs: a call that gives the processor up on its way, or a program's exit, leaves another task running by the time it answers. `WinExec` is in `src/win16/kernel/WinExec.ts`.

Not followed:
- a DOS program;

[[fn:SHELL.ShellExecute]] starts what it finds through `WinExec` ([[topic:programs-and-their-files]]).
