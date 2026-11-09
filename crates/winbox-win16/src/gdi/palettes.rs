//! Logical palettes, and the 256-colour display's system palette as programs
//! realize theirs into it.
//!
//! **Recorded** by `palette` on the VGA, the EGA, the Super VGA and the
//! Hercules, none of which has `RC_PALETTE`: a palette keeps its entries as
//! given, flags and all; `GetPaletteEntries` and `SetPaletteEntries` answer
//! how many they read or wrote, stopping at the palette's end;
//! `ResizePalette` answers 1; `GetNearestPaletteIndex` the entry nearest in
//! red, green and blue squared, the first of equals; `SelectPalette` the
//! palette the device context had, the stock one to begin with;
//! `RealizePalette` nought; `GetSystemPaletteEntries` the display's own
//! colours, flags nought; `GetSystemPaletteUse` and `SetSystemPaletteUse`
//! nought.
//!
//! **Recorded** by `palreal` and `paldib` on the Super VGA 256-colour
//! driver: realized in the foreground, a palette's colours take the slots
//! between the static colours in order from 10, whatever was there; a
//! colour that is a static one is drawn as that and takes no slot; a colour
//! the palette has had already shares its slot, unless either is
//! `PC_NOCOLLAPSE` or `PC_RESERVED`. Realized in the background, a
//! palette's colours take the free slots after the foreground's.
//! `RealizePalette` answers the palette's count, or nought for one realized
//! already. `AnimatePalette` changes a reserved entry's slot in place. Where
//! a slot changes colour, the top-level windows are sent
//! `WM_PALETTECHANGED`. The slots are the screen's own palette, changed in
//! place: a pixel is its slot, and is its slot's colour.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use std::cell::RefCell;
use std::rc::Rc;

use winbox_raster::DevicePalette;
use winbox_raster::colour_match::STATICS;
use winbox_raster::palette_colour::DEFAULT_ENTRIES;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::handles::{Kind, Object};
use crate::messages::Param;
use crate::system::System;

use super::{GdiObject, Palette};

const WM_PALETTECHANGED: u16 = 0x0311;

const PC_RESERVED: u8 = 0x01;
const PC_EXPLICIT: u8 = 0x02;
const PC_NOCOLLAPSE: u8 = 0x04;

/// The first and last slots between the static colours.
const FIRST: usize = 10;
const LAST: usize = 245;

/// The 256-colour display's system palette: the screen's own colours, and
/// the palette each slot was taken for, by object, or none for a free one.
#[derive(Debug)]
pub struct SystemPalette {
    pub colours: Rc<RefCell<DevicePalette>>,
    owners: Vec<Option<usize>>,
}

impl System {
    /// The system palette, on a display of 256 colours: made the first time
    /// it is wanted, the screen's colours put back as they were.
    fn system_palette(&mut self) -> Option<&mut SystemPalette> {
        if self.display.bits_per_pixel != 8 {
            return None;
        }

        if self.system_palette.is_none() {
            let colours = winbox_raster::palette_for_display(self.display_kind(), None);

            colours.borrow_mut().reset();
            self.system_palette = Some(SystemPalette {
                colours,
                owners: vec![None; 256],
            });
        }

        self.system_palette.as_mut()
    }

    /// The palette object a handle stands for.
    fn palette_of(&self, handle: u16) -> Option<usize> {
        match self.handles.resolve(handle)? {
            Object::Gdi(index) if matches!(self.gdi.objects[index], GdiObject::Palette(_)) => {
                Some(index)
            }
            _ => None,
        }
    }

    fn palette_mut(&mut self, object: usize) -> &mut Palette {
        match &mut self.gdi.objects[object] {
            GdiObject::Palette(palette) => palette,
            _ => unreachable!("a palette"),
        }
    }

    /// A palette's entries, the stock one's where it has none of its own.
    pub(crate) fn entries_of(&self, object: usize) -> Vec<[u8; 4]> {
        match &self.gdi.objects[object] {
            GdiObject::Palette(palette) => palette
                .entries
                .clone()
                .unwrap_or_else(|| DEFAULT_ENTRIES.to_vec()),
            _ => Vec::new(),
        }
    }

    fn read_entries(&self, far: u32, count: usize) -> Vec<[u8; 4]> {
        (0..count)
            .map(|at| {
                let address =
                    far & 0xffff_0000 | u32::from((far as u16).wrapping_add(at as u16 * 4));
                let bytes = self.read_far(address, 4);

                [bytes[0], bytes[1], bytes[2], bytes[3]]
            })
            .collect()
    }

