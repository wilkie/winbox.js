//! Painting a window on the raster desktop, as winbox.js does it: the
//! frame by `WM_NCPAINT` and the background by `WM_ERASEBKGND` when they are
//! due (`erase.ts`), `BeginPaint` and `EndPaint`, what a program marks to be
//! painted again (`InvalidateRect`, `update-region.ts`), and `UpdateWindow`.
//!
//! Erasing, as USER does it (`USER.EXE` seg1 `7a83`, the only place
//! `WM_ERASEBKGND` is sent from), **read out** and recorded by `nobrush`:
//! an erase not done -- the window procedure answered nought -- is noted on
//! the window, and `BeginPaint` hands the note back as `fErase`, 4. For a
//! program made for a Windows before 3.1, an erase not done is still to be
//! done: `BeginPaint` asks again.

use winbox_raster::ClipRegion;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::gdi::objects::{create_rect_rgn, delete_object};
use crate::handles::{Kind, Object};
use crate::messages::Param;
use crate::system::System;
use crate::windows::Window;

pub const WM_PAINT: u16 = 0x000f;
pub const WM_ERASEBKGND: u16 = 0x0014;
pub const WM_NCPAINT: u16 = 0x0085;
pub const WM_SYNCPAINT: u16 = 0x0088;
pub const WM_PAINTICON: u16 = 0x0026;
pub const WM_ICONERASEBKGND: u16 = 0x0027;

impl System {
    /// Whether a window is painted as an icon: minimized, and its class has
    /// an icon (`paint-icon.ts`).
    pub fn paints_icon(&self, index: usize) -> bool {
        let Some(window) = self.windows[index].as_ref() else {
            return false;
        };

        window.placement == crate::windows::Placement::Minimized
            && self
                .class_named(&window.class)
                .is_some_and(|class| self.classes[class].icon != 0)
    }

    /// The paint message for a window: `WM_PAINTICON`, with its 1, or
    /// `WM_PAINT`.
    pub fn paint_message(&self, index: usize) -> (u16, u16) {
        if self.paints_icon(index) {
            (WM_PAINTICON, 1)
        } else {
            (WM_PAINT, 0)
        }
    }

    /// The window a handle names, if it is one not destroyed.
    pub fn window_named(&self, hwnd: u16) -> Option<usize> {
        match self.handles.resolve(hwnd) {
            Some(Object::Window(index)) if self.windows[index].is_some() => Some(index),
            _ => None,
        }
    }

    fn painted(&self, index: usize) -> &Window {
        self.windows[index]
            .as_ref()
            .expect("a window not destroyed")
    }

    fn painted_mut(&mut self, index: usize) -> &mut Window {
        self.windows[index]
            .as_mut()
            .expect("a window not destroyed")
    }

    /// A window's client area on the screen.
    pub(crate) fn client_on_screen(&self, index: usize) -> ClipRegion {
        let window = self.painted(index);
        let left = window.left + window.client.left;
        let top = window.top + window.client.top;

        ClipRegion::rect(
            left,
            top,
            left + window.client_width(),
            top + window.client_height(),
        )
    }

    /// What a window is due to paint, on the screen: nothing, its region,
    /// its box, or all of it.
    pub(crate) fn update_region(&self, index: usize) -> ClipRegion {
        let window = self.painted(index);

        if !window.needs_paint {
            return ClipRegion::EMPTY;
        }

        let Some(dirty) = window.dirty else {
            return self.client_on_screen(index);
        };

        match &window.dirty_shape {
            Some((shape, mark)) if *mark == dirty.mark => shape.clone(),
            _ => ClipRegion::rect(dirty.area[0], dirty.area[1], dirty.area[2], dirty.area[3]),
        }
    }

    /// Sets what a window is due to paint, on the screen, as a region.
    pub(crate) fn set_update_of(&mut self, index: usize, shape: ClipRegion, erase: bool) {
        if shape.kind() <= 1 {
            let window = self.painted_mut(index);

            window.needs_paint = false;
            window.needs_erase = false;
            window.dirty = None;
            window.dirty_shape = None;
            return;
        }

        let bounds = shape.bounds();
        let dirty = self.dirty_box([bounds.left, bounds.top, bounds.right, bounds.bottom]);
        let window = self.painted_mut(index);

        window.dirty = Some(dirty);
        window.dirty_shape = Some((shape, dirty.mark));
        window.needs_paint = true;
        window.needs_erase |= erase;
    }

