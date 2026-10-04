//! A window's children and icons arranged: `ArrangeIconicWindows`, and
//! `CascadeChildWindows` and `TileChildWindows`, which arrange any window's
//! children as the MDI client arranges its own.
//!
//! The MDI client itself is not here: its windows' messages are not ported
//! yet.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::system::System;
use crate::windows::Placement;

const SM_CXSIZE: i16 = 30;
const SM_CYSIZE: i16 = 31;
const SM_CXFRAME: i16 = 32;
const SM_CYFRAME: i16 = 33;
const SM_CXICON: i16 = 11;
const SM_CXICONSPACING: i16 = 38;
const SM_CYICONSPACING: i16 = 39;

const WS_THICKFRAME: u32 = 0x0004_0000;

/// `SWP_NOZORDER | SWP_NOACTIVATE`: `MoveWindow`'s.
const MOVED: u16 = 0x0004 | 0x0010;

impl System {
    /// The window a handle names, nought or the desktop's naming none.
    fn arranged(&self, hwnd: u16) -> Option<usize> {
        if hwnd == 0 {
            None
        } else {
            self.window_named(hwnd)
        }
    }

    /// Where the icon in a slot of a parent's -- the screen's for none --
    /// goes: across from the bottom left, as many to a row as the client
    /// area has spacings, half a spacing less half an icon into its slot.
    fn icon_slot(&self, parent: Option<usize>, slot: i32) -> (i32, i32) {
        let icon = self.metric(SM_CXICON);
        let spacing_across = self.metric(SM_CXICONSPACING);
        let spacing_down = self.metric(SM_CYICONSPACING);
        let parent = parent.and_then(|index| self.windows[index].as_ref());
        let (x, y, wide, high) = parent.map_or(
            (
                0,
                0,
                i32::from(self.display.width),
                i32::from(self.display.height),
            ),
            |window| {
                (
                    window.left + window.client.left,
                    window.top + window.client.top,
                    window.client_width(),
                    window.client_height(),
                )
            },
        );
        let across = (wide / spacing_across).max(1);
        let inset = (spacing_across >> 1) - (icon >> 1);

        (
            x + (slot % across) * spacing_across + inset,
            y + high - (slot / across + 1) * spacing_down,
        )
    }

    /// The place of the `i`th step of a cascade in a window's client area,
    /// and the size a sizing child is given there (seg15 `0746`): each a
    /// sizing frame and a size box further, as large as the steps that fit a
    /// third of the client's height leave.
    fn cascade_rect(&self, index: usize, i: i32) -> [i32; 4] {
        let window = self.windows[index].as_ref().expect("a window");
        let height = window.client_height();
        let xs = self.metric(SM_CXFRAME) + self.metric(SM_CXSIZE);
        let ys = self.metric(SM_CYFRAME) + self.metric(SM_CYSIZE);
        let n = (height / (3 * ys)).max(0);
        let k = i % (n + 1);

        [
            k * xs,
            k * ys,
            window.client_width() - n * xs,
            height - n * ys,
        ]
    }

    /// A window's children an arrangement moves, the one at the top first:
    /// those shown, neither minimized nor maximized, that no window owns.
    fn arranged_children(&self, parent: usize) -> Vec<usize> {
        self.z_order
            .iter()
            .copied()
            .filter(|&other| {
                self.windows[other].as_ref().is_some_and(|window| {
                    window.parent == Some(parent)
                        && window.visible
                        && window.placement == Placement::Normal
                        && window.owner.is_none()
                        && window.hwnd != 0
                })
            })
            .collect()
    }
}

/// A window's icons put in their slots again, from the one at the top, a
/// place set for any of them forgotten; answers how many (`userwin`: 0, 1,
/// 2 -- of two, the one minimized last, above, takes the first slot).
pub(super) fn arrange_iconic_windows(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    if system.driver.is_none() {
        return Ok(Answer::Word(0));
    }

    let parent = system.arranged(hwnd);
    let icons: Vec<usize> = system
        .z_order
        .iter()
        .copied()
        .filter(|&other| {
            system.windows[other].as_ref().is_some_and(|window| {
                window.parent == parent
                    && window.visible
                    && window.placement == Placement::Minimized
                    && window.title_of.is_none()
            })
        })
        .collect();

    for (slot, &icon) in icons.iter().enumerate() {
        let (left, top) = system.icon_slot(parent, slot as i32);
        let window = system.windows[icon].as_mut().expect("a window");
        let (width, height) = (window.width, window.height);

        window.icon_place = None;
        system.place_window(icon, left, top, width, height)?;
    }

    Ok(Answer::Word(icons.len() as u16))
}

