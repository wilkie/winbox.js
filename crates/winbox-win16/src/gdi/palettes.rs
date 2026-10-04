//! Logical palettes, and the 256-colour display's system palette as
//! programs realize theirs into it, as winbox.js's `palettes.ts` and
//! `system-palette.ts` keep them.
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
    fn entries_of(&self, object: usize) -> Vec<[u8; 4]> {
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

    /// A logical palette realized into the system palette: each entry's
    /// slot kept on the palette; what `RealizePalette` answers, and whether
    /// a slot changed colour.
    fn realize(&mut self, object: usize, foreground: bool) -> (u16, bool) {
        let entries = self.entries_of(object);
        let (slots_were, taken_were) = {
            let palette = self.palette_mut(object);

            (palette.slots.clone(), palette.taken.clone())
        };
        let system = self.system_palette.as_mut().expect("the system palette");

        // Realized already, and every slot it took still its own.
        if slots_were.is_some()
            && taken_were.as_ref().is_some_and(|taken| {
                taken
                    .iter()
                    .all(|&slot| system.owners[slot] == Some(object))
            })
        {
            return (0, false);
        }

        if foreground {
            system.owners.fill(None);
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

        let count = entries.len() as u16;
        let palette = self.palette_mut(object);

        palette.slots = Some(slots);
        palette.taken = Some(taken);
        (count, changed)
    }
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

/// The palette the device context had, the stock one to begin with; kept
/// by the context's handle whether it is for the background (`palreal`).
pub fn select_palette(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let handle = args.word(system);
    let background = args.word(system) != 0;
    let (Some(dc), Some(object)) = (super::dc::dc_of(system, hdc), system.palette_of(handle))
    else {
        return Ok(Answer::Word(0));
    };
    let before = match system.gdi.dcs[dc].palette {
        Some(was) => system.handles.lookup(Object::Gdi(was)).unwrap_or(0),
        None => super::objects::default_palette(system),
    };

    system.gdi.dcs[dc].palette = Some(object);
    system.palette_background.insert(hdc, background);
    Ok(Answer::Word(before))
}

/// Nought on a display with fixed colours, or into a memory device context;
/// on the 256-colour display the palette realized, in the foreground unless
/// it was selected for the background or its window is not the active one
/// or in it, and where a slot changed colour the top-level windows sent
/// `WM_PALETTECHANGED` (`palreal`).
pub fn realize_palette(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (changed, window, answer) = {
            let mut system = engine.system();
            let hdc = args.word(&system);

            if system.system_palette().is_none() {
                return Ok(Answer::Word(0));
            }

            let Some(dc) = super::dc::dc_of(&system, hdc) else {
                return Ok(Answer::Word(0));
            };
            let Some(object) = system.gdi.dcs[dc]
                .palette
                .filter(|_| !system.gdi.dcs[dc].memory)
            else {
                return Ok(Answer::Word(0));
            };

            if !matches!(
                &system.gdi.objects[object],
                GdiObject::Palette(Palette {
                    entries: Some(_),
                    ..
                })
            ) {
                return Ok(Answer::Word(0));
            }

            let window = system.z_order.iter().copied().find(|&index| {
                system.windows[index]
                    .as_ref()
                    .is_some_and(|window| window.dc == Some(dc))
            });
            let active = system.active_window();
            let mut in_active = window.is_none();
            let mut at = window;

            while let Some(index) = at.filter(|_| !in_active) {
                in_active = Some(index) == active;
                at = system.windows[index]
                    .as_ref()
                    .and_then(|window| window.parent);
            }

            let background = system
                .palette_background
                .get(&hdc)
                .copied()
                .unwrap_or(false);
            let (answer, changed) = system.realize(object, !background && in_active);
            let hwnd = window
                .and_then(|index| system.windows[index].as_ref())
                .map_or(0, |window| window.hwnd);

            (changed, hwnd, answer)
        };

        if changed {
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
/// to the static colours is not followed.
pub fn set_system_palette_use(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);

    let usage = args.word(system);

    if system.system_palette().is_none() {
        return Ok(Answer::Word(0));
    }

    let before = system.system_palette_use.unwrap_or(1);

    system.system_palette_use = Some(usage);
    Ok(Answer::Word(before))
}
