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
const SC_KEYMENU: u16 = 0xf100;

const SW_SHOWMAXIMIZED: u16 = 3;
const SW_MINIMIZE: u16 = 6;
const SW_RESTORE: u16 = 9;

const WS_DISABLED: u32 = 0x0800_0000;

const VK_MENU: u16 = 0x12;
const VK_F4: u16 = 0x73;
const VK_F10: u16 = 0x79;

impl Engine {
    /// What `DefWindowProc` does with the frame's clicks, `WM_SYSCOMMAND`
    /// and the keys, if the message is one of those; `None` for a message
    /// it leaves to the rest.
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
            // A double click on the caption maximizes the window, or
            // restores it; on an icon, it restores it.
            WM_NCLBUTTONDBLCLK if wparam == HTCAPTION => {
                let command = if self.placement(index) == Placement::Normal {
                    SC_MAXIMIZE
                } else {
                    SC_RESTORE
                };

                Ok(Some(self.system_command(hwnd, index, command, 0).await?))
            }
            WM_SYSCOMMAND => Ok(Some(
                self.system_command(hwnd, index, wparam, lparam).await?,
            )),
            // Whether Alt is alone so far: any other key pressed while it is
            // down makes its release nothing, as Alt and a letter is the
            // letter's menu.
            WM_SYSKEYDOWN | WM_KEYDOWN => {
                self.system().menu_loop.alt_alone = message == WM_SYSKEYDOWN && wparam == VK_MENU;

                // Alt+F4 is the system menu's Close, as the menu itself
                // says.
                if message == WM_SYSKEYDOWN && wparam == VK_F4 {
                    return Ok(Some(self.system_command(hwnd, index, SC_CLOSE, 0).await?));
                }

                Ok(None)
            }
            // Alt released alone, or F10: into the menu bar from the
            // keyboard.
            WM_SYSKEYUP | WM_KEYUP => {
                if message == WM_SYSKEYUP && wparam == VK_MENU {
                    let alone = {
                        let mut system = self.system();
                        let alone = system.menu_loop.alt_alone;

                        system.menu_loop.alt_alone = false;
                        alone
                    };

                    return Ok(if alone {
                        Some(self.system_command(hwnd, index, SC_KEYMENU, 0).await?)
                    } else {
                        None
                    });
                }

                if wparam == VK_F10 {
                    return Ok(Some(self.system_command(hwnd, index, SC_KEYMENU, 0).await?));
                }

                Ok(None)
            }
            WM_SYSCHAR => Ok(Some(
                self.system_command(hwnd, index, SC_KEYMENU, u32::from(wparam))
                    .await?,
            )),
            _ => Ok(None),
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
        if hit == HTMENU {
            // The point read as two unsigned words, as the TypeScript engine
            // reads it here.
            let (x, y) = ((lparam & 0xffff) as i32, ((lparam >> 16) & 0xffff) as i32);
            let found = self
                .system()
                .menu_bar_items(index)
                .iter()
                .position(|item| x >= item[0] && x < item[1] && y >= item[2] && y < item[3]);

            if let Some(item) = found {
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

            return Ok(Some(0));
        }

        if hit == HTSYSMENU {
            self.track_menu(hwnd, MenuStart::System { keyboard: false })
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
                // A child has no menu: the keys are for the window it lies
                // in, as Alt and a letter reach Notepad's menu from its edit
                // control.
                let (parent_top, labels) = {
                    let system = self.system();
                    let window = system.windows[index].as_ref();
                    let mut top = window.and_then(|w| w.parent);

                    while let Some(parent) = top.and_then(|t| system.windows[t].as_ref()?.parent) {
                        top = Some(parent);
                    }

                    (
                        top.map(|top| system.windows[top].as_ref().map_or(0, |w| w.hwnd)),
                        window.and_then(|w| w.bar.clone()).unwrap_or_default(),
                    )
                };

                if let Some(top) = parent_top {
                    return if top == 0 {
                        Ok(0)
                    } else {
                        self.send_message(top, WM_SYSCOMMAND, wparam, &mut Param::Value(lparam))
                            .await
                    };
                }

                // Alt and a letter: the item it names; Alt and Space: the
                // system menu; Alt alone: the bar, its first item selected,
                // nothing open.
                let letter: String = char::from(lparam as u8).to_uppercase().collect();

                if letter == " " {
                    self.track_menu(hwnd, MenuStart::System { keyboard: true })
                        .await?;
                    return Ok(0);
                }

                if labels.is_empty() {
                    return Ok(0);
                }

                if lparam as u8 == 0 {
                    self.track_menu(
                        hwnd,
                        MenuStart::Bar {
                            index: 0,
                            keyboard: true,
                            open: false,
                        },
                    )
                    .await?;
                    return Ok(0);
                }

                let found = labels.iter().position(|label| {
                    let chars: Vec<char> = label.chars().collect();

                    chars.iter().position(|&c| c == '&').is_some_and(|at| {
                        chars
                            .get(at + 1)
                            .is_some_and(|&next| next.to_uppercase().collect::<String>() == letter)
                    })
                });

                if let Some(found) = found {
                    self.track_menu(
                        hwnd,
                        MenuStart::Bar {
                            index: found,
                            keyboard: true,
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
                // system menu, as Alt and Space would (`iconclk`).
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
                        self.send_message(hwnd, WM_SYSCOMMAND, SC_KEYMENU, &mut Param::Value(0x20))
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
