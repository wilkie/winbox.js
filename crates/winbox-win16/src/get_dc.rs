//! `GetDC` and `ReleaseDC`, as winbox.js gives a window's device context:
//! one context over the window's client area, which every handle given for
//! it stands for, so that what a program selects into it outlives the
//! release -- a divergence from Windows' pool of five that is older than
//! this port. The handles released are kept, still answering, five of them,
//! and the next `GetDC` of the same window answers the last of them again
//! (`reldc`).

use winbox_raster::ClipRegion;

use crate::call::{Answer, Args, Stop};
use crate::gdi::dc::DcBitmap;
use crate::gdi::objects::{delete_object, get_stock_object};
use crate::handles::{Kind, Object};
use crate::system::System;
use crate::window_vis::{
    DCX_CACHE, DCX_EXCLUDERGN, DCX_INTERSECTRGN, DCX_LOCKWINDOWUPDATE, DCX_USESTYLE, DCX_WINDOW,
    Given,
};

const BLACK_PEN: i16 = 7;
const WHITE_BRUSH: i16 = 0;
const CS_OWNDC: u16 = 0x0020;
const CS_CLASSDC: u16 = 0x0040;
const DCX_KEEPCLIPRGN: u32 = 0x0004_0000;

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
    /// window's; the window `LockWindowUpdate` locked, a new one of its own
    /// each time. It comes with the System font in it. A window's has no
    /// saved levels, brush origin or clip region left from before, and is
    /// reset as a common one.
    pub fn get_dc(&mut self, hwnd: u16) -> u16 {
        let surface = self.surface_of(hwnd);
        // The window `LockWindowUpdate` locked draws where it does not show
        // (`user_calls/lock_update.rs`), and gives that context back as its
        // own.
        let locked = self.locked_dc(hwnd);

        // While the window paints, a context of its own, which draws
        // through the whole client area, not only what is being painted:
        // USER's cache hands out another than `BeginPaint`'s (`choosclr`).
        // A class's or a window's own context is the one context still,
        // as Championship Slots' forms have it.
        if let Surface::Window(index) = surface
            && locked.is_none()
            && self.windows[index]
                .as_ref()
                .is_some_and(|window| window.paint_clip.is_some())
            && self.windows[index]
                .as_ref()
                .and_then(|window| self.class_named(&window.class))
                .map_or(0, |class| self.classes[class].style)
                & (CS_OWNDC | CS_CLASSDC)
                == 0
        {
            let dc = self.new_dc(DcBitmap::Window(index), false);
            let font = self.system_font();

            self.gdi.dcs[dc].state.font = font;
            self.gdi.dcs[dc].unclipped = true;
            self.select_window_region(dc, index, DCX_USESTYLE, None);
            self.reset_common(index, dc);
            self.window_dcs.insert(dc, hwnd);

            return self.handles.allocate(Kind::Dc, Object::Dc(dc)).unwrap_or(0);
        }

        let Some(dc) = locked.or_else(|| self.dc_named(hwnd)) else {
            return 0;
        };

        if let Some(dc) = locked {
            self.window_dcs.insert(dc, hwnd);
        }

        if self.gdi.dcs[dc].state.font.is_none() {
            let font = self.system_font();

            self.gdi.dcs[dc].state.font = font;
        }

        // Its visible region worked out by USER's rule, as `GetDCEx` with
        // `DCX_USESTYLE` (`window_vis`), and its origin its corner; the
        // screen's what it shows. The locked window's context draws on a
        // bitmap of its own and answers its client area: what it shows.
        match surface {
            Surface::Window(index) if locked.is_none() => {
                self.select_window_region(dc, index, DCX_USESTYLE, None);
            }
            _ => self.reset_visible(dc),
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

        // Its visible region by USER's rule for the whole window, as
        // `GetDCEx` with `DCX_WINDOW` and `DCX_USESTYLE` (`window_vis`).
        if let DcBitmap::Whole(index) = bitmap {
            self.select_window_region(dc, index, DCX_WINDOW | DCX_USESTYLE, None);
        }

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
                self.release_dc_ex_region(hdc);
                self.drop_given_region(released);
                Ok(true)
            }
            (Some(released), Some(surface)) if released == surface => {
                self.release_to_cache(hdc, released);
                self.gdi.dcs[released].live = self.gdi.dcs[released].live.saturating_sub(1);
                self.release_dc_ex_region(hdc);
                self.drop_given_region(released);
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    /// The region `GetDCEx` was given, deleted as its context is released
    /// (`getdcex`).
    fn release_dc_ex_region(&mut self, hdc: u16) {
        if let Some(region) = self.dc_ex_regions.remove(&hdc) {
            delete_object(self, region);
        }
    }

    /// A device context of a window's, as `GetDC` and `GetWindowDC` give
    /// one, with what drawing in it is kept to said by the flags
    /// (`USER.EXE` seg1 `a64c`, then `847b`-`87b7`), as the TypeScript
    /// engine's `get-dc-ex.ts` says more of. **Recorded** by `getdcex`.
    pub fn get_dc_ex(&mut self, hwnd: u16, region: u16, flags: u32) -> u16 {
        if hwnd == 0 {
            return 0;
        }

        // A region given that is not one, nought (`a658`-`a66d`): even 1,
        // which USER's own callers pass for the whole screen (`visrule`).
        if region != 0 && crate::gdi::regions::region_shape(self, region).is_none() {
            return 0;
        }

        let index = match self.surface_of(hwnd) {
            Surface::Window(index) => Some(index),
            _ => None,
        };

        // Without `DCX_CACHE`, only a window whose class has a context of
        // its own gets one (`8560`-`85b6`).
        if let Some(index) = index
            && flags & DCX_CACHE == 0
            && self.windows[index]
                .as_ref()
                .and_then(|window| self.class_named(&window.class))
                .map_or(0, |class| self.classes[class].style)
                & (CS_OWNDC | CS_CLASSDC)
                == 0
        {
            return 0;
        }

        // With `DCX_LOCKWINDOWUPDATE`, the locked window's context as any
        // other's, on the screen (seg1 `15cb`; `visrule`).
        let lock = if flags & DCX_LOCKWINDOWUPDATE != 0 {
            self.user_calls.locked.take()
        } else {
            None
        };
        let hdc = if flags & DCX_WINDOW == 0 {
            self.get_dc(hwnd)
        } else {
            self.get_window_dc(hwnd)
        };

        if lock.is_some() {
            self.user_calls.locked = lock;
        }
        let (Some(index), Some(Object::Dc(dc))) = (index, self.handles.resolve(hdc)) else {
            return hdc;
        };

        // The locked window's own context answers what it shows.
        if self.gdi.dcs[dc].vis_from.is_none() {
            return hdc;
        }

        let shape = crate::gdi::regions::region_shape(self, region);
        let given = if flags & DCX_INTERSECTRGN != 0 {
            // Nought leaves nothing (`8711`-`871d`).
            Some(Given {
                shape: shape.clone().unwrap_or(ClipRegion::EMPTY),
                exclude: false,
            })
        } else if flags & DCX_EXCLUDERGN != 0 {
            shape.clone().map(|shape| Given {
                shape,
                exclude: true,
            })
        } else {
            None
        };

        if flags & (DCX_INTERSECTRGN | DCX_EXCLUDERGN) != 0
            && shape.is_some()
            && flags & DCX_KEEPCLIPRGN == 0
        {
            self.dc_ex_regions.insert(hdc, region);
        }

        self.select_window_region(dc, index, flags, given);
        hdc
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

        // Its visible region USER's rule's within the update region, as
        // `GetDCEx` with `DCX_USESTYLE` and `DCX_INTERSECTRGN` of it
        // (`USER.EXE` seg1 `7671`; `visrgn`): what is to be painted, where
        // that is known; the whole client area where it is not.
        let window = self.windows[index].as_ref().expect("a window");
        let due = match (window.paint_clip, &window.paint_shape) {
            (Some([left, top, right, bottom]), Some(shape)) => {
                Some(ClipRegion::rect(left, top, right, bottom).intersect(shape))
            }
            (Some([left, top, right, bottom]), None) => {
                Some(ClipRegion::rect(left, top, right, bottom))
            }
            (None, shape) => shape.clone(),
        };
        let flags = DCX_USESTYLE | if due.is_some() { DCX_INTERSECTRGN } else { 0 };
        let given = due.map(|shape| Given {
            shape,
            exclude: false,
        });

        self.select_window_region(dc, index, flags, given);
        self.reset_common(index, dc);
        dc
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

/// The whole of a window's device context, or the screen's with nought.
pub fn get_window_dc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    Ok(Answer::Word(system.get_window_dc(hwnd)))
}
