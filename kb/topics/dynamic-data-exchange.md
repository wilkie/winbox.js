---
kind: topic
name: Dynamic data exchange
summary: How Windows 3.1's programs talk by DDE — the WM_DDE_ messages, their atoms and shared memory, and what USER does with them — and how DDEML.DLL is built on top, its instances, windows, hooks, timers and conversations, read out of the binaries and recorded between two programs.
probes:
  [dderaw, ddemgmt, ddeleft, pmatom, ddemon, ddeterm, ddelist, ddeheap, ddefail, ddehsz]
---

Dynamic data exchange is two programs passing messages between their windows. The messages are `WM_DDE_*`, 3E0h to 3E8h, and what they carry is atoms for names and blocks of global memory for data. Windows 3.1 has two layers of it:

- **The protocol**, which USER barely knows about: a program sends and posts the messages itself, adds and deletes the atoms, and allocates and frees the memory, by rules each side must keep.
- **DDEML**, the DDE Management Library, `DDEML.DLL`: an API (`DdeInitialize`, `DdeConnect`, `DdeClientTransaction` and the rest) that speaks the protocol for a program through hidden windows of its own, and calls the program back.

DDEML is WinBox's own in both engines, followed from this page's read-out, on top of WinBox's USER and KERNEL: what DDEML does depends on the atoms, windows, messages, hooks and timers underneath being Windows'. This page is what DDEML needs from them and how DDEML works ([[guide:without-windows]]).

Transactions -- `DdeClientTransaction` and every `XTYP_` a server is asked, the data handles, `DdePostAdvise` -- are on [[topic:ddeml-transactions]], and Program Manager's DDE interface on [[topic:program-manager-dde]].

## The protocol

[[documented]] A conversation is between two windows, a client's and a server's. Each message's `wParam` is the sender's window, and its `lParam` packs two words: in Windows 3.1, `MAKELONG(low, high)` straight, with nothing to unpack.

| Message            | Value | How it goes | `lParam`, low and high                    | Who frees what                                                        |
| ------------------ | ----- | ----------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `WM_DDE_INITIATE`  | 3E0h  | sent        | application atom, topic atom (0 for any)  | the sender deletes its atoms once `SendMessage` answers               |
| `WM_DDE_TERMINATE` | 3E1h  | posted      | 0                                         | answered with a `WM_DDE_TERMINATE`                                    |
| `WM_DDE_ADVISE`    | 3E2h  | posted      | `DDEADVISE` block, item atom              | the server frees the block                                            |
| `WM_DDE_UNADVISE`  | 3E3h  | posted      | format, item atom                         |                                                                       |
| `WM_DDE_ACK`       | 3E4h  | sent/posted | to `INITIATE`: application, topic atoms   | to `INITIATE`, sent, the receiver deletes the atoms                   |
|                    |       |             | otherwise: `DDEACK` status, item atom     | the receiver deletes or reuses the item atom                          |
|                    |       |             | to `EXECUTE`: status, the commands' block | the client frees the commands                                         |
| `WM_DDE_DATA`      | 3E5h  | posted      | `DDEDATA` block, item atom                | the client frees it where `fRelease`; it acknowledges where `fAckReq` |
| `WM_DDE_REQUEST`   | 3E6h  | posted      | format, item atom                         |                                                                       |
| `WM_DDE_POKE`      | 3E7h  | posted      | `DDEPOKE` block, item atom                | the server frees it where `fRelease`                                  |
| `WM_DDE_EXECUTE`   | 3E8h  | posted      | 0, the commands' block (in the high word) |                                                                       |

[[measured]] [[probe:dderaw]] speaks it by hand between two programs, a client and a server that answers as a program of 1990 would. Every exchange went as the table has it: `INITIATE` sent to `HWND_BROADCAST`, answered by the server's `WM_DDE_ACK` sent from inside it; `REQUEST` answered by `DATA`; `POKE`, `EXECUTE`, `ADVISE` and `UNADVISE` acknowledged; `TERMINATE` answered by `TERMINATE`. The `EXECUTE` acknowledgement carries the client's own handle back. A block the server freed, `fRelease`, was gone for the client: `GlobalSize` nought. With each side deleting what is its to, no atom was left once the conversation ended.