/// The children of any window, cascaded as the MDI client cascades its
/// own: `CascadeChildWindows`, which USER exports and does not document.
/// **Recorded** by `userwin`, in a plain window 400 by 300 with three, four
/// and five children and one 560 by 420 with three: the child at the
/// bottom at the corner, each a sizing frame and a size box further, all as
/// large as the steps that fit a third of the client's height leave (seg15
/// `0875`).
pub(super) fn cascade_child_windows(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let moves = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let _how = args.word(&system);
            let Some(parent) = system.arranged(hwnd) else {
                return Ok(Answer::Nothing);
            };
            let mut children = system.arranged_children(parent);

            children.reverse();
            children
                .into_iter()
                .enumerate()
                .map(|(i, child)| {
                    let [x, y, cx, cy] = system.cascade_rect(parent, i as i32);
                    let window = system.windows[child].as_ref().expect("a window");
                    let (cx, cy) = if window.style & WS_THICKFRAME == 0 {
                        (window.width, window.height)
                    } else {
                        (cx, cy)
                    };

                    (window.hwnd, [x, y, cx, cy])
                })
                .collect::<Vec<_>>()
        };

        move_each(engine, moves).await?;
        Ok(Answer::Nothing)
    })
}

/// The children of any window, tiled as the MDI client tiles its own:
/// `TileChildWindows`. **Recorded** by `userwin` with the cascade: three
/// children in three columns, four in two rows of two, five in two columns
/// of two and three, the child at the top first (seg15 `0956`). With
/// `MDITILE_HORIZONTAL` the columns and rows are the other way about.
pub(super) fn tile_child_windows(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let moves = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let how = args.word(&system);
            let Some(parent) = system.arranged(hwnd) else {
                return Ok(Answer::Nothing);
            };
            let children = system.arranged_children(parent);
            let window = system.windows[parent].as_ref().expect("a window");

            tiles(
                children.len() as i32,
                how,
                window.client_width(),
                window.client_height(),
            )
            .into_iter()
            .zip(children)
            .map(|(place, child)| {
                let hwnd = system.windows[child].as_ref().expect("a window").hwnd;

                (hwnd, place)
            })
            .collect::<Vec<_>>()
        };

        move_each(engine, moves).await?;
        Ok(Answer::Nothing)
    })
}

/// Where `n` children tile a client area, the first given first: rows and
/// columns, the last columns a row longer (seg15 `0956`). None in an area
/// of no size.
fn tiles(n: i32, how: u16, width: i32, height: i32) -> Vec<[i32; 4]> {
    let mut places = Vec::new();

    if n == 0 || width <= 0 || height <= 0 {
        return places;
    }

    let mut b = 2;

    while b * b <= n {
        b += 1;
    }

    let (cols, mut rows) = if how & 1 != 0 {
        (b - 1, n / (b - 1))
    } else {
        (n / (b - 1), b - 1)
    };
    let mut extra = n % (b - 1);

    for col in 0..cols {
        let more = cols - col <= extra;

        if more {
            rows += 1;
        }

        let mut row = 0;

        while row < rows && (places.len() as i32) < n {
            let w = width / cols;
            let h = height / rows;

            places.push([col * w, row * h, w, h]);
            row += 1;
        }

        if more {
            rows -= 1;
            extra -= 1;
        }
    }

    places
}

/// Each window moved as `MoveWindow` moves it, in turn.
async fn move_each(engine: &Engine, moves: Vec<(u16, [i32; 4])>) -> Result<(), Stop> {
    for (hwnd, [x, y, cx, cy]) in moves {
        let Some(index) = engine.system().window_named(hwnd) else {
            continue;
        };

        engine
            .position_raster(
                hwnd, index, 0, x as i16, y as i16, cx as i16, cy as i16, MOVED,
            )
            .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::tiles;

    #[test]
    fn tiles_as_userwin_recorded() {
        // Three in three columns.
        assert_eq!(
            tiles(3, 0, 390, 270),
            [[0, 0, 130, 270], [130, 0, 130, 270], [260, 0, 130, 270]]
        );
        // Four in two rows of two.
        assert_eq!(tiles(4, 0, 400, 300).len(), 4);
        assert_eq!(tiles(4, 0, 400, 300)[1], [0, 150, 200, 150]);
        // Five in two columns of two and three.
        let five = tiles(5, 0, 400, 300);

        assert_eq!(five[1], [0, 150, 200, 150]);
        assert_eq!(five[2], [200, 0, 200, 100]);
        assert!(tiles(0, 0, 400, 300).is_empty());
    }
}
