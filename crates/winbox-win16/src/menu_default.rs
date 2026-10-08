//! What `DefWindowProc` does on the raster desktop with the frame's
//! clicks, the system menu's commands and the keys, as winbox.js's
//! `DefWindowProc.ts` does it: a press on the menu bar or the system menu
//! box opens the menu (`menu_loop.rs`), one on the caption or the frame
//! moves or sizes the window (`track_loop.rs`), one on a scroll bar follows
//! it (`scroll_bars.rs`); `WM_SYSCOMMAND` does what the system menu says;
//! Alt, F10 and Alt with a letter reach the menu.

use crate::call::Stop;
use crate::engine::Engine;
use crate::menu_loop::MenuStart;
use crate::messages::Param;
use crate::raster_input::{
    HTBOTTOMRIGHT, HTCAPTION, HTHSCROLL, HTLEFT, HTMAXBUTTON, HTMENU, HTMINBUTTON, HTSYSMENU,
    HTVSCROLL,
};
use crate::track_loop::TrackStart;
use crate::user_calls::system_menu::{
    SC_CLOSE, SC_MAXIMIZE, SC_MINIMIZE, SC_MOVE, SC_RESTORE, SC_SIZE,
};
use crate::windows::Placement;

const WM_CLOSE: u16 = 0x0010;
const WM_KEYDOWN: u16 = 0x0100;
const WM_KEYUP: u16 = 0x0101;
const WM_SYSKEYDOWN: u16 = 0x0104;
const WM_SYSKEYUP: u16 = 0x0105;
const WM_SYSCHAR: u16 = 0x0106;
const WM_SYSCOMMAND: u16 = 0x0112;
const WM_NCLBUTTONDOWN: u16 = 0x00a1;
const WM_NCLBUTTONDBLCLK: u16 = 0x00a3;

const SC_VSCROLL: u16 = 0xf070;
const SC_HSCROLL: u16 = 0xf080;
const SC_MOUSEMENU: u16 = 0xf090;
const SC_KEYMENU: u16 = 0xf100;

const SW_SHOWMAXIMIZED: u16 = 3;
const SW_MINIMIZE: u16 = 6;
const SW_RESTORE: u16 = 9;

const WS_DISABLED: u32 = 0x0800_0000;
const WS_POPUP: u32 = 0x8000_0000;
const WS_CHILD: u32 = 0x4000_0000;
const WS_SYSMENU: u32 = 0x0008_0000;
const WS_MAXIMIZEBOX: u32 = 0x0001_0000;

const CS_NOCLOSE: u16 = 0x0200;

const VK_SHIFT: usize = 0x10;
const VK_MENU: u16 = 0x12;
const VK_ESCAPE: u16 = 0x1b;
const VK_F4: u16 = 0x73;
const VK_F10: u16 = 0x79;

/// A child, as USER tells one: `WS_CHILD` without `WS_POPUP`, and in a
/// parent.
fn is_child(system: &crate::system::System, index: usize) -> bool {
    system.windows[index].as_ref().is_some_and(|window| {
        window.style & (WS_CHILD | WS_POPUP) == WS_CHILD && window.parent.is_some()
    })
}

/// The window a child lies in that is not a child itself (`USER.EXE` seg2
/// `0ab8`).
fn top_level_of(system: &crate::system::System, mut index: usize) -> usize {
    while is_child(system, index) {
        match system.windows[index]
            .as_ref()
            .and_then(|window| window.parent)
        {
            Some(parent) => index = parent,
            None => break,
        }
    }

    index
}

/// A window's handle, nought for none.
fn hwnd_of(system: &crate::system::System, index: usize) -> u16 {
    system.windows[index]
        .as_ref()
        .map_or(0, |window| window.hwnd)
}

impl Engine {
    /// The window whose menu a window's keys and system menu box reach:
    /// itself or the nearest it lies in that is not a child or has a system
    /// menu of its own (`USER.EXE` seg17 `00fe`-`012b`).
    fn menu_window_of(system: &crate::system::System, index: usize) -> usize {
        let mut menu_window = index;

        while is_child(system, menu_window)
            && system.windows[menu_window]
                .as_ref()
                .is_some_and(|w| w.style & WS_SYSMENU == 0)
        {
            match system.windows[menu_window].as_ref().and_then(|w| w.parent) {
                Some(parent) => menu_window = parent,
                None => break,
            }
        }

        menu_window
    }

