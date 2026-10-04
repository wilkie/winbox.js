//! Where the cursor is on the screen. Moving it moves nothing on the host's
//! own pointer; it is where the next message not the mouse's own is said
//! to have come from.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Stop};
use crate::handles::Object;
use crate::queue::WM_MOUSEMOVE;
use crate::system::System;

impl System {
    /// Where the cursor is: where it was last put, or the middle of the
    /// screen, where the mouse driver's reset leaves it.
    pub fn cursor_of(&self) -> (i16, i16) {
        self.cursor_pos
            .unwrap_or((self.display.width >> 1, self.display.height >> 1))
    }

    /// Where the cursor may be: the rectangle `ClipCursor` gave, as it gave
    /// it, or the screen. The rectangle takes the screen's place, a part off
    /// the screen included (`cursclip`).
    fn cursor_bounds(&self) -> [i16; 4] {
        self.cursor_clip
            .unwrap_or([0, 0, self.display.width, self.display.height])
    }

    /// A place for the cursor held inside its bounds, their right and
    /// bottom outside, the left and top taken first: a rectangle whose right
    /// comes before its left holds it at its right less one (`cursclip`).
    fn held_in(&self, (x, y): (i16, i16)) -> (i16, i16) {
        let [left, top, right, bottom] = self.cursor_bounds().map(i32::from);

        (
            (i32::from(x).max(left)).min(right - 1) as i16,
            (i32::from(y).max(top)).min(bottom - 1) as i16,
        )
    }

    /// The cursor put somewhere, and a mouse move where it now is.
    fn put_cursor(&mut self, at: (i16, i16)) -> Result<(), Stop> {
        let held = self.held_in(at);

        self.cursor_pos = Some(held);
        self.nudge()
    }

    /// A mouse move USER makes of its own accord, where the cursor is:
    /// after a window is shown or moves, and after `SetCursorPos`.
    /// **Recorded** by `mousemv`: the window under the cursor is sent
    /// `WM_MOUSEMOVE` at that point, and with no window there the desktop
    /// is. No window is shown here yet, so the desktop is.
    pub fn nudge(&mut self) -> Result<(), Stop> {
        if self.windows.iter().flatten().any(|window| window.visible) {
            return Err(Stop::Unsupported("the mouse over a window"));
        }

        let Some(desktop) = self.handles.lookup(Object::Desktop) else {
            return Ok(());
        };
        let (x, y) = self.cursor_of();
        let point = u32::from(y as u16) << 16 | u32::from(x as u16);

        self.post_message(desktop, WM_MOUSEMOVE, 0, point);
        Ok(())
    }
}

/// The cursor put at a place on the screen, held inside its bounds.
pub fn set_cursor_pos(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let x = args.word(system) as i16;
    let y = args.word(system) as i16;

    system.put_cursor((x, y))?;
    Ok(Answer::Nothing)
}

/// The cursor's place on the screen, into a point the program gives.
pub fn get_cursor_pos(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let (x, y) = system.cursor_of();
    let mut bytes = Vec::with_capacity(4);

    bytes.extend_from_slice(&x.to_le_bytes());
    bytes.extend_from_slice(&y.to_le_bytes());
    system.write_far(far, &bytes);
    Ok(Answer::Nothing)
}

/// The cursor held inside a rectangle, or let go with none; moved into it
/// where it is outside.
pub fn clip_cursor(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    system.cursor_clip = (far != 0).then(|| {
        let bytes = system.read_far(far, 8);

        [0, 2, 4, 6].map(|at| i16::from_le_bytes([bytes[at], bytes[at + 1]]))
    });

    let cursor = system.cursor_of();
    let held = system.held_in(cursor);

    if held != cursor {
        system.put_cursor(held)?;
    }

    Ok(Answer::Nothing)
}

/// The rectangle the cursor is held in: the screen, where none was given.
pub fn get_clip_cursor(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    if far != 0 {
        let bytes: Vec<u8> = system
            .cursor_bounds()
            .iter()
            .flat_map(|side| side.to_le_bytes())
            .collect();

        system.write_far(far, &bytes);
    }

    Ok(Answer::Nothing)
}