    fn write_entries(&mut self, far: u32, entries: &[[u8; 4]]) {
        let bytes: Vec<u8> = entries.iter().flatten().copied().collect();

        self.write_far(far, &bytes);
    }

    /// A palette USER makes of a wallpaper's colours and realizes for the
    /// desktop (`USER.EXE` seg21 `0000`, `068b`-`06df`): its handle and each
    /// entry's slot; none on a display of fixed colours. Realized in the
    /// background, as USER's `SelectPalette` makes any palette but the
    /// active window's (seg6 `00a2`-`011f`). **Recorded** by `deskwall` on
    /// the 256-colour display: its colours shown as they are, and no
    /// window sent `WM_PALETTECHANGED`.
    pub(crate) fn desk_palette(&mut self, colours: &[[u8; 3]]) -> Option<(u16, Vec<usize>)> {
        self.system_palette()?;

        let entries = colours.iter().map(|&[r, g, b]| [r, g, b, 0]).collect();
        let object = self.gdi_object(GdiObject::Palette(Palette {
            entries: Some(entries),
            slots: None,
            taken: None,
        }));
        let handle = self
            .handles
            .allocate(Kind::Gdi, Object::Gdi(object))
            .unwrap_or(0);

        self.realize(object, false);

        let slots = match &self.gdi.objects[object] {
            GdiObject::Palette(palette) => palette.slots.clone().unwrap_or_default(),
            _ => Vec::new(),
        };

        Some((handle, slots))
    }

    /// A logical palette realized into the system palette: each entry's slot
    /// kept on the palette; how many entries are in a slot they were not in
    /// before, and how many slots were given a colour.
    #[allow(clippy::too_many_lines)]
    fn realize(&mut self, object: usize, foreground: bool) -> (u16, u16) {
        let entries = self.entries_of(object);
        let (slots_were, taken_were) = {
            let palette = self.palette_mut(object);

            (palette.slots.clone(), palette.taken.clone())
        };
        let system = self.system_palette.as_mut().expect("the system palette");
        let own_slots = taken_were.as_ref().is_some_and(|taken| {
            taken
                .iter()
                .all(|&slot| system.owners[slot] == Some(object))
        });

        // Realized already in the background, and every slot it took still
        // its own: nothing to do (`GDI.EXE` seg22 `0e63`).
        if !foreground && slots_were.is_some() && own_slots {
            return (0, 0);
        }

        if foreground {
            system.owners.fill(None);
        }

        // Realized before, now in the foreground: each entry keeps the slot
        // it had, the slot's colour put back where another palette took it
        // since, and nothing is mapped anew (seg22 `0dd2`-`0e2e`).
        if foreground && let (Some(before), Some(taken)) = (&slots_were, &taken_were) {
            let mut written = 0u16;

            for &slot in taken {
                let index = before.iter().position(|&at| at == slot);
                let colour = index
                    .and_then(|index| entries.get(index))
                    .map_or([0, 0, 0], |&[r, g, b, _]| [r, g, b]);

                if system.colours.borrow().colours[slot] != colour {
                    system.colours.borrow_mut().recolour(slot, colour);
                    written += 1;
                }

                system.owners[slot] = Some(object);
            }

            if written > 0 {
                system.colours.borrow_mut().rewritten = true;
            }

            return (0, written);
        }

        let mut slots: Vec<usize> = Vec::with_capacity(entries.len());
        let mut taken = Vec::new();
        let mut changed = false;
        let mut next = FIRST;

        for (index, &[red, green, blue, flags]) in entries.iter().enumerate() {
            if flags & PC_EXPLICIT != 0 {
                slots.push(usize::from(red));
                continue;
            }

            let own = flags & (PC_RESERVED | PC_NOCOLLAPSE) != 0;

            if !own {
                let colours = system.colours.borrow();

                if let Some(&fixed) = STATICS
                    .iter()
                    .find(|&&at| colours.colours[at] == [red, green, blue])
                {
                    slots.push(fixed);
                    continue;
                }

                // One of this palette's before it.
                let earlier = entries[..index].iter().position(|&[r, g, b, f]| {
                    f & (PC_RESERVED | PC_NOCOLLAPSE) == 0 && [r, g, b] == [red, green, blue]
                });

                if let Some(earlier) = earlier {
                    slots.push(slots[earlier]);
                    continue;
                }

                // In the background, any slot of that colour held.
                if !foreground
                    && let Some(held) = (0..256).find(|&at| {
                        system.owners[at].is_some() && colours.colours[at] == [red, green, blue]
                    })
                {
                    slots.push(held);
                    continue;
                }
            }

            while next <= LAST && system.owners[next].is_some() {
                next += 1;
            }

            if next > LAST {
                slots.push(system.colours.borrow_mut().index(red, green, blue));
                continue;
            }

            if system.colours.borrow().colours[next] != [red, green, blue] {
                system
                    .colours
                    .borrow_mut()
                    .recolour(next, [red, green, blue]);
                changed = true;
            }

            system.owners[next] = Some(object);
            taken.push(next);
            slots.push(next);
            next += 1;
        }

        // Where a slot changed, GDI sends the driver the whole palette, from
        // nought (`GDI.EXE` seg22 `0e51`, `0fd3`).
        if changed {
            system.colours.borrow_mut().rewritten = true;
        }

        // The entries whose slot is not the one they had (seg22 `0f86`), and
        // the slots given a colour (`0f14`).
        let moved = slots
            .iter()
            .enumerate()
            .filter(|&(at, &slot)| {
                slots_were
                    .as_ref()
                    .and_then(|before| before.get(at))
                    .is_none_or(|&was| was != slot)
            })
            .count() as u16;
        let written = taken.len() as u16;
        let palette = self.palette_mut(object);

        palette.slots = Some(slots);
        palette.taken = Some(taken);
        (moved, written)
    }

