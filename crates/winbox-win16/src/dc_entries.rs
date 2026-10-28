//! USER's device context entries (`USER.EXE`, the list at DS:12Eh): the
//! five common contexts USER makes as Windows starts (seg3 `0635`-`0662`),
//! and one for each window of a `CS_OWNDC` class and each `CS_CLASSDC`
//! class (seg8 `0707`-`071e`). Each entry is a device context of its own
//! -- its own drawing surface and attributes -- the window it is lent for,
//! the window whose region it has, a region given, and its flags. `GetDC`,
//! `GetWindowDC`, `GetDCEx` and `BeginPaint` take one (seg1 `847b`),
//! `ReleaseDC` and `EndPaint` give it back (seg1 `8805`), and windows
//! changing make entries stale (seg1 `8aa0`), to be worked out again when
//! next taken or by USER's hook when next used (seg1 `8a00`).
//! `kb/topics/visible-regions.md`, phase 4. Twin of the TypeScript
//! engine's `dc-entries.ts`, where each read-out is told at length.

use std::collections::HashMap;

use winbox_raster::ClipRegion;

use crate::gdi::dc::{DcBitmap, DcState};
use crate::gdi::objects::{delete_object, get_stock_object};
use crate::handles::{Kind, Object};
use crate::system::System;
use crate::window_vis::{
    DCX_CACHE, DCX_CLIPCHILDREN, DCX_CLIPSIBLINGS, DCX_EXCLUDERGN, DCX_INTERSECTRGN,
    DCX_PARENTCLIP, DCX_WINDOW,
};
use crate::windows::Placement;

/// An entry whose region is gone: free, to be worked out when next taken
/// (`8b6e`).
pub const DCX_EMPTY: u32 = 0x0800;
/// An entry lent and not given back (`8698`, cleared at `884e`).
pub const DCX_INUSE: u32 = 0x1000;
/// An entry in use made stale: USER's hook works it out again (`8ba0`).
pub const DCX_STALE: u32 = 0x2000;
const DCX_KEEPCLIPRGN: u32 = 0x0004_0000;

/// The flags an entry is found by (`854f`), and those it is matched on
/// (`85cd`).
const KEY: u32 = 0x041b;
const MATCH: u32 = 0x1c1b;

const WS_CLIPCHILDREN: u32 = 0x0200_0000;
const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_MINIMIZE: u32 = 0x2000_0000;
const CS_OWNDC: u16 = 0x0020;
const CS_CLASSDC: u16 = 0x0040;
const CS_PARENTDC: u16 = 0x0080;
const BLACK_PEN: i16 = 7;
const WHITE_BRUSH: i16 = 0;

/// One of USER's entries.
#[derive(Debug, Clone)]
pub struct Entry {
    /// The context's handle, and the context: its own drawing and
    /// attributes.
    pub hdc: u16,
    pub dc: usize,
    /// `GetDCEx`'s flags as kept (`86a1`-`869e`), with the three of USER's
    /// own.
    pub flags: u32,
    /// The window it is lent for, and the window whose region it has;
    /// nought for none.
    pub hwnd: u16,
    pub clip: u16,
    /// The region `GetDCEx` was given, by its handle; 1 for the whole
    /// screen.
    pub region: u16,
    /// A region given with no handle: `BeginPaint`'s part to paint.
    pub shape: Option<ClipRegion>,
    /// A class's context, which outlives its windows.
    pub shared: bool,
}

/// What USER's walk is told of a window's change, as WinBox finds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Seen {
    hwnd: u16,
    parent: u16,
    rect: [i32; 8],
    minimized: bool,
    order: usize,
    visible: bool,
    clipping: u32,
}

/// The entries, the one taken last first, and USER's copy of a new
/// context's state.
#[derive(Debug, Default)]
pub struct Entries {
    pub list: Vec<Entry>,
    pub state: Option<DcState>,
    /// Each `CS_CLASSDC` class's context, by the class's name.
    pub classes: HashMap<String, u16>,
    /// The windows as they were when the screen's owners were last worked
    /// out, by their index and handle.
    seen: Option<HashMap<(usize, u16), Seen>>,
}

/// The flags an entry is taken with, the window whose region it has, and
/// the class's context (`8491`-`854c`).
struct Taken {
    low: u32,
    high: u32,
    clip: u16,
    class_dc: u16,
}

