//! What an edit control keeps to undo, for both kinds of control --
//! winbox.js's `edit-undo.ts` -- read out of `USER.EXE`'s shared edit code
//! (segment 26) and **recorded** by `editundo` in a single-line control, a
//! multi-line one that scrolls down and one that does not.
//!
//! The control keeps one record (seg26, the control's data from 3Ch):
//!
//! * what kind it is: nothing, an insertion (1), a deletion (2) or both (3);
//! * the text taken out, in a global block, where it was and how long;
//! * where the text put in starts and ends.
//!
//! The control's own insertion (seg26 `05c4`) and deletion (`0841`) keep it
//! as they change the text. Setting the text, `EM_REPLACESEL` and
//! `EM_EMPTYUNDOBUFFER` throw it away, and so does `EM_SETHANDLE`. Moving
//! the caret or the selection does not.
//!
//! Throwing it away (`059f`) clears its kind and frees the text taken out,
//! and leaves where that was: an undo afterwards of an insertion alone
//! moves a single-line control's caret back there (seg29 `0277`).
//! **Recorded**: "abcdef", a deletion at 1, the text set again and "XY"
//! typed at its end, then undone, leaves the caret at 1.

pub const UNDO_INSERT: u8 = 1;
pub const UNDO_DELETE: u8 = 2;

/// The record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Undo {
    /// 0 nothing, 1 an insertion, 2 a deletion, 3 both.
    pub kind: u8,
    /// The text taken out, or none.
    pub deleted: Option<Vec<u8>>,
    pub ich_deleted: i32,
    pub cch_deleted: i32,
    pub ins_start: i32,
    pub ins_end: i32,
}

/// Nothing to undo, made with its places at -1 (seg27 `01a3`).
impl Default for Undo {
    fn default() -> Self {
        Self {
            kind: 0,
            deleted: None,
            ich_deleted: -1,
            cch_deleted: 0,
            ins_start: -1,
            ins_end: -1,
        }
    }
}

/// The record taken for an undo (seg29 `0201`, seg32 `0477`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Taken {
    pub deleted: Option<Vec<u8>>,
    pub had_delete: bool,
    pub ich_deleted: i32,
    pub cch_deleted: i32,
    /// Whether what remained was an insertion alone, now made nothing.
    pub inserted: bool,
    pub ins_start: i32,
    pub ins_end: i32,
}

impl Undo {
    /// Thrown away (seg26 `059f`): the kind cleared and the text taken out
    /// let go, its place kept.
    pub fn empty(&mut self) {
        self.kind = 0;
        self.deleted = None;
    }

    /// Whether there is anything to undo (`EM_CANUNDO`, seg26 `0e85`).
    pub fn can_undo(&self) -> bool {
        self.kind != 0
    }

    /// `count` characters put in at `caret` (seg26 `0794`-`0822`). With
    /// nothing kept, it is an insertion. Straight after the last insertion
    /// it makes that longer: a run typed is undone whole. Anywhere else it
    /// starts again, keeping the text taken out only where it was taken
    /// from this very place, as when typing over a selection: then it is
    /// both.
    pub fn note_insert(&mut self, caret: i32, count: i32) {
        if count <= 0 {
            return;
        }

        if self.kind == 0 {
            self.kind = UNDO_INSERT;
            self.ins_start = caret;
            self.ins_end = caret + count;
            return;
        }

        if self.kind & UNDO_INSERT != 0 && self.ins_end == caret {
            self.ins_end += count;
            return;
        }

        if self.kind & UNDO_INSERT == 0 && self.kind != UNDO_DELETE {
            return;
        }

        if self.ich_deleted != caret {
            self.deleted = None;
            self.ich_deleted = -1;
            self.kind &= !UNDO_DELETE;
        }

        self.ins_start = caret;
        self.ins_end = caret + count;
        self.kind |= UNDO_INSERT;
    }