### What USER does with the messages

USER does not route DDE. It only checks the parameters, and the rest is `SendMessage` and `PostMessage` as for any message.

- [[read out]] `SendMessage` and `PostMessage` check a message's parameters before anything else (`USER.EXE` seg1 `af70`, from `a7a1` and `a7d2`). For the DDE messages (`b31a`-`b388`): the `wParam` of `INITIATE`, `ADVISE`, `UNADVISE`, `ACK`, `DATA` and `REQUEST` must be a window (`ae6d`); the low word of `ADVISE`'s `lParam` must be a global handle -- one `LAR` takes, of the local descriptor table, or FFFFh (`aeb6`); that of `DATA` and `POKE` a global handle or nought (`aeb2`). `TERMINATE` and `EXECUTE` are not checked, nor `POKE`'s `wParam`. A refused call answers nought and the message goes nowhere (`a7aa`).
- [[measured]] [[probe:dderaw]]: `SendMessage` of `INITIATE` with a `wParam` of nought or 1234h answered nought and the server was handed nothing; so did `PostMessage` of `ADVISE` with no options or with 1234h, `ACK` from 1234h and `REQUEST` from nought. `DATA` with no block, and `POKE`, `EXECUTE` and `TERMINATE` from 1234h, were posted and handed to the server.
- [[read out]] `HWND_BROADCAST`, -1, passes by every check (seg1 `a78c`-`a790`), and the broadcast sends to every window at the top ([[fn:USER.SendMessage]]). [[measured]] The client's own window was handed its `INITIATE` too; the broadcast answered 10000h.
- [[read out]] `PostMessage` answers where it put the message: its offset in the task's queue, whose ring of entries starts at 6Eh, 22 bytes each (`5480`, `54db`), or nought where the ring is full (`5502`). The ring has 8 entries unless [[fn:USER.SetMessageQueue]] made another size (`5326`, `535b`). [[measured]] The server's posts answered 110, 132, 154 and on; ten `WM_USER + 7` posted to a server that had not run answered 176, 198, 220, 242, 264, 110, 132, 154, then nought twice, and the server took eight. DDEML posts again where a post failed, and keeps the message to post on a timer otherwise (below).
- [[read out]] A message from 390h to 3B0h, posted to the same window as the last one waiting and of the same number, takes that one's place (seg1 `23e4`-`23ff`, `237c`).

### The memory and the atoms

