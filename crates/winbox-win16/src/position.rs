//! A window moved, sized, shown, hidden or brought forward on the raster
//! desktop, as winbox.js's `positionRaster` does it: what `SetWindowPos`
//! does, and `MoveWindow` and `BringWindowToTop` through it; and the active
//! window asked for and set (`placement.ts`).
//!
//! A child's place is in its parent's client area, as a program gives it.
//! It is done in two halves (`defer`): `WM_WINDOWPOSCHANGING`, and
//! `WM_NCCALCSIZE` when a size is given; then the window is placed, and
//! `WM_WINDOWPOSCHANGED` follows when its place, size or showing changed,
//! from which `DefWindowProc` sends `WM_MOVE` and `WM_SIZE`. Where it goes
//! in the order of windows, and what it keeps of its bits as it moves, is
//! `moved.rs`'s.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::messages::{Param, WM_NCCALCSIZE};
use crate::moved::{Insert, Kept};
use crate::system::System;
use crate::windows::Placement;

const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOMOVE: u16 = 0x0002;
pub(crate) const SWP_NOZORDER: u16 = 0x0004;
pub(crate) const SWP_NOACTIVATE: u16 = 0x0010;
const SWP_SHOWWINDOW: u16 = 0x0040;
const SWP_HIDEWINDOW: u16 = 0x0080;
const SWP_NOCOPYBITS: u16 = 0x0100;
const SWP_FRAMECHANGED: u16 = 0x0020;
const SWP_NOCLIENTSIZE: u16 = 0x0800;
const SWP_NOCLIENTMOVE: u16 = 0x1000;

const WM_WINDOWPOSCHANGING: u16 = 0x0046;
const WM_WINDOWPOSCHANGED: u16 = 0x0047;

const WS_POPUP: u32 = 0x8000_0000;
const WS_CHILD: u32 = 0x4000_0000;
const WS_MINIMIZE: u32 = 0x2000_0000;
const WS_CAPTION: u32 = 0x00c0_0000;
const WS_SYSMENU: u32 = 0x0008_0000;
const WS_THICKFRAME: u32 = 0x0004_0000;
const WS_MINIMIZEBOX: u32 = 0x0002_0000;
const WS_MAXIMIZEBOX: u32 = 0x0001_0000;

const SM_CXBORDER: i16 = 5;
const SM_CYBORDER: i16 = 6;
const SM_CXSIZE: i16 = 30;
const SM_CXFRAME: i16 = 32;
const SM_CYFRAME: i16 = 33;

const WM_GETMINMAXINFO: u16 = 0x0024;
const OBM_CLOSE: u16 = 32754;

/// The five points of a `MINMAXINFO`: `ptReserved`, `ptMaxSize`,
/// `ptMaxPosition`, `ptMinTrackSize`, `ptMaxTrackSize`.
pub(crate) type MinMax = [(i32, i32); 5];

/// A `MINMAXINFO`'s points, from its bytes.
fn min_max_points(bytes: &[u8]) -> MinMax {
    let word = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));

    std::array::from_fn(|point| (word(point * 4), word(point * 4 + 2)))
}

/// `SWP_NOCLIENTSIZE` and `SWP_NOCLIENTMOVE`, as a client area was and is
/// (seg7 `0fcf`, `0fe6`).
pub(crate) fn client_flags(was: [i32; 4], now: [i32; 4]) -> u16 {
    (if now[2] - now[0] == was[2] - was[0] && now[3] - now[1] == was[3] - was[1] {
        SWP_NOCLIENTSIZE
    } else {
        0
    }) | if now[..2] == was[..2] {
        SWP_NOCLIENTMOVE
    } else {
        0
    }
}

/// A `WINDOWPOS`, as it is laid out: seven words.
fn window_pos(hwnd: u16, after: u16, place: [i32; 4], flags: u16) -> Vec<u8> {
    [hwnd, after]
        .into_iter()
        .chain(place.map(|value| value as u16))
        .chain(std::iter::once(flags))
        .flat_map(u16::to_le_bytes)
        .collect()
}

