---
kind: topic
name: DDEML transactions and data handles
summary: How Windows 3.1's DDEML carries a transaction — what DdeClientTransaction sends for each kind and waits for, its modal loop and time-outs, the errors and the status it leaves, asynchronous transactions and abandoning them, the server's callbacks and how their answers become acknowledgements, advise links hot, warm and acknowledged with DdePostAdvise, blocked callbacks — and the data handles over the shared memory DDE posts.
probes: [ddexact, ddefail, ddenest, ddeheap, ddemon]
---

`DDEML.DLL` is Microsoft's library, and both engines load it from the installation and run it on their own USER and KERNEL, as they run COMMDLG. This page states what it does, so that it can be followed later as WinBox's own. [[probe:ddexact]] is a client and a server (`DDEXACTC.EXE`), two programs, which talk through DDEML and also by plain `WM_DDE_*` messages. Both engines run it whole, and all 92 of its records agree with Windows on each. [[probe:ddefail]] holds a server's `CBF_FAIL_` and `CBF_SKIP_` flags and `EC_ENABLEONE`, [[probe:ddenest]] transactions nested and a time-out past FFFFh milliseconds, [[probe:ddeheap]] an instance's heap filled, and [[probe:ddemon]] what monitors are told.

Everything read out here is `DDEML.DLL` segment 1. The connection side of DDEML (`DdeInitialize`, string handles, `DdeConnect` and the rest, its windows and hooks) is on [[topic:dynamic-data-exchange]].

## Handles