    /// The Windows version a window's program was made for.
    fn expected_version(&mut self, index: usize) -> u16 {
        let instance = self.painted(index).instance;

        self.executable_of(instance).map_or(0x30a, |executable| {
            executable.header.expected_windows_version
        })
    }
}

impl Engine {
    /// `WM_NCPAINT` to a window whose frame is due: 1 for all of it, or a
    /// region of the screen for the part due, a handle of its own made for
    /// the message and deleted after it (`showseq`).
    async fn send_nc_paint(
        &self,
        hwnd: u16,
        index: usize,
        due: Option<[i32; 4]>,
    ) -> Result<(), Stop> {
        let region = {
            let mut system = self.system();
            let window = system.painted(index);
            let whole = due.is_none_or(|due| {
                due[0] <= window.left
                    && due[1] <= window.top
                    && due[2] >= window.left + window.width
                    && due[3] >= window.top + window.height
            });

            due.filter(|_| !whole).map(|due| {
                create_rect_rgn(
                    &mut system,
                    due[0] as i16,
                    due[1] as i16,
                    due[2] as i16,
                    due[3] as i16,
                )
            })
        };

        self.send_message(hwnd, WM_NCPAINT, region.unwrap_or(1), &mut Param::Value(0))
            .await?;

        if let Some(region) = region {
            delete_object(&mut self.system(), region);
        }

        Ok(())
    }

    /// The window sent its erase message on `hdc`, and what came of it
    /// noted.
    async fn send_erase(&self, hwnd: u16, index: usize, hdc: u16) -> Result<(), Stop> {
        {
            let mut system = self.system();
            let window = system.painted_mut(index);

            window.needs_erase = false;
            window.unerased = false;
        }

        let message = if self.system().paints_icon(index) {
            WM_ICONERASEBKGND
        } else {
            WM_ERASEBKGND
        };
        let answer = self
            .send_message(hwnd, message, hdc, &mut Param::Value(0))
            .await?;

        if answer as u16 == 0 {
            let mut system = self.system();
            let old = system.expected_version(index) < 0x30a;
            let window = system.painted_mut(index);

            window.unerased = true;
            window.needs_erase = old;
        }

        Ok(())
    }

    /// The erase a window is due, done now rather than at `BeginPaint`, on
    /// a context of its own: what the end of `SetWindowPos` does (seg7
    /// `28d`, seg1 `7913`).
    async fn erase_now(&self, hwnd: u16) -> Result<(), Stop> {
        let Some(index) = self.system().window_named(hwnd) else {
            return Ok(());
        };

        {
            let system = self.system();
            let window = system.painted(index);

            // A window of another task is left to its `BeginPaint`.
            if !window.needs_erase || !window.visible || !system.mine(hwnd) {
                return Ok(());
            }
        }

        let hdc = self.system().get_dc(hwnd);

        self.send_erase(hwnd, index, hdc).await?;
        self.system().release_dc(hwnd, hdc)?;
        Ok(())
    }

    /// What an uncovered window is due, drawn now: `WM_NCPAINT` where its
    /// frame was uncovered, then its erase, clipped to what was uncovered.
    /// `DefWindowProc` does this for `WM_SYNCPAINT`.
    pub async fn sync_paint(&self, hwnd: u16) -> Result<(), Stop> {
        let Some(index) = self.system().window_named(hwnd) else {
            return Ok(());
        };

        if !self.system().painted(index).visible {
            return Ok(());
        }

        let nc = {
            let mut system = self.system();
            let window = system.painted_mut(index);

            std::mem::take(&mut window.needs_nc_paint).then(|| {
                window
                    .dirty
                    .filter(|_| window.needs_paint)
                    .map(|dirty| dirty.area)
            })
        };

        if let Some(due) = nc {
            self.send_nc_paint(hwnd, index, due).await?;
        }

        let (clip, shape) = {
            let mut system = self.system();
            let window = system.painted_mut(index);
            let dirty = window.dirty;
            let shape = match (dirty, &window.dirty_shape) {
                (Some(dirty), Some((shape, mark))) if *mark == dirty.mark => Some(shape.clone()),
                _ => None,
            };
            let kept = (window.paint_clip, window.paint_shape.take());

            window.paint_clip = dirty.map(|dirty| dirty.area);
            window.paint_shape = shape;
            kept
        };

        self.erase_now(hwnd).await?;

        let mut system = self.system();

        if let Some(window) = system.windows[index].as_mut() {
            window.paint_clip = clip;
            window.paint_shape = shape;
        }

        Ok(())
    }