impl System {
    /// What a window answered `WM_GETMINMAXINFO`, held to what USER allows
    /// (`USER.EXE` seg6 `19a8`; `minmax`): a window with a minimize box
    /// keeps the reserved point offered; with a whole caption, the least
    /// tracking size no narrower than its caption's boxes, each half the
    /// display driver's `OBM_CLOSE` wide (seg3 `0f3c`, `1114`), and a
    /// sizing frame each side, and no lower than offered; without one, no
    /// smaller than two sizing frames, or two borders, each way.
    fn min_max_held(&self, style: u32, offered: &MinMax, answer: &mut MinMax) {
        if style & WS_MINIMIZEBOX != 0 {
            answer[0] = offered[0];
        }

        let boxes = [WS_SYSMENU, WS_MAXIMIZEBOX, WS_MINIMIZEBOX]
            .iter()
            .filter(|&&bit| style & bit != 0)
            .count() as i32;
        let least = &mut answer[3];

        if style & WS_CAPTION == WS_CAPTION {
            let width = self
                .driver
                .as_ref()
                .and_then(|driver| driver.oem.get(&OBM_CLOSE))
                .map_or_else(|| self.metric(SM_CXSIZE), |close| close.width() >> 1);

            least.0 = least.0.max(boxes * width + 2 * self.metric(SM_CXFRAME));
            least.1 = least.1.max(offered[3].1);
        } else {
            let (x, y) = if style & WS_THICKFRAME != 0 {
                (self.metric(SM_CXFRAME), self.metric(SM_CYFRAME))
            } else {
                (self.metric(SM_CXBORDER), self.metric(SM_CYBORDER))
            };

            least.0 = least.0.max(2 * x);
            least.1 = least.1.max(2 * y);
        }
    }

    /// Where a window's parent's client area is on the screen: the screen's
    /// corner for a window at the top.
    pub(crate) fn origin_of(&self, index: usize) -> (i32, i32) {
        self.windows[index]
            .as_ref()
            .and_then(|window| window.parent)
            .and_then(|parent| self.windows[parent].as_ref())
            .map_or((0, 0), |parent| {
                (
                    parent.left + parent.client.left,
                    parent.top + parent.client.top,
                )
            })
    }

    /// A window's client area in its parent's, or on the screen for a
    /// window at the top.
    pub(crate) fn client_in_parent(&self, index: usize) -> [i32; 4] {
        let window = self.windows[index].as_ref().expect("a window");
        let (x, y) = window
            .parent
            .and_then(|parent| self.windows[parent].as_ref())
            .map_or((window.left, window.top), |parent| {
                (
                    window.left - parent.left - parent.client.left,
                    window.top - parent.top - parent.client.top,
                )
            });

        [
            x + window.client.left,
            y + window.client.top,
            x + window.client.right,
            y + window.client.bottom,
        ]
    }

    /// A window's frame changed where it is: `SWP_FRAMECHANGED` with no
    /// move or size (`USER.EXE` seg7 `0e8f`-`0fe6`). Its client area is
    /// laid out again for its style; what of the old client area's bits
    /// fits is kept at the new one's top left, as `WM_NCCALCSIZE` answered
    /// with nought keeps it (`0f67`-`0f84`), and the rest is due an erase
    /// and a paint. Its whole frame is due, `WM_NCPAINT` given a region of
    /// it, and its erase is due though nothing of it may be (`swpframe`):
    /// the box of what is not kept, which the erase's clip and the paint
    /// are, a rectangle where only one side grew.
    pub(crate) fn frame_changed(&mut self, index: usize) -> Result<(), Stop> {
        let (left, top, width, height, was) = {
            let window = self.windows[index].as_ref().expect("a window");

            (
                window.left,
                window.top,
                window.width,
                window.height,
                window.client,
            )
        };
        let screen = self.screen_bitmap();
        let old = [
            left + was.left,
            top + was.top,
            left + was.right,
            top + was.bottom,
        ];
        let bits: Vec<u8> = (old[1]..old[3])
            .flat_map(|y| (old[0]..old[2]).map(move |x| (x, y)))
            .map(|(x, y)| screen.index_at(x, y).unwrap_or(0))
            .collect();

        self.relocate(index, left, top, width, height)?;

        if !self.showing(index) {
            return Ok(());
        }

        self.own();

        let now = self.windows[index].as_ref().expect("a window").client;
        let new = [
            left + now.left,
            top + now.top,
            left + now.right,
            top + now.bottom,
        ];
        let kept = [
            new[0],
            new[1],
            new[2].min(new[0] + old[2] - old[0]),
            new[3].min(new[1] + old[3] - old[1]),
        ];

        if let Some(view) = self.window_part(index, 0, 0, width, height, false) {
            let across = (old[2] - old[0]).max(0);

            for y in kept[1]..kept[3] {
                for x in kept[0]..kept[2] {
                    let at = ((y - new[1]) * across + (x - new[0])) as usize;

                    view.put(x - left, y - top, bits.get(at).copied().unwrap_or(0));
                }
            }

            view.context.mark_rect(0, 0, width, height);
        }

        let lost = if kept[2] >= new[2] && kept[3] >= new[3] {
            None
        } else if kept[2] >= new[2] {
            Some([new[0], kept[3], new[2], new[3]])
        } else if kept[3] >= new[3] {
            Some([kept[2], new[1], new[2], new[3]])
        } else {
            Some(new)
        };
        let area = lost.unwrap_or([new[0], new[1], new[0], new[1]]);
        let dirty = self.dirty_box(area);
        let window = self.windows[index].as_mut().expect("a window");

        window.needs_nc_paint = true;
        window.frame_region = true;
        window.needs_erase = true;

        if let Some(lost) = lost {
            window.dirty = match (window.needs_paint, window.dirty) {
                (false, _) => Some(dirty),
                (true, None) => None,
                (true, Some(before)) => Some(crate::windows::Dirty {
                    area: [
                        before.area[0].min(lost[0]),
                        before.area[1].min(lost[1]),
                        before.area[2].max(lost[2]),
                        before.area[3].max(lost[3]),
                    ],
                    ..dirty
                }),
            };
            window.needs_paint = true;
        } else if !window.needs_paint {
            window.dirty = Some(dirty);
        }

        Ok(())
    }

