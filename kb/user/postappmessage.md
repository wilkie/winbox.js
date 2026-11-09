---
kind: function
module: USER
name: PostAppMessage
ordinal: 116
summary: A message posted to a task's own queue, with no window.
versions:
  '3.1': exact
probes: [thswch]
records: [set, child]
source: crates/winbox-win16/src/queue.rs
---

## Observed behaviour

- [[read out]] `USER.EXE` seg1 `a7e8`-`a7f6`: the task checked as a handle (`aeb6`), then USER's post (`23a0`) with the queue `GetTaskQueue` gives for it (`23c3`), not the queue of the task posting.
- [[measured]] [[probe:thswch]]: a program waiting in `GetMessage` is woken by a message posted to its task, and goes on.

## Implementation

`crates/winbox-win16/src/queue.rs` (`post_app_message`).
