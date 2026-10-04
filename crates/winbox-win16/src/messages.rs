//! Messages sent to a window's procedure: a program's, called with its
//! window's instance as USER calls one, or USER's own, answered here.

use winbox_cpu::{AX, DS, ES};

use crate::call::Stop;
use crate::classes::{HostProc, WndProc};
use crate::engine::{Engine, GuestArg, Register};
use crate::handles::Object;

pub const WM_CREATE: u16 = 0x0001;
pub const WM_MOVE: u16 = 0x0003;
pub const WM_SIZE: u16 = 0x0005;
pub const WM_SETTEXT: u16 = 0x000c;
pub const WM_CTLCOLOR: u16 = 0x0019;
pub const WM_GETTEXT: u16 = 0x000d;
pub const WM_GETTEXTLENGTH: u16 = 0x000e;
pub const WM_GETMINMAXINFO: u16 = 0x0024;
pub const WM_NCCREATE: u16 = 0x0081;
pub const WM_NCDESTROY: u16 = 0x0082;
pub const WM_NCCALCSIZE: u16 = 0x0083;
pub const WM_PARENTNOTIFY: u16 = 0x0210;

/// What a message's `lParam` carries: a value, or a structure laid out as
/// Windows lays it out, which a program's procedure is given a far pointer
/// to and may change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Param {
    Value(u32),
    Struct(Vec<u8>),
}

/// The messages USER's `DefWindowProc` handles on the raster desktop
/// that are not answered here yet: the frame's
/// clicks, the system menu's commands and the keys.
const RASTER_DEFAULTS: [u16; 7] = [0x00a1, 0x00a3, 0x0112, 0x0104, 0x0100, 0x0105, 0x0101];

/// `WM_SYSCHAR`, which `DefWindowProc` takes for the system menu's key.
const WM_SYSCHAR: u16 = 0x0106;

impl Engine {
    /// A message sent to a window's procedure -- its own, where a program
    /// has subclassed it, else its class's -- and its answer, the structure
    /// in `lParam` as the procedure left it. Nothing is sent to a window
    /// that is gone. Hooks are not called: none can be set yet.
    pub async fn send_message(
        &self,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        // The window procedure hooks first, as for any message sent: the
        // desktop's too (`cwphook`).
        let desktop = {
            let system = self.system();

            match system.handles.resolve(hwnd) {
                Some(Object::Window(index)) if system.windows[index].is_some() => false,
                Some(Object::Desktop) => true,
                _ => return Ok(0),
            }
        };
        let (message, wparam) =
            Box::pin(self.sent_message_hook(hwnd, message, wparam, lparam)).await?;

        if desktop {
            return Ok(0);
        }

        self.dispatch_to(hwnd, message, wparam, lparam).await
    }

    /// A message handed to a window's procedure as `DispatchMessage` hands
    /// one: not the hooks'.
    pub async fn dispatch_to(
        &self,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        let (proc, instance) = {
            let system = self.system();
            let window = match system.handles.resolve(hwnd) {
                Some(Object::Window(index)) => system.windows[index].as_ref(),
                _ => None,
            };
            let Some(window) = window else {
                return Ok(0);
            };
            let class = system
                .class_named(&window.class)
                .map(|class| &system.classes[class]);
            let proc = window
                .proc
                .clone()
                .or_else(|| class.map(|class| class.proc.clone()));

            (proc, window.instance)
        };

        match proc {
            None => Ok(0),
            Some(proc) => {
                self.call_proc_as(&proc, instance | 1, hwnd, message, wparam, lparam)
                    .await
            }
        }
    }

    /// A window procedure called with a message, the window's instance in
    /// AX as USER calls one.
    pub async fn call_proc(
        &self,
        proc: &WndProc,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        let instance = {
            let system = self.system();

            match system.handles.resolve(hwnd) {
                Some(Object::Window(index)) => system.windows[index]
                    .as_ref()
                    .map_or(0, |window| window.instance),
                _ => 0,
            }
        };

        self.call_proc_as(proc, instance | 1, hwnd, message, wparam, lparam)
            .await
    }