    /// The active window at the top's handle, nought for none.
    pub(crate) fn active_hwnd(&self) -> u16 {
        self.active_top()
            .and_then(|index| self.windows[index].as_ref())
            .map_or(0, |window| window.hwnd)
    }
}

impl Engine {
    /// A window asked `WM_GETMINMAXINFO`, offered what USER offers
    /// (`min_max_info`, seg6 `18e0`), and what it answered held
    /// (`min_max_held`): `USER.EXE` seg6 `1a4f`.
    pub(crate) async fn ask_min_max(&self, hwnd: u16, style: u32) -> Result<MinMax, Stop> {
        let offered = self.system().min_max_info(style);
        let mut info = Param::Struct(offered.clone());

        self.send_message(hwnd, WM_GETMINMAXINFO, 0, &mut info)
            .await?;

        let offered = min_max_points(&offered);
        let mut answer = match &info {
            Param::Struct(bytes) => min_max_points(bytes),
            Param::Value(_) => offered,
        };

        self.system().min_max_held(style, &offered, &mut answer);
        Ok(answer)
    }

    /// `WM_NCCALCSIZE` as `SetWindowPos` sends it (`USER.EXE` seg7
    /// `0ea4`-`0f50`): `wParam` 1 and `NCCALCSIZE_PARAMS` -- the rectangle
    /// the window is to have, the one it has and its client area's, each in
    /// its parent's client area. The three rectangles as the window
    /// procedure left them, and its answer.
    pub(crate) async fn calc_size(
        &self,
        hwnd: u16,
        index: usize,
        to: [i32; 4],
    ) -> Result<([[i32; 4]; 3], u16), Stop> {
        let mut params = {
            let system = self.system();
            let window = system.windows[index].as_ref().expect("a window");
            let offset = system.origin_of(index);
            let (x, y) = (window.left - offset.0, window.top - offset.1);
            let mut params: Vec<u8> = to
                .into_iter()
                .chain([x, y, x + window.width, y + window.height])
                .chain(system.client_in_parent(index))
                .flat_map(|value| (value as i16).to_le_bytes())
                .collect();

            params.extend(0u32.to_le_bytes());
            Param::Struct(params)
        };
        let answer = self
            .send_message(hwnd, WM_NCCALCSIZE, 1, &mut params)
            .await?;
        let rects = match &params {
            Param::Struct(bytes) => {
                let word = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));

                std::array::from_fn(|rect| std::array::from_fn(|side| word(rect * 8 + side * 2)))
            }
            Param::Value(_) => [to; 3],
        };

        Ok((rects, answer as u16))
    }

    /// A size held to what a window may be (`USER.EXE` seg1 `0000`): only
    /// an overlapped window, or one with a sizing frame, is held, and asked
    /// `WM_GETMINMAXINFO` for it. An icon is held between the reserved
    /// point and the size maximized; any other window between the least and
    /// the most it may be tracked to, the least winning (`005d`-`007e`).
    /// `DefWindowProc` holds `WM_WINDOWPOSCHANGING`'s size so (seg1 `609a`)
    /// and `CreateWindow` the size it was given (seg8 `06d9`), not
    /// `SetWindowPos` itself (`minmax`).
    pub(crate) async fn hold_size(
        &self,
        hwnd: u16,
        style: u32,
        minimized: bool,
        cx: i32,
        cy: i32,
    ) -> Result<(i32, i32), Stop> {
        if style & (WS_POPUP | WS_CHILD) != 0 && style & WS_THICKFRAME == 0 {
            return Ok((cx, cy));
        }

        let info = self
            .ask_min_max(hwnd, style | if minimized { WS_MINIMIZE } else { 0 })
            .await?;
        let (least, most) = if minimized {
            (info[0], info[1])
        } else {
            (info[3], info[4])
        };

        Ok((cx.min(most.0).max(least.0), cy.min(most.1).max(least.1)))
    }
}