    /// GDI's palettes: the one last selected in the foreground, `[480h]`,
    /// and the one last realized, `[482h]` (`GDI.EXE` seg22 `0271`, `1088`).
    fn palette_state(&mut self) -> &mut (u16, u16) {
        &mut self.palette_state
    }

    /// The palette selected into a device context: its handle, the stock
    /// one's where none was selected.
    fn palette_handle_of(&mut self, dc: usize) -> u16 {
        match self.gdi.dcs[dc].palette {
            Some(object) => self.handles.lookup(Object::Gdi(object)).unwrap_or(0),
            None => super::objects::default_palette(self),
        }
    }

    /// The window a device context is lent for, as USER's entries keep it
    /// (`dc_entries`), or whose own context it is, by its index.
    fn window_of_dc(&self, dc: usize) -> Option<usize> {
        if let Some(lent) = self.entry_window_of_dc(dc) {
            return lent;
        }

        self.z_order.iter().copied().find(|&index| {
            self.windows[index]
                .as_ref()
                .is_some_and(|window| window.dc == Some(dc))
        })
    }
}

/// `GDISelectPalette`: **read out** of `GDI.EXE` seg22 `0271`; the palette
/// before answered, and one selected for the foreground, not the one there
/// already, GDI's foreground palette, no palette then realized last
/// (`dcinner`).
pub fn gdi_select_palette(system: &mut System, hdc: u16, handle: u16, background: bool) -> u16 {
    // A metafile's context keeps it, and answers 1 (`metafile.rs`).
    if let Some(kept) = super::metafile::select_palette_in_metafile(system, hdc, handle) {
        return kept;
    }

    let (Some(dc), Some(object)) = (super::dc::dc_of(system, hdc), system.palette_of(handle))
    else {
        return 0;
    };
    let before = system.palette_handle_of(dc);

    system.gdi.dcs[dc].palette = Some(object);

    if !background && handle != system.palette_state().0 {
        *system.palette_state() = (handle, 0);
    }

    before
}

pub fn gdi_select_palette_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let handle = args.word(system);
    let background = args.word(system) != 0;

    Ok(Answer::Word(gdi_select_palette(
        system, hdc, handle, background,
    )))
}

