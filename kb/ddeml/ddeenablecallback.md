---
kind: function
module: DDEML
name: DdeEnableCallback
ordinal: 26
summary: Holds back an instance's or a conversation's callbacks, lets one through or all of them, or asks whether any are waiting.
probes: [ddemgmt, ddefail]
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: `EC_DISABLE` on a conversation answered TRUE and set `ST_BLOCKED`, 8, in its `wStatus`; `EC_ENABLEONE` answered TRUE and left `ST_BLOCKNEXT`, 80h, in its place.
- [[measured]] `EC_DISABLE` on the whole instance set `ST_BLOCKED` on its conversations, and a conversation made after it began with `ST_BLOCKED`; `EC_ENABLEALL` cleared it.
- [[measured]] A server's `EC_DISABLE` on its instance set `ST_BLOCKED` on its server conversations too. Its `EC_QUERYWAITING`, with nothing waiting, answered FALSE.
- [[measured]] `XTYP_CONNECT` still reached a server whose callbacks were disabled: connecting is not held back.
- [[measured]] A command of 1 answered FALSE and `DMLERR_INVALIDPARAMETER`; so did a conversation that is not one. An id whose serial is not the instance's answered FALSE and set nothing.
- [[measured]] Enabling inside a callback answered FALSE and `DMLERR_REENTRANCY`, 400Dh.
- [[measured]] [[probe:ddefail]], a server with three requests waiting behind `EC_DISABLE`: `EC_QUERYWAITING` answered TRUE; `EC_ENABLEONE`, for the instance or for the conversation, had its callback handed one request, the first waiting, inside the call, and `EC_QUERYWAITING` was TRUE still; `EC_ENABLEALL` let the rest through, and then it answered FALSE.
- [[measured]] A request the callback answered `CBR_BLOCK`, another behind it: `EC_ENABLEONE` handed the blocked request to the callback again and left the second waiting; `EC_ENABLEALL` let it through. With only the conversation disabled, `EC_ENABLEONE` for the whole instance let one of its requests through.

## Nuances

- [[read out]] The commands are `EC_ENABLEALL` 0, `EC_QUERYWAITING` 2, `EC_DISABLE` 8 and `EC_ENABLEONE` 80h; any other bit is refused (`DDEML.DLL` seg1 `1ddc`, `test 0FF75h`).
- [[read out]] `EC_QUERYWAITING` looks in the instance's queue of callbacks waiting, for the conversation's where one is given (`1de6`-`1e47`).
- [[read out]] For the instance, the flag at 2Ch is set or cleared and every window under its `DMGClass` window is sent `WM_USER + CFh`: its client conversations, and through the lists and the server conversations' holding window, theirs (`1e4c`-`1e7d`, `5814`). Each conversation keeps the command in its flags (`5432`-`5446`).
- [[read out]] **Enabling makes the callbacks waiting at once**, inside the call, by sending the instance's window `WM_USER + CCh` (`1eaa`-`1eb4`). Inside a callback it does not: `DMLERR_REENTRANCY` -- though the conversations were already enabled (`1e9a`-`1ea7`).
- [[read out]] A callback's answer of `CBR_BLOCK`, FFFFFFFFh, is passed back as it is, not taken for a data handle (`594c`-`5956`). What DDEML then does with the transaction is on the knowledge base's page of DDEML transactions.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation.
