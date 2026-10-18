---
kind: function
module: DDEML
name: DdeReconnect
ordinal: 37
summary: Starts a client conversation again with the window it was made through, its advise loops started again, where the server ended it.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/conv.ts
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: called inside the client's `XTYP_DISCONNECT` callback, when the server had ended the conversation, it answered a new conversation, and the server was called back `XTYP_CONNECT` and `XTYP_CONNECT_CONFIRM` again. The old conversation was gone once the programs had run.
- [[measured]] For a conversation already gone it answered nought, and `DMLERR_NO_CONV_ESTABLISHED`.

## Nuances

- [[read out]] Only a client's conversation: a server's is refused with `DMLERR_INVALIDPARAMETER` (`DDEML.DLL` seg1 `0c47`-`0c54`).
- [[read out]] It sends `WM_DDE_INITIATE` to the one window the old conversation was made through -- the server's `DMGFrame`, for a DDEML server -- not to every window at the top (`0c56`-`0c75`), with the old service, topic and `CONVCONTEXT`.
- [[read out]] In a list, the new conversation joins the old one's list (`0c8c`-`0ca0`). Each advise loop the old conversation had is started again, `XTYP_ADVSTART` with its flags, asynchronously (`0ca5`-`0d68`).
- [[inferred]] A client conversation is destroyed once the server's `WM_DDE_TERMINATE` has been handled ([[fn:DDEML.DdeDisconnect]]), so the time to reconnect is inside the `XTYP_DISCONNECT` callback.

## Implementation

WinBox's own: `reconnect` in `src/win16/ddeml/conv.ts` and `reconnect` in `crates/winbox-win16/src/ddeml/conv.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. The new conversation is made through the window the old one was made through; its advise links are started again asynchronously. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