    /// What `DefWindowProc` does with the frame's clicks, `WM_SYSCOMMAND`
    /// and the keys, if the message is one of those; `None` for a message
    /// it leaves to the rest.
    #[allow(clippy::too_many_lines)]
    pub async fn menu_default(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
        wparam: u16,
        lparam: u32,
    ) -> Result<Option<u32>, Stop> {
        // A press on a scroll bar is a system command to the window, pressed
        // once or twice alike (`USER.EXE` seg1 `01cb`, `0314`).
        if (message == WM_NCLBUTTONDOWN || message == WM_NCLBUTTONDBLCLK)
            && (wparam == HTVSCROLL || wparam == HTHSCROLL)
        {
            let command = if wparam == HTVSCROLL {
                SC_VSCROLL
            } else {
                SC_HSCROLL
            } | wparam;

            self.send_message(hwnd, WM_SYSCOMMAND, command, &mut Param::Value(lparam))
                .await?;
            return Ok(Some(0));
        }

        match message {
            WM_NCLBUTTONDOWN => self.frame_press(hwnd, index, wparam, lparam).await,
            // A double click on the caption: `WM_SYSCOMMAND` sent to the
            // window, with `HTCAPTION` in the command and the point as it
            // came -- `SC_RESTORE` for an icon or a maximized window,
            // `SC_MAXIMIZE` for another only where it has a maximize box,
            // and nothing at all for one without (`USER.EXE` seg1
            // `0221`-`0238`, `0314`). USER asks the system menu too, once it
            // has brought the menu up to the window's state (seg9 `0d8b`),
            // whether Maximize is grayed (seg1 `02cc`-`030d`): brought up to
            // it, that is the maximize box again. **Recorded** by `capdbl`:
            // Save As's frame and a window without the box stay as they
            // are; a window with it is maximized even with Maximize grayed
            // by `EnableMenuItem`, and one maximized is restored, box or no
            // box.
            WM_NCLBUTTONDBLCLK if wparam == HTCAPTION => {
                let (placement, style) = {
                    let system = self.system();

                    system.windows[index]
                        .as_ref()
                        .map_or((Placement::Normal, 0), |window| {
                            (window.placement, window.style)
                        })
                };
                let command = match placement {
                    Placement::Normal if style & WS_MAXIMIZEBOX != 0 => SC_MAXIMIZE,
                    Placement::Normal => return Ok(Some(0)),
                    _ => SC_RESTORE,
                };

                self.send_message(
                    hwnd,
                    WM_SYSCOMMAND,
                    command | HTCAPTION,
                    &mut Param::Value(lparam),
                )
                .await?;
                Ok(Some(0))
            }
            WM_SYSCOMMAND => Ok(Some(
                self.system_command(hwnd, index, wparam, lparam).await?,
            )),
            // The keys that reach the menu, as `DefWindowProc` takes them
            // (`USER.EXE` seg1 `616e`-`6299`), whichever window has the
            // focus (`altchild`). Two flags of USER's own: Alt pressed with
            // nothing after it (`1d0`) and F10 pressed (`352`).
            //
            // A system key with Alt down: Alt's first press sets the first
            // flag, any other key clears it, a repeat leaves it; F10's is
            // cleared; and Alt+F4 closes the active window -- `WM_SYSCOMMAND`
            // with `SC_CLOSE` posted to it, unless its class has
            // `CS_NOCLOSE` (seg1 `578d`, `57ce`-`5808`). From a child, that
            // is the window it lies in (`altchild`). Not followed: Alt with
            // Tab, Escape or F6, which send the active window
            // `SC_NEXTWINDOW` or `SC_PREVWINDOW` (`57a7`); and, for Alt+F4,
            // what USER does first when the focus is in another top-level
            // window than the active one (`57db`-`57f5`).
            WM_SYSKEYDOWN if lparam & (1 << 29) != 0 => {
                {
                    let mut system = self.system();

                    if lparam & (1 << 30) == 0 {
                        system.menu_loop.alt_alone =
                            wparam == VK_MENU && !system.menu_loop.alt_alone;
                    }

                    system.menu_loop.f10 = false;
                }

                if wparam == VK_F4 {
                    self.close_active();
                }

                Ok(Some(0))
            }
            // Without Alt: F10, its flag; Shift+Escape, the window's system
            // menu (`6201`-`6224`).
            WM_SYSKEYDOWN => {
                let shift = self.system().user_state.key_states[VK_SHIFT] & 0x80 != 0;

                if wparam == VK_F10 {
                    self.system().menu_loop.f10 = true;
                } else if wparam == VK_ESCAPE && shift {
                    self.send_message(hwnd, WM_SYSCOMMAND, SC_KEYMENU, &mut Param::Value(0x20))
                        .await?;
                }

                Ok(Some(0))
            }
            WM_KEYDOWN => {
                if wparam == VK_F10 {
                    self.system().menu_loop.f10 = true;
                }

                Ok(Some(0))
            }
            // Alt released with nothing pressed after it, or F10 released
            // after its press: the menu of the top-level window, `SC_KEYMENU`
            // sent to it -- from a child, past every window between
            // (`6180`-`61b8`, seg2 `0ab8`; `altchild`). Any release clears
            // both flags.
            WM_SYSKEYUP | WM_KEYUP => {
                let top = {
                    let mut system = self.system();
                    let enter = (wparam == VK_MENU && system.menu_loop.alt_alone)
                        || (wparam == VK_F10 && system.menu_loop.f10);

                    system.menu_loop.alt_alone = false;
                    system.menu_loop.f10 = false;

                    enter.then(|| hwnd_of(&system, top_level_of(&system, index)))
                };

                if let Some(top) = top {
                    self.send_message(top, WM_SYSCOMMAND, SC_KEYMENU, &mut Param::Value(0))
                        .await?;
                }

                Ok(Some(0))
            }
            // A character typed with Alt: `SC_KEYMENU` with it, sent to the
            // window itself -- but Alt+Space in a child is the parent's,
            // sent on to it as the same `WM_SYSCHAR`, so it reaches the
            // top-level window's system menu one parent at a time; Tab and
            // Escape are nothing (`622c`-`6290`; `altchild`). Not followed:
            // Enter in a window minimized, which posts it `SC_RESTORE`
            // (`6238`); and the beep for a character without Alt (`6297`).
            WM_SYSCHAR => {
                let parent = {
                    let mut system = self.system();

                    system.menu_loop.alt_alone = false;

                    if is_child(&system, index) {
                        system.windows[index]
                            .as_ref()
                            .and_then(|window| window.parent)
                            .map(|parent| hwnd_of(&system, parent))
                    } else {
                        None
                    }
                };

                if lparam & (1 << 29) != 0 && wparam != 0 && wparam != 0x09 && wparam != 0x1b {
                    match parent {
                        Some(parent) if wparam == 0x20 => {
                            self.send_message(
                                parent,
                                WM_SYSCHAR,
                                wparam,
                                &mut Param::Value(lparam),
                            )
                            .await?;
                        }
                        _ => {
                            self.send_message(
                                hwnd,
                                WM_SYSCOMMAND,
                                SC_KEYMENU,
                                &mut Param::Value(u32::from(wparam)),
                            )
                            .await?;
                        }
                    }
                }

                Ok(Some(0))
            }
            _ => Ok(None),
        }
    }

