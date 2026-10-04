//! What `DefWindowProc` does for a window on the raster desktop, as
//! winbox.js's `DefWindowProc.ts` does it: paints it, activates it, draws
//! its frame and caption, erases it, answers where the mouse is on it and
//! with what cursor, and closes it. The menus, the system menu's commands
//! and the keyboard are not here yet.

use crate::call::{Args, Stop};
use crate::engine::Engine;
use crate::gdi::GdiObject;
use crate::handles::Object;
use crate::messages::{Param, WM_GETTEXT, WM_MOVE, WM_SIZE};
use crate::paint::{
    WM_ERASEBKGND, WM_ICONERASEBKGND, WM_NCPAINT, WM_PAINT, WM_PAINTICON, WM_SYNCPAINT,
};
use crate::raster_input::HTCLIENT;
use crate::window_state::{WM_ACTIVATE, WM_NCACTIVATE};
use crate::windows::Placement;

const WM_CLOSE: u16 = 0x0010;
const WM_QUERYOPEN: u16 = 0x0013;
const WM_CANCELMODE: u16 = 0x001f;
const WM_SETCURSOR: u16 = 0x0020;
const WM_WINDOWPOSCHANGED: u16 = 0x0047;
const WM_NCHITTEST: u16 = 0x0084;
const WM_KILLFOCUS: u16 = 0x0008;
const WM_SETFOCUS: u16 = 0x0007;

const WS_CHILD: u32 = 0x4000_0000;
const WS_CAPTION: u32 = 0x00c0_0000;
const WS_MINIMIZE: u32 = 0x2000_0000;
const WS_DISABLED: u32 = 0x0800_0000;

const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOMOVE: u16 = 0x0002;

const IDC_ARROW: u16 = 32512;

/// The cursor a sizing border shows, by the part of the window.
fn border_cursor(hit: u16) -> u16 {
    match hit {
        10 | 11 => 32644,
        12 | 15 => 32645,
        13 | 17 => 32642,
        14 | 16 => 32643,
        _ => IDC_ARROW,
    }
}