    /// Every window due an erase, erased now, as `SetWindowPos` ends --
    /// showing, hiding, moving -- each sent `WM_NCPAINT` if its frame is
    /// due, then erased where it is due; a child waits for its own
    /// `BeginPaint`, and a window in a hidden one for when it shows.
    /// **Recorded** by `uncover`, `uncovr2` and `menuinv`.
    pub async fn erase_due(&self) -> Result<(), Stop> {
        let windows = self.system().z_order.clone();

        for index in windows {
            let hwnd = {
                let system = self.system();
                let Some(window) = system.windows[index].as_ref() else {
                    continue;
                };

                if !window.visible
                    || !(window.needs_erase || window.needs_nc_paint)
                    || window.parent.is_some()
                {
                    continue;
                }

                window.hwnd
            };

            // A window of another task is sent `WM_SYNCPAINT`, and draws
            // itself in its own task (`syncpnt`). What it is sent with is
            // not recorded.
            if !self.system().mine(hwnd) {
                self.send_message(hwnd, WM_SYNCPAINT, 0, &mut Param::Value(0))
                    .await?;
                continue;
            }

            self.sync_paint(hwnd).await?;
        }

        Ok(())
    }

    /// A window made ready to paint, on a device context of its own: its
    /// frame drawn first if it changed, its background erased if it is due,
    /// and the window validated. Its answer: the handle, and `PAINTSTRUCT`
    /// as it is laid out.
    pub async fn begin_paint(&self, hwnd: u16, index: usize) -> Result<(u16, Vec<u8>), Stop> {
        let hdc = {
            let mut system = self.system();
            let dc = system.paint_dc(index);

            let hdc = system
                .handles
                .allocate(Kind::Dc, Object::Dc(dc))
                .unwrap_or(0);

            // The caret, if it is this window's, is hidden until `EndPaint`,
            // so the painting does not leave it half drawn.
            system.caret_before_paint(hwnd);
            hdc
        };
        let nc = {
            let mut system = self.system();
            let window = system.painted_mut(index);

            std::mem::take(&mut window.needs_nc_paint).then_some(window.paint_clip)
        };

        if let Some(clip) = nc {
            self.send_nc_paint(hwnd, index, clip).await?;
        }

        let erase = {
            let mut system = self.system();
            let window = system.painted_mut(index);

            window.needs_paint = false;
            window.needs_erase
        };

        if erase {
            self.send_erase(hwnd, index, hdc).await?;
        }

        let system = self.system();
        let window = system.painted(index);
        let (width, height) = (window.client_width(), window.client_height());
        let mut paint = [0, 0, width, height];

        // Only what was to be painted again, when that is known.
        if let Some(clip) = window.paint_clip {
            let x = window.left + window.client.left;
            let y = window.top + window.client.top;

            paint = [
                (clip[0] - x).max(0),
                (clip[1] - y).max(0),
                (clip[2] - x).min(width),
                (clip[3] - y).min(height),
            ];
        }

        let mut bytes = Vec::with_capacity(32);

        bytes.extend(hdc.to_le_bytes());
        bytes.extend(if window.unerased { 4u16 } else { 0 }.to_le_bytes());

        for side in paint {
            bytes.extend((side as i16).to_le_bytes());
        }

        bytes.resize(32, 0);
        Ok((hdc, bytes))
    }
}

