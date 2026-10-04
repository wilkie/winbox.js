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
    /// Its device context, one for all the handles `GetDC` gives for it,
    /// once one is asked for.
    pub dc: Option<usize>,
    /// What it shows minimized: its class's icon as it was when it was
    /// made.
    pub icon: Option<winbox_raster::IconData>,
    /// Whether its client area is to be erased and painted, its frame
    /// drawn again by `WM_NCPAINT`, or by the desktop itself.
    pub needs_erase: bool,
    pub needs_paint: bool,
    pub needs_nc_paint: bool,
    pub needs_frame: bool,
    /// How much of it is due a paint, on the screen: none for all of it.
    pub dirty: Option<Dirty>,
    /// What is due as a region, while `dirty` is the very box it was set
    /// with: the region, and that box's mark.
    pub dirty_shape: Option<(winbox_raster::ClipRegion, u64)>,
    /// The mark of a box due only where its children were shown, which
    /// `about_to_paint` passes over.
    pub quiet_dirty: Option<u64>,
    /// A paint's clip on the screen, and its shape, while it paints.
    pub paint_clip: Option<[i32; 4]>,
    pub paint_shape: Option<winbox_raster::ClipRegion>,
    /// Where it shows, cut to each ancestor's client area, as the desktop
    /// last worked it out.
    pub clip_rect: [i32; 4],
    /// Whether its last erase was not done, which `BeginPaint` hands back.
    pub unerased: bool,
    /// The caption drawn active or not, as `WM_NCACTIVATE` last had it, or
    /// none to follow the activation.
    pub lit: Option<bool>,
    /// Hidden as its owner was minimized, to show when it is restored.
    pub hidden_with_owner: bool,
    /// Being destroyed: what it gives the activation to is its owner.
    pub destroying: bool,
}

/// A box due a paint, with a mark of its own: a box set again is another
/// box, however alike, as the TypeScript engine's arrays are.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dirty {
    pub area: [i32; 4],
    pub mark: u64,
}

impl Window {
    pub fn client_width(&self) -> i32 {
        self.client.right - self.client.left
    }

    pub fn client_height(&self) -> i32 {
        self.client.bottom - self.client.top
    }
}
