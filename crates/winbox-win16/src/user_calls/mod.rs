//! USER's calls answered beside its windows, messages and controls:
//! windows' properties, the system menu as data, the message box, what a
//! window is due to paint asked about and changed, scrolling, the pop-ups
//! at the top, one window locked from drawing, Help asked for, and
//! children and icons arranged.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

pub(crate) mod arrange;
mod lock_update;
pub mod message_box;
mod popups;
pub mod props;
mod scroll_window;
pub mod system_menu;
mod update_region;

use std::collections::HashMap;

use crate::call::Implementation;
use crate::handles::Object;

/// What USER keeps for these calls.
#[derive(Debug, Clone, Default)]
pub struct UserCalls {
    /// Each object's properties, in the order each was first set.
    pub props: HashMap<Object, Vec<props::Prop>>,
    /// The block `EnumProps` writes a property's name in, once made.
    pub prop_name: Option<u32>,
    /// Each window's own system menu, by the window's index, once asked
    /// for or given: the menu's index.
    pub system_menus: HashMap<usize, usize>,
    /// The system menu every window shows that has none of its own, once
    /// made.
    pub default_system_menu: Option<usize>,
    /// The system menus made as an MDI document window's.
    pub document_menus: std::collections::HashSet<usize>,
    /// The window `LockWindowUpdate` locked.
    pub locked: Option<lock_update::Lock>,
    /// How many message boxes are open.
    pub message_boxes: u16,
}

pub fn implementation(name: &str) -> Option<Implementation> {
    use Implementation::{Async, Sync};

    Some(match name {
        "SetProp" => Sync(props::set_prop),
        "GetProp" => Sync(props::get_prop),
        "RemoveProp" => Sync(props::remove_prop),
        "EnumProps" => Async(props::enum_props),
        "GetSystemMenu" => Sync(system_menu::get_system_menu),
        "MessageBox" => Async(message_box::message_box_call),
        "GetUpdateRect" => Sync(update_region::get_update_rect),
        "InvalidateRgn" => Sync(update_region::invalidate_rgn),
        "ValidateRgn" => Sync(update_region::validate_rgn),
        "GetUpdateRgn" => Sync(update_region::get_update_rgn),
        "ExcludeUpdateRgn" => Sync(update_region::exclude_update_rgn),
        "RedrawWindow" => Async(update_region::redraw_window),
        "ScrollWindow" => Sync(scroll_window::scroll_window),
        "ScrollWindowEx" => Sync(scroll_window::scroll_window_ex),
        "ScrollDC" => Sync(scroll_window::scroll_dc),
        "AnyPopUp" => Sync(popups::any_popup),
        "ShowOwnedPopups" => Sync(popups::show_owned_popups),
        "LockWindowUpdate" => Sync(lock_update::lock_window_update),
        "WinHelp" => Sync(popups::win_help),
        "ArrangeIconicWindows" => Sync(arrange::arrange_iconic_windows),
        "CascadeChildWindows" => Async(arrange::cascade_child_windows),
        "TileChildWindows" => Async(arrange::tile_child_windows),
        _ => return None,
    })
}
