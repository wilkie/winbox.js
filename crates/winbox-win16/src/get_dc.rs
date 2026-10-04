//! `GetDC` and `ReleaseDC`, as winbox.js gives a window's device context:
//! one context over the window's client area, which every handle given for
//! it stands for, so that what a program selects into it outlives the
//! release -- a divergence from Windows' pool of five that is older than
//! this port. The handles released are kept, still answering, five of them,
//! and the next `GetDC` of the same window answers the last of them again
//! (`reldc`).

use crate::call::{Answer, Args, Stop};
use crate::gdi::dc::DcBitmap;
use crate::gdi::objects::get_stock_object;
use crate::handles::{Kind, Object};
use crate::system::System;

const BLACK_PEN: i16 = 7;
const WHITE_BRUSH: i16 = 0;
const CS_OWNDC: u16 = 0x0020;
const CS_CLASSDC: u16 = 0x0040;

/// How many released contexts USER keeps.
const CACHED: usize = 5;

/// What a window handle names a device context of: the screen's, a
/// window's, or nothing that has one.
enum Surface {
    Screen,
    Window(usize),
    None,
}

impl System {
    fn surface_of(&self, hwnd: u16) -> Surface {
        if hwnd == 0 {
            return Surface::Screen;
        }

        match self.handles.resolve(hwnd) {
            Some(Object::Desktop) => Surface::Screen,
            Some(Object::Window(index)) if self.windows[index].is_some() => Surface::Window(index),
            _ => Surface::None,
        }
    }

    /// A window's device context, made the first time it is asked for.
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

    /// The device context a window handle names, if it names one.
    fn dc_named(&mut self, hwnd: u16) -> Option<usize> {
        match self.surface_of(hwnd) {
            Surface::Screen => Some(self.screen_dc()),
            Surface::Window(index) => Some(self.window_dc(index)),
            Surface::None => None,
        }
    }

    /// A common device context as `GetDC` and `BeginPaint` give it: what was
    /// selected and set in the last forgotten -- the System font, black
    /// text on white, opaque, `R2_COPYPEN`, the black pen and the white
    /// brush -- for a window whose class has no device context of its own
    /// (`dcreset`). While another context of the window is still out, it is
    /// left as it is.
    fn reset_common(&mut self, index: usize, dc: usize) {
        let live = self.gdi.dcs[dc].live;

        self.gdi.dcs[dc].live = live + 1;

        if live > 0 {
            return;
        }

        let style = self.windows[index]
            .as_ref()
            .and_then(|window| self.class_named(&window.class))
            .map_or(0, |class| self.classes[class].style);

        if style & (CS_OWNDC | CS_CLASSDC) != 0 {
            return;
        }

        let font = self.system_font();
        let pen = self.stock_index(BLACK_PEN);
        let brush = self.stock_index(WHITE_BRUSH);
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
    fn stock_index(&mut self, stock: i16) -> Option<usize> {
        let handle = get_stock_object(self, stock);

        match self.handles.resolve(handle)? {
            Object::Gdi(index) => Some(index),
            _ => None,
        }
    }

    /// The context released last over a device context, given out again.
    fn take_from_cache(&mut self, dc: usize) -> Option<u16> {
        let at = self.dc_cache.iter().rposition(|&(handle, over)| {
            over == dc && self.handles.resolve(handle) == Some(Object::Dc(dc))
        })?;

        Some(self.dc_cache.remove(at).0)
    }

    /// A context given back: kept, still answering, the one released
    /// longest ago let go past five.
    fn release_to_cache(&mut self, hdc: u16, dc: usize) {
        if self.dc_cache.iter().any(|&(handle, _)| handle == hdc) {
            return;
        }

        self.dc_cache.push((hdc, dc));

        while self.dc_cache.len() > CACHED {
            let (handle, _) = self.dc_cache.remove(0);

            self.handles.free(handle);
        }
    }
}

impl System {
    /// A device context for a window's client area, or for the screen where
    /// the window is nought or the desktop; nought for a handle that is no
    /// window's. It comes with the System font in it. A window's has no
    /// saved levels, brush origin or clip region left from before, and is
    /// reset as a common one.
    pub fn get_dc(&mut self, hwnd: u16) -> u16 {
        let surface = self.surface_of(hwnd);
        let Some(dc) = self.dc_named(hwnd) else {
            return 0;
        };

        if self.gdi.dcs[dc].state.font.is_none() {
            let font = self.system_font();

            self.gdi.dcs[dc].state.font = font;
        }

        if let Surface::Window(index) = surface {
            self.gdi.dcs[dc].saved.clear();
            self.gdi.dcs[dc].state.brush_org = None;
            self.gdi.dcs[dc].state.clip = None;
            self.reset_common(index, dc);
        }

        match self.take_from_cache(dc) {
            Some(handle) => handle,
            None => self.handles.allocate(Kind::Dc, Object::Dc(dc)).unwrap_or(0),
        }
    }