/// The first half of a move: where the window is to go, after it was told.
pub(crate) struct Move {
    hwnd: u16,
    index: usize,
    after: u16,
    insert: Insert,
    place: [i32; 4],
    flags: u16,
    /// The family it brings to the front with it, itself among them, top
    /// first; itself alone otherwise.
    family: Vec<usize>,
    /// `WM_NCCALCSIZE`'s rectangles as the window procedure left them, and
    /// its answer, where it was sent.
    calc: Option<([[i32; 4]; 3], u16)>,
}

const WVR_ALIGNBOTTOM: u16 = 0x0040;
const WVR_ALIGNRIGHT: u16 = 0x0080;
const WVR_HREDRAW: u16 = 0x0100;
const WVR_VREDRAW: u16 = 0x0200;
const CS_VREDRAW: u16 = 0x0001;
const CS_HREDRAW: u16 = 0x0002;

/// Which of a window's old client area's bits `SetWindowPos` keeps, from
/// what its procedure answered `WM_NCCALCSIZE` (`USER.EXE` seg7
/// `0f67`-`0f84`, `10a7`-`1153`; `calcKept` in `window-state.ts`, where it
/// is told at length): none for what `move_with_bits` keeps of itself, the
/// old client area's corner at the new one's, for an answer of nought or
/// one below 10h or above 400h. Otherwise the second rectangle is where they
/// go and the third where they come from; `WVR_HREDRAW` or `CS_HREDRAW` with
/// the width changed, or `WVR_VREDRAW` or `CS_VREDRAW` with the height,
/// keeps nothing; `WVR_ALIGNRIGHT` and `WVR_ALIGNBOTTOM` move the second's
/// corner by how much larger it is, and one larger is cut to the third's
/// size (`nccalc`).
fn calc_kept(
    calc: &([[i32; 4]; 3], u16),
    class_style: u16,
    origin: (i32, i32),
    client_was: [i32; 4],
) -> Option<Kept> {
    let ([client, mut dest, source], answer) = *calc;

    if !(0x10..=0x400).contains(&answer) {
        return None;
    }

    if client[2] - client[0] != client_was[2] - client_was[0]
        && (answer & WVR_HREDRAW != 0 || class_style & CS_HREDRAW != 0)
        || client[3] - client[1] != client_was[3] - client_was[1]
            && (answer & WVR_VREDRAW != 0 || class_style & CS_VREDRAW != 0)
    {
        return Some(Kept::Nothing);
    }

    let delta = (dest[0] - source[0], dest[1] - source[1]);
    let (source_wide, source_high) = (source[2] - source[0], source[3] - source[1]);
    let (dest_wide, dest_high) = (dest[2] - dest[0], dest[3] - dest[1]);

    if answer & WVR_ALIGNRIGHT != 0 {
        dest[0] += dest_wide - source_wide;
    }

    if answer & WVR_ALIGNBOTTOM != 0 {
        dest[1] += dest_high - source_high;
    }

    if dest_wide > source_wide {
        dest[2] = dest[0] + source_wide;
    }

    if dest_high > source_high {
        dest[3] = dest[1] + source_high;
    }

    Some(Kept::Bits {
        rect: [
            dest[0] + origin.0,
            dest[1] + origin.1,
            dest[2] + origin.0,
            dest[3] + origin.1,
        ],
        delta,
    })
}

impl Engine {
    /// A window placed, shown, hidden or activated as `SetWindowPos` asks.
    #[allow(clippy::too_many_arguments)]
    pub async fn position_raster(
        &self,
        hwnd: u16,
        index: usize,
        after: u16,
        x: i16,
        y: i16,
        cx: i16,
        cy: i16,
        flags: u16,
    ) -> Result<(), Stop> {
        let Some(change) = self
            .position_changing(hwnd, index, after, [x, y, cx, cy].map(i32::from), flags)
            .await?
        else {
            return Ok(());
        };

        self.position_changed(vec![change]).await
    }