impl System {
    /// The desktop window's handle.
    fn desktop_hwnd(&self) -> u16 {
        self.handles.lookup(Object::Desktop).unwrap_or(0)
    }

    /// The entries made, as Windows starts: five common contexts, each
    /// with no window, made empty (seg3 `0635`-`0662`); a copy of the last
    /// one's state kept to give a common context back with (`0665`).
    pub fn dc_entries_made(&mut self) {
        if self.dc_entries.state.is_some() {
            return;
        }

        for _ in 0..5 {
            self.make_entry(0, DCX_CACHE | DCX_EMPTY, None);
        }

        let first = self.dc_entries.list[0].dc;

        self.dc_entries.state = Some(self.gdi.dcs[first].state.clone());
    }

    /// The entry of a context, by its handle, as its place in the list.
    pub fn entry_at(&self, hdc: u16) -> Option<usize> {
        self.dc_entries
            .list
            .iter()
            .position(|entry| entry.hdc == hdc)
    }

    /// The window a context is lent for, as `WindowFromDC` finds it by its
    /// entry (seg1 `8988`): none where it is no entry's.
    pub fn entry_window_of_dc(&self, dc: usize) -> Option<Option<usize>> {
        let entry = self.dc_entries.list.iter().find(|entry| entry.dc == dc)?;

        Some(self.window_named(entry.hwnd))
    }

    /// A new entry, at the head of the list (seg1 `88aa`): a display
    /// context of its own with USER's hook in it and the context's handle
    /// as the hook's data (`890d`), the window it is for. One that is not
    /// common is in use from the start, and stale (`896d`-`8972`); a
    /// class's is the class's context from then on (`8965`).
    fn make_entry(&mut self, hwnd: u16, flags: u32, own: Option<usize>) {
        let dc = own.unwrap_or_else(|| self.new_dc(DcBitmap::Screen, false));
        let hdc = self.handles.allocate(Kind::Dc, Object::Dc(dc)).unwrap_or(0);

        self.default_state(dc);
        self.gdi.dcs[dc].hook.set = Some((0, u32::from(hdc)));
        self.gdi.dcs[dc].hook.user = true;
        self.gdi.dcs[dc].hook.flag = false;
        self.dc_entries.list.insert(
            0,
            Entry {
                hdc,
                dc,
                flags,
                hwnd,
                clip: hwnd,
                region: 0,
                shape: None,
                shared: false,
            },
        );

        if flags & DCX_CACHE == 0 {
            if let Some(class) = self.class_of(hwnd)
                && self.classes[class].style & CS_CLASSDC != 0
            {
                let name = self.classes[class].name.to_ascii_uppercase();

                self.dc_entries.classes.insert(name, hdc);
                self.dc_entries.list[0].shared = true;
            }

            self.dc_entries.list[0].flags |= DCX_INUSE;
            self.stale_one(0);
        }
    }

    /// A new display context's attributes, as `CreateDC` gives them and
    /// USER's copy of them keeps: the System font, black text on white,
    /// opaque, `R2_COPYPEN`, the black pen and the white brush
    /// (`dcreset`).
    fn default_state(&mut self, dc: usize) {
        let font = self.system_font();
        let pen = self.stock_object_index(BLACK_PEN);
        let brush = self.stock_object_index(WHITE_BRUSH);
        let state = &mut self.gdi.dcs[dc].state;

        state.back_mode = 2;
        state.back_color = None;
        state.rop2 = None;
        state.text_color = Some(0);

        if font.is_some() {
            state.font = font;
        }

        if let Some(pen) = pen {
            state.pen = pen;
        }

        if let Some(brush) = brush {
            state.brush = brush;
        }
    }

    /// A stock object's index among GDI's objects.
    fn stock_object_index(&mut self, stock: i16) -> Option<usize> {
        let handle = get_stock_object(self, stock);

        match self.handles.resolve(handle)? {
            Object::Gdi(index) => Some(index),
            _ => None,
        }
    }

    /// The class a window was made of, by its handle.
    pub(crate) fn class_of(&self, hwnd: u16) -> Option<usize> {
        let index = self.window_named(hwnd)?;

        self.class_named(&self.windows[index].as_ref()?.class)
    }