    /// A window procedure called with AX as given: USER's own way, the
    /// window's instance with its low bit set, or as the dialog manager
    /// calls a dialog's procedure, the stack's segment.
    pub async fn call_proc_as(
        &self,
        proc: &WndProc,
        ax: u16,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        match proc {
            WndProc::Host(host) => {
                Box::pin(self.host_proc(host, hwnd, message, wparam, lparam)).await
            }
            WndProc::Guest(far) => {
                let far = *far;

                if far == 0 {
                    return Ok(0);
                }

                // USER calls a window procedure with DS and ES the stack's
                // segment and AX the window's instance with its low bit set
                // (`USER.EXE` seg1 `27ad`, `3aa3`).
                let stack = self.system().cpu.segments[winbox_cpu::SS].selector;
                let last = match lparam {
                    Param::Value(value) => GuestArg::Long(*value),
                    Param::Struct(bytes) => GuestArg::Struct(bytes.clone()),
                };
                let args = [
                    GuestArg::Word(hwnd),
                    GuestArg::Word(message),
                    GuestArg::Word(wparam),
                    last,
                ];
                let registers = [
                    Register::Segment(DS, stack),
                    Register::Segment(ES, stack),
                    Register::Word(AX, ax),
                ];
                let (answer, mut structures) = self.call_with(far, &args, &registers).await?;

                if let (Param::Struct(bytes), Some(back)) = (lparam, structures.pop()) {
                    *bytes = back;
                }

                Ok(answer)
            }
        }
    }

    /// A procedure of USER's own.
    async fn host_proc(
        &self,
        proc: &HostProc,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        match proc {
            HostProc::DefWindow => self.def_window_proc(hwnd, message, wparam, lparam).await,
            HostProc::Dialog => Box::pin(self.def_dlg_proc(hwnd, message, wparam, lparam)).await,
            HostProc::Control(kind) => {
                Box::pin(self.control_proc(kind, hwnd, message, wparam, lparam)).await
            }
        }
    }

    /// `DefWindowProc`, as far as it is answered here: `WM_NCCREATE` makes
    /// the window (TRUE, `showsq2`); its text set, read and measured; what
    /// it does not handle answered nought. What it does on the raster
    /// desktop -- painting, activating, the frame's clicks and the system
    /// menu -- is not done yet; that will call into windows, so this is
    /// async already.
    #[allow(clippy::unused_async)]
    pub async fn def_window_proc(
        &self,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        let index = {
            let system = self.system();
            let Some(Object::Window(index)) = system.handles.resolve(hwnd) else {
                return Ok(0);
            };

            index
        };

        if RASTER_DEFAULTS.contains(&message) || message == WM_SYSCHAR {
            return Err(Stop::Unsupported(
                "a message DefWindowProc handles on the desktop",
            ));
        }

        if let Some(answer) =
            Box::pin(self.raster_default(hwnd, index, message, wparam, lparam)).await?
        {
            return Ok(answer);
        }

        if let Some(answer) =
            Box::pin(self.default_messages(hwnd, index, message, wparam, lparam)).await?
        {
            return Ok(answer);
        }

        let mut system = self.system();

        if RASTER_DEFAULTS.contains(&message) {
            return Err(Stop::Unsupported(
                "a message DefWindowProc handles on the desktop",
            ));
        }

        match message {
            WM_NCCREATE => Ok(1),
            // A control's colours, as USER answers them for a parent that
            // leaves them (seg1 `5f9c`): see `controls`.
            WM_CTLCOLOR => {
                let kind = match lparam {
                    Param::Value(value) => (*value >> 16) as u16,
                    Param::Struct(_) => 0,
                };

                Ok(u32::from(system.default_control_colour(wparam, kind)))
            }
            WM_SETTEXT => {
                let text = match lparam {
                    Param::Value(far) => system
                        .read_string(*far)
                        .iter()
                        .map(|&byte| char::from(byte))
                        .collect(),
                    Param::Struct(bytes) => bytes
                        .iter()
                        .take_while(|&&byte| byte != 0)
                        .map(|&byte| char::from(byte))
                        .collect(),
                };

                if let Some(window) = system.windows[index].as_mut() {
                    window.title = text;
                }

                Ok(1)
            }
            WM_GETTEXT => {
                let caption = system.windows[index]
                    .as_ref()
                    .map(|window| window.title.clone())
                    .unwrap_or_default();

                match lparam {
                    Param::Value(far) => {
                        let far = *far;

                        Ok(if wparam == 0 {
                            0
                        } else {
                            system.copy_text(caption.as_bytes(), far, usize::from(wparam)) as u32
                        })
                    }
                    Param::Struct(bytes) => {
                        let count = caption
                            .len()
                            .min(usize::from(wparam).saturating_sub(1))
                            .min(bytes.len().saturating_sub(1));

                        bytes[..count].copy_from_slice(&caption.as_bytes()[..count]);

                        if count < bytes.len() {
                            bytes[count] = 0;
                        }

                        Ok(count as u32)
                    }
                }
            }
            WM_GETTEXTLENGTH => Ok(system.windows[index]
                .as_ref()
                .map_or(0, |window| window.title.len()) as u32),
            _ => Ok(0),
        }
    }
}
