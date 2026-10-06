---
kind: topic
name: Several programs at once
summary: How Windows 3.1 runs several programs on one processor — when a task gives it up and takes it back, how a program starts another with WinExec and how far the other runs before WinExec answers, and what the new program is given — recorded by a probe that starts a program of its own twice.
probes: [winexec, tasks2, loadenv, curdir]
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

- [[measured]] When the first program starts, the current directory is the one Windows was started in, `C:\WINDOWS`, and not the program's own.
- [[measured]] A program started by another is in the directory the other was in. The probe changes to `C:\ORACLE`, and the programs it starts find themselves there.
- [[measured]] **Each program has a current directory of its own.** [[probe:curdir]] changes to `C:\ORACLE\PA` and starts `C:\WINDOWS\CURDIRC.EXE` by its whole path. The program starts in `C:\ORACLE\PA`, the probe's directory, and not its own folder. It then changes to `C:\ORACLE\CB`, and the probe is still in `PA`. The probe changes to `C:\ORACLE`, and the program, sent a message and then posted one, is still in `CB`. A file it makes by its name alone goes in `CB`.
- [[read out]] KERNEL keeps a drive and a directory in each task's database, at 66h and 67h. As a task is switched away from, KERNEL reads DOS's current drive and directory into the task's, if they changed since it last did (`KRNL386.EXE` seg1 `8170`, calling `820a`, which asks DOS with functions 19h and 47h). A change of drive or directory, functions 0Eh and 3Bh, marks the task's copy to be read again (seg1 `148a` and `14cc`, from the table at `1a5a`, both to `14e8`). Before the next task's next DOS call on a path, KERNEL sets DOS's drive and directory from that task's with functions 0Eh and 3Bh, where another task's are DOS's (seg1 `1c64` to `1ce9`). `KRNL286.EXE`, which the oracle's standard mode runs, does the same (seg1 `1b1f` and `7a1b`). A task made is given DOS's drive and directory as they are then, which are its starter's (seg1 `af1d`).
- [[measured]] [[fn:KERNEL.WinExec]] finds a program by its name alone in the current directory. The probe copies its program to `C:\ORACLE\CDHERE.EXE` and starts it as `CDHERE.EXE` from `C:\ORACLE`. The copy is not in Windows' directory, its system directory or the probe's. The whole search, Windows' and the system directory, the program's own and PATH after the current one, is in [[topic:finding-files]].
- [[documented]] Program Manager starts an item in its working directory, or in the program's own folder where the item names none. The program then starts in that directory, as any program started by another does.
- [[measured]] [[fn:KERNEL.LoadModule]] starts a program as `WinExec` does, from a parameter block instead of a command line. The block holds an environment's segment, a far pointer to the command's tail, and a far pointer to two words: 2, and the way to show the window. The tail is its length in a byte, then its characters: a tail of `B and more` is given to `WinMain` as `B and more`. A file that is not there answers 2.
- [[measured]] The environment's segment in the block may name an environment of the caller's making. [[probe:loadenv]] gives one of two strings. The program is given those strings alone, then a count of nought and no path, and not the path that followed them in the block.
- [[measured]] A segment of nought gives the program its parent's environment whole: the same strings, then the count of 1 and the kernel's path ([[topic:task-startup]]). `WinExec` does the same. The block is copied as the parent holds it at the time: a PATH the parent wrote into its own environment is the child's too ([[probe:search]]).

## Messages between programs

- [[documented]] A message sent to another program's window is not called on the sender's stack. Windows switches to the window's task, which runs the window procedure, while the sender waits for the answer. [[measured]] The probe closes each program by sending `WM_CLOSE` to its window. Each program's window procedure then destroys its window, and each program writes its last line and ends.
- A task waiting in `SendMessage` answers what is sent to it meanwhile, so two programs sending to each other do not wait for ever.
- [[read out]] **The task sent to runs next, and the sender after it.** USER puts the message in the window's task's queue and hands that task the processor with [[fn:KERNEL.DirectedYield]] (`USER.EXE` seg1 `3b3e`). The answer is handed back the same way, the sender's task named (seg1 `3c8f`). So no third task runs between a message sent and its answer.
  winbox.js had put the task sent to in line behind every task already waiting. Clock and Notepads started together each showed its window while another's activation was still waiting for its answers. Each Notepad's `WM_ACTIVATE` came once another window was active, and its `SetFocus` made it active again ([[topic:activation-and-focus]]). The windows took the activation from one another round and round, each time deeper on every task's stack, until Clock's stack ran over its brushes and it painted with its own data segment's handle.

## In winbox.js

`Scheduler` in `src/win16/scheduler.ts` keeps one task's state in the processor at a time:
- `release` gives the processor up and keeps the task's registers, flags and floating-point unit;
- `acquire` takes it back;
- the tasks waiting are granted it in turn.

`release` also keeps the task's current drive and directory, and the task granted the processor gets its own back (`keepDirectory`). A task starts in its starter's directory. A program run from the page starts in its own folder, as Program Manager starts one. The Rust engine keeps them with each task's state in `scheduler.rs`.

`nextMessage` in `src/win16/user/queue.ts` gives the processor up while it waits. It gives a task only its own windows' paints and timers, and it answers messages sent from other tasks first. `sendAcross` hands a window procedure to its task and puts that task first in line; `takeSent` hands the processor back to the sender with each answer (`handBack`). An API call's answer goes to the task that made the call, taken before the call runs: a call that gives the processor up on its way, or a program's exit, leaves another task running by the time it answers. `WinExec` is in `src/win16/kernel/WinExec.ts`.

Not followed:
- a DOS program;

[[fn:SHELL.ShellExecute]] starts what it finds through `WinExec` ([[topic:programs-and-their-files]]).
