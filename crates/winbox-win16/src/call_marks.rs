//! Things done at set places in a run, each named by the instructions the
//! program has run by then: a key pressed, or the screen kept. The
//! TypeScript engine's corpus survey presses a program's keys and takes its
//! screens between its frames, which may come between two of the program's
//! calls, and notes where -- the instructions run, the calls made and the
//! clock's time -- so a run here can do the same at the same place
//! (`examples/corpus.rs`); the two engines' instructions agree call for
//! call.

use std::collections::VecDeque;

use crate::key_input::Key;
use crate::system::System;

/// What is done at a mark.
#[derive(Debug, Clone)]
pub enum MarkAction {
    /// A key pressed (`true`) or let go, its message timed as the other
    /// engine's was.
    Key { down: bool, key: Key, time: u32 },
    /// The screen's pixels kept, as they are.
    Shot,
}

/// A thing to do once the program has run `instructions`, before it runs
/// the next.
#[derive(Debug, Clone)]
pub struct CallMark {
    pub instructions: u64,
    /// The calls made by then, as the other engine counted them.
    pub calls: usize,
    /// The clock's time there, in milliseconds: while the program waits
    /// with no call to make, the mark comes when the time does.
    pub time: f64,
    pub action: MarkAction,
}

/// The marks still to come, and the screens kept so far.
#[derive(Debug, Clone, Default)]
pub struct CallMarks {
    pub marks: VecDeque<CallMark>,
    /// The screen's palette indices at each `Shot`.
    pub shots: Vec<Vec<u8>>,
}

impl System {
    /// What is due by the instructions run so far and the clock's time,
    /// done in order: a mark comes as the program runs to its instruction,
    /// or, where the program waits there, as time passes to the mark's
    /// time. Whether any was.
    pub(crate) fn take_call_marks(&mut self) -> bool {
        let now = self.clock.now(self.instructions);
        let instructions = self.instructions;
        let mut taken = false;

        while self
            .call_marks
            .marks
            .front()
            .is_some_and(|mark| mark.instructions <= instructions && mark.time <= now)
        {
            taken = true;

            let Some(mark) = self.call_marks.marks.pop_front() else {
                break;
            };

            match mark.action {
                MarkAction::Key { down, key, time } => {
                    self.message_time = Some(time);
                    self.key_event(down, &key);
                    self.message_time = None;
                }
                MarkAction::Shot => {
                    let indices = self.screen_bitmap().indices.borrow().clone();

                    self.call_marks.shots.push(indices);
                }
            }
        }

        taken
    }

    /// How many instructions the program may run before the next mark is
    /// due; none where there is none, or where it comes only once time has
    /// passed to it, the program waiting at its instruction.
    pub(crate) fn until_mark(&self) -> Option<u64> {
        let mark = self.call_marks.marks.front()?;
        let left = mark.instructions.saturating_sub(self.instructions);

        (left > 0 || mark.time <= self.clock.now(self.instructions)).then_some(left)
    }

    /// Palette indices of the screen's as a host shows them now, the cursor
    /// over them: as the TypeScript engine's survey shows each screen it
    /// kept, with the cursor and the colours as the run ended.
    pub fn shown_indices(&mut self, indices: &[u8]) -> (usize, usize, Vec<u32>) {
        let screen = self.screen_bitmap();
        let (width, height) = (screen.width() as usize, screen.height() as usize);
        let indices = self.with_cursor(indices, width, height);

        (width, height, self.coloured(&screen, &indices))
    }
}