- [[read out]] A conversation handle is `MAKELONG(window, tag)`: DDEML's own window for the conversation, and the word at that window's offset 4. A handle is good while `IsWindow` holds and the tag still matches (`2dac`). The conversation's record is the far pointer at window offset 0 (`GetWindowLong`, `123c`).
- [[read out]] An instance identifier is `MAKELONG(record, check)`: the near offset of the instance's record in DDEML's data segment, and a word that must equal the record's offset `30h`. A call with a nought record or the wrong check answers nought and sets no error, since there is no instance to set it in (`DdeAbandonTransaction` `1bfd`, `DdePostAdvise` `1125`, `DdeCreateDataHandle` `14fb`).
- [[read out]] A data handle is a far pointer to six bytes in the instance's local heap: the instance record, the handle's flags, and the global block (`1564`-`1577`). See [Data handles](#data-handles).
- [[read out]] Every call clears the instance's last error first, at its record's offset `2Ah`, so [[fn:DDEML.DdeGetLastError]] answers for the last call alone. A bad conversation handle given to `DdeClientTransaction` sets `DMLERR_INVALIDPARAMETER` in every instance of the calling task (`121f`-`1239`, the walk at `20a0` keeping those whose task is `GetCurrentTask`'s).

## A transaction, message by message

[[read out]] `DdeClientTransaction` checks the type and its arguments (`12fe`-`13dd`) and then sends one message (`3886`):

| Type                                                 | Message           | `lParam`                                    | State it waits in  |
| ---------------------------------------------------- | ----------------- | ------------------------------------------- | ------------------ |
| `XTYP_REQUEST`                                       | `WM_DDE_REQUEST`  | format, item                                | 5 `XST_REQSENT`    |
| `XTYP_POKE`                                          | `WM_DDE_POKE`     | the data's block, item                      | 7 `XST_POKESENT`   |
| `XTYP_EXECUTE`                                       | `WM_DDE_EXECUTE`  | nought, the command's block                 | 9 `XST_EXECSENT`   |
| `XTYP_ADVSTART`, with `XTYPF_NODATA`, `XTYPF_ACKREQ` | `WM_DDE_ADVISE`   | a block of the options and the format, item | 11 `XST_ADVSENT`   |
| `XTYP_ADVSTOP`                                       | `WM_DDE_UNADVISE` | format, item                                | 12 `XST_UNADVSENT` |

- [[read out]] Any other type is `DMLERR_INVALIDPARAMETER` (`1323`); [[measured]] `20C0h` is refused so, and nothing is sent.
- [[read out]] A request, a poke and the advise starts need an item, and all but an execute need a format (`138b`-`13dd`). [[measured]] A request with no item, a request and a poke with no format: `DMLERR_INVALIDPARAMETER`, and the server hears nothing.
- [[read out]] `XTYP_ADVSTART | XTYPF_NODATA | XTYPF_ACKREQ`, `103Ch`, goes past the item's check (`130a` jumps to `13d0`), so it is sent with no item. [[measured]] The server's callback is handed an `XTYP_ADVSTART` for item nought, and the link is made.
- [[read out]] The advise's options word is the type's flags moved to the top: `XTYPF_NODATA` becomes `fDeferUpd` (4000h), `XTYPF_ACKREQ` becomes `fAckReq` (8000h), and 2000h is set as well (`38dc`-`38f2`). The block is `GMEM_DDESHARE` (`5b0c`).
- [[read out]] The conversation must be idle, in state 2 `XST_CONNECTED`, or the call answers nought with `DMLERR_SERVER_DIED` (`367d`-`368a`). [[measured]] A second synchronous request on the same conversation, made by a window procedure that the first's modal loop dispatched, answers nought with 400Eh.
- [[read out]] For a conversation inside one DDEML, the client checks the server instance's `CBF_FAIL_*` flags itself, by the same table as the callback's (below), and answers nought without sending (`129a`-`12c2`). The `DMLERR_NOTPROCESSED` it sets there goes to the instance in a word of its stack frame not yet given a value, `[bp-0Ch]`, which is set only after, at `1304`: not to the client's. [[measured]] [[probe:ddefail]]: a request, a poke, an execute and an advise start that the server's flags failed each answered nought, `DdeGetLastError` nought, `pdwResult` left AAAAAAAAh, and the server's callback heard nothing. An advise stop is in no flag: it was sent, and with no link made answered `DMLERR_NOTPROCESSED`, AAAA0000h.
- [[read out]] When the server's window is gone the call answers `DMLERR_SERVER_DIED`, and when `PostMessage` fails, `DMLERR_POSTMSG_FAILED` (`39eb`-`3a34`).
- [[read out]] A poke's or execute's data handle that DDEML did not get to send is freed unless it is the application's (`12c5`-`12f7`).

## Synchronous: the modal loop

[[read out]] A transaction with a time-out is waited for in a loop of DDEML's (`59cc`):

- No instance of the calling task may already be waiting: if any instance whose task is the caller's (the walk at `20a0`) has a window at its offset `28h`, the call answers nought with `DMLERR_REENTRANCY`, set in the calling instance (`59d7`-`59f2`). The loop is entered after the message is sent (`3886`), so the transaction has gone to the server all the same.
- [[measured]] [[probe:ddenest]]: while instance A waited on a request, a message A's loop dispatched made a synchronous request of a second instance, B: it answered nought with 400Dh in B, A's own error untouched, and the server was handed the request. So was a synchronous request on A's second conversation. B's asynchronous request went through, and completed. A synchronous request made meanwhile by another task's instance, the server's own client of itself, was answered with its data.
- `SetTimer(conversation window, 1, time-out)`, at most FFFFh milliseconds at a time; a longer time-out is waited in FFFFh pieces, each tick of timer 1 taking 10000h off what is left and setting the timer to the rest once it is less (`5a07`-`5a71`, `5ab2`-`5abc`). A `SetTimer` that fails is `DMLERR_SYS_ERROR`. [[measured]] [[probe:ddenest]]: a request the server blocked, with a time-out of 10000h + 500 ms, answered `DMLERR_DATAACKTIMEOUT` after no less than that by `GetTickCount` (but for two of its ticks) and less than a second and a half more.
- `GetMessage`, then `CallMsgFilter(MSGF_DDEMGR)`, and `DispatchMessage` unless the filter took it (`5a7e`-`5aa4`). There is no `TranslateMessage`.
- The loop ends when the instance's offset `3Ah` is set: 1 by the timer (`4760`), 80h by the answer (`48ca`), 2 by the conversation ending (`4fb9`, `50e4`) or the instance going (`0527`).
- Then `KillTimer`, and every `WM_TIMER` left for the conversation's window taken out (`5abe`-`5adf`), and DDEML's message 4CCh posted to the instance's window, so that callbacks queued while it waited run (`5ae7`-`5af0`).

What the loop means for a program:

- [[measured]] It dispatches the program's own messages: a message posted to its window just before a request was handled while the request waited, and a timer of one millisecond set before a request that timed out ticked inside it.
- [[read out]] `GetMessage`'s answer is not looked at (`5a89`-`5a8e`). [[measured]] A `WM_QUIT` posted before a request is taken by the loop and lost: `PeekMessage` for it afterwards finds nothing.

When the loop ends, the transaction's state says what came (`4356`):

| Type     | Done when the state is | Otherwise, if no error is set already |
| -------- | ---------------------- | ------------------------------------- |
| Request  | 6 `XST_DATARCVD`       | `DMLERR_DATAACKTIMEOUT` (4002h)       |
| Poke     | 8 `XST_POKEACKRCVD`    | `DMLERR_POKEACKTIMEOUT` (400Bh)       |
| Execute  | 10 `XST_EXECACKRCVD`   | `DMLERR_EXECACKTIMEOUT` (4005h)       |
| Advise   | 13 `XST_ADVACKRCVD`    | `DMLERR_ADVACKTIMEOUT` (4000h)        |
| Unadvise | 14 `XST_UNADVACKRCVD`  | `DMLERR_UNADVACKTIMEOUT` (4010h)      |

[[read out]] A request answers a data handle. Anything else answers 1. A failure answers nought and leaves the conversation in state 1, `XST_INCOMPLETE` (`4600`). [[read out]] The handle a request answers is a new six-byte record, and the block is put in the instance's list of handles to free at `DdeUninitialize` (`1425`-`1488`).

### The acknowledgement

[[read out]] The client's window (`ClientWndProc`, `4614`) matches a `WM_DDE_ACK` to the transaction by the item, or for an execute by the command's block (`4b8e`-`4c5f`). A `WM_DDE_DATA` matches a request only when it has `fResponse` and the asked format and item (`4b9b`-`4bee`). Then (`4c6a`):

- [[read out]] The acknowledgement's status word is stored into `pdwResult`'s **low word** only (`4cd7`-`4cdd`). [[measured]] With `pdwResult` holding AAAAAAAAh before, a positive poke leaves AAAA8000h, a busy one AAAA4000h, a refused one AAAA0000h; a request answered with data leaves it untouched.
- [[read out]] A negative acknowledgement sets `DMLERR_NOTPROCESSED`, or `DMLERR_BUSY` where `fBusy` is set (`4d50`-`4d74`). A poke's block is freed if its header has `fRelease`, an advise's options block is freed (`4d86`-`4db1`).
- [[read out]] A positive acknowledgement to a request is not an answer to it (`4d1b`).
- [[read out]] A request's `WM_DDE_DATA` without `fRelease` is copied, and one with `fRelease` taken as it is (`4df2`-`4e19`); it is acknowledged when it has `fAckReq` (`4e27`-`4e43`).

## Errors and status, measured

All from [[probe:ddexact]], the server answering by the item's name:

| Transaction                                           | Answer  | `DdeGetLastError`                       | `pdwResult`                     |
| ----------------------------------------------------- | ------- | --------------------------------------- | ------------------------------- |
| Request answered with data                            | handle  | 0                                       | AAAAAAAAh                       |
| Request the server answers nought                     | 0       | `DMLERR_NOTPROCESSED`                   | AAAA0000h                       |
| Request in a format the server refuses                | 0       | `DMLERR_NOTPROCESSED`                   | AAAA0000h                       |
| Poke, `DDE_FACK`                                      | 1       | 0                                       | AAAA8000h                       |
| Poke, `DDE_FBUSY`                                     | 0       | `DMLERR_BUSY`                           | AAAA4000h                       |
| Poke, `DDE_FNOTPROCESSED`                             | 0       | `DMLERR_NOTPROCESSED`                   | AAAA0000h                       |
| Poke, `DDE_FACK` with 2Ah of its own                  | 1       | 0                                       | AAAA800Ah                       |
| Execute, `DDE_FACK`, `DDE_FBUSY`, `DDE_FNOTPROCESSED` | 1, 0, 0 | 0, `DMLERR_BUSY`, `DMLERR_NOTPROCESSED` | AAAA8000h, AAAA4000h, AAAA0000h |
| Advise start the server refuses                       | 0       | `DMLERR_NOTPROCESSED`                   | AAAA0000h                       |
| Advise stop for a link there is not                   | 0       | `DMLERR_NOTPROCESSED`                   | AAAA0000h                       |
| Request the server blocks, 300 ms                     | 0       | `DMLERR_DATAACKTIMEOUT`                 | AAAAAAAAh                       |

- [[read out]] The status a server's answer puts in its acknowledgement is the answer `AND C00Fh` (`42be`-`4333`, `4336`), so of the application's own eight bits only the low four reach the client. [[measured]] 802Ah arrives as 800Ah.

## Asynchronous transactions

- [[read out]] A time-out of `TIMEOUT_ASYNC` takes a record from the conversation's pool of 38h-byte transactions, sends the message, and answers 1 at once; `pdwResult` is the transaction's identifier, the record's offset and a word of it (`3694`-`37c5`).
- [[read out]] When the answer comes, the client's window finds the record in the conversation's list (`48d4`-`4936`), finishes it as the loop would (`4356`), and queues an `XTYP_XACT_COMPLETE` for the client's callback: the format and item asked, the topic, the data handle (a request's data, or 1), the identifier in `dwData1` and the acknowledgement's status in `dwData2` (`49ab`-`4a43`).
- [[measured]] A request completes with the data, `dwData2` nought; a poke with `dwData2` 8000h, a busy poke with no data and 4000h; an execute with 8000h. The completion's `dwData1` is the identifier `pdwResult` had.
- [[read out]] [[fn:DDEML.DdeAbandonTransaction]] takes the record out (`1cb6`); an answer arriving later matches nothing and is freed (`4b42`-`4b7f`).

## The server's side

- [[read out]] The server's window (`ServerWndProc`, `523a`) turns each message into a queued transaction (`3a68`, queued by `5b60`): `WM_DDE_REQUEST` an `XTYP_REQUEST`, `WM_DDE_POKE` an `XTYP_POKE`, `WM_DDE_EXECUTE` an `XTYP_EXECUTE`, `WM_DDE_ADVISE` an `XTYP_ADVSTART`, `WM_DDE_UNADVISE` an `XTYP_ADVSTOP` for each link it ends. A message from a window that is not the conversation's partner is ignored (`3a80`-`3a96`).
- [[read out]] The callback is never called from inside the `WM_DDE_*` message. The queue is run when DDEML's message 4CCh reaches the instance's window, and not while the instance is inside a callback (`4e66`, `4ea9`).
- [[read out]] An execute's callback is handed hsz2 nought and format nought, and the command block as a handle with no header (`3dd6`-`3e10`). [[measured]] `[hello]` arrives as `[hello]`, size 32, the whole of its global block.
- [[measured]] An execute sent with an item and a format arrives as an empty string: the client made its block with a header (see [Data handles](#data-handles)), and the server reads the command from the block's first byte.
- [[read out]] What the callback answers becomes the reply (`3fa0`): a request's data handle is posted as `WM_DDE_DATA` with `fResponse` set (`4222`-`42bb`), and nought is a negative acknowledgement; a poke's or execute's answer is the acknowledgement's status, `AND C00Fh`, the execute's echoing the command's block (`4336`). A poke's data is freed when the answer has `DDE_FACK` (`42be`).
- [[read out]] An advise start answered with anything but nought makes a link, kept once for each window, topic, item and format (`261a`), and is acknowledged 8000h; nought is a negative acknowledgement (`40b0`-`4170`). [[measured]] Starting the same link twice is acknowledged twice, the callback called both times.
- [[read out]] `XTYP_ADVSTOP`'s acknowledgement comes after the last link it ends, and its `dwData2`'s low word is the item's atom (`3cdf`-`3d15`). The callback's answer is not looked at.
- [[read out]] The application's `CBF_FAIL_*` and `CBF_SKIP_*` flags are looked up in a table by type (`5838`-`585d`); a filtered type answers nought without calling the application, so a filtered request, poke or execute is acknowledged negatively. `XTYP_ADVREQ`, `XTYP_ADVSTOP`, `XTYP_ADVDATA`, `XTYP_XACT_COMPLETE` and the errors cannot be filtered.
- [[measured]] [[probe:ddefail]], a plain client of a server whose flags were changed by calling [[fn:DDEML.DdeInitialize]] again: `CBF_FAIL_REQUESTS` answered a request with `WM_DDE_ACK` status nought, `CBF_FAIL_POKES` a poke, `CBF_FAIL_EXECUTES` an execute (with the commands' block), `CBF_FAIL_ADVISES` an advise, each without the callback, while the other kinds were served; the flags took effect on the conversation already open. With `CBF_FAIL_ADVISES` no link was made, so the unadvise after was refused too. `CBF_FAIL_ALLSVRXACTIONS` failed all of them -- and connections, its bits taking in `CBF_FAIL_CONNECTIONS` and `CBF_FAIL_SELFCONNECTIONS`; a conversation already open still ended with `XTYP_DISCONNECT`.

### Blocking: CBR_BLOCK

- [[read out]] A callback that answers `CBR_BLOCK` for a type without `XTYPF_NOBLOCK` blocks the conversation: the transaction stays first in the queue and the conversation is marked `ST_BLOCKED` (`4f43`-`4f5d`). Transactions of other conversations still run; those of the blocked one wait behind it, in order (`4eeb`).
- [[read out]] [[fn:DDEML.DdeEnableCallback]] with `EC_ENABLEALL` or `EC_ENABLEONE` clears the mark and runs the queue at once, inside the call (`1eaa`-`1eb4`); `EC_ENABLEONE` lets one transaction through and blocks again (`4ef4`-`4efe`).
- [[measured]] [[probe:ddefail]]: three asynchronous requests to a server that had called `EC_DISABLE` for its instance waited, `EC_QUERYWAITING` answering TRUE. Each `EC_ENABLEONE` -- for the instance, then for the conversation -- had the callback handed one, the first, then the second, inside the call, the client's completion following; `EC_QUERYWAITING` was still TRUE after each, and `EC_ENABLEALL` let the last through, after which it was FALSE. A request answered `CBR_BLOCK` and another behind it: `EC_ENABLEONE` handed the blocked one to the callback again, answered, and the second still waited until `EC_ENABLEALL`. With only the conversation disabled, `EC_ENABLEONE` for the instance let one of its transactions through.
- [[measured]] A request blocked so times the client out (`DMLERR_DATAACKTIMEOUT`); a second request on the same conversation is not seen by the server and times out too. Enabled again from a second conversation, the server's callback is handed the first request again, then the second, in order, and its answers go to a client that has stopped waiting: the client's next request on the conversation is answered normally.
- [[measured]] A poke blocked and then abandoned by the client, when released, reaches the server's callback with an item whose name `DdeQueryString` cannot give: an empty string. [[inferred]] Abandoning deletes the item's atom (`1d44`-`1d4b`), and the queued transaction held no reference of its own.

## Advise links and DdePostAdvise

- [[read out]] [[fn:DDEML.DdePostAdvise]] walks every link of the instance whose topic and item match, in any conversation and format, newest first (`1118`-`11f3`). `APPCMD_CLIENTONLY` instances are refused with `DMLERR_DLL_USAGE`. It answers 1 once the instance is good, whether or not a link matched.
- [[read out]] A **hot** link calls `XTYP_ADVREQ` at once, synchronously and not through the queue, so `CBR_BLOCK` does not apply to it (`3e64`); `dwData1`'s low word is how many later links have the same window, topic, item and format, and as links are kept once that is nought. Nought answered sends nothing.
- [[read out]] A **warm** link (`XTYPF_NODATA`) gets `WM_DDE_DATA` with no block and no `XTYP_ADVREQ` (`11a0`-`11c6`). [[measured]] The client's callback is handed `XTYP_ADVDATA` with data nought.
- [[read out]] A link made with `XTYPF_ACKREQ` gets `fAckReq` in the data's header and waits for the acknowledgement; a `DdePostAdvise` while it waits only marks the link, and when the acknowledgement comes the server is asked again with `dwData1` FFFFh, `CADV_LATEACK` (`1191`-`119d`, `3d30`-`3d75`). [[measured]] Two `DdePostAdvise` calls in a row: one `XTYP_ADVREQ` (count 0), one `XTYP_ADVDATA`, then a second `XTYP_ADVREQ` with FFFFh and a second `XTYP_ADVDATA`. A plain client that asked for acknowledgement saw both blocks with A000h in their headers, `fAckReq` and `fRelease`.
- [[measured]] Two links on one item, in `CF_TEXT` and then `CF_OEMTEXT`: the `XTYP_ADVREQ` for `CF_OEMTEXT` came first. The format the client's `XTYP_ADVDATA` is handed is the data's, not the link's: the server answered both in `CF_TEXT`, and both came as `CF_TEXT`.
- [[measured]] `DdePostAdvise` for an item with no link, and for a link stopped, answers 1 and asks nothing.
- [[read out]] The client's window takes a `WM_DDE_DATA` that answers no request as advise data and queues `XTYP_ADVDATA`; a later one for the same conversation, item and format replaces one still queued (`4a4a`-`4b3e`, `5600`-`5741`).

## Data handles

The calls: [[fn:DDEML.DdeCreateDataHandle]], [[fn:DDEML.DdeAddData]], [[fn:DDEML.DdeGetData]], [[fn:DDEML.DdeAccessData]], [[fn:DDEML.DdeUnaccessData]], [[fn:DDEML.DdeFreeDataHandle]].

- [[read out]] The data is a `GMEM_DDESHARE` global block, fixed when made and moveable once grown (`5b22`, `165a`). When the handle has an item, the block starts with DDE's four-byte header — the status word and the format — and the data follows it (`63c6`). Without an item it has no header for the data: the data starts at the block's first byte (flag 100h).
- [[read out]] The header's status is `fRelease` (2000h) for DDEML's own data and `fAckReq` (8000h) for `HDATA_APPOWNED` data (`63e0`-`63ee`). It is written even into a block with no header, where the data then overwrites it.
- [[read out]] Sizes are the global block's, from `GlobalSize`, less the header (`17d9`, `18dc`). [[measured]] So nine bytes of data report 28 (a block of 32), and so do 1, 14 and 27; 40 report 60.
- [[read out]] The handle's flags: 1 `HDATA_APPOWNED`; 100h no header; 4000h handed to a callback; 8000h sent or received, read-only. Each instance keeps a list of its handles (`2ac6`, `29d8`), and the application's own blocks also a count in a list of DDEML's (`6454`-`648a`).
- [[read out]] A handle given to a callback is a six-byte record on DDEML's stack, flagged 4000h, good only during the callback (`589a`-`58bc`). [[fn:DDEML.DdeFreeDataHandle]] on it does nothing and answers 1. [[measured]] Freed inside `XTYP_ADVDATA`, it answered 1, and its data still read back after.
- [[read out]] A handle given to `DdeClientTransaction` is DDEML's afterwards: its record is freed unless it is the application's (`1363`). An application's block is copied before it is posted to another DDEML's conversation (`65b8`, `67fc`). [[measured]] An `HDATA_APPOWNED` handle poked twice is accepted both times, and freed after with 1.
- [[read out]] A received block is wrapped (`6636`): one without `fRelease` is treated as the application's, so it is not freed under the sender, and every received handle is read-only. [[measured]] `DdeAddData` on the handle a request answered is refused with `DMLERR_INVALIDPARAMETER`; `DdeFreeDataHandle` on it answers 1.
- [[read out]] Freeing a handle frees its block when it has `fRelease`, or when it is the application's and its count has come to nought; a block of `CF_BITMAP`, `CF_DIB`, `CF_DSPBITMAP` or a metafile picture has its object deleted first (`64c4`, `691a`).

### The shared memory, seen plainly

[[measured]] A plain `WM_DDE_*` client of the same DDEML server saw:

- A request answered with a block whose header is 3000h, `fResponse` and `fRelease`, in `CF_TEXT`, of 32 bytes, holding the text.
- A refused request answered with `WM_DDE_ACK`, status 0.
- A poke whose header had no `fRelease`, acknowledged 8000h, and its block left alone: still 32 bytes after.
- An execute acknowledged 8000h with its own block in `lParam`'s high word, and the block left alone.
- An advise with `fAckReq` acknowledged 8000h; its data came with A000h headers, as above. An unadvise brought `XTYP_ADVSTOP` to the server and 8000h back. A terminate brought `XTYP_DISCONNECT` to the server and a terminate back.

## What a monitor sees of a transaction

[[measured]] [[probe:ddemon]], a monitor taking every kind of notice ([[topic:dynamic-data-exchange]]), watching a client and a server in two programs:

- A synchronous request: the client's `WM_DDE_REQUEST` told as the server's task took it (`MF_POSTMSGS`, the format and the item's name), the server's `MF_CALLBACKS` notice of `XTYP_REQUEST` with its answer, then its `WM_DDE_DATA` as the client took it. A request the server answered nought came back as `WM_DDE_ACK` with status nought; the client's `DMLERR_NOTPROCESSED` was told to no monitor.
- A poke and an execute: the message, the callback, the acknowledgement 8000h -- an execute's with the commands' block.
- An advise start: the callback, then the server's link (`MF_LINKS`, `fServer` 1) before its acknowledgement, and the client's link (`fServer` 0) after it. A warm link's `fNoData` was 4000h on the server's side, the bit of the `DDEADVISE` options, and 4, `XTYPF_NODATA`, on the client's. `XTYP_ADVREQ` from `DdePostAdvise`, the data posted, and the client's `XTYP_ADVDATA`. An advise stop: both links ended, the server's first, then the callback.
- A request with no item: `MF_ERRORS`, 4006h, the client's task, to both monitors.
- An asynchronous request: its completion's `XTYP_XACT_COMPLETE` told with `MF_CALLBACKS` as the client was called back.

## Inside DDEML

- [[read out]] A request for the topic "Who" and item "Made me?" in `CF_TEXT` is answered by DDEML itself, before the application's callback, with the text "DDEML - By Sanford Alyn Staab", the strings kept XORed with 25h in DDEML's data (`5860`-`5897`, decoded at `5990`).

## In winbox.js

DDEML is not reimplemented: both engines load `DDEML.DLL` from the installation, and [[probe:ddexact]], [[probe:ddefail]], [[probe:ddenest]] and [[probe:ddemon]], every record of each agreeing in both engines, hold what it asks of their KERNEL and USER — global atoms, `GMEM_DDESHARE` blocks, messages posted and sent between two programs, timers, a modal loop with `CallMsgFilter`, `GlobalSize`'s rounding — to Windows' answers. Program Manager's DDE is on [[topic:program-manager-dde]].

## Not yet done

- DDEML as WinBox's own, followed from this page in both engines.
- The 4CCh queue's timing against other messages, beyond the orders recorded here.
- Where the `DMLERR_NOTPROCESSED` of a transaction a local server's flags fail goes: to the instance an unset word of the stack names, which no probe has seen.
- A time-out's length to the millisecond: [[probe:ddenest]] holds it to two of `GetTickCount`'s ticks, where both engines, held to the millisecond, came short of the 66,036 asked (66,021 in one run of the Rust engine's): a timer's period against `GetTickCount`, which Windows' recording, held to the same, did not come short of.