/// `BeginPaint`: nought for a handle that is no window's.
pub fn begin_paint(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, far, index) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let far = args.dword(&system);

            match system.handles.resolve(hwnd) {
                Some(Object::Window(index)) if system.windows[index].is_some() => {
                    (hwnd, far, index)
                }
                None => return Ok(Answer::Word(0)),
                Some(_) => {
                    return Err(Stop::Unsupported(
                        "BeginPaint of something that is no window",
                    ));
                }
            }
        };
        let (hdc, bytes) = engine.begin_paint(hwnd, index).await?;

        engine.system().write_far(far, &bytes);
        Ok(Answer::Word(hdc))
    })
}

impl System {
    /// `EndPaint` of a window by its index, given the context `BeginPaint`
    /// gave: the paint's clip goes, and its context.
    pub(crate) fn end_paint(&mut self, hwnd: u16, index: usize, hdc: u16) {
        {
            let window = self.painted_mut(index);

            window.paint_clip = None;
            window.paint_shape = None;
        }

        self.caret_after_paint(hwnd);

        if let (Some(Object::Dc(dc)), Some(own)) = (
            self.handles.resolve(hdc),
            self.windows[index].as_ref().and_then(|window| window.dc),
        ) && dc == own
        {
            self.handles.free(hdc);
            self.gdi.dcs[dc].live = self.gdi.dcs[dc].live.saturating_sub(1);
        }
    }
}

/// `EndPaint`: the paint's clip goes, and its context.
pub fn end_paint(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let Some(index) = system.window_named(hwnd) else {
        return Ok(Answer::Nothing);
    };
    let hdc = u16::from_le_bytes(system.read_far(far, 2).try_into().unwrap_or([0, 0]));

    system.end_paint(hwnd, index, hdc);
    Ok(Answer::Nothing)
}

/// A window marked to be painted, where a rectangle of its client area
/// says, or all of it: it is painted when its program next asks for a
/// message and none is queued. What is due is kept as a region on the
/// screen (`updrgn`).
pub fn invalidate_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let erase = args.word(system) != 0;
    let Some(index) = system.window_named(hwnd) else {
        return Ok(Answer::Nothing);
    };
    let rect = (far != 0).then(|| {
        let bytes = system.read_far(far, 8);

        [0, 2, 4, 6].map(|at| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]])))
    });

    system.invalidate(index, rect, erase);
    Ok(Answer::Nothing)
}

impl System {
    /// A rectangle of a window's client area made due to paint, or all of
    /// it for none, as `InvalidateRect` makes it.
    pub(crate) fn invalidate(&mut self, index: usize, rect: Option<[i32; 4]>, erase: bool) {
        let (needs_paint, dirty) = {
            let window = self.painted(index);

            (window.needs_paint, window.dirty)
        };

        // Due all of it already, it stays so.
        if let Some([left, top, right, bottom]) = rect
            && !(needs_paint && dirty.is_none())
        {
            let window = self.painted(index);
            let (x, y) = (
                window.left + window.client.left,
                window.top + window.client.top,
            );
            let area = ClipRegion::rect(left + x, top + y, right + x, bottom + y);
            let shape = self.update_region(index).union(&area);

            self.set_update_of(index, shape, erase);
            return;
        }

        let window = self.painted_mut(index);

        window.dirty = None;
        window.dirty_shape = None;
        window.needs_paint = true;
        window.needs_erase |= erase;
    }
}

/// A window's `WM_PAINT` sent at once, if it is due one.
pub fn update_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hwnd = args.word(&engine.system());

        engine.update_window(hwnd).await?;
        Ok(Answer::Nothing)
    })
}

impl Engine {
    /// A window's `WM_PAINT` sent at once, if it is due one.
    pub async fn update_window(&self, hwnd: u16) -> Result<(), Stop> {
        let due = {
            let mut system = self.system();
            let index = system.window_named(hwnd);

            match index {
                Some(index)
                    if system.painted(index).needs_paint && system.painted(index).visible =>
                {
                    system.about_to_paint(index);
                    true
                }
                _ => false,
            }
        };

        if due {
            let (message, wparam) = {
                let system = self.system();

                system.paint_message(system.window_named(hwnd).expect("a window"))
            };

            self.send_message(hwnd, message, wparam, &mut Param::Value(0))
                .await?;
        }

        Ok(())
    }
}