    /// A window's own entry made as it is created, where its class has one
    /// (seg8 `0707`-`071e`): its own context for a `CS_OWNDC` class, the
    /// class's for the first window of a `CS_CLASSDC` one.
    pub fn window_created(&mut self, hwnd: u16, index: usize) {
        self.dc_entries_made();

        let Some(class) = self.class_of(hwnd) else {
            return;
        };
        let style = self.classes[class].style;
        let name = self.classes[class].name.to_ascii_uppercase();

        if style & CS_OWNDC != 0 {
            let dc = self.window_dc(index);

            self.make_entry(hwnd, 0x0002_0000, Some(dc));
        } else if style & CS_CLASSDC != 0 && !self.dc_entries.classes.contains_key(&name) {
            self.make_entry(hwnd, 0x0002_0000, None);
        }
    }

    /// A window's entries as it is destroyed and taken off the desktop (seg8
    /// `0d90`-`0e05`): a common
    /// one in use given back, and each emptied; a class's emptied, its
    /// region given restored; a window's own let go (seg1 `89aa`).
    pub fn window_destroyed(&mut self, hwnd: u16) {
        if hwnd == 0 {
            return;
        }

        let mut at = 0;

        while at < self.dc_entries.list.len() {
            let entry = self.dc_entries.list[at].clone();

            if entry.flags & DCX_EMPTY != 0 || (entry.hwnd != hwnd && entry.clip != hwnd) {
                at += 1;
                continue;
            }

            if entry.flags & DCX_CACHE != 0 {
                if entry.flags & DCX_INUSE != 0 {
                    self.release_entry(entry.hdc, false);
                }

                self.dc_entries.list[at].flags = DCX_CACHE | DCX_EMPTY;
            } else if entry.shared {
                if entry.flags & (DCX_EXCLUDERGN | DCX_INTERSECTRGN) != 0 {
                    self.restore_given(at);
                }

                self.dc_entries.list[at].flags = DCX_EMPTY;
            } else {
                self.dc_entries.list.remove(at);
                self.gdi.dcs[entry.dc].hook = crate::gdi::dc::DcHook::default();
                self.handles.free(entry.hdc);
                continue;
            }

            let entry = &mut self.dc_entries.list[at];

            entry.hwnd = 0;
            entry.clip = 0;
            entry.region = 0;
            entry.shape = None;
            at += 1;
        }
    }

    /// A window's parent, the desktop for one at the top; nought for the
    /// desktop (the word at 4).
    fn parent_hwnd(&self, hwnd: u16) -> u16 {
        let desktop = self.desktop_hwnd();

        if hwnd == 0 || hwnd == desktop {
            return 0;
        }

        let Some(index) = self.window_named(hwnd) else {
            return 0;
        };

        match self.windows[index]
            .as_ref()
            .and_then(|window| window.parent)
        {
            Some(parent) => self.windows[parent]
                .as_ref()
                .map_or(desktop, |parent| parent.hwnd),
            None => desktop,
        }
    }

    /// A window's style as USER keeps it, `WS_VISIBLE` and `WS_MINIMIZE` as
    /// it shows; the desktop's has `WS_CLIPCHILDREN` and is visible.
    fn user_style(&self, hwnd: u16) -> u32 {
        if hwnd != 0 && hwnd == self.desktop_hwnd() {
            return WS_CLIPCHILDREN | WS_VISIBLE;
        }

        let Some(window) = self
            .window_named(hwnd)
            .and_then(|index| self.windows[index].as_ref())
        else {
            return 0;
        };

        (window.style & !(WS_VISIBLE | WS_MINIMIZE))
            | if window.visible { WS_VISIBLE } else { 0 }
            | if window.placement == Placement::Minimized {
                WS_MINIMIZE
            } else {
                0
            }
    }

