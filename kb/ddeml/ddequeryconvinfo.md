---
kind: function
module: DDEML
name: DdeQueryConvInfo
ordinal: 9
summary: What a conversation is -- its partner, names, state, flags, last error, list and CONVCONTEXT -- or, for a client's asynchronous transaction, that transaction's; copied as far as the CONVINFO's cb says.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/conv.ts
topics: [dynamic-data-exchange]
---

## Observed behaviour

[[measured]] [[probe:ddemgmt]], `QID_SYNC`, a `CONVINFO` of 58 bytes:

| Field           | A client's conversation                                       | The server's      |
| --------------- | ------------------------------------------------------------- | ----------------- |
| `cb`            | 58, and the call answers 58                                   | 58                |
| `hUser`         | nought, or what [[fn:DDEML.DdeSetUserHandle]] set             | nought            |
| `hConvPartner`  | the server's conversation, where it is DDEML's                | nought            |
| `hszSvcPartner` | the service the server answered with                          | nought            |
| `hszServiceReq` | the service asked for, nought for a wildcard                  | the same          |
| `hszTopic`      | the topic                                                     | the topic         |
| `hszItem`       | nought                                                        | nought            |
| `wFmt`          | 1                                                             | nought            |
| `wType`         | 1062h                                                         | nought            |
| `wStatus`       | 15h: `ST_CONNECTED`, `ST_ISLOCAL`, `ST_CLIENT`; 55h in a list | 1, `ST_CONNECTED` |
| `wConvst`       | 2, `XST_CONNECTED`                                            | 2                 |
| `wLastError`    | nought                                                        | nought            |
| `hConvList`     | its list, in one                                              | nought            |
| `ConvCtxt`      | the context it was made with                                  | the client's      |

- [[measured]] `wFmt` 1 and `wType` 1062h with no transaction are DDEML's: they come from a record in its data that stands for no transaction.
- [[measured]] A conversation with itself is 115h on the client's side and 101h on the server's: `ST_ISSELF`.
- [[measured]] [[fn:DDEML.DdeEnableCallback]] shows in `wStatus`: `EC_DISABLE` 8, `ST_BLOCKED`; then `EC_ENABLEONE` 80h, `ST_BLOCKNEXT`, the 8 gone.
- [[measured]] With `cb` 10 it answers 10, writes `cb` as 10 and copies 10 bytes, nothing past them.
- [[measured]] A transaction id that is no transaction's, 5, answers nought and `DMLERR_UNFOUND_QUEUE_ID`, 4011h.
- [[measured]] For a conversation that has ended and gone, nought and `DMLERR_NO_CONV_ESTABLISHED`.

## Nuances

- [[read out]] `hConvPartner` is given only where the partner is a window still and the conversation is `ST_CONNECTED | ST_ISLOCAL` (`DDEML.DLL` seg1 `0e69`-`0e9e`); a server's conversation is never `ST_ISLOCAL`, so its partner is never given. `hszSvcPartner` is given only on a client's side (`0e9e`-`0eb8`).
- [[read out]] On a client's side, `hszItem`, `wFmt`, `wType`, `wConvst` and `wLastError` come from the conversation's synchronous transaction, or with an id, from that transaction in its queue (`0e10`-`0e42`, `0efd`-`0f45`); on a server's, the conversation's state and the instance's last error (`0f4c`-`0f78`). Which it is, the conversation's window says, sent `WM_USER + CBh` (`0df0`). An id on a server's conversation is taken as `QID_SYNC`.
- [[read out]] `cb` is read as a word; as many bytes as the lesser of it and 58 are copied, and `cb` written back as that (`0fc2`-`0fee`).
- [[read out]] A handle that is not a conversation's sets `DMLERR_NO_CONV_ESTABLISHED` on every instance of the calling task.

## Implementation

WinBox's own: `queryConvInfo` in `src/win16/ddeml/conv.ts` and `query_conv_info` in `crates/winbox-win16/src/ddeml/conv.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. The `CONVINFO` is laid out from the conversation's 42h bytes, or an asynchronous transaction's record, and copied for as many bytes as the caller's `cb` asks. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