    /// The first half of a window's move: what it is told before, and where
    /// it is to go -- as the window procedure left the structure, which may
    /// move it elsewhere (Towers of the corpus does). None where nothing is
    /// to be done at all, and nothing is sent.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn position_changing(
        &self,
        hwnd: u16,
        index: usize,
        after: u16,
        [x, y, cx, cy]: [i32; 4],
        mut flags: u16,
    ) -> Result<Option<Move>, Stop> {
        let (after, insert) = {
            let system = self.system();
            let window = system.windows[index].as_ref().expect("a window");

            // The window it goes after as USER works it out, told so in the
            // structure; asked to go after itself, or a child to be topmost,
            // it is sent nothing at all where nothing else is asked
            // (`swporder`).
            let activated = flags & (SWP_NOACTIVATE | SWP_HIDEWINDOW) == 0
                && (window.visible || flags & SWP_SHOWWINDOW != 0);

            if flags & SWP_NOZORDER != 0 {
                (after, Insert::Stay)
            } else if let Some(found) = system.insert_for(index, after, activated) {
                found
            } else if flags & (SWP_NOMOVE | SWP_NOSIZE) == SWP_NOMOVE | SWP_NOSIZE
                && flags & (SWP_SHOWWINDOW | SWP_HIDEWINDOW) == 0
            {
                return Ok(None);
            } else {
                flags |= SWP_NOZORDER;
                (after, Insert::Stay)
            }
        };

        let mut structure = Param::Struct(window_pos(hwnd, after, [x, y, cx, cy], flags));

        // A window at the top brought to the front brings the family it
        // heads, as `ShowWindow` does: each asked in turn from the top down,
        // the rest neither sized, moved nor made active (`alttab`: a pop-up
        // and its owner, whichever of them is brought up).
        let family = {
            let system = self.system();
            let top = system.windows[index]
                .as_ref()
                .is_some_and(|window| window.parent.is_none());

            if top && flags & SWP_NOZORDER == 0 && insert == Insert::Top {
                system.family_of(index)
            } else {
                vec![index]
            }
        };
        let at = family
            .iter()
            .position(|&member| member == index)
            .unwrap_or(0);

        self.ask_family(&family[..at]).await?;
        self.send_message(hwnd, WM_WINDOWPOSCHANGING, 0, &mut structure)
            .await?;
        self.ask_family(&family[at + 1..]).await?;

        let (asked, x, y, cx, cy, flags) = match &structure {
            Param::Struct(bytes) => {
                let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
                let signed = |at: usize| i32::from(word(at) as i16);

                (
                    word(2),
                    signed(4),
                    signed(6),
                    signed(8),
                    signed(10),
                    word(12),
                )
            }
            Param::Value(_) => (after, x, y, cx, cy, flags),
        };
        // A size below nought is nought (`USER.EXE` seg7 `0da1`-`0db5`;
        // `minmax`): a window that answers `WM_WINDOWPOSCHANGING` itself is
        // held to nothing else, `DefWindowProc` having held it there.
        let (cx, cy) = if flags & SWP_NOSIZE == 0 {
            (cx.max(0), cy.max(0))
        } else {
            (cx, cy)
        };
        // Put elsewhere by the window procedure, it goes where it was put.
        let insert = if flags & SWP_NOZORDER != 0 {
            Insert::Stay
        } else if asked == after {
            insert
        } else {
            self.system()
                .insert_for(index, asked, false)
                .map_or(Insert::Stay, |(_, insert)| insert)
        };
        let after = asked;
        let place = {
            let system = self.system();
            let window = system.windows[index].as_ref().expect("a window");
            let offset = window
                .parent
                .and_then(|parent| system.windows[parent].as_ref())
                .map_or((0, 0), |parent| {
                    (
                        parent.left + parent.client.left,
                        parent.top + parent.client.top,
                    )
                });

            [
                if flags & SWP_NOMOVE != 0 {
                    window.left
                } else {
                    x + offset.0
                },
                if flags & SWP_NOMOVE != 0 {
                    window.top
                } else {
                    y + offset.1
                },
                if flags & SWP_NOSIZE != 0 {
                    window.width
                } else {
                    cx
                },
                if flags & SWP_NOSIZE != 0 {
                    window.height
                } else {
                    cy
                },
            ]
        };

        // Whenever a size is given, even the one the window has (`defer`),
        // and whenever the frame changed (`USER.EXE` seg7 `0e8f`): with
        // `NCCALCSIZE_PARAMS`, the window's rectangle to be, the one it
        // has and its client area's, each in its parent's client area
        // (`0ea4`-`0f50`; `swpframe`). The first, as the window procedure
        // leaves it, is its client area, and its answer says what of the
        // old client area's bits it keeps (`calc_kept`; `nccalc`). The
        // `WINDOWPOS` is not pointed to.
        let calc = if flags & SWP_NOSIZE == 0 || flags & SWP_FRAMECHANGED != 0 {
            let offset = self.system().origin_of(index);
            let [left, top, width, height] = place;
            let (left, top) = (left - offset.0, top - offset.1);

            Some(
                self.calc_size(hwnd, index, [left, top, left + width, top + height])
                    .await?,
            )
        } else {
            None
        };

        Ok(Some(Move {
            hwnd,
            index,
            after,
            insert,
            place,
            flags,
            family,
            calc,
        }))
    }

    /// The rest of a family brought to the front asked, neither sized,
    /// moved nor made active.
    async fn ask_family(&self, members: &[usize]) -> Result<(), Stop> {
        for &member in members {
            let hwnd = self.system().hwnd_of(member);

            self.send_message(
                hwnd,
                WM_WINDOWPOSCHANGING,
                0,
                &mut Param::Struct(window_pos(
                    hwnd,
                    0,
                    [0; 4],
                    SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE,
                )),
            )
            .await?;
        }

        Ok(())
    }

    /// The rest of a family brought to the front told, each that moved
    /// among the windows since `before`.
    async fn tell_family(
        &self,
        members: &[usize],
        before: &std::collections::HashMap<usize, Vec<usize>>,
    ) -> Result<(), Stop> {
        for &member in members {
            let (hwnd, place) = {
                let system = self.system();
                let Some(window) = system.windows[member].as_ref() else {
                    continue;
                };

                if before.get(&member) == Some(&system.above(member)) {
                    continue;
                }

                let (x, y) = match window
                    .parent
                    .and_then(|parent| system.windows[parent].as_ref())
                {
                    Some(parent) => (
                        window.left - parent.left - parent.client.left,
                        window.top - parent.top - parent.client.top,
                    ),
                    None => (window.left, window.top),
                };

                (window.hwnd, [x, y, window.width, window.height])
            };

            self.send_message(
                hwnd,
                WM_WINDOWPOSCHANGED,
                0,
                &mut Param::Struct(window_pos(
                    hwnd,
                    0,
                    place,
                    SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOCLIENTSIZE | SWP_NOCLIENTMOVE,
                )),
            )
            .await?;
        }

        Ok(())
    }

    /// The second half of the moves begun, each window placed and then
    /// told, in the order they were begun -- only when something changed:
    /// a window deferred to where it already was is sent no more (`defer`).
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn position_changed(&self, changes: Vec<Move>) -> Result<(), Stop> {
        let mut placed = Vec::with_capacity(changes.len());
        // Where each of the families brought up lay, to tell those that
        // moved.
        let before: std::collections::HashMap<usize, Vec<usize>> = {
            let system = self.system();

            changes
                .iter()
                .flat_map(|change| change.family.iter())
                .map(|&member| (member, system.above(member)))
                .collect()
        };

        for change in changes {
            let mut system = self.system();
            let [left, top, width, height] = change.place;
            let framed = change.flags & SWP_FRAMECHANGED != 0;
            let client_was = system.client_in_parent(change.index);
            let (moved, resized, visible, parent) = {
                let window = system.windows[change.index].as_ref().expect("a window");

                (
                    left != window.left || top != window.top,
                    width != window.width || height != window.height,
                    window.visible,
                    window.parent,
                )
            };

            let origin = system.origin_of(change.index);

            // The client area as the window procedure made it (seg7
            // `0f89`-`0fb9`; `nccalc`).
            if let Some(([client, _, _], _)) = change.calc {
                let (x, y) = (left - origin.0, top - origin.1);

                system.answer_client(
                    change.index,
                    width,
                    height,
                    crate::windows::Rect {
                        left: client[0] - x,
                        top: client[1] - y,
                        right: client[2] - x,
                        bottom: client[3] - y,
                    },
                )?;
            }

            if moved || resized {
                let kept = change.calc.as_ref().filter(|_| resized).and_then(|calc| {
                    calc_kept(calc, system.class_style(change.index), origin, client_was)
                });

                system.move_with_bits(
                    change.index,
                    change.place,
                    change.flags & SWP_NOCOPYBITS == 0,
                    kept,
                )?;
            } else if framed {
                system.frame_changed(change.index)?;
            }

            // Sized, its whole frame is due as a region of it (`swpframe`).
            if resized && let Some(window) = system.windows[change.index].as_mut() {
                window.frame_region = window.needs_nc_paint;
            }

            if moved || resized {
                // An icon moved keeps that place, minimized again later
                // (`iconclk`).
                if moved
                    && let Some(window) = system.windows[change.index].as_mut()
                    && window.placement == Placement::Minimized
                {
                    window.icon_place = Some((left, top));
                }
            }

            let now = system.windows[change.index]
                .as_ref()
                .expect("a window")
                .visible;

            // Put where it was asked to go among its brothers (`mousemsg`,
            // `swporder`); a window shown comes to the front as it shows,
            // and one hidden stays where it is.
            let mut reordered = change.flags & SWP_HIDEWINDOW == 0
                && (now || change.flags & SWP_SHOWWINDOW == 0)
                && system.reorder(change.index, change.insert);

            // Brought to the top, the windows it owns come up above it and
            // the window that owns it beneath, the family it was asked with
            // (`alttab`). Not made active, it is brought up so all the same:
            // a press on a disabled owner puts it on top with
            // `SWP_NOACTIVATE`, and the pop-up it owns comes with it
            // (`USER.EXE` seg1 `59a4`; `curerr`).
            if change.family.len() > 1 && change.flags & SWP_HIDEWINDOW == 0 && now {
                reordered = system.bring_family_up(change.index) || reordered;
            }

            if change.flags & SWP_HIDEWINDOW != 0 && now {
                // The active window hidden so stays active: only
                // `ShowWindow` and `DestroyWindow` ask for another
                // (`USER.EXE` seg14 `0dc2`, seg8 `0bb7`).
                system.hide_with(change.index, false);
            } else if change.flags & SWP_SHOWWINDOW != 0 && !now {
                system.show(change.index);
            } else if parent.is_none() && now && change.flags & SWP_NOACTIVATE == 0 {
                // Activated, and so brought to the top, unless asked not to be
                // (`mousemv`); only what it uncovered of itself is due.
                system.show_with(change.index, false);
            }

            let showing = system.windows[change.index]
                .as_ref()
                .expect("a window")
                .visible
                != visible;

            // What of the client area stayed as it was, said so (seg7
            // `0d66`, `0fcf`, `0fe6`).
            let client = client_flags(client_was, system.client_in_parent(change.index));

            placed.push((
                change,
                moved,
                resized,
                showing || reordered || framed,
                client,
            ));
        }

        // Made active, then erased where it is due, and only then told it
        // moved (`swpbits`, `swporder`, `showseq`); brought to the front
        // again where it is not then the first at the top (`alttab`).
        self.deliver_activation(Some(crate::window_state::Between::Again))
            .await?;
        self.erase_due().await?;

        // A frame changed with nothing of its client area to paint is done.
        for (change, ..) in &placed {
            if change.flags & SWP_FRAMECHANGED != 0
                && let Some(window) = self.system().windows[change.index].as_mut()
                && !window.needs_paint
            {
                window.dirty = None;
            }
        }

        for (change, moved, sized, changed, client) in placed {
            let at = change
                .family
                .iter()
                .position(|&member| member == change.index)
                .unwrap_or(0);

            self.tell_family(&change.family[..at], &before).await?;

            if !moved && !sized && !changed {
                self.tell_family(&change.family[at + 1..], &before).await?;
                continue;
            }

            let place = {
                let system = self.system();
                let window = system.windows[change.index].as_ref().expect("a window");
                let (x, y) = match window
                    .parent
                    .and_then(|parent| system.windows[parent].as_ref())
                {
                    Some(parent) => (
                        window.left - parent.left - parent.client.left,
                        window.top - parent.top - parent.client.top,
                    ),
                    None => (window.left, window.top),
                };

                [x, y, window.width, window.height]
            };
            let flags = change.flags
                | if moved { 0 } else { SWP_NOMOVE }
                | if sized { 0 } else { SWP_NOSIZE }
                | client;

            self.send_message(
                change.hwnd,
                WM_WINDOWPOSCHANGED,
                0,
                &mut Param::Struct(window_pos(change.hwnd, change.after, place, flags)),
            )
            .await?;
            self.tell_family(&change.family[at + 1..], &before).await?;
        }

        self.system().nudge()?;
        Ok(())
    }
}