    /// `SC_CLOSE` posted to the active window, unless its class has
    /// `CS_NOCLOSE`.
    fn close_active(&self) {
        let mut system = self.system();

        if let Some(active) = system.active_window()
            && system.class_style(active) & CS_NOCLOSE == 0
        {
            let hwnd = hwnd_of(&system, active);

            system.post_message(hwnd, WM_SYSCOMMAND, SC_CLOSE, 0);
        }
    }

    fn placement(&self, index: usize) -> Placement {
        self.system().windows[index]
            .as_ref()
            .map_or(Placement::Normal, |window| window.placement)
    }

    /// `WM_NCLBUTTONDOWN`: a press on the menu bar opens that item's menu;
    /// on the box, the system menu; the caption moves the window, the
    /// frame's edges and corners size it, and the boxes minimize and
    /// maximize it.
    async fn frame_press(
        &self,
        hwnd: u16,
        index: usize,
        hit: u16,
        lparam: u32,
    ) -> Result<Option<u32>, Stop> {
        // The menu bar or the system menu box: `WM_SYSCOMMAND` with
        // `SC_MOUSEMENU` and the hit, the point as it came (`USER.EXE` seg1
        // `01cb`; `mdisys`: `f093` for a document window's box, `f095` for
        // a frame's bar).
        if hit == HTMENU || hit == HTSYSMENU {
            self.send_message(
                hwnd,
                WM_SYSCOMMAND,
                SC_MOUSEMENU | hit,
                &mut Param::Value(lparam),
            )
            .await?;
            return Ok(Some(0));
        }

        let (x, y) = (
            i32::from(lparam as u16 as i16),
            i32::from((lparam >> 16) as u16 as i16),
        );

        // The caption: its window made active, as a click makes it, and
        // then moved by `SC_MOVE` with `HTCAPTION`, the point as it came
        // (`iconclk`). The frame's edges and corners size it.
        if hit == HTCAPTION {
            self.activate_by_click(index).await?;
            self.send_message(
                hwnd,
                WM_SYSCOMMAND,
                SC_MOVE | HTCAPTION,
                &mut Param::Value(lparam),
            )
            .await?;
            return Ok(Some(0));
        }

        if (HTLEFT..=HTBOTTOMRIGHT).contains(&hit) && self.placement(index) == Placement::Normal {
            self.track_window(hwnd, TrackStart::Size { x, y, hit })
                .await?;
            return Ok(Some(0));
        }

        // Not measured: Windows shows the box pressed until the button is
        // released over it; here, as in the TypeScript engine, the press is
        // enough.
        if hit == HTMINBUTTON {
            return Ok(Some(
                self.system_command(hwnd, index, SC_MINIMIZE, 0).await?,
            ));
        }

        if hit == HTMAXBUTTON {
            let command = if self.placement(index) == Placement::Maximized {
                SC_RESTORE
            } else {
                SC_MAXIMIZE
            };

            return Ok(Some(self.system_command(hwnd, index, command, 0).await?));
        }

        Ok(None)
    }