/// `GDIRealizePalette`: **read out** of seg22 `1088` and `0cfb`. Nought on
/// a display with fixed colours and for the palette realized last;
/// otherwise it becomes that, realized in the foreground if it is GDI's
/// foreground palette. The entries moved, the slots written above them
/// (`dcinner`).
pub fn gdi_realize_palette(system: &mut System, hdc: u16) -> u32 {
    // A metafile's context keeps it, and answers 1 (`metafile.rs`).
    if let Some(kept) = super::metafile::realize_palette_in_metafile(system, hdc) {
        return kept;
    }

    if system.system_palette().is_none() {
        return 0;
    }

    let Some(dc) = super::dc::dc_of(system, hdc) else {
        return 0;
    };
    let Some(object) = system.gdi.dcs[dc].palette else {
        return 0;
    };

    if !matches!(
        &system.gdi.objects[object],
        GdiObject::Palette(Palette {
            entries: Some(_),
            ..
        })
    ) {
        return 0;
    }

    let handle = system.palette_handle_of(dc);
    let (foreground, realized) = *system.palette_state();

    if handle == realized {
        return 0;
    }

    system.palette_state().1 = handle;

    let (moved, written) = system.realize(object, handle == foreground);

    u32::from(moved) | (u32::from(written) << 16)
}

pub fn gdi_realize_palette_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);

    Ok(Answer::Dword(gdi_realize_palette(system, hdc)))
}

/// `IsDCCurrentPalette`: **read out** of seg22 `0b0c`, the device context's
/// palette compared with GDI's foreground palette (`dcinner`).
pub fn is_dc_current_palette(system: &mut System, hdc: u16) -> bool {
    let Some(dc) = super::dc::dc_of(system, hdc) else {
        return false;
    };
    let handle = system.palette_handle_of(dc);

    handle == system.palette_state().0
}

pub fn is_dc_current_palette_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);

    Ok(Answer::Word(u16::from(is_dc_current_palette(system, hdc))))
}

/// `RealizeDefaultPalette`: **read out** of seg22 `101d`. On a display with
/// a palette every slot between the static colours freed, keeping its
/// colour, the stock palette GDI's foreground palette and the one realized
/// last, and nought; on one with fixed colours, what AX held, GDI's data
/// segment (`dcinner`).
pub fn realize_default_palette_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);

    if system.system_palette().is_none() {
        return Ok(Answer::Dword(u32::from(
            super::text::enumerate::gdi_data_selector(system),
        )));
    }

    if super::dc::dc_of(system, hdc).is_none() {
        return Ok(Answer::Dword(0));
    }

    if let Some(palette) = system.system_palette() {
        palette.owners.fill(None);
    }

    let stock = super::objects::default_palette(system);

    *system.palette_state() = (stock, stock);
    Ok(Answer::Dword(0))
}

/// `UpdateColors`: **read out** of seg22 `0109` and `0773`; nought either
/// way, the redrawing on a display with a palette not followed (`dcinner`).
pub fn update_colors_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);

    Ok(Answer::Word(0))
}

/// A palette of the entries a `LOGPALETTE` gives: its version, its count,
/// and the entries.
pub fn create_palette(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    if far == 0 {
        return Ok(Answer::Word(0));
    }

    let header = system.read_far(far, 4);
    let count = usize::from(u16::from_le_bytes([header[2], header[3]]));
    let entries = system.read_entries(far.wrapping_add(4), count);
    let object = system.gdi_object(GdiObject::Palette(Palette {
        entries: Some(entries),
        slots: None,
        taken: None,
    }));

    Ok(Answer::Word(
        system
            .handles
            .allocate(Kind::Gdi, Object::Gdi(object))
            .unwrap_or(0),
    ))
}

/// How many entries were read, into the buffer, stopping at the end.
pub fn get_palette_entries(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let start = usize::from(args.word(system));
    let count = usize::from(args.word(system));
    let far = args.dword(system);
    let Some(object) = system.palette_of(handle) else {
        return Ok(Answer::Word(0));
    };
    let entries: Vec<[u8; 4]> = system
        .entries_of(object)
        .into_iter()
        .skip(start)
        .take(count)
        .collect();

    system.write_entries(far, &entries);
    Ok(Answer::Word(entries.len() as u16))
}

/// How many entries were written, from the buffer, stopping at the end.
pub fn set_palette_entries(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let start = usize::from(args.word(system));
    let count = usize::from(args.word(system));
    let far = args.dword(system);
    let Some(object) = system.palette_of(handle) else {
        return Ok(Answer::Word(0));
    };
    let mut entries = system.entries_of(object);
    let count = count.min(entries.len().saturating_sub(start));

    for (at, entry) in system.read_entries(far, count).into_iter().enumerate() {
        entries[start + at] = entry;
    }

    system.palette_mut(object).entries = Some(entries);
    Ok(Answer::Word(count as u16))
}

