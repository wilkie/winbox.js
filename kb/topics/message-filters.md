---
kind: topic
name: Message filters
summary: Which messages GetMessage and PeekMessage take when asked for one window's or a range of them — a window's children included, a range turned inside out, the quit let through — as a probe recorded them.
probes: [getmsg]
---

[[fn:USER.GetMessage]] and [[fn:USER.PeekMessage]] each take a window and a range of messages, and give only messages that match both. [[probe:getmsg]] posts messages to a window A, its child C and another window B, and takes them with filters of each kind. winbox.js runs the probe whole, and all 17 of its records agree.

- [[measured]] A window's filter takes its children's messages too, in the order they were posted. Asked for A's, `GetMessage` took C's message first, because it was posted first.
- [[measured]] A range takes both its ends. A window and a range together take only messages that match both.
- [[measured]] A range whose first is past its last takes the messages outside it, both ends excluded. With first 3 and last 1 above `WM_USER`, it took `WM_USER + 10` and `+ 11`, and left `+ 1`, `+ 2` and `+ 3`.
- [[measured]] `WM_QUIT` passes every filter: a range it is outside, and a window, although it belongs to none. `PM_NOREMOVE` leaves it waiting.
- Not yet measured: a grandchild's messages under a window's filter (winbox.js takes them, as `IsChild` counts it), and paints and timers under a filter.

## In winbox.js

`nextMessage` in `src/win16/user/queue.ts` applies the filter to posted messages, paints and timers. A `GetMessage` with a filter has nothing it can take yet. It waits for any message to arrive, a timer to fall due, or a paint to be due, and then looks again.

Before this, `PeekMessage` kept to a window but not its children, and `GetMessage` took any message at all.