    /// The flags an entry is taken with (seg1 `8491`-`854c`), as
    /// `dc-entries.ts`'s `takenFlags` says.
    fn taken_flags(&self, hwnd: u16, flags: u32) -> Taken {
        let mut low = flags & 0xffff;
        let high = flags >> 16;
        let mut clip = hwnd;
        let mut class_dc = 0;
        let style = self.user_style(hwnd);

        if high & 1 != 0 {
            low &= 0xc7;

            if low & DCX_WINDOW == 0 {
                let class = self.class_of(hwnd);
                let class_style = class.map_or(0, |class| self.classes[class].style);

                if class_style & CS_PARENTDC != 0 {
                    low |= DCX_PARENTCLIP;
                }

                if low & DCX_CACHE == 0 {
                    low |= DCX_CACHE;

                    if class_style & CS_OWNDC != 0 {
                        low &= !DCX_CACHE;
                    } else if class_style & CS_CLASSDC != 0 {
                        class_dc = class
                            .and_then(|class| {
                                self.dc_entries
                                    .classes
                                    .get(&self.classes[class].name.to_ascii_uppercase())
                            })
                            .copied()
                            .unwrap_or(0);
                        low &= !DCX_CACHE;
                    }
                }

                if style & WS_CLIPCHILDREN != 0 {
                    low |= DCX_CLIPCHILDREN;
                }

                if style & WS_CLIPSIBLINGS != 0 {
                    low |= DCX_CLIPSIBLINGS;
                }

                if style & WS_MINIMIZE != 0 {
                    low &= !DCX_CLIPCHILDREN;
                }
            } else {
                if style & WS_CLIPSIBLINGS != 0 {
                    low |= DCX_CLIPSIBLINGS;
                }

                low |= DCX_CACHE;
            }
        }

        if high & 8 != 0 {
            low &= !(DCX_CLIPCHILDREN | DCX_PARENTCLIP);
            low |= DCX_CACHE;
        }

        if low & DCX_PARENTCLIP != 0 {
            low |= DCX_CACHE;

            let parent = self.parent_hwnd(hwnd);
            let parent_style = self.user_style(parent);

            if parent != 0
                && parent_style & WS_CLIPCHILDREN == 0
                && low & (DCX_CLIPCHILDREN | DCX_CLIPSIBLINGS) == 0
                && (parent_style ^ style) & WS_VISIBLE == 0
            {
                clip = parent;

                if parent_style & WS_CLIPSIBLINGS != 0 {
                    low |= DCX_CLIPSIBLINGS;
                }
            }
        }

        Taken {
            low,
            high,
            clip,
            class_dc,
        }
    }

    /// An entry taken for a window by `GetDCEx`'s flags and a region (seg1
    /// `847b`-`87b7`), as `dc-entries.ts`'s `takeEntry` says: its handle,
    /// or nought where the window's class has no context of its own and
    /// `DCX_CACHE` is not given (`85b6`).
    pub fn take_entry(
        &mut self,
        hwnd: u16,
        region: u16,
        flags: u32,
        shape: Option<ClipRegion>,
    ) -> u16 {
        self.dc_entries_made();

        let Taken {
            low,
            high,
            clip,
            class_dc,
        } = self.taken_flags(hwnd, flags);
        let key = low & KEY;
        let afresh;
        let at;

        if low & DCX_CACHE == 0 {
            let Some(found) = self.dc_entries.list.iter().position(|one| {
                one.flags & DCX_CACHE == 0
                    && (one.hwnd == hwnd || (class_dc != 0 && one.hdc == class_dc))
            }) else {
                return 0;
            };

            if self.dc_entries.list[found].flags & (DCX_EXCLUDERGN | DCX_INTERSECTRGN) != 0
                && low & (DCX_EXCLUDERGN | DCX_INTERSECTRGN) != 0
            {
                self.restore_given(found);
            }

            afresh = self.dc_entries.list[found].hwnd != hwnd;
            at = found;
        } else {
            (at, afresh) = self.common_entry(hwnd, clip, key);
        }

        if afresh {
            let entry = &mut self.dc_entries.list[at];

            entry.flags = key | DCX_INUSE;
            entry.hwnd = hwnd;
            entry.clip = clip;
            entry.region = 0;
            entry.shape = None;
            self.bind_entry(at);

            let region = self.rule_region(at);
            let dc = self.dc_entries.list[at].dc;

            self.select_vis(dc, region);
        }

        let entry = self.dc_entries.list.remove(at);

        self.dc_entries.list.insert(0, entry);

        let given = if low & DCX_INTERSECTRGN != 0 {
            (region != 1).then_some(DCX_INTERSECTRGN)
        } else if low & DCX_EXCLUDERGN != 0 && (region != 0 || shape.is_some()) {
            Some(DCX_EXCLUDERGN)
        } else {
            None
        };

        if let Some(given) = given {
            let hdc = self.dc_entries.list[0].hdc;
            let dc = self.dc_entries.list[0].dc;

            crate::gdi::visible_region::save_vis_quietly(self, dc);

            let entry = &mut self.dc_entries.list[0];

            entry.region = region;
            entry.shape = shape;

            if high & 4 != 0 {
                entry.flags |= DCX_KEEPCLIPRGN;
            }

            entry.flags |= given;

            if given == DCX_INTERSECTRGN {
                entry.flags &= !DCX_STALE;
            }

            let now = crate::gdi::regions::vis_of(self, dc);
            let combined = self.with_given(0, now);

            self.select_vis(dc, combined);
            let _ = hdc;
        }

        self.dc_entries.list[0].hdc
    }

