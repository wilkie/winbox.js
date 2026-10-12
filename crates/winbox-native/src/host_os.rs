//! What seamless mode asks of the host's own window system that winit has
//! no call for. On Windows: the owner a window is made with, a menu's
//! window that a press does not activate (`WS_EX_NOACTIVATE`), the host's
//! windows stacked as the emulated ones are (`SetWindowPos`), one brought
//! forward without winit's `focus_window`, which presses Alt to be let
//! (the emulated machine would be given that Alt), the work area's corner,
//! and the host's own order of the windows, for `--seamless-shots`.
//! Elsewhere, what winit offers, or nothing.

use winit::event_loop::ActiveEventLoop;
use winit::window::Window;

/// A window's own handle on the host, where it has one this file uses.
pub fn handle_of(window: &Window) -> Option<isize> {
    #[cfg(windows)]
    {
        use winit::raw_window_handle::{HasWindowHandle, RawWindowHandle};

        match window.window_handle().ok()?.as_raw() {
            RawWindowHandle::Win32(handle) => Some(handle.hwnd.get()),
            _ => None,
        }
    }

    #[cfg(not(windows))]
    {
        let _ = window;
        None
    }
}

/// Where the emulated screen's top left goes: the corner of the primary
/// monitor's work area, clear of a task bar along its top or left, on
/// Windows; else the primary monitor's corner.
pub fn screen_origin(event_loop: &ActiveEventLoop) -> (i32, i32) {
    #[cfg(windows)]
    if let Some(origin) = windows::work_area_origin() {
        return origin;
    }

    event_loop
        .primary_monitor()
        .or_else(|| event_loop.available_monitors().next())
        .map_or((0, 0), |monitor| {
            let at = monitor.position();

            (at.x, at.y)
        })
}

/// A window a press does not activate: a menu's, a list dropped down.
/// winit sets a window's styles again as it shows it, so this is asked
/// again after.
pub fn never_activated(window: &Window) {
    #[cfg(windows)]
    if let Some(handle) = handle_of(window) {
        windows::no_activate(handle);
    }

    #[cfg(not(windows))]
    let _ = window;
}

/// The host's windows stacked front to back as given, none activated.
pub fn restack(windows: &[&Window]) {
    #[cfg(windows)]
    {
        let handles: Vec<isize> = windows.iter().filter_map(|w| handle_of(w)).collect();

        windows::restack(&handles);
    }

    #[cfg(not(windows))]
    let _ = windows;
}

/// A window brought forward and given the keyboard, as the emulated one
/// was made active. On Windows only where the host lets this program take
/// the foreground; elsewhere winit's own call.
pub fn bring_forward(window: &Window) {
    #[cfg(windows)]
    if let Some(handle) = handle_of(window) {
        windows::foreground(handle);
    }

    #[cfg(not(windows))]
    window.focus_window();
}

/// The host's own word on a window, for `--seamless-shots`: where it is in
/// the host's order of all its windows (nought in front), its owner's
/// handle, and whether it shows on the task bar and may be activated.
#[derive(Debug, Default, Clone, Copy)]
pub struct HostSays {
    pub handle: Option<isize>,
    pub order: Option<usize>,
    pub owner: Option<isize>,
    pub app_window: bool,
    pub no_activate: bool,
    pub foreground: bool,
}

pub fn host_says(window: &Window) -> HostSays {
    #[cfg(windows)]
    if let Some(handle) = handle_of(window) {
        return windows::says(handle);
    }

    let _ = window;
    HostSays::default()
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod windows {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GW_HWNDNEXT, GW_OWNER, GWL_EXSTYLE, GetForegroundWindow, GetTopWindow, GetWindow,
        GetWindowLongPtrW, SPI_GETWORKAREA, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
        SWP_NOSIZE, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, SystemParametersInfoW,
        WS_EX_APPWINDOW, WS_EX_NOACTIVATE,
    };

    use super::HostSays;

    pub fn work_area_origin() -> Option<(i32, i32)> {
        let mut area = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        // SAFETY: SPI_GETWORKAREA writes a RECT where it is pointed.
        let done = unsafe {
            SystemParametersInfoW(SPI_GETWORKAREA, 0, std::ptr::from_mut(&mut area).cast(), 0)
        };

        (done != 0).then_some((area.left, area.top))
    }

    pub fn no_activate(handle: isize) {
        // SAFETY: the handle is a window of this thread's, living.
        unsafe {
            let style = GetWindowLongPtrW(handle, GWL_EXSTYLE);

            if style & WS_EX_NOACTIVATE as isize == 0 {
                SetWindowLongPtrW(handle, GWL_EXSTYLE, style | WS_EX_NOACTIVATE as isize);
            }
        }
    }

    pub fn restack(handles: &[isize]) {
        for pair in handles.windows(2) {
            // SAFETY: both are windows of this thread's, living.
            unsafe {
                SetWindowPos(
                    pair[1],
                    pair[0],
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                );
            }
        }
    }

    pub fn foreground(handle: isize) {
        // SAFETY: the handle is a window of this thread's, living.
        unsafe {
            if GetForegroundWindow() != handle {
                SetForegroundWindow(handle);
            }
        }
    }

    pub fn says(handle: isize) -> HostSays {
        // SAFETY: each call reads of windows; none is kept.
        unsafe {
            let mut order = None;
            let mut at = GetTopWindow(0);
            let mut place = 0;

            while at != 0 && place < 100_000 {
                if at == handle {
                    order = Some(place);
                    break;
                }

                at = GetWindow(at, GW_HWNDNEXT);
                place += 1;
            }

            let style = GetWindowLongPtrW(handle, GWL_EXSTYLE) as u32;
            let owner = GetWindow(handle, GW_OWNER);

            HostSays {
                handle: Some(handle),
                order,
                owner: (owner != 0).then_some(owner),
                app_window: style & WS_EX_APPWINDOW != 0,
                no_activate: style & WS_EX_NOACTIVATE != 0,
                foreground: GetForegroundWindow() == handle,
            }
        }
    }
}