    /// A device context for the whole of a window, its frame, caption and
    /// menu bar as well as its client area, its origin at the window's
    /// corner: a program draws its own frame with one. A new one each
    /// time, with the System font in it; nought for a handle that is no
    /// window's, and with nought, one over the whole screen, as `GetDC`'s.
    pub fn get_window_dc(&mut self, hwnd: u16) -> u16 {
        let bitmap = match self.surface_of(hwnd) {
            Surface::Screen => DcBitmap::Screen,
            Surface::Window(index) => DcBitmap::Whole(index),
            Surface::None => return 0,
        };
        let dc = self.new_dc(bitmap, false);
        let font = self.system_font();

        self.gdi.dcs[dc].state.font = font;

        if hwnd != 0 {
            self.window_dcs.insert(dc, hwnd);
        }

        self.handles.allocate(Kind::Dc, Object::Dc(dc)).unwrap_or(0)
    }

    /// A device context given back by the window it was given for -- the
    /// screen's by nought -- to the cache; FALSE where it is not that
    /// window's.
    pub fn release_dc(&mut self, hwnd: u16, hdc: u16) -> Result<bool, Stop> {
        let released = match self.handles.resolve(hdc) {
            Some(Object::Dc(dc)) => Some(dc),
            _ => None,
        };
        let surface = match self.surface_of(hwnd) {
            Surface::Screen => Some(self.screen_dc()),
            Surface::Window(index) => self.windows[index].as_ref().and_then(|window| window.dc),
            // Something that is no window, and a context that is nothing:
            // the TypeScript engine takes the two for the same, and fails.
            Surface::None
                if self.handles.resolve(hwnd).is_some() && self.handles.resolve(hdc).is_none() =>
            {
                return Err(Stop::Unsupported(
                    "ReleaseDC of nothing, by something that is no window",
                ));
            }
            Surface::None => None,
        };

        // Or one `GetWindowDC` made over the window's whole rectangle.
        let whole = released
            .is_some_and(|released| hwnd != 0 && self.window_dcs.get(&released) == Some(&hwnd));

        match (released, surface) {
            (Some(released), _) if whole => {
                self.release_to_cache(hdc, released);
                self.gdi.dcs[released].live = self.gdi.dcs[released].live.saturating_sub(1);
                Ok(true)
            }
            (Some(released), Some(surface)) if released == surface => {
                self.release_to_cache(hdc, released);
                self.gdi.dcs[released].live = self.gdi.dcs[released].live.saturating_sub(1);
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    /// A window's own device context, as `BeginPaint` makes ready to paint
    /// in: the System font, no saved levels, brush origin or clip region,
    /// reset as a common one.
    pub fn paint_dc(&mut self, index: usize) -> usize {
        let dc = self.window_dc(index);

        if self.gdi.dcs[dc].state.font.is_none() {
            let font = self.system_font();

            self.gdi.dcs[dc].state.font = font;
        }

        self.gdi.dcs[dc].saved.clear();
        self.gdi.dcs[dc].state.brush_org = None;
        self.gdi.dcs[dc].state.clip = None;
        self.reset_common(index, dc);
        dc
    }
}

pub fn get_dc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    // The window `LockWindowUpdate` locked draws on a bitmap of its own,
    // which this engine does not give yet (`user_calls/popups.rs`).
    if system.user_calls.locked == Some(hwnd) && system.window_named(hwnd).is_some() {
        return Err(Stop::Unsupported(
            "GetDC of the window LockWindowUpdate locked",
        ));
    }

    Ok(Answer::Word(system.get_dc(hwnd)))
}

pub fn release_dc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let hdc = args.word(system);

    Ok(Answer::Word(u16::from(system.release_dc(hwnd, hdc)?)))
}

/// The whole of a window's device context, or the screen's with nought.
pub fn get_window_dc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    Ok(Answer::Word(system.get_window_dc(hwnd)))
}
