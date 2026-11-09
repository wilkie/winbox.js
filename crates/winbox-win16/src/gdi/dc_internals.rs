//! GDI's calls on a device context that USER and the drivers make, and a
//! program may: the logical font selected, the relative-or-absolute mode,
//! the hook a context calls, its clip region's own handle, and `ResetDC`.
//!
//! **Recorded** by `dcinner` on the VGA and the 256-colour display.

use crate::call::{Answer, Args, Implementation, Stop};
use crate::handles::Object;
use crate::system::System;

use super::GdiObject;
use super::dc::{DcBitmap, dc_of, origin_of};

/// USER's `DCHOOK`, ordinal 362, the hook USER sets on the contexts it
/// lends.
const USER_DCHOOK: u16 = 362;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "GetCurLogFont" => get_cur_log_font_call,
        "SetRelAbs" => set_rel_abs_call,
        "GetRelAbs" => get_rel_abs_call,
        "SetDCHook" => set_dc_hook_call,
        "GetDCHook" => get_dc_hook_call,
        "SetHookFlags" => set_hook_flags_call,
        "GetClipRgn" => get_clip_rgn_call,
        "ResetDC" => reset_dc_call,
        _ => return None,
    }))
}

/// `GetCurLogFont`: the font selected's handle (seg1 `511a`); nought for a
/// handle that is no context.
fn get_cur_log_font_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let font = system.gdi.dcs[dc].state.font;

    Ok(Answer::Word(font.map_or(0, |object| {
        system.handles.lookup(Object::Gdi(object)).unwrap_or(0)
    })))
}

/// `SetRelAbs`: the mode kept, the one before answered (seg1 `5218`).
fn set_rel_abs_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let mode = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(
        system.gdi.dcs[dc].state.rel_abs.replace(mode).unwrap_or(1),
    ))
}

/// `GetRelAbs`: the dword at the context's 80h, the mode and the polygon
/// fill mode above it (seg1 `5145`).
fn get_rel_abs_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Dword(0));
    };
    let state = &system.gdi.dcs[dc].state;

    Ok(Answer::Dword(
        u32::from(state.rel_abs.unwrap_or(1))
            | (u32::from(state.poly_fill_mode.unwrap_or(1)) << 16),
    ))
}

/// `SetDCHook`: the procedure and data kept, a procedure of nought clearing
/// the flag; 1, the data's high word in DX (seg31 `04ec`).
fn set_dc_hook_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let proc = args.dword(system);
    let data = args.dword(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Dword(0));
    };
    let user = proc != 0 && proc == user_dc_hook(system);
    let context = &mut system.gdi.dcs[dc];

    context.hook.set = Some((proc, data));
    context.hook.user = user;

    if proc == 0 {
        context.hook.flag = false;
    }

    Ok(Answer::Dword((data & 0xffff_0000) | 1))
}

/// USER's `DCHOOK`'s address, as USER exports it.
fn user_dc_hook(system: &mut System) -> u32 {
    let user = system
        .kept_named("USER")
        .map_or(0, |kept| system.kept[kept].handle());

    if user == 0 {
        0
    } else {
        crate::modules_kernel::proc_numbered(system, user, USER_DCHOOK)
    }
}

/// `GetDCHook`: the procedure written, the data answered (seg31 `04b5`);
/// for a context USER lends, USER's `DCHOOK` and the context's handle as
/// USER's entry for it.
fn get_dc_hook_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Dword(0));
    };
    let lent = matches!(
        system.gdi.dcs[dc].bitmap,
        DcBitmap::Window(_) | DcBitmap::Whole(_)
    );
    let hook = system.gdi.dcs[dc].hook;
    // USER's own, which WinBox runs itself: its address as USER exports it.
    let (proc, data) = match hook.set {
        Some((_, data)) if hook.user => (user_dc_hook(system), data),
        Some(hook) => hook,
        None if lent => (user_dc_hook(system), u32::from(hdc)),
        None => (0, 0),
    };

    if far != 0 {
        system.write_far(far, &proc.to_le_bytes());
    }

    Ok(Answer::Dword(data))
}

/// `SetHookFlags`: 1 where the flag was set and 2 where not, in AX and DX
/// both; set by `DCHF_INVALIDATEVISRGN`, cleared by anything else (seg1
/// `76b0`).
fn set_hook_flags_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let flags = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Dword(0));
    };
    let context = &mut system.gdi.dcs[dc];
    let before: u32 = if context.hook.flag { 1 } else { 2 };

    context.hook.flag = flags & 1 == 1;

    Ok(Answer::Dword(before | (before << 16)))
}

/// `GetClipRgn`: the context's own clip region (seg1 `5130`), in the
/// screen's coordinates; nought where it has none. The region is the clip
/// region as it is when asked, an object the context keeps.
fn get_clip_rgn_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let Some(clip) = system.gdi.dcs[dc].state.clip.clone() else {
        return Ok(Answer::Word(0));
    };
    let (x, y) = origin_of(system, dc);
    let shape = clip.offset(x, y);

    if let Some((handle, object)) = system.gdi.dcs[dc].clip_handle
        && system.handles.resolve(handle) == Some(Object::Gdi(object))
    {
        system.gdi.objects[object] = GdiObject::Region(shape);
        return Ok(Answer::Word(handle));
    }

    let handle = system.gdi_allocate(GdiObject::Region(shape));
    let Some(Object::Gdi(object)) = system.handles.resolve(handle) else {
        return Ok(Answer::Word(0));
    };

    system.gdi.dcs[dc].clip_handle = Some((handle, object));
    Ok(Answer::Word(handle))
}

/// `ResetDC`: nought for a raster display's context, for a memory one and
/// for WinBox's own printer, which answers no escape; a driver's from the
/// drive is not followed, and answers nought (seg31 `0372`).
fn reset_dc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    args.dword(system);

    Ok(Answer::Word(0))
}