/// The palette made that long, entries added noughts; 1.
pub fn resize_palette(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let length = usize::from(args.word(system));
    let Some(object) = system.palette_of(handle) else {
        return Ok(Answer::Word(0));
    };
    let mut entries = system.entries_of(object);

    entries.resize(length, [0; 4]);
    system.palette_mut(object).entries = Some(entries);

    // Kept in each metafile being recorded that holds it (`metafile.rs`).
    super::metafile::resize_in_metafiles(system, handle, length as u16);
    Ok(Answer::Word(1))
}

/// The entry nearest a colour, the first of equals.
pub fn get_nearest_palette_index(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let colorref = args.dword(system);
    let Some(object) = system.palette_of(handle) else {
        return Ok(Answer::Word(0));
    };
    let [red, green, blue, _] = colorref.to_le_bytes();
    let distance = |[r, g, b, _]: [u8; 4]| {
        (i32::from(r) - i32::from(red)).pow(2)
            + (i32::from(g) - i32::from(green)).pow(2)
            + (i32::from(b) - i32::from(blue)).pow(2)
    };
    let mut best = 0;
    let mut nearest = i32::MAX;

    for (index, entry) in system.entries_of(object).into_iter().enumerate() {
        let away = distance(entry);

        if away < nearest {
            nearest = away;
            best = index;
        }
    }

    Ok(Answer::Word(best as u16))
}

/// USER's `SelectPalette`: **read out** of `USER.EXE` seg6 `00a2`. A
/// palette is selected for the background when asked, when it is the stock
/// one, and when the device context is no window's, or the window is
/// neither the active one nor in it; then GDI's `GDISelectPalette`
/// (`dcinner`, `palreal`).
pub fn select_palette(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let handle = args.word(system);
    let force = args.word(system) != 0;
    let mut background = true;

    if !force
        && handle != super::objects::default_palette(system)
        && let Some(dc) = super::dc::dc_of(system, hdc)
    {
        let active = system.active_window();
        let mut at = system.window_of_dc(dc);

        while let Some(index) = at.filter(|_| background) {
            background = Some(index) != active;
            at = system.windows[index]
                .as_ref()
                .and_then(|window| window.parent);
        }
    }

    Ok(Answer::Word(gdi_select_palette(
        system, hdc, handle, background,
    )))
}

/// USER's `RealizePalette`: **read out** of `USER.EXE` seg6 `0134`. GDI's
/// `GDIRealizePalette`, and where it gave a slot a colour and the palette
/// is GDI's foreground palette, the top-level windows sent
/// `WM_PALETTECHANGED` with the device context's window (`palreal`).
pub fn realize_palette(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (answer, window) = {
            let mut system = engine.system();
            let hdc = args.word(&system);
            let answer = gdi_realize_palette(&mut system, hdc);
            let current = answer >> 16 != 0 && is_dc_current_palette(&mut system, hdc);
            let window = super::dc::dc_of(&system, hdc)
                .and_then(|dc| system.window_of_dc(dc))
                .and_then(|index| system.windows[index].as_ref())
                .map(|window| window.hwnd)
                .filter(|_| current);

            (answer as u16, window)
        };

        if let Some(window) = window {
            let tops: Vec<u16> = {
                let system = engine.system();

                system
                    .z_order
                    .iter()
                    .filter_map(|&index| system.windows[index].as_ref())
                    .filter(|window| window.parent.is_none() && window.hwnd != 0)
                    .map(|window| window.hwnd)
                    .collect()
            };

            for top in tops {
                engine
                    .send_message(top, WM_PALETTECHANGED, window, &mut Param::Value(0))
                    .await?;
            }
        }

        Ok(Answer::Word(answer))
    })
}