impl Engine {
    /// What `DefWindowProc` does on the raster desktop with a message, if
    /// it is one of those done here.
    pub async fn raster_default(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<Option<u32>, Stop> {
        let value = match lparam {
            Param::Value(value) => *value,
            Param::Struct(_) => 0,
        };

        Ok(Some(match message {
            // An icon may be restored (`iconclk`).
            WM_QUERYOPEN => 1,
            // The window's menu, open, ends: none is open here.
            WM_CANCELMODE => 0,
            // The cursor the window shows where the mouse is (`setcur`).
            WM_SETCURSOR => self.default_set_cursor(hwnd, index, wparam, value).await?,
            // Where on the window a point of the screen is.
            WM_NCHITTEST => u32::from(self.system().hit_test(
                index,
                i32::from(value as i16),
                i32::from((value >> 16) as i16),
            )),
            WM_CLOSE => {
                self.destroy_window(hwnd).await?;
                0
            }
            // `WM_MOVE` and `WM_SIZE`, as the flags say the window moved and
            // was sized (`defer`).
            WM_WINDOWPOSCHANGED => {
                let flags = match lparam {
                    Param::Struct(bytes) => u16::from_le_bytes([bytes[12], bytes[13]]),
                    Param::Value(far) => {
                        let bytes = self.system().read_far(far.wrapping_add(12), 2);

                        u16::from_le_bytes([bytes[0], bytes[1]])
                    }
                };

                self.window_pos_changed(hwnd, index, flags).await?;
                0
            }
            _ => return Ok(None),
        }))
    }

    /// The messages USER's `DefWindowProc` answers for every window it
    /// knows, after those of the raster desktop.
    #[allow(clippy::too_many_lines)]
    pub async fn default_messages(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<Option<u32>, Stop> {
        Ok(Some(match message {
            // `BeginPaint` and `EndPaint`: the window is painted, its
            // background erased if it was due to be.
            // An icon's paint as `WM_PAINT`, its background by
            // `WM_ICONERASEBKGND`, and then the class's icon drawn in the
            // middle of the window (seg1 `580f`).
            WM_PAINT => {
                self.paint_and_end(hwnd, index, false).await?;
                0
            }
            WM_PAINTICON => {
                self.paint_and_end(hwnd, index, true).await?;
                0
            }
            // A child's parent's class brush; the desktop's behind a
            // top-level window (seg1 `5881`).
            WM_ICONERASEBKGND => {
                self.system().erase_icon(index);
                1
            }
            // A window made active takes the focus -- none, if it is
            // minimized (`showsq2`; `USER.EXE` seg1 `5e84`).
            WM_ACTIVATE => {
                if wparam != 0 {
                    let minimized = self.system().windows[index]
                        .as_ref()
                        .is_some_and(|window| window.placement == Placement::Minimized);

                    if minimized {
                        self.focus_nothing().await?;
                    } else {
                        self.set_focus(hwnd).await?;
                    }
                }

                0
            }
            // The caption drawn active or not, as it is told, the window's
            // activation unchanged.
            WM_NCACTIVATE => {
                if let Some(window) = self.system().windows[index].as_mut() {
                    window.lit = Some(wparam != 0);
                }

                self.ask_caption(hwnd, index).await?;

                let visible = self.system().windows[index]
                    .as_ref()
                    .is_some_and(|window| window.visible);

                if visible {
                    self.system().paint_frame(index);
                }

                1
            }
            // Drawn now what another task uncovered (seg1 `6151`).
            WM_SYNCPAINT => {
                self.sync_paint(hwnd).await?;
                0
            }
            // The frame: drawn as USER draws every window's.
            WM_NCPAINT => {
                let visible = self.system().windows[index]
                    .as_ref()
                    .is_some_and(|window| window.visible);

                if visible {
                    self.ask_caption(hwnd, index).await?;
                    self.system().paint_frame(index);
                }

                0
            }
            // The class's brush, a system colour's or its own, over what
            // shows of the client area; with no brush nothing is drawn and
            // the answer is nought, the erase not done (seg1 `6355`). A
            // hollow brush -- `NULL_BRUSH` -- is a brush, and paints
            // nothing: what was there shows. Jewel Thief of the corpus gives
            // its logo's class one, and the dialog's white shows round it.
            WM_ERASEBKGND => {
                let mut system = self.system();
                let class = system.windows[index]
                    .as_ref()
                    .and_then(|window| system.class_named(&window.class));
                let handle = class.map_or(0, |class| system.classes[class].background);
                let Some(background) = system.background_of(handle) else {
                    return Ok(Some(0));
                };

                if background.hollow {
                    return Ok(Some(1));
                }

                // Erased as `FillRect` fills: the brush realised in the
                // window, if it is not already somewhere, and its pattern
                // from there (`brushrlz`). A system colour's number is no
                // brush to realise.
                let mut origin = (0, 0);

                if handle > 21
                    && let Some((object, GdiObject::Brush(brush))) = system.gdi_object_of(handle)
                {
                    let corner = {
                        let window = system.windows[index].as_ref().expect("a window");

                        (
                            window.left + window.client.left,
                            window.top + window.client.top,
                        )
                    };
                    let realised = if let Some(realised) = brush.realised {
                        realised
                    } else {
                        let at = if let Some(dc) =
                            system.windows[index].as_ref().and_then(|window| window.dc)
                        {
                            crate::gdi::dc::brush_org_of(&system, dc)
                        } else {
                            corner
                        };

                        if let GdiObject::Brush(brush) = &mut system.gdi.objects[object] {
                            brush.realised = Some(at);
                        }

                        at
                    };

                    origin = (realised.0 - corner.0, realised.1 - corner.1);
                }

                system.erase(index, background.colorref, background.pattern, origin);
                1
            }
            _ => {
                let _ = lparam;
                return Ok(None);
            }
        }))
    }

    /// `BeginPaint` and `EndPaint`, as `DefWindowProc` paints a window.
    /// With `icon`, the window's icon drawn between them, as for
    /// `WM_PAINTICON`.
    async fn paint_and_end(&self, hwnd: u16, index: usize, icon: bool) -> Result<(), Stop> {
        let (hdc, _) = self.begin_paint(hwnd, index).await?;
        let mut system = self.system();

        if icon {
            system.draw_window_icon(index);
        }

        if let Some(window) = system.windows[index].as_mut() {
            window.paint_clip = None;
            window.paint_shape = None;
        }

        system.caret_after_paint(hwnd);

        let own = system.windows[index].as_ref().and_then(|window| window.dc);

        if let (Some(Object::Dc(dc)), Some(own)) = (system.handles.resolve(hdc), own)
            && dc == own
        {
            system.handles.free(hdc);
            system.gdi.dcs[dc].live = system.gdi.dcs[dc].live.saturating_sub(1);
        }

        Ok(())
    }

    /// A caption about to be drawn is asked of its window first, with
    /// `WM_GETTEXT` for 79 characters at most (`showseq`); a window
    /// minimized draws none (`showmin`).
    async fn ask_caption(&self, hwnd: u16, index: usize) -> Result<(), Stop> {
        let asks = self.system().windows[index].as_ref().is_some_and(|window| {
            window.visible
                && window.style & WS_CAPTION == WS_CAPTION
                && window.placement != Placement::Minimized
        });

        if asks {
            self.send_message(hwnd, WM_GETTEXT, 0x4f, &mut Param::Struct(vec![0; 80]))
                .await?;
        }

        Ok(())
    }

    /// `DefWindowProc`'s `WM_SETCURSOR`: a child's parent asked first; in
    /// the client area the class's cursor, for the window's own message;
    /// elsewhere the arrow, or a sizing border's.
    async fn default_set_cursor(
        &self,
        hwnd: u16,
        index: usize,
        wparam: u16,
        lparam: u32,
    ) -> Result<u32, Stop> {
        let (parent, style) = {
            let system = self.system();
            let window = system.windows[index].as_ref().expect("a window");
            let parent = window
                .parent
                .and_then(|parent| system.windows[parent].as_ref())
                .map(|parent| parent.hwnd);

            (parent, window.style)
        };

        if style & WS_CHILD != 0
            && let Some(parent) = parent
            && self
                .send_message(parent, WM_SETCURSOR, wparam, &mut Param::Value(lparam))
                .await?
                != 0
        {
            return Ok(1);
        }

        let hit = lparam as u16;
        let mut system = self.system();

        if hit == HTCLIENT {
            let class = system.windows[index]
                .as_ref()
                .and_then(|window| system.class_named(&window.class));
            let cursor = class.map_or(0, |class| system.classes[class].cursor);

            if wparam != hwnd || cursor == 0 {
                return Ok(0);
            }

            crate::icons::set_cursor(&mut system, &mut Args::repeat(cursor))?;
            return Ok(1);
        }

        system.raster();

        let cursor = crate::icons::standard_cursor_handle(&mut system, border_cursor(hit));

        crate::icons::set_cursor(&mut system, &mut Args::repeat(cursor))?;
        Ok(1)
    }

    /// `WM_MOVE` and `WM_SIZE`, as `WM_WINDOWPOSCHANGED`'s flags say.
    pub(crate) async fn window_pos_changed(
        &self,
        hwnd: u16,
        index: usize,
        flags: u16,
    ) -> Result<(), Stop> {
        let (kind, size, origin) = self.system().size_and_origin(index);

        if flags & SWP_NOMOVE == 0 {
            self.send_message(hwnd, WM_MOVE, 0, &mut Param::Value(origin))
                .await?;
        }

        if flags & SWP_NOSIZE == 0 {
            self.send_message(hwnd, WM_SIZE, kind, &mut Param::Value(size))
                .await?;
        }

        Ok(())
    }

    /// The focus given to a window, as `SetFocus` gives it on the raster
    /// desktop: not to one minimized or disabled, or inside one (`USER.EXE`
    /// seg1 `3869`); `WM_KILLFOCUS` to the window that had it, naming this
    /// one, then `WM_SETFOCUS` to this one. The window that had it.
    pub async fn set_focus(&self, hwnd: u16) -> Result<u16, Stop> {
        let (index, previous) = {
            let system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(0);
            };
            let mut at = Some(index);

            while let Some(window) = at {
                let window = system.windows[window].as_ref().expect("a window");

                if window.placement == Placement::Minimized
                    || window.style & (WS_MINIMIZE | WS_DISABLED) != 0
                {
                    return Ok(0);
                }

                at = window.parent;
            }

            let previous = system
                .focus
                .and_then(|focus| system.windows[focus].as_ref())
                .map_or(0, |window| window.hwnd);

            if system.focus == Some(index) {
                return Ok(previous);
            }

            (index, previous)
        };

        if previous != 0 {
            self.send_message(previous, WM_KILLFOCUS, hwnd, &mut Param::Value(0))
                .await?;
        }

        self.system().focus = Some(index);
        self.send_message(hwnd, WM_SETFOCUS, previous, &mut Param::Value(0))
            .await?;
        Ok(previous)
    }

    /// The focus taken away: `WM_KILLFOCUS` to the window that had it,
    /// naming none, and the answer is that window (`activate`).
    pub async fn focus_nothing(&self) -> Result<u16, Stop> {
        let previous = {
            let mut system = self.system();
            let previous = system
                .focus
                .and_then(|focus| system.windows[focus].as_ref())
                .map_or(0, |window| window.hwnd);

            system.focus = None;
            previous
        };

        if previous != 0 {
            self.send_message(previous, WM_KILLFOCUS, 0, &mut Param::Value(0))
                .await?;
        }

        Ok(previous)
    }
}

/// The window keys go to, nought for none.
pub fn get_focus(
    system: &mut crate::system::System,
    _: &mut Args,
) -> Result<crate::call::Answer, Stop> {
    system.raster();

    let focus = system
        .focus
        .and_then(|focus| system.windows[focus].as_ref())
        .map_or(0, |window| window.hwnd);

    Ok(crate::call::Answer::Word(focus))
}

/// The focus given to a window, or taken away by nought; the window that
/// had it. A handle that is no window's changes nothing.
pub fn set_focus(engine: &Engine, mut args: Args) -> crate::call::Later<'_> {
    Box::pin(async move {
        let (hwnd, window, raster) = {
            let mut system = engine.system();
            let hwnd = args.word(&system);
            let window = system.window_named(hwnd).is_some();

            (hwnd, window, system.raster())
        };
        let previous = if window {
            engine.set_focus(hwnd).await?
        } else if hwnd == 0 && raster {
            engine.focus_nothing().await?
        } else {
            0
        };

        Ok(crate::call::Answer::Word(previous))
    })
}
