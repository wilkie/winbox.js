//! Where the TypeScript engine's mapper may answer with an outline.
//!
//! This engine loads no outline, and answers with a strike wherever the
//! TypeScript engine's mapper puts a question to one (see `map`). That is
//! the same answer only where none of those questions could have found
//! one. What is drawn or measured in a font that an outline may have
//! answered is not known here, and the calls that would tell a program
//! stop rather than tell it something else.

use super::{
    FACE_PENALTY, FontManager, OEM_CHARSET, Request, SYMBOL_CHARSET, has_extension, substitute,
};

impl FontManager {
    /// Whether an installed outline may have answered a request in the
    /// TypeScript engine: wherever its `map` asks for an outline, or runs
    /// the competition, whose second walk is over the outlines -- a symbol
    /// set, no name, a name that is an outline's family, a name not
    /// installed, a name whose strikes the character set refuses, and a
    /// strike that costs more than a wrong name. Asked without regard to
    /// whether the outline would have won, so it may say yes where the
    /// answer would have been a strike after all; never no where it would
    /// not.
    pub fn outline_may_answer(&self, request: &Request) -> bool {
        let installed = self
            .true_type_directory
            .iter()
            .any(|resource| has_extension(&resource.file, "ttf"));

        if !installed {
            return false;
        }

        let charset = request.charset;

        if charset == SYMBOL_CHARSET {
            return true;
        }

        let face = if charset == OEM_CHARSET && !self.is_oem(&request.face) {
            "Roman".to_string()
        } else if request.face.is_empty() {
            return true;
        } else {
            request.face.clone()
        };
        let wanted = substitute(&face).unwrap_or(&face).to_lowercase();
        let named = self.true_type_directory.iter().any(|resource| {
            resource.family.to_lowercase() == wanted || resource.full_name.to_lowercase() == wanted
        });

        if named {
            return true;
        }

        let Some((_, strikes)) = self.lookup(&face) else {
            return true;
        };
        let entries: Vec<_> = strikes
            .iter()
            .filter(|strike| {
                charset == OEM_CHARSET || i32::from(strike.entry.header.char_set) != OEM_CHARSET
            })
            .map(|strike| strike.entry.clone())
            .collect();

        if entries.is_empty() {
            return true;
        }

        Self::choose(&entries, request).is_none_or(|chosen| chosen.cost > FACE_PENALTY)
    }
}