    /// `start` to `end` of `text` taken out (seg26 `0861`-`09a3`). A
    /// deletion alone kept grows by one that ends where it was taken, put
    /// before it -- backspaces in a run -- or that starts there, put after
    /// it -- Deletes. Anything else, or anything kept with an insertion, is
    /// let go, and this is kept on its own.
    pub fn note_delete(&mut self, text: &[u8], start: i32, end: i32) {
        if end <= start {
            return;
        }

        let taken = crate::edit::slice(text, start, end).to_vec();

        if self.kind == UNDO_DELETE
            && let Some(deleted) = self.deleted.as_mut()
        {
            if self.ich_deleted == end {
                let mut joined = taken.clone();

                joined.extend_from_slice(deleted);
                *deleted = joined;
                self.ich_deleted = start;
                self.cch_deleted += taken.len() as i32;
                return;
            }

            if self.ich_deleted == start {
                deleted.extend_from_slice(&taken);
                self.cch_deleted += taken.len() as i32;
                return;
            }
        }

        if self.kind != 0 {
            *self = Self {
                ich_deleted: -1,
                ..Self::default()
            };
        }

        self.kind = UNDO_DELETE;
        self.ich_deleted = start;
        self.cch_deleted = taken.len() as i32;
        self.deleted = Some(taken);
    }

    /// Before a multi-line control that neither scrolls down nor has a
    /// scroll bar down puts text in (seg30 `06d1`-`071d`): an insertion or
    /// a deletion kept alone is let go and every place made nought, so it
    /// keeps only what this puts in. Such a control undoes a character at a
    /// time, and typing over a selection undoes only what was typed.
    /// **Recorded** by `editundo` in such a control: "abc" typed, undone,
    /// leaves "ab".
    pub fn forget_before_insert(&mut self) {
        if self.kind == UNDO_INSERT || self.kind == UNDO_DELETE {
            *self = Self {
                kind: 0,
                deleted: None,
                ich_deleted: 0,
                cch_deleted: 0,
                ins_start: 0,
                ins_end: 0,
            };
        }
    }

    /// The record taken for an undo (seg29 `0201`, seg32 `0477`): what was
    /// taken out and where, and whether there was any, cleared from the
    /// control's; and whether what remains is an insertion alone, made
    /// nothing.
    pub fn take(&mut self) -> Taken {
        let mut taken = Taken {
            deleted: self.deleted.take(),
            had_delete: self.kind & UNDO_DELETE != 0,
            ich_deleted: self.ich_deleted,
            cch_deleted: self.cch_deleted,
            inserted: false,
            ins_start: self.ins_start,
            ins_end: self.ins_end,
        };

        self.cch_deleted = 0;
        self.ich_deleted = -1;
        self.kind &= !UNDO_DELETE;

        if self.kind == UNDO_INSERT {
            self.kind = 0;
            taken.inserted = true;
        }

        taken
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_run_typed_is_one_insertion() {
        let mut undo = Undo::default();

        undo.note_insert(0, 1);
        undo.note_insert(1, 1);
        undo.note_insert(2, 1);
        assert_eq!((undo.kind, undo.ins_start, undo.ins_end), (1, 0, 3));
    }

    #[test]
    fn backspaces_put_what_they_take_before() {
        let mut undo = Undo::default();
        let text = b"Hello there world";

        undo.note_delete(text, 10, 11);
        undo.note_delete(text, 9, 10);
        assert_eq!(undo.deleted.as_deref(), Some(&b"re"[..]));
        assert_eq!((undo.ich_deleted, undo.cch_deleted), (9, 2));
    }

    #[test]
    fn typing_over_a_selection_keeps_both() {
        let mut undo = Undo::default();

        undo.note_delete(b"Hello", 0, 5);
        undo.note_insert(0, 1);
        assert_eq!(undo.kind, 3);
        assert_eq!(undo.deleted.as_deref(), Some(&b"Hello"[..]));
    }

    #[test]
    fn emptied_keeps_where_the_deletion_was() {
        let mut undo = Undo::default();

        undo.note_delete(b"abc", 1, 2);
        undo.empty();
        assert!(!undo.can_undo());
        assert_eq!(undo.ich_deleted, 1);
    }
}