- [[read out]] `GMEM_DDESHARE`, 2000h, decides who owns a block ([[fn:KERNEL.GlobalAlloc]]): without it the task that asked (`KRNL386.EXE` seg1 `0c62`-`0c7b`, the task's PDB), with it the module whose code asked -- the owner of the caller's code segment (`0d12`-`0d2a`). `GlobalReAlloc` with `GMEM_MODIFY` goes the same way (`0d68`-`0d98`). So a block a DLL allocates shared is the DLL's, whichever program called it.
- [[measured]] [[probe:ddeleft]]: of the blocks a program allocated, the plain one was freed as the program ended; the `GMEM_DDESHARE` ones -- moveable, fixed, and plain made shared by `GlobalReAlloc` with `GMEM_MODIFY` -- lived on while a second copy of the program kept its module loaded, and were freed when that ended too.
- [[measured]] `GlobalFlags` shows nothing of `GMEM_DDESHARE`: nought for every block, shared or not ([[probe:dderaw]]). Another task may lock and free a shared block: the server freed the client's `POKE` block, answering nought.
- [[measured]] Atoms are counted ([[topic:atoms]]): the protocol's "the receiver deletes" works only because the sender added the atom for it. An atom deleted once more than it was added is not checked: [[probe:ddeleft]]'s `GlobalDeleteAtom` answered nought, but DDEML's third free of a string handle made once and kept once answered FALSE, its `GlobalDeleteAtom` having answered what KERNEL left in AX (`KRNL386.EXE` seg1 `4a80`), which depends on whether the local heap wrote over the freed entry's string.

## DDEML's structure

`DDEML.DLL` is three segments: code (seg1, 7532h bytes), the library's entry and `WEP` (seg2), and its data (seg3), whose local heap holds the instances. Its imports are KERNEL, USER, GDI and KEYBOARD.

- [[read out]] It refuses to load outside protected mode (`GetWinFlags`, seg2 `000a`). `WEP` answers 1 (seg2 `002c`).
- [[read out]] **The first `DdeInitialize`** since `DDEML.DLL` was loaded (seg1 `00b4`; the word at DS `0018` it tests is set there, `0146`, and nowhere else) reads `[DDEML]` `ShutdownTimeout=` (3000 ms unless set) and `ShutdownRetryTimeout=` (30000 ms) from `WIN.INI`, adds the global atom `Progman` and keeps its number at DS `00A4` (`0134`-`013d`), registers its classes (`62e0`) and adds two atoms of its own, `Who` and `Made me?`, out of a string kept each byte XOR 25h (`5990`).
- [[read out]] **The classes**, registered with DDEML's instance, style nought, no background (`62e0`-`63c4`):

| Class             | Procedure         | Extra bytes | What its windows are                                                             |
| ----------------- | ----------------- | ----------- | -------------------------------------------------------------------------------- |
| `DMGClass`        | `DMGWNDPROC`      | 6           | an instance's own window: at the top, invisible, the parent of its conversations |
| `DMGFrame`        | `SUBFRAMEWNDPROC` | 4           | a server-capable instance's pop-up, which answers `WM_DDE_INITIATE`              |
| `DMGClientClass`  | `CLIENTWNDPROC`   | 6           | one client conversation                                                          |
| `DMGServerClass`  | `SERVERWNDPROC`   | 6           | one server conversation                                                          |
| `DMGHoldingClass` | `CONVLISTWNDPROC` | 8           | a conversation list, and the parent of an instance's server conversations        |
| `DMGMonitorClass` | `MONITORWNDPROC`  | 4           | a monitor instance's window, which is sent the monitor's notices                 |

`DMGHeapWatchClass` is named in its data but never registered.

- [[read out]] **An instance** is 3Ch bytes of DDEML's local heap (`019b`), in a list from `[1Ah]` of its data. The id a program is given is `MAKELONG(` its offset `,` a serial `)` (`025f`-`026c`), the serial counted up at `[24h]` -- the same count that numbers conversations and lists. Its fields: the next instance (0), the callback (4), registered names (8), data handles (0Ch), string handles (10h), the queue of callbacks waiting (16h), the flags it was given (1Ah, a double word), its task (1Eh), a local heap of 4 KB of its own (20h), its windows (22h `DMGClass`, 24h `DMGFrame`, 26h `DMGMonitorClass`), the window in a synchronous transaction (28h), the last error (2Ah), callbacks disabled (2Ch), callbacks under way (2Eh), the serial (30h).
- [[measured]] [[probe:ddemgmt]]: the probe's client instance was serial 2, its monitor 3, three more monitors 4 to 6 and the server's instance 7.
- [[read out]] **A conversation** is a `DMGClientClass` or `DMGServerClass` window, its 42h bytes in its instance's heap at its window long 0, a serial at its window word 4. An `HCONV` is `MAKELONG(` the window `,` the serial `)`, and a call checks one by `IsWindow` and the word (`2dac`). A client conversation is a child of its instance's `DMGClass` window, or of a list's `DMGHoldingClass` window; a server conversation is a child of a `DMGHoldingClass` window each server instance makes the first time (`6f74`). [[measured]] The probe's first conversation was a `DMGClientClass` window, child of a `DMGClass` window at the top, and its word 4 was the handle's high word.
- [[read out]] **A string handle** is a global atom: `MAKELONG(atom, 0)` from `DdeCreateStringHandle`. DDEML makes a second kind for an instance's own name, `MAKELONG(atom, ` its `DMGFrame` window `)`, which [[fn:DDEML.DdeQueryString]] writes as `Name:(hhhh)`.
- [[read out]] **Its counts** are the atom's. Each handle an instance makes or keeps is put in the instance's array at 10h, and [[fn:DDEML.DdeFreeStringHandle]] takes one entry of it out, where it is there, and deletes the atom whether or not it was (seg1 `1a40`, `29d8`, `2ddc`). An instance ending deletes each entry left. [[measured]] [[probe:ddehsz]]: a handle freed by another instance of the same program lost a count there, and another as the instance that made it ended; made twice and freed once, or made and kept, the atom lost one count and two as the instance ended. An id of nought, or with another serial, answers FALSE and leaves the instance's last error as it was; the instance's own id clears it.

### Its private messages

[[read out]] The windows talk among themselves with messages of `WM_USER`:

| Message              | To                       | What it does                                                                           |
| -------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `WM_USER+6Bh` (46Bh) | a server conversation    | another client window for the same conversation, in a list (`7302`)                    |
| `WM_USER+C8h` (4C8h) | `DMGClass`               | a name registered: `XTYP_REGISTER` (`55b6`)                                            |
| `WM_USER+C9h` (4C9h) | `DMGClass`               | a name unregistered: `XTYP_UNREGISTER`                                                 |
| `WM_USER+CAh` (4CAh) | `DMGMonitorClass`        | a notice for a monitor: `XTYP_MONITOR` (`3636`)                                        |
| `WM_USER+CBh` (4CBh) | a conversation           | whether it is a client's, for `DdeQueryConvInfo` and `DdeSetUserHandle`                |
| `WM_USER+CCh` (4CCh) | `DMGClass`               | callbacks waiting: make them (`5744`, `4e66`)                                          |
| `WM_USER+CEh` (4CEh) | a conversation or a list | end it: 2000h ends and destroys; a list ends each conversation in it (`57c0`)          |
| `WM_USER+CFh` (4CFh) | conversations            | `DdeEnableCallback`'s command                                                          |
| `WM_USER+D0h` (4D0h) | `DMGClass`               | `DdePostAdvise`'s work, posted again while a callback is under way (`5600`)            |
| `WM_USER+D1h` (4D1h) | a conversation           | a `WM_DDE_TERMINATE` that came in a synchronous transaction, handled after it (`50eb`) |

### Hooks

[[read out]] The first monitor instance puts in two hooks with [[fn:USER.SetWindowsHook]] (`02ec`-`0310`), and the last to go takes them out (`0551`-`0566`):

- `DDEPOSTHOOKPROC`, `WH_GETMESSAGE`: each DDE message a task takes from its queue -- so a posted one is seen when it is taken, not when it is posted -- as a `MONMSGSTRUCT`, `MF_POSTMSGS`, the time the message's own (`309e`).
- `DDESENDHOOKPROC`, `WH_CALLWNDPROC`: each DDE message sent, `MF_SENDMSGS` (`2fb0`).

Both keep the hook before them at the same word, `[3Ah]`, so the second put in overwrites the first's; both pass on with [[fn:USER.DefHookProc]].

[[measured]] [[probe:ddemon]], a monitor taking `MF_SENDMSGS` and `MF_POSTMSGS` in the client's program, with the server in another:

- The hooks are the system's: the messages sent and posted in the server's task were told as well as the client's. Each `MONMSGSTRUCT` was 18 bytes, its `hTask` the task of the window the message went to.
- `DdeConnect`'s `WM_DDE_INITIATE` was told for each window at the top it was sent to, in Z order, until the one that answered: the task-switch window, `#32771`, first, then the server's own window, then its `DMGFrame`; the `WM_DDE_ACK` sent back after.
- A plain `WM_DDE_INITIATE` sent to `HWND_BROADCAST` by the client's own window was told for every window at the top: the server's window and frame, its `DMGClass`, the client's `DMGFrame`, `DMGClass` and `DMGMonitorClass` windows, its own window, and a window of class `#42` last -- but not `#32771`.
- A posted message was told as the receiving task took it: `WM_DDE_REQUEST` by the server's, then `WM_DDE_DATA` by the client's.

### The callback

[[read out]] Every callback goes through one place (`5832`):

- A table of the `CBF_` flag that keeps each type away, by the type's number (data at 0A6h): `ADVSTART` `CBF_FAIL_ADVISES`, `EXECUTE` `CBF_FAIL_EXECUTES`, `CONNECT` and `WILDCONNECT` `CBF_FAIL_CONNECTIONS`, `CONNECT_CONFIRM` `CBF_SKIP_CONNECT_CONFIRMS`, `POKE` `CBF_FAIL_POKES`, `REGISTER` `CBF_SKIP_REGISTRATIONS`, `REQUEST` `CBF_FAIL_REQUESTS`, `DISCONNECT` `CBF_SKIP_DISCONNECTS`, `UNREGISTER` `CBF_SKIP_UNREGISTRATIONS`. A type kept away answers nought without the callback.
- A request for the item `Made me?` on the topic `Who`, `CF_TEXT`, never reaches a server's callback: DDEML answers it with "DDEML - By Sanford Alyn Staab" (`5860`-`5891`).
- The count of callbacks under way, at 2Eh, is up while the callback runs; DDEML's own calls that would make another callback read it (`DdeEnableCallback`, `DdeDisconnect`).
- Each callback is told to the monitors with `MF_CALLBACKS`, the answer with it, but for `XTYP_MONITOR` itself (`58f8`-`5935`).
- **`XTYP_ERROR`** is called back only when an instance's own heap of 4 KB is full (`61a8`, from `628a`): DDEML frees the 256 bytes it keeps against that (an instance's 36h), sets `DMLERR_LOW_MEMORY`, calls back `XTYP_ERROR` with 4007h in `dwData1`, and posts its window `WM_USER + D0h`, which keeps 256 bytes again once there are (`5728`-`5741`). The heap is a moveable block with `LocalInit` (`6118`), so `LocalAlloc` grows it to 64 KiB first.
- [[measured]] [[probe:ddeheap]]: a server whose callbacks were disabled, posted one plain `WM_DDE_REQUEST` after another, each kept in its queue, was called back `XTYP_ERROR` in the 1,247th request, `dwData1` 4007h, `dwData2` nought, `DdeGetLastError` 4007h inside the callback. Twenty more requests after it brought nothing back, no acknowledgement, and left the server's last error `DMLERR_MEMORY_ERROR`, 4008h. Both engines are called back in the 1,247th too. Each request's block is 2Eh bytes, 52 with KERNEL's arena of four, and the heap grows to 65,504 bytes. After each growth, room too small to split is given to the last block whole ([[topic:global-and-local-memory]]). With a header of two bytes, as winbox.js had before, it was the 1,302nd.