    /// A common entry taken (`85c5`-`867e`): one not in use for the same
    /// window whose region it has and the same flags, taken as it is; else
    /// the first empty one, or the last free one; else, all lent, the one
    /// taken last given back. Its place, and whether it is taken afresh.
    fn common_entry(&mut self, hwnd: u16, clip: u16, key: u32) -> (usize, bool) {
        let minimized = self.user_style(clip) & WS_MINIMIZE != 0;
        let matching = self.dc_entries.list.iter().position(|one| {
            one.clip == clip && one.flags & MATCH == key && !(minimized && one.hwnd != one.clip)
        });

        if let Some(found) = matching {
            self.dc_entries.list[found].flags |= DCX_INUSE;

            if self.dc_entries.list[found].hwnd != hwnd {
                // What it drew for the other window, taken back (`8665`).
                self.harvest(found);
                self.dc_entries.list[found].hwnd = hwnd;
                self.bind_entry(found);
            }

            return (found, false);
        }

        let mut free = None;

        for (place, one) in self.dc_entries.list.iter().enumerate() {
            if one.flags & DCX_CACHE == 0 {
                continue;
            }

            if one.flags & DCX_EMPTY != 0 {
                free = Some(place);
                break;
            }

            if one.flags & DCX_INUSE == 0 {
                free = Some(place);
            }
        }

        let place = free.unwrap_or_else(|| {
            let head = self.dc_entries.list[0].hdc;

            self.release_entry(head, false);
            0
        });

        // What it drew, taken back unless it was emptied (`8688`-`868f`).
        if self.dc_entries.list[place].flags & DCX_EMPTY == 0 {
            self.harvest(place);
        }

        (place, true)
    }

    /// `SelectVisRgn`'s body, as USER selects a region.
    fn select_vis(&mut self, dc: usize, region: ClipRegion) {
        crate::gdi::visible_region::select_vis(self, dc, region);
    }

    /// The window's region combined with the region given (`86f8`-`8798`,
    /// `8a3b`-`8a82`).
    fn with_given(&self, at: usize, region: ClipRegion) -> ClipRegion {
        let entry = &self.dc_entries.list[at];
        let given = if entry.region > 1 {
            crate::gdi::regions::region_shape(self, entry.region)
        } else {
            None
        }
        .or_else(|| entry.shape.clone());

        if entry.flags & DCX_INTERSECTRGN != 0 {
            return given.map_or(ClipRegion::EMPTY, |given| region.intersect(&given));
        }

        if entry.flags & DCX_EXCLUDERGN != 0 {
            if entry.region == 1 {
                return ClipRegion::EMPTY;
            }

            return given.map_or(region.clone(), |given| region.subtract(&given));
        }

        region
    }

    /// The region USER's rule gives an entry's window by its flags (seg1
    /// `1582`).
    fn rule_region(&self, at: usize) -> ClipRegion {
        let entry = &self.dc_entries.list[at];
        let screen = ClipRegion::rect(
            0,
            0,
            i32::from(self.display.width),
            i32::from(self.display.height),
        );

        if entry.hwnd == self.desktop_hwnd() {
            return if entry.flags & DCX_CLIPCHILDREN != 0 {
                self.less_top_windows(screen)
            } else {
                screen
            };
        }

        let (Some(window), Some(of)) =
            (self.window_named(entry.hwnd), self.window_named(entry.clip))
        else {
            return ClipRegion::EMPTY;
        };

        if !self.z_order.contains(&window) || !self.z_order.contains(&of) {
            return ClipRegion::EMPTY;
        }

        self.window_region(window, of, entry.flags & 0xffff)
    }

