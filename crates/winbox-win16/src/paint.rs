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
use crate::handles::Object;
use crate::invalidate_through::{RDW_ERASE, RDW_INVALIDATE, RDW_VALIDATE};
use crate::messages::Param;
use crate::system::System;
use crate::windows::Window;

const CS_PARENTDC: u16 = 0x0080;
const WS_CLIPCHILDREN_STYLE: u32 = 0x0200_0000;
/// The high word of the flags USER erases a window with (seg1 `7ac1`).
const ERASE_FLAGS: u32 = 0x0005_0000;

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
            window.walked = None;
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

    /// Whether a window's paint waits for a window it is in: one up to the
    /// first with `WS_CLIPCHILDREN` that has an update region (`USER.EXE`
    /// seg1 `7a64`). Its paint will draw over the window.
    pub(crate) fn parent_pending(&self, index: usize) -> bool {
        let mut up = self.painted(index).parent;

        while let Some(parent) = up {
            let window = self.painted(parent);

            if window.style & WS_CLIPCHILDREN_STYLE != 0 {
                return false;
            }

            if window.needs_paint {
                return true;
            }

            up = window.parent;
        }

        false
    }

    /// The Windows version a window's program was made for.
    pub(crate) fn expected_version(&mut self, index: usize) -> u16 {
        let instance = self.painted(index).instance;

        self.expected_windows_version(instance).unwrap_or(0x30a)
    }
}