### Timers and modal loops

[[read out]] Of timers, a conversation's window sets 1 for a synchronous transaction's time out and 4, every 200 ms, to post again what a full queue refused (`5e94`); an instance's `DMGClass` window sets 2 while `DdeUninitialize` waits. The two modal loops are `DdeUninitialize`'s, waiting for conversations to end (`043c`-`0510`), and a synchronous transaction's.

- [[read out]] A DDE message DDEML posts (`5c58`): `PostMessage` is tried four times, with a `Yield` between where the window is another task's (`5d1a`-`5d7b`). Should all four fail, the message is kept in the conversation's queue of posts, and posted again on timer 4 (`5de4`). A `WM_DDE_TERMINATE` drops what is kept.

## Conversations

### Connecting

- [[read out]] **The client** (`6a68`) makes a `DMGClientClass` window, state 3 (`XST_INIT1`), and does not broadcast: it walks the windows at the top with [[fn:USER.EnumWindows]] and sends each `WM_DDE_INITIATE` (`INITENUM`, `6b8a`), until one acknowledges -- unless it is making a list, where it goes on to the end. A conversation not acknowledged is destroyed. `DdeReconnect` sends to the one window the conversation was made through instead.
- [[read out]] **The server**: of an instance's windows only its `DMGFrame` answers `WM_DDE_INITIATE` (`SUBFRAMEWNDPROC`, `54c4`); its `DMGClass` lets `DefWindowProc` have it. An instance made with `APPCMD_CLIENTONLY` has no frame, and so is never a server. The frame (`6bf6`) passes by where `CBF_FAIL_CONNECTIONS` is set; with `APPCMD_FILTERINITS`, where no name is registered or the service is not one of them; and with `CBF_FAIL_SELFCONNECTIONS`, for the instance's own client. It calls back `XTYP_CONNECT`, or `XTYP_WILDCONNECT` where either name is nought; for each pair it is answered it makes a `DMGServerClass` window, adds the atoms it will send, sends `WM_DDE_ACK` from it, and calls back `XTYP_CONNECT_CONFIRM`.
- [[read out]] **`APPCMD_FILTERINITS` is on for every new instance** (`021f`), the program's flags or not, until `DNS_FILTEROFF`. [[measured]] [[probe:ddemgmt]]: before the server registered a name, a client's `DdeConnect` found no one and the server was called back nothing.
- [[read out]] **The client's acknowledgement** (`709c`): the first makes the conversation, state 4. The conversation is `ST_ISLOCAL` where the server's window is DDEML's (`70e6`). Otherwise, where the acknowledgement's application atom is the number DDEML kept at DS `00A4` -- the atom `Progman` -- it adds a count to both of the acknowledgement's atoms (`7140`-`7150`). It then keeps the two atoms in the conversation, and adds a count to the service's string handle (`7176`-`717d`). The conversation's end deletes each of the three once (`4719`-`4731`, `5323`-`533b`). The test is of the atom's number, not of the server: nothing compensates for Program Manager, which adds the atoms it answers with as the protocol asks ([[topic:program-manager-dde]]).
- [[read out]] **A second acknowledgement** (`7184`): from the partner itself, or to a client window not in a list -- its parent the instance's `DMGClass` window -- it is answered by `WM_DDE_TERMINATE` sent, not posted, to its sender, and its two atoms are deleted (`730c`-`7327`). In a list, one from a window of DDEML's makes another conversation (`7202`). One from a window not DDEML's is sent `WM_DDE_TERMINATE` too, and DDEML initiates again, a new client window in the list sending `WM_DDE_INITIATE` straight to the window this conversation was made through (`71bb`-`71f0`, through `6a68` with that window); then the atoms are deleted, unless the application atom is DDEML's `Progman` (`71f3`-`71ff`). So `Progman`'s atoms are left only in a list.
- [[measured]] [[probe:ddelist]], a plain server whose window A acknowledged and then, inside the same `WM_DDE_INITIATE`, a second window B: to `DdeConnect`, B was sent `WM_DDE_TERMINATE` from inside its acknowledgement, the conversation was with A alone, and the atoms counted as for one acknowledgement -- for `Progman` too: five counts more while connected, two left after. To `DdeConnectList`, B was sent `WM_DDE_TERMINATE` the same way and A was sent `WM_DDE_INITIATE` again from inside it, which it acknowledged; the list held two conversations, each `ST_CONNECTED | ST_CLIENT | ST_INLIST`, 51h, their `hConvPartner` nought. For `LISTSRV` the atoms balanced; for `Progman` the list left six counts where one acknowledgement left two: two for each conversation and B's two.
- [[read out]] The client stops walking the windows at the first acknowledgement (`6bd6`-`6be8`): of two servers that would answer, only the first in Z order is sent `WM_DDE_INITIATE`.
- [[measured]] [[probe:pmatom]] counts the atoms by name, deleting each until `GlobalFindAtom` no longer finds it and adding it back, around connections made while an instance of DDEML was held. To a server of its own named `Control`, topic `Topic`, a connection left nothing: `Control` counted 1 with its string handle, 3 connected, 1 after `DdeDisconnect`. To Program Manager, and to the same server of its own answering `Progman`, `Progman`, every connection left two counts of `Progman`. Over what there was before: 1 with the string handle, 6 connected (the handle, the two the server added, DDEML's two, the service's), 3 after `DdeDisconnect`, 2 once the handle was freed. `Shell`, `AppProperties`, Program Manager's other conversation, left nothing. With both servers answering `Progman`, only one was connected to, and the count was as for one.
- [[measured]] The held instance's `DdeUninitialize` deleted `Progman` once (11 counts to 10). Deleted until it was gone and added again, `Progman` came back with its old number, and DDEML's test still held: the next connection left two counts again, and its `DdeUninitialize` deleted one more, the number at DS `00A4` being deleted by every last instance whatever it now names ([[fn:DDEML.DdeUninitialize]]).
- [[measured]] A wildcard connection answered with two pairs: the server was called back `XTYP_WILDCONNECT`, `XTYP_CONNECT_CONFIRM` for the first, `XTYP_DISCONNECT` for the second -- the client having terminated it inside its acknowledgement -- and then `XTYP_CONNECT_CONFIRM` for the second with no conversation, its window gone.