/// `SetWindowPos`: FALSE for a handle that is no window of the desktop's.
pub fn set_window_pos(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, after, x, y, cx, cy, flags) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.signed(&system),
                args.signed(&system),
                args.signed(&system),
                args.signed(&system),
                args.word(&system),
            )
        };
        let Some(index) = engine.system().window_named(hwnd) else {
            return Ok(Answer::Word(0));
        };

        engine
            .position_raster(hwnd, index, after, x, y, cx, cy, flags)
            .await?;
        Ok(Answer::Word(1))
    })
}

/// `MoveWindow`: `SetWindowPos` with the place and size, and no change to
/// the order or the activation.
pub fn move_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, x, y, cx, cy) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let place = (
                args.signed(&system),
                args.signed(&system),
                args.signed(&system),
                args.signed(&system),
            );

            args.word(&system);
            (hwnd, place.0, place.1, place.2, place.3)
        };
        let Some(index) = engine.system().window_named(hwnd) else {
            return Ok(Answer::Word(0));
        };

        engine
            .position_raster(hwnd, index, 0, x, y, cx, cy, SWP_NOZORDER | SWP_NOACTIVATE)
            .await?;
        Ok(Answer::Word(1))
    })
}

/// A window brought above the others: a top-level window to the top, made
/// active with the focus; a child above its siblings, the focus left where
/// it was (`minis`).
pub fn bring_window_to_top(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hwnd = args.word(&engine.system());
        let (index, child) = {
            let system = engine.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(Answer::Word(0));
            };

            (
                index,
                system.windows[index]
                    .as_ref()
                    .is_some_and(|window| window.parent.is_some()),
            )
        };

        if child {
            engine.system().raise(index);
        } else {
            engine
                .position_raster(hwnd, index, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
                .await?;
        }

        Ok(Answer::Word(1))
    })
}

