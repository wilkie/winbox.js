//! Windows: each one's place, style, title and family, as USER keeps them
//! and winbox.js's desktop does -- the state first; drawing it is GDI's
//! and the raster layer's.

/// A rectangle: left, top, right, bottom.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// Whether a window is as it was made, maximized, or minimized.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Placement {
    #[default]
    Normal,
    Maximized,
    Minimized,
}

/// A window.
#[derive(Debug, Clone, Default)]
// Each is a yes or no of the window's, as USER keeps it.
#[allow(clippy::struct_excessive_bools)]
pub struct Window {
    pub hwnd: u16,
    /// Where it is on the screen, and its size.
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    pub style: u32,
    pub ex_style: u32,
    pub title: String,
    /// Its class's name, as it was made with.
    pub class: String,
    /// Its menu bar's handle, nought for none.
    pub menu: u16,
    pub visible: bool,
    pub active: bool,
    /// Its client area, relative to the window, as its frame leaves it.
    pub client: Rect,
    /// The window it is a child of, and the window at the top that owns it.
    pub parent: Option<usize>,
    pub owner: Option<usize>,
    /// A child's identifier: what `CreateWindow` was given as its menu.
    pub control_id: u16,
    pub topmost: bool,
    pub modal_frame: bool,
    pub placement: Placement,
    /// Whether it is owed its size and place until it is first shown.
    pub owes_size: bool,
    /// The block its name was copied into, if USER gave it its name.
    pub name_block: u16,
    /// Its extra bytes, as many as its class asks for.
    pub extra: Vec<u8>,
    /// Its own procedure, where a program has subclassed it.
    pub proc: Option<crate::classes::WndProc>,
    /// The instance its procedure is called with: its `CREATESTRUCT`'s.
    pub instance: u16,
    /// The task it was made by.
    pub task: u16,
    /// What it shows minimized: its class's icon as it was when it was
    /// made.
    pub icon: Option<winbox_raster::IconData>,
}

impl Window {
    pub fn client_width(&self) -> i32 {
        self.client.right - self.client.left
    }

    pub fn client_height(&self) -> i32 {
        self.client.bottom - self.client.top
    }
}