### Ending

- [[read out]] **The side that ends a conversation** (`4f9e`) posts `WM_DDE_TERMINATE` and counts it at the instance's word 2 until the answer comes; its own callback is not called. **The other side** (`50be`) is called back `XTYP_DISCONNECT`, its `dwData2` 1 where the conversation was with itself, and answers `WM_DDE_TERMINATE`. A conversation's window is destroyed once both are done: its flag 2000h with `ST_TERMINATED` (`50a6`, `5220`).
- [[measured]] [[probe:ddemgmt]]: `DdeDisconnect` answered TRUE with its window still there; once the programs had run, the conversation was gone, `DdeQueryConvInfo` answering nought with `DMLERR_NO_CONV_ESTABLISHED`. The server's own `DdeDisconnect` called back the client `XTYP_DISCONNECT`; [[fn:DDEML.DdeReconnect]] made inside it found the server again.
- [[read out]] A `WM_DDE_TERMINATE` that comes while the instance is in a synchronous transaction is handled after it (`50d9`); `DdeDisconnect` inside a callback is posted (`0ba3`).

### Ending an instance: TermDialog

- [[read out]] [[fn:DDEML.DdeUninitialize]] waits for the answers to its `WM_DDE_TERMINATE`s (`040c`-`0513`): it yields and takes every message of its task with `GetMessage`, dispatching it, timer 2 on its `DMGClass` window set to `ShutdownTimeout`'s low word and its high word counted down in ticks of FFFFh. When the time is up it kills the timer and shows `TermDialog` (`049c`-`04cb`), owned by nothing, with `DialogBox`. Close (3) or a dialog that failed stops the waiting; Retry (4) sets the timer to `ShutdownRetryTimeout`; Continue (5) waits on with no timer (`04d0`-`04f8`).
- [[read out]] The template is `DS_SYSMODAL` (`DDEML.DLL`'s resources): the dialog is the system-modal window, and `DialogBox`'s loop locks the task once it is painted ([[topic:dialog-boxes]]), so no other program runs while it is up -- the partner cannot answer then.
- [[measured]] [[probe:ddeterm]], `ShutdownTimeout` 1000 and `ShutdownRetryTimeout` 2000 written to `WIN.INI` before the first `DdeInitialize`, a partner of plain DDE that kept its terminates: the dialog came between one and two and a half seconds after `DdeUninitialize` began, found among the task's windows as `#32770`, "Windows DDE", owned by nothing and active, style 94C800C2h, at 152,31 to 479,283. Its controls: four statics, 101 to 104, "An application using DDE did not respond to the system's exit command.", "Choose Retry to attempt to close the application and return to Windows.", "Choose Continue to repeatedly attempt to close the application and return to Windows.", "Choose Close to exit the application that is not responding. You may lose any unsaved information in this application."; buttons Retry (4, the default push button), Continue (5) and Close (3); three statics of `*`, 108 to 110.
- [[measured]] `IDCANCEL` posted to it was ignored. Retry closed it, and it came again between two and three and a half seconds later. Continue closed it, and in four seconds it did not come again; once the partner answered, `DdeUninitialize` answered TRUE and the conversation's window was gone. In a second instance, Close made `DdeUninitialize` answer TRUE at once with the conversation's window gone; the partner's late answer went to a window that no longer was.

### Monitors

- [[read out]] A monitor is `APPCLASS_MONITOR`, at most four at a time (`0055`, `DMLERR_DLL_USAGE`), its flags forced to `CBF_FAIL_ALLSVRXACTIONS | CBF_SKIP_CONNECT_CONFIRMS | CBF_SKIP_DISCONNECTS` (`0062`). It is still called back `XTYP_REGISTER` and `XTYP_UNREGISTER`. Each notice is a block of `GMEM_DDESHARE` (`5b0c`) sent to every monitor whose `MF_` flags take it (`3524`), and handed to its callback as `XTYP_MONITOR`, `dwData2` the `MF_` flag (`3636`).
- [[measured]] `MF_HSZ_INFO` tells more than the four `MH_` actions: 5 as DDEML adds an atom (`2f26`), 6 as it adds a count to one (`2e18`), 7 as it deletes one (`2ddc`). Making a string handle was 5 then `MH_CREATE`; freeing it `MH_DELETE` then 7; keeping it `MH_KEEP` then 6; the instance's end `MH_CLEANUP` then 7 for each left. `MONERRSTRUCT` was 10 bytes, `MONCONVSTRUCT` 26, `MONCBSTRUCT` 42.
- [[measured]] [[probe:ddemon]], two monitors, one taking every kind, the other `MF_LINKS` and `MF_ERRORS` alone: each was handed only its kinds, and both were called back `XTYP_REGISTER` and `XTYP_UNREGISTER` for the server's name, the second string its instance's own (`MAKELONG(atom, frame)`); the first was also told of those callbacks, its own among them, with `MF_CALLBACKS`. `MF_CONV` told the server's side of a conversation as it acknowledged, the client's as it took the acknowledgement, and the end of each. `MONLINKSTRUCT` was 36 bytes, a link told by both sides, made and ended; a warm link still open was ended by `DdeDisconnect`, the client's side told first. The transactions as a monitor sees them are on [[topic:ddeml-transactions]].

## In WinBox

DDEML is WinBox's own (`src/win16/ddeml/`, `crates/winbox-win16/src/ddeml/`), every export, kept as COMMDLG, VER and LZEXPAND are: with `DDEML.DLL` on the drive, each import of an export is linked to WinBox's stub and `GetProcAddress` answers the stub; with none, WinBox's is found by the file's name. Each routine of seg1 is followed as read out, on guest memory laid out as the file lays it out -- the instances in DDEML's own local heap, each instance's handles, conversations, links and queued callbacks in its heap of 4 KB, the queues of posts and asynchronous transactions in heaps of their own, the data in `GMEM_DDESHARE` blocks -- and each call into KERNEL, USER, GDI and KEYBOARD made as the file makes it, so the atoms counted, the windows made, the timers, messages and monitors' notices are the file's. Its data segment's initial bytes and `TermDialog`'s template are WinBox's own data. [[probe:ddemgmt]], [[probe:pmatom]], [[probe:ddemon]], [[probe:ddeterm]], [[probe:ddelist]] and [[probe:ddefail]] agree with Windows in every record, in both engines, with the file and without it; so does [[probe:dderaw]], plain DDE. What the probes needed of USER and KERNEL, WinBox does as Windows does, as it did when Microsoft's DDEML ran on it:

- USER's checks of a DDE message's parameters (`src/win16/user/dde-checks.ts`, `crates/winbox-win16/src/dde_checks.rs`).
- A task's queue as USER's ring: `PostMessage` answering the place, eight entries, a full ring refusing, `SetMessageQueue` making it anew (`Task.ringPlace` in `src/win16/task.ts`, `Queue::ring_place` in `crates/winbox-win16/src/queue.rs`).
- `PostMessage` to a handle that is no window's refused.
- [[fn:USER.SetParent]] linking the window first among its new parent's children (`USER.EXE` seg14 `04ab`-`04b2`): DDEML moves a list's conversations one by one into the new list, and the last moved is the first.
- `GetKbCodePage` answering 437, the word the US keyboard driver keeps at seg10 `06fc` (seg10 `083e`), which DDEML compares a code page with.

[[probe:ddeleft]] has two known gaps, the same with WinBox's DDEML as with Microsoft's: winbox.js frees no block as its task or module ends, and an atom deleted once too often answers nought.

## Not yet done

- **Freeing a task's memory as it ends**, and a module's `GMEM_DDESHARE` blocks as its last instance ends ([[probe:ddeleft]], 5 records): neither engine knows a block's owner.
- **An atom deleted once too often**: the answer depends on KERNEL's local heap in USER's data segment, which winbox.js does not keep ([[probe:ddeleft]], 1 record).
- USER's checks of the other messages' parameters (seg1 `afc2`-`b388`, and `af84` for the controls'): only the DDE rows are followed.
- Atom numbers where a deleted atom's place in USER's table is taken: winbox.js gives a deleted atom's number to the next string added ([[topic:atoms]]), Windows the place in its heap that fits. Whether DDEML's `Progman` test holds after the atom was gone can differ: a first draft of [[probe:pmatom]], whose first instance ended before the connections, saw the test fail under Windows, the number taken by another name, and hold in winbox.js. Not recorded in the probe as it stands.