/// The active top-level window: a document window inside one does not
/// count.
pub fn get_active_window(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.raster();
    Ok(Answer::Word(system.active_hwnd()))
}

/// A top-level window made the active one, brought to the top, with the
/// messages that go with it (`activate`); the window that was active.
pub fn set_active_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hwnd = args.word(&engine.system());

        Ok(Answer::Word(engine.activate_top(hwnd).await?))
    })
}

impl Engine {
    /// `SetActiveWindow`: a top-level window made the active one, brought
    /// to the top, with the messages that go with it; the window that was
    /// active. A window hidden is made active hidden: USER asks only that it
    /// is not a child (`USER.EXE` seg1 `38c5`, `38f2`, then `3514`).
    pub(crate) async fn activate_top(&self, hwnd: u16) -> Result<u16, Stop> {
        let (previous, index) = {
            let mut system = self.system();

            system.raster();

            let previous = system.active_hwnd();
            let index = system.window_named(hwnd).filter(|&index| {
                system.windows[index]
                    .as_ref()
                    .is_some_and(|window| window.parent.is_none())
            });

            (previous, index)
        };

        // Brought to the front between the two windows' messages where the
        // first window that shows is not it (`3674`-`3697`; `enddlg`: W,
        // under O, is asked and told 3).
        if let Some(index) = index {
            self.activate_window(index, false, true).await?;
        }

        Ok(previous)
    }
}