    /// The entry's context pointed at its window: the window's client area
    /// or, with `DCX_WINDOW`, the whole window; the screen for the
    /// desktop's. Its origin and brush origin the corner (seg1 `1540`).
    fn bind_entry(&mut self, at: usize) {
        let entry = &self.dc_entries.list[at];
        let dc = entry.dc;
        let whole = entry.flags & DCX_WINDOW != 0;
        let hwnd = entry.hwnd;
        let own = self
            .window_named(hwnd)
            .and_then(|index| self.windows[index].as_ref())
            .and_then(|window| window.dc);

        if own != Some(dc) {
            self.gdi.dcs[dc].bitmap = if hwnd == self.desktop_hwnd() {
                DcBitmap::Screen
            } else {
                match self.window_named(hwnd) {
                    Some(index) if whole => DcBitmap::Whole(index),
                    Some(index) => DcBitmap::Window(index),
                    None => DcBitmap::Screen,
                }
            };
        }

        self.gdi.dcs[dc].state.origin = None;
        self.gdi.dcs[dc].state.brush_org = None;
    }

    /// An entry given back (seg1 `8805`), as `dc-entries.ts`'s
    /// `releaseEntry` says: nought where it is not in use; a common one's
    /// state set back from USER's copy, its origin and visible region
    /// staying.
    pub fn release_entry(&mut self, hdc: u16, ending: bool) -> bool {
        let Some(at) = self.entry_at(hdc) else {
            return false;
        };
        let flags = self.dc_entries.list[at].flags;

        if flags & (DCX_EMPTY | DCX_INUSE) != DCX_INUSE {
            return false;
        }

        if flags & (DCX_EXCLUDERGN | DCX_INTERSECTRGN) != 0 && (flags & DCX_CACHE != 0 || ending) {
            self.restore_given(at);
        }

        if self.dc_entries.list[at].flags & DCX_CACHE != 0 {
            let dc = self.dc_entries.list[at].dc;

            self.reset_entry_state(dc);
            self.dc_entries.list[at].flags &= !DCX_INUSE;
        }

        true
    }

    /// A common context's attributes set back as USER's copy has them, as
    /// `SetDCState` puts a state: the hook called first where its flag is
    /// set (`GDI.EXE` seg1 `067f`), the origin and the visible region
    /// staying (`072f`-`073f`), the palette the stock one again. Its saved
    /// levels go too; not recorded.
    fn reset_entry_state(&mut self, dc: usize) {
        self.user_hook_due(dc);

        let origin = self.gdi.dcs[dc].state.origin;

        if let Some(state) = self.dc_entries.state.clone() {
            self.gdi.dcs[dc].state = state;
        }

        self.gdi.dcs[dc].state.origin = origin;
        self.gdi.dcs[dc].saved.clear();
        // The palette, which is in the state Windows copies (`GDI.EXE` seg1
        // `074f`-`075e`), the stock one again.
        self.gdi.dcs[dc].palette = None;
    }

    /// A window's own context handed out as a common one would be -- the
    /// context a list box or a button gives its owner to draw an item with,
    /// which in Windows is one USER lends -- with a common context's
    /// attributes, unless it is the window's own entry's (`CS_OWNDC`).
    pub(crate) fn as_common(&mut self, dc: usize) {
        self.dc_entries_made();

        if !self.dc_entries.list.iter().any(|entry| entry.dc == dc) {
            self.reset_entry_state(dc);
        }
    }

    /// A region given let go (seg1 `885f`): deleted unless
    /// `DCX_KEEPCLIPRGN`, the region saved before it restored with
    /// `RestoreVisRgn`, and an entry made stale while it had it made stale
    /// again (`889b`).
    fn restore_given(&mut self, at: usize) {
        let entry = &mut self.dc_entries.list[at];

        entry.flags &= !(DCX_EXCLUDERGN | DCX_INTERSECTRGN);

        let deleted = if entry.flags & DCX_KEEPCLIPRGN == 0 {
            let region = entry.region;

            entry.region = 0;
            (region > 1).then_some(region)
        } else {
            entry.flags &= !DCX_KEEPCLIPRGN;
            None
        };

        entry.shape = None;

        let dc = entry.dc;
        let stale = entry.flags & DCX_STALE != 0;

        if let Some(region) = deleted {
            delete_object(self, region);
        }

        crate::gdi::visible_region::restore_vis_rgn(self, dc);

        if stale && let Some(at) = self.dc_entries.list.iter().position(|one| one.dc == dc) {
            self.stale_one(at);
        }
    }

