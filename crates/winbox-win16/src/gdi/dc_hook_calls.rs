//! GDI calls a device context's hook before a call uses the context, where
//! the flag `SetHookFlags` sets is set (`GDI.EXE` seg1 `4423`, `43f3`): the
//! context, `DCHC_INVALIDVISRGN` (1), the hook's data and nought. USER's own
//! hook, on the contexts it lends, WinBox runs itself (`dc_entries`); a
//! program's is called through the processor. Which calls call it, read
//! out and inferred, is told in the TypeScript engine's twin,
//! `dc-hook-calls.ts`. **Recorded** by `dchook`.

use winbox_cpu::{AX, DS, ES, SS};

use crate::call::{Args, Implementation, Later, Pending, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::handles::Object;
use crate::modules::Export;
use crate::system::System;

/// The calls that set one attribute and do no more, which do not call it
/// (seg1 `1476`, `14dc`, `4e22`-`4ed8`), and the hook's own; `DeleteDC`
/// calls it with `DCHC_DELETEDC`, which is not followed.
const UNHOOKED: &[&str] = &[
    "SetBkColor",
    "SetTextColor",
    "SetBkMode",
    "SetROP2",
    "SetPolyFillMode",
    "SetStretchBltMode",
    "SetTextAlign",
    "SetRelAbs",
    "SetDCHook",
    "GetDCHook",
    "SetHookFlags",
    "DeleteDC",
    "DCHook",
];

/// USER's calls whose first argument is a device context: they draw
/// through GDI's, which call the hook.
const USER_DC_FIRST: &[&str] = &[
    "FillRect",
    "InvertRect",
    "FrameRect",
    "DrawIcon",
    "DrawText",
    "GrayString",
    "TabbedTextOut",
    "GetTabbedTextExtent",
    "ScrollDC",
    "ExcludeUpdateRgn",
    "SelectPalette",
    "RealizePalette",
    "DrawFocusRect",
];

/// GDI's calls whose first argument is a device context beside those a
/// metafile keeps (`metafile::DC_FIRST`), as the TypeScript engine's export
/// table types them.
const MORE_DC_FIRST: &[&str] = &[
    "CreateUserDiscardableBitmap",
    "Death",
    "ExcludeVisRect",
    "FastWindowFrame",
    "GetBoundsRect",
    "GetCharAbcWidths",
    "GetClipRgn",
    "GetCurLogFont",
    "GetDCState",
    "GetFontData",
    "GetKerningPairs",
    "GetOutlineTextMetrics",
    "GetRelAbs",
    "InquireVisRgn",
    "IntersectVisRect",
    "IsDCCurrentPalette",
    "IsDCDirty",
    "OffsetVisRgn",
    "QueryAbort",
    "RealizeDefaultPalette",
    "RectVisible_Ehh",
    "ResetDC",
    "RestoreVisRgn",
    "Resurrection",
    "SaveVisRgn",
    "SelectBitmap",
    "SelectVisRgn",
    "SetBoundsRect",
    "SetDCOrg",
    "SetDCState",
    "SetDCStatus",
    "UpdateColors",
];

/// A program's hook to be called before a call: its procedure, the
/// context's handle, and its data.
pub(crate) type Due = (u32, u16, u32);

/// The hook a call made at an `INT 80h` calls first, if it is one that
/// calls it and its context's flag is set: USER's run at once, a program's
/// answered to be called.
pub(crate) fn before(
    system: &mut System,
    module: &str,
    export: Export,
    stack: u32,
    sp: u32,
) -> Option<Due> {
    let first = match module {
        "GDI" => {
            super::metafile::DC_FIRST.contains(&export.name) || MORE_DC_FIRST.contains(&export.name)
        }
        "USER" => USER_DC_FIRST.contains(&export.name),
        _ => false,
    };

    if !first || UNHOOKED.contains(&export.name) {
        return None;
    }

    let at = sp + 4 + u32::from(export.pops).saturating_sub(2);
    let hdc = system.cpu.bus.read16(stack + (at & 0xffff));
    let Some(Object::Dc(dc)) = system.handles.resolve(hdc) else {
        return None;
    };
    let hook = system.gdi.dcs[dc].hook;

    if !hook.flag {
        return None;
    }

    if hook.user {
        system.user_hook_due(dc);
        return None;
    }

    hook.set.map(|(proc, data)| (proc, hdc, data))
}

/// A call made after its context's hook, a program's: the hook and the
/// call kept for `hooked` to make.
pub(crate) fn pending(
    system: &mut System,
    due: Due,
    implementation: Implementation,
    args: Args,
    logged: Option<usize>,
) -> Pending {
    system.hook_then = Some((due, implementation));

    Pending {
        implementation: hooked,
        args,
        logged,
    }
}

/// A call whose context's hook is a program's: the hook called through the
/// processor, then the call made (`System::hook_then`).
pub(crate) fn hooked(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (due, implementation, stack) = {
            let mut system = engine.system();
            let (due, implementation) = system.hook_then.take().ok_or(Stop::Unsupported(
                "a device context's hook called with no call after it",
            ))?;

            (due, implementation, system.cpu.segments[SS].selector)
        };
        let (proc, hdc, data) = due;

        engine
            .call_with(
                proc,
                &[
                    GuestArg::Word(hdc),
                    GuestArg::Word(1),
                    GuestArg::Long(data),
                    GuestArg::Long(0),
                ],
                &[
                    Register::Word(AX, stack),
                    Register::Segment(DS, stack),
                    Register::Segment(ES, stack),
                ],
            )
            .await?;

        match implementation {
            Implementation::Sync(answer) => {
                let mut system = engine.system();

                answer(&mut system, &mut args)
            }
            Implementation::Async(answer) => answer(engine, args).await,
        }
    })
}
