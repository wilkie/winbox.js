---
kind: function
module: DDEML
name: DdePostAdvise
ordinal: 13
summary: Tells DDEML that a server's item has changed, so that every advise link on it is served — hot links with the data the server's XTYP_ADVREQ callback gives, warm links with a notice only.
versions:
  '3.1': exact
probes: [ddexact]
source: src/win16/ddeml/xact.ts
topics: [ddeml-transactions]
---

## Observed behaviour

- [[measured]] It answers 1, whether or not any link is on the item.
- [[measured]] For each hot link the server's callback is handed `XTYP_ADVREQ` with the link's format, and the client's `XTYP_ADVDATA` what it answered. A warm link brings no `XTYP_ADVREQ`, and the client's `XTYP_ADVDATA` has no data.
- [[measured]] Two links on one item in two formats are served newest first.
- [[measured]] A link that asked for acknowledgement and has not had it yet is not sent again at once: two calls in a row bring one `XTYP_ADVREQ` with `dwData1` nought, and when the client's acknowledgement comes, a second with FFFFh (`CADV_LATEACK`).
- [[measured]] Called inside the server's own `XTYP_REQUEST` callback, it serves the link and answers 1.

## Nuances

- [[read out]] `APPCMD_CLIENTONLY` instances are refused with `DMLERR_DLL_USAGE` (`DDEML.DLL` seg1 `1144`). A bad instance identifier answers nought with no error (`1125`-`113c`).
- [[read out]] `XTYP_ADVREQ` is called directly, not queued, so it runs inside the call and `CBR_BLOCK` means nothing to it (`3e64`).
- [[read out]] `dwData1`'s low word counts the later links with the same window, topic, item and format; links are kept once each, so it is nought except for `CADV_LATEACK` (`25ae`, `261a`).
- [[read out]] What the server answers is sent in its own format whatever the link's; [[measured]] the client was handed `CF_TEXT` for its `CF_OEMTEXT` link.
- [[read out]] A link with `fAckReq` sends the data with `fAckReq` in its header, copying the application's own block first (`3ef6`-`3f4c`).

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `1118` walks the instance's links (`26ea`, `2720`), marks a link awaiting acknowledgement (`1191`), posts a warm link's `WM_DDE_DATA` with no block (`11a0`-`11c6`), and sends a hot link through `3e64`.

## Implementation

WinBox's own: `postAdvise` in `src/win16/ddeml/xact.ts` and `post_advise` in `crates/winbox-win16/src/ddeml/xact.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It walks the instance's links as `2720` walks them; a hot link is asked `XTYP_ADVREQ` at once (`adviseRequest`, `advise_request`, seg1 `3e64`). Both engines agree with [[probe:ddexact]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
