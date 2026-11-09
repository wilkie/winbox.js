//! `GetDC`, `GetWindowDC`, `GetDCEx` and `ReleaseDC`: USER's device
//! context entries lent and given back (`dc_entries`), as the TypeScript
//! engine's `GetDC.ts`, `GetWindowDC.ts`, `get-dc-ex.ts` and `ReleaseDC.ts`
//! have them. A window's own context, which USER draws through itself,
//! stays its own (`window_dc`).

use crate::call::{Answer, Args, Stop};
use crate::gdi::dc::DcBitmap;
use crate::handles::Object;
use crate::system::System;

/// What a window handle names a device context of: the desktop's, a
/// window's, or nothing that has one.
enum Target {
    Desktop,
    Window,
    None,
}

impl System {
    fn target_of(&self, hwnd: u16) -> Target {
        match self.handles.resolve(hwnd) {
            Some(Object::Desktop) => Target::Desktop,
            Some(Object::Window(index)) if self.windows[index].is_some() => Target::Window,
            _ => Target::None,
        }
    }

    /// A window's own device context, made the first time it is asked
    /// for: the one USER draws through itself, and a `CS_OWNDC` window's
    /// entry's (`dc_entries`).
    pub fn window_dc(&mut self, index: usize) -> usize {
        if let Some(dc) = self.windows[index].as_ref().and_then(|window| window.dc) {
            return dc;
        }

        let dc = self.new_dc(DcBitmap::Window(index), false);

        if let Some(window) = self.windows[index].as_mut() {
            window.dc = Some(dc);
        }

        dc
    }

    /// A device context comes with the System font in it, as every display
    /// context starts; USER's copy of a context's state made before the
    /// fonts were has it given here.
    pub(crate) fn with_font(&mut self, hdc: u16) {
        if let Some(Object::Dc(dc)) = self.handles.resolve(hdc)
            && self.gdi.dcs[dc].state.font.is_none()
        {
            let font = self.system_font();

            self.gdi.dcs[dc].state.font = font;
        }
    }

    /// A device context for a window's client area, or for the screen where
    /// the window is nought: one of USER's entries, `GetDCEx` of the window
    /// with `DCX_USESTYLE` and the high word's 2, of the desktop with
    /// `DCX_WINDOW | DCX_CACHE` (`USER.EXE` seg1 `8406`-`8428`); nought for
    /// a handle that is no window's.
    pub fn get_dc(&mut self, hwnd: u16) -> u16 {
        let desktop = self.handles.lookup(Object::Desktop).unwrap_or(0);

        if hwnd != 0 && matches!(self.target_of(hwnd), Target::None) {
            return 0;
        }

        let hdc = if hwnd == 0 {
            self.take_entry(desktop, 0, 0x0002_0003, None)
        } else {
            self.take_entry(hwnd, 0, 0x0003_0000, None)
        };

        self.with_font(hdc);
        hdc
    }

    /// A device context for the whole of a window, its frame, caption and
    /// menu bar as well as its client area: one of USER's entries, as
    /// `GetDCEx` with `DCX_WINDOW` and `DCX_USESTYLE` (seg1 `8457`-`8473`);
    /// nought, the desktop window, the whole screen (`visrgn`).
    pub fn get_window_dc(&mut self, hwnd: u16) -> u16 {
        let target = match self.target_of(hwnd) {
            Target::None if hwnd != 0 => return 0,
            Target::None => self.handles.lookup(Object::Desktop).unwrap_or(0),
            _ => hwnd,
        };
        let hdc = self.take_entry(target, 0, 0x0001_0001, None);

        self.with_font(hdc);
        hdc
    }

    /// A device context given back (seg1 `a61f`, `8805`): the window's
    /// handle checked, the entry found by its context alone. FALSE where it
    /// is not lent (`dcentry`, `dcreuse`).
    pub fn release_dc(&mut self, hwnd: u16, hdc: u16) -> Result<bool, Stop> {
        if hwnd != 0 && self.handles.resolve(hwnd).is_none() {
            return Ok(false);
        }

        Ok(self.release_entry(hdc, false))
    }

    /// A device context of a window's, by `GetDCEx`'s flags and a region
    /// (`USER.EXE` seg1 `a64c`, then `847b`-`87b7`; `dc_entries`).
    /// **Recorded** by `getdcex`, `visrule` and `dcentry`.
    pub fn get_dc_ex(&mut self, hwnd: u16, region: u16, flags: u32) -> u16 {
        if hwnd == 0 || matches!(self.target_of(hwnd), Target::None) {
            return 0;
        }

        // A region given that is not one, nought (`a658`-`a66d`): even 1,
        // which USER's own callers pass for the whole screen (`visrule`).
        if region != 0 && crate::gdi::regions::region_shape(self, region).is_none() {
            return 0;
        }

        let hdc = self.take_entry(hwnd, region, flags, None);

        self.with_font(hdc);
        hdc
    }
}

pub fn get_dc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    Ok(Answer::Word(system.get_dc(hwnd)))
}

pub fn release_dc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let hdc = args.word(system);

    Ok(Answer::Word(u16::from(system.release_dc(hwnd, hdc)?)))
}

/// A device context of a window's, by flags and a region.
pub fn get_dc_ex(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let region = args.word(system);
    let flags = args.dword(system);

    Ok(Answer::Word(system.get_dc_ex(hwnd, region, flags)))
}

/// The whole of a window's device context, or the screen with nought.
pub fn get_window_dc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    Ok(Answer::Word(system.get_window_dc(hwnd)))
}