    /// USER's hook, run where a context's flag is set and the hook is
    /// USER's: GDI calls it before the context is next used.
    pub fn user_hook_due(&mut self, dc: usize) {
        let hook = self.gdi.dcs[dc].hook;

        if hook.flag
            && hook.user
            && let Some(at) = self.dc_entries.list.iter().position(|one| one.dc == dc)
        {
            self.dc_hook(at);
        }
    }

    /// USER's hook (seg1 `8a00`), for `DCHC_INVALIDVISRGN`: the flag
    /// cleared (`8a18`), and for an entry in use its region worked out
    /// again, the region given applied again, selected, and its origin and
    /// brush origin set (`8a26`-`8a94`).
    pub fn dc_hook(&mut self, at: usize) {
        let dc = self.dc_entries.list[at].dc;

        self.gdi.dcs[dc].hook.flag = false;

        if self.dc_entries.list[at].flags & DCX_INUSE == 0 {
            return;
        }

        self.bind_entry(at);

        let region = self.rule_region(at);
        let region = self.with_given(at, region);

        self.select_vis(dc, region);
    }

    /// One entry made stale (seg1 `8b4f`): a free one emptied; one in use
    /// given `DCX_CLIPCHILDREN` and `DCX_CLIPSIBLINGS` by its window's style
    /// again, and USER's hook to be called the next time it is used.
    fn stale_one(&mut self, at: usize) {
        let entry = &self.dc_entries.list[at];

        if entry.flags & DCX_INUSE == 0 {
            let entry = &mut self.dc_entries.list[at];

            entry.flags = (entry.flags & DCX_CACHE) | DCX_EMPTY;
            entry.hwnd = 0;
            entry.clip = 0;
            entry.region = 0;
            entry.shape = None;
            return;
        }

        let style = self.user_style(entry.hwnd);
        let dc = entry.dc;
        let entry = &mut self.dc_entries.list[at];

        entry.flags &= !(DCX_CLIPCHILDREN | DCX_CLIPSIBLINGS);

        if style & WS_CLIPCHILDREN != 0 && style & WS_MINIMIZE == 0 {
            entry.flags |= DCX_CLIPCHILDREN;
        }

        if style & WS_CLIPSIBLINGS != 0 {
            entry.flags |= DCX_CLIPSIBLINGS;
        }

        entry.flags |= DCX_STALE;
        self.gdi.dcs[dc].hook.flag = true;
    }

    /// The entries a window's change makes stale (seg1 `8aa0`), as
    /// `dc-entries.ts`'s `makeStale` says: those of the window and every
    /// window within it; `how` 1 makes it its parent's where the parent has
    /// `WS_CLIPCHILDREN` (4) or the window `WS_CLIPSIBLINGS` (2).
    pub fn make_stale(&mut self, hwnd: u16, how: u32) {
        if hwnd == 0 || self.dc_entries.list.is_empty() {
            return;
        }

        let mut target = hwnd;
        let mut mode = how;

        if mode & 1 != 0 {
            mode = 0;

            if hwnd != self.desktop_hwnd() {
                let parent = self.parent_hwnd(hwnd);

                if self.user_style(parent) & WS_CLIPCHILDREN != 0 {
                    mode = 4;
                    target = parent;
                } else if self.user_style(hwnd) & WS_CLIPSIBLINGS != 0 {
                    mode = 2;
                    target = parent;
                }
            }
        }

        for at in 0..self.dc_entries.list.len() {
            let entry = &self.dc_entries.list[at];

            if entry.flags & DCX_EMPTY != 0 {
                continue;
            }

            let own = entry.hwnd;

            if entry.flags & (DCX_WINDOW | DCX_CACHE) == 0 {
                let style = self.user_style(own);
                let entry = &mut self.dc_entries.list[at];

                if style & WS_CLIPCHILDREN != 0 {
                    entry.flags |= DCX_CLIPCHILDREN;
                }

                if style & WS_MINIMIZE != 0 {
                    entry.flags &= !DCX_CLIPCHILDREN;
                }
            }

            let mut level = own;

            while level != 0 {
                if level == target {
                    let flags = self.dc_entries.list[at].flags;

                    if !(own == target
                        && (mode & 2 != 0 || (mode & 4 != 0 && flags & DCX_WINDOW != 0)))
                    {
                        self.stale_one(at);
                    }
                }

                level = self.parent_hwnd(level);
            }
        }
    }