impl Engine {
    /// `WM_NCPAINT` to a window whose frame is due: 1 for all of it, or a
    /// region of the screen for the part due, a handle of its own made for
    /// the message and deleted after it (`showseq`). Where what it is due
    /// is a region of its own, `shape`, a copy of it, whatever it covers
    /// (`USER.EXE` seg1 `7ba0`-`7be4`, `7b52`; `rdwwalk`); 1 where it is due
    /// all of itself (`7bab`). The TypeScript engine's `sendNcPaint`.
    async fn send_nc_paint(
        &self,
        hwnd: u16,
        index: usize,
        due: Option<[i32; 4]>,
        shape: Option<&ClipRegion>,
    ) -> Result<(), Stop> {
        let region = {
            let mut system = self.system();
            let framed = std::mem::take(&mut system.painted_mut(index).frame_region);
            let window = system.painted(index);
            let rect = [
                window.left,
                window.top,
                window.left + window.width,
                window.top + window.height,
            ];
            let copy = due.and_then(|due| {
                shape.filter(|shape| {
                    let bounds = shape.bounds();

                    shape.kind() > 1
                        && [bounds.left, bounds.top, bounds.right, bounds.bottom] == due
                })
            });
            // Its frame changed, or it was sized: a region of all of it
            // (`swpframe`). A box with no region of its own that covers it:
            // all of it.
            let due = if framed {
                Some(rect)
            } else if copy.is_some() {
                due
            } else {
                due.filter(|due| {
                    !(due[0] <= rect[0]
                        && due[1] <= rect[1]
                        && due[2] >= rect[2]
                        && due[3] >= rect[3])
                })
            };
            let copy = copy.filter(|_| !framed).cloned();

            due.map(|due| {
                let made = create_rect_rgn(
                    &mut system,
                    due[0] as i16,
                    due[1] as i16,
                    due[2] as i16,
                    due[3] as i16,
                );

                if let (Some(copy), Some((object, _))) = (copy, system.region_named(made)) {
                    system.gdi.objects[object] = crate::gdi::GdiObject::Region(copy);
                }

                made
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

        // USER's entry for the client area with `DCX_INTERSECTRGN` of what
        // is due, its visible region within it (seg1 `7a83`-`7ac6`:
        // `GetDCEx` with 50080h; `swpunc`): its clip box what the window is
        // told is to be erased, nothing where nothing is (`swpframe`). All
        // of it, where it is due all over. An icon is erased as before,
        // through `GetDC`.
        let (hdc, given, icon) = {
            let mut system = self.system();
            let window = system.painted(index);
            let icon = window.placement == crate::windows::Placement::Minimized;
            let due = window.paint_clip.filter(|_| !icon).map(|clip| {
                if clip[2] <= clip[0] || clip[3] <= clip[1] {
                    ClipRegion::EMPTY
                } else {
                    let rect = ClipRegion::rect(clip[0], clip[1], clip[2], clip[3]);

                    match &window.paint_shape {
                        Some(shape) => rect.intersect(shape),
                        None => rect,
                    }
                }
            });
            let icon_clip = window.paint_clip.filter(|_| icon).map(|clip| {
                let (x, y) = (
                    window.left + window.client.left,
                    window.top + window.client.top,
                );

                if clip[2] <= clip[0] || clip[3] <= clip[1] {
                    ClipRegion::EMPTY
                } else {
                    ClipRegion::rect(clip[0] - x, clip[1] - y, clip[2] - x, clip[3] - y)
                }
            });
            let given = due.is_some();
            let hdc = match due {
                Some(due) => system.take_entry(
                    hwnd,
                    0,
                    ERASE_FLAGS | crate::window_vis::DCX_INTERSECTRGN,
                    Some(due),
                ),
                None => system.get_dc(hwnd),
            };

            if let (Some(clip), Some(dc)) = (icon_clip.clone(), crate::gdi::dc::dc_of(&system, hdc))
            {
                system.gdi.dcs[dc].state.clip = Some(clip);
            }

            (hdc, given, icon_clip.is_some())
        };

        self.send_erase(hwnd, index, hdc).await?;

        {
            let mut system = self.system();

            if icon && let Some(dc) = crate::gdi::dc::dc_of(&system, hdc) {
                system.gdi.dcs[dc].state.clip = None;
            }

            // Given back as `EndPaint` gives one, its region given let go
            // (`7b0e`-`7b13`: seg1 `8805` with 1).
            if given {
                system.release_entry(hdc, true);
            } else {
                system.release_dc(hwnd, hdc)?;
            }
        }

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
                let dirty = window.dirty.filter(|_| window.needs_paint);
                let shape = match (dirty, &window.dirty_shape) {
                    (Some(dirty), Some((shape, mark))) if *mark == dirty.mark => {
                        Some(shape.clone())
                    }
                    _ => None,
                };

                (dirty.map(|dirty| dirty.area), shape)
            })
        };

        if let Some((due, shape)) = nc {
            self.send_nc_paint(hwnd, index, due, shape.as_ref()).await?;
        }

        // What it is due cut to its client area as its frame is drawn:
        // nothing left, it is due no paint (seg1 `7ba0` with 1,
        // `7bfa`-`7c5b`). The erase goes by what was due before (`7bdc`,
        // `7a83`).
        let (clip, shape) = {
            let mut system = self.system();
            let window = system.painted(index);
            let dirty = window.dirty;
            let due = (window.needs_paint && dirty.is_some()).then(|| system.update_region(index));

            if let Some(due) = &due {
                let client = system.client_on_screen(index);
                let erase = system.painted(index).needs_erase;

                system.set_update_of(index, due.intersect(&client), erase);
                system.painted_mut(index).needs_erase = erase;
            }

            let window = system.painted_mut(index);
            let kept = (window.paint_clip, window.paint_shape.take());

            window.paint_clip = dirty.map(|dirty| dirty.area);
            window.paint_shape = due;
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

    /// What the end of `SetWindowPos` draws at once (`USER.EXE` seg7
    /// `0286`-`028d`, seg1 `7913`), from the parent of the windows it
    /// placed -- the desktop for none -- with `DSP_ENUMCLIPPEDCHILDREN`. A
    /// window whose paint waits for a window it is in is passed over with
    /// the windows in it (`798d`-`799f`, `7a64`); one due its frame is sent
    /// `WM_NCPAINT`, and one due an erase is erased where it has an update
    /// region (`79a2`-`79d8`, `7930`-`7961`), one of another task sent
    /// `WM_SYNCPAINT` instead and the windows in it left (`79e6`-`7a02`);
    /// then the windows in it, front to back, where it has
    /// `WS_CLIPCHILDREN` -- the desktop has -- a child of another task
    /// passed over (`796a`-`797f`, `7a04`-`7a59`). The windows in it with
    /// `DSP_ALLCHILDREN` in `flags`, or with `DSP_ENUMCLIPPEDCHILDREN` where
    /// it has `WS_CLIPCHILDREN`; none with neither (`796a`-`797c`). The
    /// TypeScript engine's `syncPaintFrom`.
    pub(crate) async fn sync_paint_from(
        &self,
        start: Option<usize>,
        flags: u16,
    ) -> Result<(), Stop> {
        // The desktop's own part, where it is due, drawn first (`rdwmore`,
        // `RDW_ERASENOW`).
        if start.is_none() {
            self.system().paint_background_due();
        }

        let mut work: Vec<(Option<usize>, bool)> = vec![(start, false)];

        while let Some((at, checked)) = work.pop() {
            if let Some(index) = at {
                let (hwnd, act) = {
                    let mut system = self.system();
                    let Some(window) = system.windows[index].as_ref() else {
                        continue;
                    };

                    if !checked && system.parent_pending(index) {
                        continue;
                    }

                    let hwnd = window.hwnd;
                    let mut act = None;

                    if window.needs_nc_paint || window.needs_erase {
                        if window.visible {
                            // With no update region it is not erased
                            // (`79ce`-`79d8`); a frame changed in place is
                            // due its frame alone, kept as an empty box
                            // (`frame_changed`): it has one.
                            if !window.needs_paint && window.dirty.is_none() {
                                system.painted_mut(index).needs_erase = false;
                            }

                            act = Some(system.mine(hwnd));
                        } else {
                            let window = system.painted_mut(index);

                            window.needs_nc_paint = false;
                            window.needs_erase = false;
                        }
                    }

                    (hwnd, act)
                };

                match act {
                    Some(false) => {
                        self.send_message(hwnd, WM_SYNCPAINT, 0, &mut Param::Value(0))
                            .await?;
                        continue;
                    }
                    Some(true) if self.system().painted(index).paints_itself() => {
                        self.sync_paint(hwnd).await?;
                    }
                    _ => {}
                }
            }

            let system = self.system();
            let clips = at.is_none_or(|index| {
                system
                    .windows
                    .get(index)
                    .and_then(Option::as_ref)
                    .is_some_and(|window| window.style & WS_CLIPCHILDREN_STYLE != 0)
            });

            if !(flags & DSP_ALLCHILDREN != 0 || (flags & DSP_ENUMCLIPPEDCHILDREN != 0 && clips)) {
                continue;
            }

            let children: Vec<usize> = system
                .z_order
                .iter()
                .copied()
                .filter(|&child| {
                    system.windows[child]
                        .as_ref()
                        .is_some_and(|window| window.parent == at)
                        && (at.is_none() || system.mine(system.painted(child).hwnd))
                })
                .collect();

            // Front to back: the first taken first.
            for child in children.into_iter().rev() {
                work.push((Some(child), true));
            }
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

                // An icon's title is drawn by USER, not erased as a window
                // that paints itself is, as the TypeScript engine's
                // `eraseDue` passes it over (`paintsItself`).
                if !window.paints_itself()
                    || !window.visible
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

    /// A frame that changed drawn first, by `WM_NCPAINT` to the window with
    /// what it is due, whole, the region's own shape where it has one (seg1
    /// `7ba0` with nought: a copy of the update region).
    async fn frame_before_paint(&self, hwnd: u16, index: usize) -> Result<(), Stop> {
        let nc = {
            let mut system = self.system();
            let window = system.painted_mut(index);

            std::mem::take(&mut window.needs_nc_paint)
                .then(|| (window.paint_clip, window.paint_shape.clone()))
        };

        if let Some((clip, shape)) = nc {
            self.send_nc_paint(hwnd, index, clip, shape.as_ref())
                .await?;
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

            // The note that its paint was sent, and another task's making it
            // due, taken off (`USER.EXE` seg1 `764c`; `update_now`).
            {
                let window = system.painted_mut(index);

                window.paint_sent = false;
                window.other_task = false;
            }

            // One of USER's entries (`dc_entries`): `GetDCEx` with
            // `DCX_USESTYLE` and `DCX_INTERSECTRGN` of the update region
            // (`USER.EXE` seg1 `7640`-`7671`; `visrgn`): its visible region
            // USER's rule's within what is to be painted, where that is
            // known; the whole client area where it is not.
            let window = system.painted(index);
            let due = match (window.paint_clip, &window.paint_shape) {
                (Some([left, top, right, bottom]), Some(shape)) => {
                    Some(ClipRegion::rect(left, top, right, bottom).intersect(shape))
                }
                (Some([left, top, right, bottom]), None) => {
                    Some(ClipRegion::rect(left, top, right, bottom))
                }
                (None, shape) => shape.clone(),
            };
            let flags = 0x0003_0000
                | if due.is_some() {
                    crate::window_vis::DCX_INTERSECTRGN
                } else {
                    0
                };
            let hdc = system.take_entry(hwnd, 0, flags, due);

            system.with_font(hdc);

            // The caret, if it is this window's, is hidden until `EndPaint`,
            // so the painting does not leave it half drawn.
            system.caret_before_paint(hwnd);
            hdc
        };
        self.frame_before_paint(hwnd, index).await?;

        // `rcPaint` is the context's clip box, cut to the client area for
        // a class with `CS_PARENTDC` (`USER.EXE` seg1 `7687`,
        // `78be`-`790e`): what of the update shows. Where nothing does, the
        // window is not sent its erase, and is not due it after (`762a`,
        // `768c`).
        let (shows, mut paint) = {
            let mut system = self.system();
            let dc = crate::gdi::dc::dc_of(&system, hdc);
            // GDI calls the context's hook first, as for any `GetClipBox`
            // (`dc_hook_calls`).
            let (kind, mut paint) = dc.map_or((1, [0; 4]), |dc| {
                system.user_hook_due(dc);
                crate::gdi::regions::clip_box(&mut system, dc)
            });
            let mut shows = kind > 1;

            let class = system.class_of(hwnd);
            let class_style = class.map_or(0, |class| system.classes[class].style);

            if shows && class_style & CS_PARENTDC != 0 {
                let window = system.painted(index);

                paint = [
                    paint[0].max(0),
                    paint[1].max(0),
                    paint[2].min(window.client_width()),
                    paint[3].min(window.client_height()),
                ];
                shows = paint[0] < paint[2] && paint[1] < paint[3];
            }

            (shows, paint)
        };

        let erase = {
            let mut system = self.system();
            let window = system.painted_mut(index);

            window.needs_paint = false;
            // Its paint of its own taken too (`7643`).
            window.internal_paint = false;
            window.walked = None;

            if window.needs_erase && !shows {
                window.needs_erase = false;
                window.unerased = false;
            }

            window.needs_erase
        };

        if erase {
            self.send_erase(hwnd, index, hdc).await?;
        }

        // The windows in it whose frames are due and nothing else are sent
        // `WM_NCPAINT` now (`76a7`, `7b30`-`7b4e`; `invchild`).
        let children: Vec<usize> = self.system().windows_in(Some(index));

        for child in children {
            let target = {
                let mut system = self.system();
                let inner = system.painted_mut(child);

                if inner.needs_paint || !inner.needs_nc_paint || inner.hwnd == 0 {
                    None
                } else {
                    inner.needs_nc_paint = false;
                    Some(inner.hwnd)
                }
            };

            if let Some(child_hwnd) = target {
                self.send_nc_paint(child_hwnd, child, None, None).await?;
            }
        }

        let system = self.system();
        let window = system.painted(index);

        if !shows {
            paint = [0; 4];
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

        // The paint's context given back, its region given -- the update
        // region -- let go even where it is a window's own (`USER.EXE` seg1
        // `76cc`-`76d4`, `8805` with 1).
        self.release_entry(hdc, true);
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

/// A rectangle of a window's client area made due to paint, or all of it
/// for none: `RedrawWindow`'s body with `RDW_INVALIDATE`, and `RDW_ERASE`
/// to erase (`USER.EXE` seg1 `aa27`, `014c`, `3e1e`). Nothing for a window
/// that does not show; else through the window and, where it has no
/// `WS_CLIPCHILDREN`, the windows in it, each made due where the rectangle
/// meets it, erase and frame too (`invalidate_through`; `invchild`). It is
/// painted when its program next asks for a message and none is queued.
/// What is due is kept as a region on the screen (`updrgn`).
pub fn invalidate_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let erase = args.word(system) != 0;
    let Some(index) = system.window_named(hwnd) else {
        return Ok(Answer::Nothing);
    };
    let rect = system.rect_given(far);

    system.invalidate(index, rect, erase);
    Ok(Answer::Nothing)
}

impl System {
    /// A rectangle a program gave: none for a null pointer.
    pub(crate) fn rect_given(&self, far: u32) -> Option<[i32; 4]> {
        (far != 0).then(|| {
            let bytes = self.read_far(far, 8);

            [0, 2, 4, 6].map(|at| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]])))
        })
    }

    /// A rectangle of a window's client area on the screen.
    fn client_part(&self, index: usize, rect: Option<[i32; 4]>) -> Option<ClipRegion> {
        rect.map(|[left, top, right, bottom]| {
            let window = self.painted(index);
            let (x, y) = (
                window.left + window.client.left,
                window.top + window.client.top,
            );

            ClipRegion::rect(left + x, top + y, right + x, bottom + y)
        })
    }

    /// A rectangle of a window's client area made due to paint, or all of
    /// it for none, as `InvalidateRect` makes it; where a window is locked,
    /// what is made due is told to it as drawn (`USER.EXE` seg1
    /// `3f41`-`3f7c`).
    pub(crate) fn invalidate(&mut self, index: usize, rect: Option<[i32; 4]>, erase: bool) {
        let region = self.client_part(index, rect);

        self.redraw_through(
            index,
            region.as_ref(),
            RDW_INVALIDATE | if erase { RDW_ERASE } else { 0 },
            rect,
        );
    }

    /// A rectangle of a window's client area validated, or all of it for
    /// none, as `ValidateRect` validates it (`USER.EXE` seg1 `aa47`, `0142`,
    /// `3e1e`): through the window and, where it has no `WS_CLIPCHILDREN`,
    /// the windows in it (`invchild`).
    pub(crate) fn validate(&mut self, index: usize, rect: Option<[i32; 4]>) {
        let region = self.client_part(index, rect);

        self.redraw_through(index, region.as_ref(), RDW_VALIDATE, None);
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

const WS_EX_TRANSPARENT: u32 = 0x0000_0020;
const WS_CLIPCHILDREN: u32 = 0x0200_0000;

/// `DoSyncPaint`'s flags (`USER.EXE` seg1 `7913`).
pub(crate) const DSP_ENUMCLIPPEDCHILDREN: u16 = 0x0004;
pub(crate) const DSP_ALLCHILDREN: u16 = 0x0020;

impl System {
    /// Whether a window behind this one among its siblings is due a paint.
    fn behind_due(&self, index: usize) -> bool {
        let parent = self.painted(index).parent;
        let siblings = self.windows_in(parent);
        let at = siblings.iter().position(|&one| one == index);

        at.is_some_and(|at| {
            siblings[at + 1..]
                .iter()
                .any(|&other| self.painted(other).due())
        })
    }

    /// Each window it is in that is due, up to one with `WS_CLIPCHILDREN`,
    /// validated where it is (`USER.EXE` seg1 `4515`): its window rectangle
    /// cut to the client areas it is in, through `RedrawWindow`'s walk with
    /// `RDW_VALIDATE` and `RDW_NOCHILDREN`.
    fn validate_under(&mut self, index: usize) {
        let mut region: Option<ClipRegion> = None;
        let mut up = self.painted(index).parent;

        while let Some(parent) = up {
            up = self.painted(parent).parent;

            if self.painted(parent).style & WS_CLIPCHILDREN != 0 {
                return;
            }

            if !self.painted(parent).needs_paint {
                continue;
            }

            if region.is_none() {
                let Some(rect) = self.cut_to_parents(index, self.window_rect(index)) else {
                    return;
                };

                region = Some(crate::invalidate_through::region_of(rect));
            }

            if self
                .cut_to_parents(parent, self.window_rect(parent))
                .is_none()
            {
                return;
            }

            self.valid_through(parent, region.as_ref());
        }
    }
}

impl Engine {
    /// `UpdateWindow` (`USER.EXE` seg1 `a95d`, `4404`, `441d`, `444c`;
    /// `invchild`): the window's `WM_PAINT` sent at once if it is due one,
    /// and then the windows in it the same way, each and the windows in it
    /// in turn, front to back. A window with `WS_EX_TRANSPARENT` that is
    /// due waits while a window behind it is due (`4424`-`443e`,
    /// `44d8`-`4503`). Before a window with an update region is painted,
    /// each window it is in that is due, up to one with `WS_CLIPCHILDREN`,
    /// is validated where the window is (`4515`). The TypeScript engine's
    /// `UpdateWindow`.
    pub async fn update_window(&self, hwnd: u16) -> Result<(), Stop> {
        self.update_now(hwnd, true).await
    }

    /// A window painted now, and with `children` the windows in it
    /// (`USER.EXE` seg1 `441d`): `UpdateWindow`, and `RedrawWindow`'s
    /// `RDW_UPDATENOW` without `RDW_NOCHILDREN` or with it (`3f93`-`3fad`).
    /// A window is due where it has an update region or a paint of its own
    /// (`4453`-`445d`). The TypeScript engine's `updateNow`.
    pub async fn update_now(&self, hwnd: u16, children: bool) -> Result<(), Stop> {
        let root = {
            let system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(());
            };

            if system.painted(index).ex_style & WS_EX_TRANSPARENT != 0 && system.behind_due(index) {
                return Ok(());
            }

            index
        };
        // Each window to paint, as it was when it was put here: its index,
        // handle and parent, and whether it is the first.
        let mut work = vec![(root, hwnd, true)];

        while let Some((index, handle, first)) = work.pop() {
            let send = {
                let mut system = self.system();
                let alive = system.windows[index]
                    .as_ref()
                    .is_some_and(|window| window.hwnd == handle);

                if !alive {
                    continue;
                }

                if !first
                    && system.painted(index).ex_style & WS_EX_TRANSPARENT != 0
                    && system.painted(index).due()
                    && system.behind_due(index)
                {
                    continue;
                }

                let window = system.painted(index);
                let send = window.paints_itself() && window.due() && system.showing(index);

                if send {
                    if system.painted(index).needs_paint {
                        system.validate_under(index);
                    }

                    system.about_to_paint(index);
                }

                send.then(|| system.paint_message(index))
            };

            if let Some((message, wparam)) = send {
                // Noted as sent, until `BeginPaint` takes the note off (seg1
                // `447f`, `764c`).
                self.system().painted_mut(index).paint_sent = true;
                self.send_message(handle, message, wparam, &mut Param::Value(0))
                    .await?;

                // Destroyed in its paint, nothing more (`44ac`).
                let unsent = {
                    let mut system = self.system();

                    if system.windows[index]
                        .as_ref()
                        .is_none_or(|window| window.hwnd != handle)
                    {
                        continue;
                    }

                    std::mem::take(&mut system.painted_mut(index).paint_sent)
                        && system.showing(index)
                };

                // Its paint taken without `BeginPaint`: what it is due of its
                // frame and its erase is sent now, the window alone (seg1
                // `44ab`-`44c0`: `7913` with nought, where it shows;
                // `rdwmore`).
                if unsent {
                    self.sync_paint_from(Some(index), 0).await?;
                }
            }

            if !children {
                continue;
            }

            let system = self.system();

            for child in system.windows_in(Some(index)).into_iter().rev() {
                work.push((child, system.painted(child).hwnd, false));
            }
        }

        Ok(())
    }
}
