//! An edit control's memory in the program's own local heap, as winbox.js's
//! `edit-buffer.ts` keeps it.
//!
//! **Read out of `USER.EXE`**: the edit control runs with DS set to the
//! instance handle it was made with, so what it allocates is in that
//! instance's local heap -- a program's, or a library's (seg1 `27a7`). At
//! `WM_NCCREATE` it takes its own data, 62h bytes (`LMEM_ZEROINIT`); a
//! multi-line one a table of widths, 200h bytes; and the text, a moveable
//! block of 20h noughts (seg27 `0056`, `0114`). A multi-line one's line
//! starts follow at `WM_CREATE`, four bytes (seg31 `010d`). All of it is
//! freed at `WM_NCDESTROY`, the text by whichever handle it has then (seg27
//! `01d6`).
//!
//! A multi-line control hands its text out with `EM_GETHANDLE`, null ended
//! (seg30 `247c`), and takes another with `EM_SETHANDLE`, whose text is
//! read to its null and whose block is sized to the text and 20h more; the
//! old block is not freed (seg32 `018f`). Notepad reads a file this way: it
//! grows the handle it was given, reads into it and gives it back.
//!
//! Not followed, as the TypeScript engine does not follow it: USER keeps
//! the text in the block all the time, growing it by what is typed and
//! 20h, and shrinking it to the text and 10h when more than 20h is spare
//! (seg26 `05c4`, `0841`). Here the text is written to the block when it is
//! handed out, the block grown then to the text and 20h if it is too small;
//! the line starts' block keeps its first size; and a dialog's edit control
//! without `DS_LOCALEDIT`, whose heap USER makes in a block of its own
//! (seg24 `0337`), keeps no block at all.

use winbox_machine::{LocalOptions, index_for, segment_selector};

use crate::handles::Object;
use crate::system::System;

const EDIT_DATA: u32 = 0x62;
const WIDTHS: u32 = 0x200;
const TEXT: u32 = 0x20;
const LINE_STARTS: u32 = 4;

/// An edit control's blocks, and the selector of the segment whose heap
/// they are in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditBuffer {
    pub selector: u16,
    pub data: u32,
    pub widths: u32,
    pub text: u32,
    pub lines: u32,
}

impl System {
    /// The data segment an instance handle stands for: a program's or a
    /// library's; nought for none.
    pub(crate) fn instance_selector(&self, instance: u16) -> u16 {
        let module = match self.handles.resolve(instance) {
            Some(Object::Task(program)) => Some(program),
            Some(Object::Library(module)) => Some(module),
            _ => None,
        };

        module
            .and_then(|module| self.modules[module].data())
            .map_or(0, segment_selector)
    }

    /// Takes an edit control's memory in its instance's heap, where it has
    /// one.
    pub(crate) fn create_edit_buffer(&mut self, index: usize, instance: u16, multiline: bool) {
        let selector = self.instance_selector(instance);

        if selector == 0 {
            return;
        }

        let segment = index_for(selector);
        let Some(heap) = self.heaps.get_mut(&segment) else {
            return;
        };
        let memory = &mut self.cpu.bus;
        let fixed = LocalOptions {
            movable: false,
            zero_init: true,
        };
        let movable = LocalOptions {
            movable: true,
            zero_init: true,
        };
        let data = heap.allocate(memory, EDIT_DATA, fixed).unwrap_or(0);
        let widths = if multiline {
            heap.allocate(memory, WIDTHS, movable).unwrap_or(0)
        } else {
            0
        };
        let text = heap.allocate(memory, TEXT, movable).unwrap_or(0);
        let lines = if multiline {
            heap.allocate(memory, LINE_STARTS, fixed).unwrap_or(0)
        } else {
            0
        };

        self.follow_growth(segment);
        self.control_at(index).buffer = Some(EditBuffer {
            selector,
            data,
            widths,
            text,
            lines,
        });
    }

    /// Frees an edit control's memory.
    pub(crate) fn free_edit_buffer(&mut self, index: usize) {
        let Some(buffer) = self.control_at(index).buffer.take() else {
            return;
        };
        let Some(heap) = self.heaps.get_mut(&index_for(buffer.selector)) else {
            return;
        };

        for block in [buffer.text, buffer.lines, buffer.widths, buffer.data] {
            if block != 0 && heap.size_of(block) != 0 {
                heap.free(block);
            }
        }
    }

    /// `EM_GETHANDLE`: the text written to its block and ended with a
    /// nought.
    pub(crate) fn text_handle(&mut self, index: usize) -> u16 {
        let text = self.edit_text(index);
        let Some(buffer) = self.control_at(index).buffer else {
            return 0;
        };
        let segment = index_for(buffer.selector);
        let Some(heap) = self.heaps.get_mut(&segment) else {
            return 0;
        };

        if buffer.text == 0 {
            return 0;
        }

        if heap.size_of(buffer.text) <= text.len() as u32 {
            heap.reallocate(
                &mut self.cpu.bus,
                buffer.text,
                text.len() as u32 + TEXT,
                true,
                false,
            );
        }

        let at = heap.resolve(buffer.text);

        self.follow_growth(segment);

        let mut bytes = text;

        bytes.push(0);

        for (step, byte) in bytes.iter().enumerate() {
            let offset = (at + step as u32) & 0xffff;

            self.write_far(u32::from(buffer.selector) << 16 | offset, &[*byte]);
        }

        buffer.text as u16
    }

    /// The text written to its block, as `text_handle` writes it, and where
    /// the block is: the far pointer USER passes a word-break procedure,
    /// the block locked in its heap (seg26 `0370`). Nought where the
    /// control keeps none.
    pub(crate) fn text_pointer(&mut self, index: usize) -> u32 {
        let handle = self.text_handle(index);
        let Some(buffer) = self.control_at(index).buffer else {
            return 0;
        };
        let Some(heap) = self.heaps.get(&index_for(buffer.selector)) else {
            return 0;
        };

        if handle == 0 {
            return 0;
        }

        u32::from(buffer.selector) << 16 | heap.resolve(u32::from(handle)) & 0xffff
    }

    /// `EM_SETHANDLE`: the block taken as the text, read to its nought, and
    /// sized to it and 20h more. Answers the text.
    pub(crate) fn adopt_handle(&mut self, index: usize, handle: u16) -> Option<Vec<u8>> {
        let mut buffer = self.control_at(index).buffer?;
        let segment = index_for(buffer.selector);
        let heap = self.heaps.get(&segment)?;

        buffer.text = u32::from(handle);

        let size = heap.size_of(u32::from(handle));
        let at = heap.resolve(u32::from(handle));
        let mut text = Vec::new();

        for step in 0..size {
            let offset = (at + step) & 0xffff;
            let byte = self.read_far(u32::from(buffer.selector) << 16 | offset, 1)[0];

            if byte == 0 {
                break;
            }

            text.push(byte);
        }

        if let Some(heap) = self.heaps.get_mut(&segment) {
            heap.reallocate(
                &mut self.cpu.bus,
                u32::from(handle),
                text.len() as u32 + TEXT,
                false,
                false,
            );
        }

        self.follow_growth(segment);
        self.control_at(index).buffer = Some(buffer);
        Some(text)
    }
}