    /// A window's top-level window made active, if it is not, as a click
    /// makes it.
    async fn activate_by_click(&self, index: usize) -> Result<(), Stop> {
        {
            let mut system = self.system();
            let mut top = index;

            while let Some(parent) = system.windows[top].as_ref().and_then(|w| w.parent) {
                top = parent;
            }

            if system.windows[top].as_ref().is_none_or(|w| w.active) {
                return Ok(());
            }

            system.show(top);

            if let Some((_, click)) = system.pending_activation.as_mut() {
                *click = true;
            }
        }

        self.deliver_activation(None).await
    }

    /// `WM_SYSCOMMAND`, as `DefWindowProc` carries out each command; any it
    /// does not know does nothing.
    #[allow(clippy::too_many_lines)]
    async fn system_command(
        &self,
        hwnd: u16,
        index: usize,
        wparam: u16,
        lparam: u32,
    ) -> Result<u32, Stop> {
        match wparam & 0xfff0 {
            SC_KEYMENU => {
                // The menu the keys reach: that of the nearest window the
                // window lies in, or itself, that is not a child, or that has
                // a system menu of its own -- an MDI document window, whose
                // own menu is its system menu (`USER.EXE` seg17 `00fe`-`012b`;
                // `altchild`, `mdisys`). Alt alone does nothing where that
                // window has no bar.
                let (menu_window, has_bar) = {
                    let system = self.system();
                    let menu_window = Self::menu_window_of(&system, index);
                    let has_bar = !is_child(&system, menu_window)
                        && system.windows[menu_window]
                            .as_ref()
                            .and_then(|w| w.bar.as_ref())
                            .is_some_and(|bar| !bar.is_empty());

                    (menu_window, has_bar)
                };
                let character = lparam as u8;

                if character == 0 && !has_bar {
                    return Ok(0);
                }

                let hwnd = hwnd_of(&self.system(), menu_window);

                self.track_menu(
                    hwnd,
                    MenuStart::Key {
                        character: u16::from(character),
                    },
                )
                .await?;
                Ok(0)
            }
            // The menu the mouse pressed: the system menu, or the bar's item
            // under the point (seg1 `04ab`).
            SC_MOUSEMENU => {
                let (menu_window, found) = {
                    let system = self.system();
                    let menu_window = Self::menu_window_of(&system, index);
                    let (x, y) = ((lparam & 0xffff) as i32, ((lparam >> 16) & 0xffff) as i32);
                    let found = system.menu_bar_items(index).iter().position(|item| {
                        x >= item[0] && x < item[1] && y >= item[2] && y < item[3]
                    });

                    (menu_window, found)
                };

                if wparam & 0x0f == HTSYSMENU {
                    let hwnd = hwnd_of(&self.system(), menu_window);

                    self.track_menu(hwnd, MenuStart::System { keyboard: false })
                        .await?;
                } else if let Some(item) = found {
                    self.track_menu(
                        hwnd,
                        MenuStart::Bar {
                            index: item,
                            keyboard: false,
                            open: true,
                        },
                    )
                    .await?;
                }

                Ok(0)
            }
            // The scroll bar followed until let go, unless something has the
            // mouse or the window is disabled (seg1 `037c`).
            SC_VSCROLL | SC_HSCROLL => {
                let follows = {
                    let system = self.system();

                    system.capture.is_none()
                        && system.windows[index]
                            .as_ref()
                            .is_some_and(|w| w.style & WS_DISABLED == 0)
                };

                if follows {
                    self.track_scroll_bar(
                        hwnd,
                        wparam & 0x0f,
                        i32::from(lparam as u16 as i16),
                        i32::from((lparam >> 16) as u16 as i16),
                    )
                    .await?;
                }

                Ok(0)
            }
            SC_MOVE => {
                // From the caption, the mouse moves it: not a window
                // maximized. An icon let go where it was pressed opens its
                // system menu, as Alt and Space would (`iconclk`) -- a
                // child's, a document window's, as Alt and the hyphen would
                // (`USER.EXE` seg6 `1369`-`1391`).
                if wparam & 0x0f == HTCAPTION {
                    if self.placement(index) == Placement::Maximized {
                        return Ok(0);
                    }

                    let moved = self
                        .track_window(
                            hwnd,
                            TrackStart::Move {
                                x: i32::from(lparam as u16 as i16),
                                y: i32::from((lparam >> 16) as u16 as i16),
                            },
                        )
                        .await?;

                    if !moved && self.placement(index) == Placement::Minimized {
                        let child = self.system().windows[index]
                            .as_ref()
                            .is_some_and(|window| window.style & WS_CHILD != 0);
                        let key = if child { 0x2d } else { 0x20 };

                        self.send_message(hwnd, WM_SYSCOMMAND, SC_KEYMENU, &mut Param::Value(key))
                            .await?;
                    }

                    return Ok(0);
                }

                self.track_window(hwnd, TrackStart::Keyboard { size: false })
                    .await?;
                Ok(0)
            }
            SC_SIZE => {
                self.track_window(hwnd, TrackStart::Keyboard { size: true })
                    .await?;
                Ok(0)
            }
            SC_MINIMIZE => {
                self.show_raster(hwnd, index, SW_MINIMIZE, true, false)
                    .await?;
                Ok(0)
            }
            SC_MAXIMIZE => {
                self.show_raster(hwnd, index, SW_SHOWMAXIMIZED, true, false)
                    .await?;
                Ok(0)
            }
            SC_RESTORE => {
                self.show_raster(hwnd, index, SW_RESTORE, true, false)
                    .await?;
                Ok(0)
            }
            SC_CLOSE => {
                self.send_message(hwnd, WM_CLOSE, 0, &mut Param::Value(0))
                    .await?;
                Ok(0)
            }
            _ => Ok(0),
        }
    }
}