/// A palette's reserved entries changed, and on the 256-colour display,
/// if it is realized, their slots of the system palette with them.
pub fn animate_palette(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let start = usize::from(args.word(system));
    let count = usize::from(args.word(system));
    let far = args.dword(system);
    let Some(object) = system.palette_of(handle) else {
        return Ok(Answer::Nothing);
    };

    if far == 0
        || !matches!(
            &system.gdi.objects[object],
            GdiObject::Palette(Palette {
                entries: Some(_),
                ..
            })
        )
    {
        return Ok(Answer::Nothing);
    }

    let colours = system.read_entries(far, count);

    if system.system_palette().is_some() {
        for (at, colour) in colours.into_iter().enumerate() {
            let index = start + at;
            let palette = system.palette_mut(object);
            let reserved = palette
                .entries
                .as_ref()
                .and_then(|entries| entries.get(index))
                .is_some_and(|entry| entry[3] & PC_RESERVED != 0);

            if !reserved {
                continue;
            }

            if let Some(entries) = palette.entries.as_mut() {
                entries[index] = colour;
            }

            let slot = palette
                .slots
                .as_ref()
                .and_then(|slots| slots.get(index))
                .copied();
            let system_palette = system.system_palette.as_mut().expect("the system palette");

            if let Some(slot) = slot
                && system_palette.owners[slot] == Some(object)
            {
                system_palette
                    .colours
                    .borrow_mut()
                    .recolour(slot, [colour[0], colour[1], colour[2]]);
            }
        }

        if let Some(screen) = &system.screen {
            screen.context.mark_rect(
                0,
                0,
                i32::from(system.display.width),
                i32::from(system.display.height),
            );
        }
    } else if let Some(entries) = system.palette_mut(object).entries.as_mut() {
        for (at, colour) in colours.into_iter().enumerate() {
            if let Some(entry) = entries.get_mut(start + at)
                && entry[3] & PC_RESERVED != 0
            {
                *entry = colour;
            }
        }
    }

    Ok(Answer::Nothing)
}

/// How many of the display's own colours were read, flags nought.
pub fn get_system_palette_entries(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let start = usize::from(args.word(system));
    let count = usize::from(args.word(system));
    let far = args.dword(system);

    if system.handles.resolve(hdc).is_none() {
        return Ok(Answer::Word(0));
    }

    // The screen's colours, put back as they were as this run's system
    // palette is first wanted: another run in the same process may have
    // realized a palette into them.
    system.system_palette();

    let colours = winbox_raster::palette_for_display(system.display_kind(), None);
    let entries: Vec<[u8; 4]> = colours
        .borrow()
        .colours
        .iter()
        .skip(start)
        .take(count)
        .map(|&[r, g, b]| [r, g, b, 0])
        .collect();

    system.write_entries(far, &entries);
    Ok(Answer::Word(entries.len() as u16))
}

/// Nought on a display with fixed colours; on the 256-colour display how
/// the static colours are used, `SYSPAL_STATIC`, 1, until set otherwise.
pub fn get_system_palette_use(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);

    if system.system_palette().is_none() {
        return Ok(Answer::Word(0));
    }

    Ok(Answer::Word(system.system_palette_use.unwrap_or(1)))
}

/// The use set, and the one before answered; what `SYSPAL_NOSTATIC` does
/// to the static colours is not followed. Any use but `SYSPAL_NOSTATIC`
/// puts the statics back and sends the driver the whole palette (`GDI.EXE`
/// seg22 `0a94`-`0af3`).
pub fn set_system_palette_use(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);

    let usage = args.word(system);
    let Some(palette) = system.system_palette() else {
        return Ok(Answer::Word(0));
    };

    if usage != 2 {
        palette.colours.borrow_mut().rewritten = true;
    }

    let before = system.system_palette_use.unwrap_or(1);

    system.system_palette_use = Some(usage);
    Ok(Answer::Word(before))
}

/// Whether TrueType is installed and enabled.
///
/// **Read out** of `GDI.EXE` (seg7 `0d36`): for a size above nought, a
/// `RASTERIZER_STATUS` of six bytes is made -- `TT_AVAILABLE` where the
/// TrueType table has a font, `TT_ENABLED` where `TTEnable` is on, and
/// GDI's language, 409h -- and as many of its bytes copied as the size
/// says, AX left the language; with TrueType off there is no table and no
/// language, and the flags and the answer are nought. A size of nought or
/// less answers nought and writes nothing. **Recorded** by `fontboot`. More
/// than six bytes asked for copies what is on GDI's stack after the
/// structure; here only the six are written.
pub fn get_rasterizer_caps(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let size = args.signed(system);

    if size <= 0 {
        return Ok(Answer::Word(0));
    }

    let (flags, language) = {
        let fonts = system.fonts();

        if fonts.true_type_off {
            (0u16, 0u16)
        } else {
            (u16::from(!fonts.true_type_directory.is_empty()) | 2, 0x409)
        }
    };
    let mut bytes = vec![6, 0];

    bytes.extend(flags.to_le_bytes());
    bytes.extend(language.to_le_bytes());
    bytes.truncate(size as usize);
    system.write_far(far, &bytes);
    Ok(Answer::Word(language))
}