/// Whether a window of the desktop's is an icon.
pub fn is_iconic(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let placement = system
        .window_named(hwnd)
        .and_then(|index| system.windows[index].as_ref())
        .map(|window| window.placement);

    Ok(Answer::Word(u16::from(
        placement == Some(Placement::Minimized),
    )))
}

/// Whether a window of the desktop's is maximized.
pub fn is_zoomed(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let placement = system
        .window_named(hwnd)
        .and_then(|index| system.windows[index].as_ref())
        .map(|window| window.placement);

    Ok(Answer::Word(u16::from(
        placement == Some(Placement::Maximized),
    )))
}

/// A move kept: the window, the window it goes after, its place and size,
/// and the flags.
pub type Deferred = (u16, u16, [i16; 4], u16);

/// Moves kept to be made together: a handle for them.
pub fn begin_defer_window_pos(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    system.deferred.push(Some(Vec::new()));

    let index = system.deferred.len() - 1;

    Ok(Answer::Word(
        system
            .handles
            .allocate(
                crate::handles::Kind::Atom,
                crate::handles::Object::Deferred(index),
            )
            .unwrap_or(0),
    ))
}

/// A move kept with the others; the handle, or nought for no set or a
/// handle that is no window of the desktop's.
pub fn defer_window_pos(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let set = args.word(system);
    let hwnd = args.word(system);
    let after = args.word(system);
    let place = [
        args.signed(system),
        args.signed(system),
        args.signed(system),
        args.signed(system),
    ];
    let flags = args.word(system);
    let Some(crate::handles::Object::Deferred(index)) = system.handles.resolve(set) else {
        return Ok(Answer::Word(0));
    };

    if system.window_named(hwnd).is_none() {
        return Ok(Answer::Word(0));
    }

    if let Some(moves) = system.deferred[index].as_mut() {
        moves.push((hwnd, after, place, flags));
    }

    Ok(Answer::Word(set))
}

/// The moves kept made, each window's first half in turn, then each
/// placed and told (`defer`).
pub fn end_defer_window_pos(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let moves = {
            let mut system = engine.system();
            let set = args.word(&system);
            let Some(crate::handles::Object::Deferred(index)) = system.handles.resolve(set) else {
                return Ok(Answer::Word(0));
            };

            system.handles.free(set);
            system.deferred[index].take().unwrap_or_default()
        };
        let mut begun = Vec::with_capacity(moves.len());

        for (hwnd, after, place, flags) in moves {
            let Some(index) = engine.system().window_named(hwnd) else {
                continue;
            };

            begun.extend(
                engine
                    .position_changing(hwnd, index, after, place.map(i32::from), flags)
                    .await?,
            );
        }

        engine.position_changed(begun).await?;
        Ok(Answer::Word(1))
    })
}
