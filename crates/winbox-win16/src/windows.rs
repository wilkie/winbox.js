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
    /// Its menu bar's items' texts as the desktop last had them, set as the
    /// window is made, by `SetMenu` and by `DrawMenuBar`; none for no bar.
    pub bar: Option<Vec<String>>,
    /// Which of the bar's items it shows grayed, as it last had them.
    pub bar_grayed: Option<Vec<bool>>,
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
    /// A standard control's state, for a window of USER's own control
    /// classes or one adopting a control's procedure.
    pub control: Option<crate::controls::ControlState>,
    /// What USER keeps of a dialog, for a dialog's window.
    pub dialog: Option<crate::dialogs::DialogState>,
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
    /// Where a maximized or minimized window goes back to: left, top,
    /// width and height.
    pub restore_rect: Option<[i32; 4]>,
    /// For an icon's title, a window of USER's own (`#32772`) drawn by the
    /// desktop: the window whose title it shows.
    pub title_of: Option<usize>,
    /// A minimized window's title, and where its icon was moved to, which
    /// it goes back to minimized again (`iconclk`).
    pub icon_title: Option<usize>,
    pub icon_place: Option<(i32, i32)>,
    /// Told to the shell hooks as it was made, and so as it is destroyed.
    pub shell_window: bool,
    /// The parent `CreateWindow` was given, which owns a pop-up.
    pub parent_given: u16,
    /// The owned window last made active, kept on the window at the root
    /// of its owners; nought for none.
    pub last_active_popup: u16,
    /// Its own scroll bars' ranges and positions (`scroll_bars.rs`).
    pub scroll_bars: crate::scroll_bars::WindowScroll,
    /// The menu bar's item selected while a menu is open from it, and
    /// whether its system menu is open (`menu_loop.rs`).
    pub menu_selected: Option<usize>,
    pub system_menu_open: bool,
    /// For a pop-up menu's own window, which has no handle: the menu, the
    /// item selected in it, and the screen it covered (`menu_popup.rs`).
    pub popup: Option<crate::menu_popup::PopupWindow>,
}

impl Window {
    /// Whether it is drawn by its own procedure's messages: any window but
    /// an icon's title, which the desktop draws itself.
    pub fn paints_itself(&self) -> bool {
        self.hwnd != 0 && self.title_of.is_none()
    }
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