    /// Which windows changed since the screen's owners were last worked
    /// out, and the entries each change makes stale as USER's own callers
    /// of seg1 `8aa0` would, as `dc-entries.ts`'s `windowsChanged` says.
    pub fn windows_changed(&mut self) {
        if self.dc_entries.list.is_empty() {
            return;
        }

        let desktop = self.desktop_hwnd();
        let mut now = HashMap::new();
        let mut places: HashMap<Option<usize>, usize> = HashMap::new();

        for &index in &self.z_order {
            let Some(window) = self.windows[index].as_ref() else {
                continue;
            };
            let order = places.entry(window.parent).or_insert(0);

            now.insert(
                (index, window.hwnd),
                Seen {
                    hwnd: window.hwnd,
                    parent: window
                        .parent
                        .and_then(|parent| self.windows[parent].as_ref())
                        .map_or(desktop, |parent| parent.hwnd),
                    rect: [
                        window.left,
                        window.top,
                        window.width,
                        window.height,
                        window.client.left,
                        window.client.top,
                        window.client.right,
                        window.client.bottom,
                    ],
                    minimized: window.placement == Placement::Minimized,
                    order: *order,
                    visible: window.visible,
                    clipping: window.style & (WS_CLIPCHILDREN | WS_CLIPSIBLINGS),
                },
            );
            *order += 1;
        }

        let before = self
            .dc_entries
            .seen
            .replace(now.clone())
            .unwrap_or_default();

        for (key, seen) in &before {
            if now.contains_key(key) {
                continue;
            }

            // Destroyed: hidden first, as `DestroyWindow` hides it; its
            // entries were let go as it was taken off the desktop
            // (`window_destroyed`). Its handle may be another window's by
            // now: the walk is its parent's.
            if seen.visible {
                self.stale_gone(seen);
            }
        }

        let mut keys: Vec<_> = now.keys().copied().collect();

        keys.sort_unstable();

        for key in keys {
            let seen = &now[&key];

            let Some(was) = before.get(&key) else {
                if seen.visible {
                    self.stale_for(seen, true);
                }

                continue;
            };

            if was.visible != seen.visible || was.clipping != seen.clipping {
                self.stale_for(seen, true);
            }

            if was.rect != seen.rect
                || was.minimized != seen.minimized
                || was.order != seen.order
                || was.parent != seen.parent
            {
                self.stale_for(seen, false);
            }
        }
    }

    /// USER's walk for a window's change: as shown or hidden, or as
    /// placed.
    fn stale_for(&mut self, seen: &Seen, shown: bool) {
        if !shown {
            let parent_style = self.user_style(seen.parent);

            self.make_stale(
                seen.parent,
                if parent_style & WS_CLIPCHILDREN != 0 {
                    4
                } else {
                    2
                },
            );
            return;
        }

        self.make_stale(seen.hwnd, 1);
    }

    /// USER's walk for a window gone, as hidden, by what it had: its
    /// parent's (`8ab1`-`8adc`).
    fn stale_gone(&mut self, seen: &Seen) {
        if self.user_style(seen.parent) & WS_CLIPCHILDREN != 0 {
            self.make_stale(seen.parent, 4);
        } else if seen.clipping & WS_CLIPSIBLINGS != 0 {
            self.make_stale(seen.parent, 2);
        }
    }
}

/// `DCHook`, USER's hook as a program calls it, by the data GDI gives it:
/// the context's handle here. 1.
pub fn dc_hook_call(
    system: &mut System,
    args: &mut crate::call::Args,
) -> Result<crate::call::Answer, crate::call::Stop> {
    let hdc = args.word(system);
    let code = args.word(system);
    let data = args.dword(system);
    let _ = args.dword(system);

    if code == 1
        && let Some(at) = system
            .entry_at(data as u16)
            .or_else(|| system.entry_at(hdc))
    {
        system.dc_hook(at);
    }

    Ok(crate::call::Answer::Dword(1))
}
