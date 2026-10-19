//! The libraries WinBox keeps whose file is loaded beside them when there
//! is one, each import of an export WinBox answers linked to WinBox's stub
//! (`linker.rs`, `GetProcAddress`): `COMMDLG` (`commdlg/`), `VER` (`ver/`),
//! `LZEXPAND` (`lzexpand/`) and `DDEML` (`ddeml/`). As
//! `src/win16/own-modules.ts`.

use crate::call::Implementation;
use crate::loader::Held;
use crate::modules::Kept;
use crate::system::{STEP, System};

/// The names of those libraries.
pub const OWN_WITH_FILE: [&str; 4] = [
    crate::commdlg::NAME,
    crate::ver::NAME,
    crate::lzexpand::NAME,
    crate::ddeml::NAME,
];

/// Whether a module is one of those.
pub(crate) fn own_with_file(name: &str) -> bool {
    OWN_WITH_FILE
        .iter()
        .any(|own| own.eq_ignore_ascii_case(name))
}

/// The library of these whose file has this name (`VER.DLL`), if one does.
pub(crate) fn by_file(file: &str) -> Option<&'static str> {
    let upper = file.to_ascii_uppercase();
    let name = upper.strip_suffix(".DLL")?;

    OWN_WITH_FILE.into_iter().find(|own| *own == name)
}

/// One of these loaded by its file's name with no file there: WinBox's,
/// found by its file's name as the other modules it keeps are, counted as
/// its file would be (`use_own`): its instance, and the libraries whose
/// entry points are to run.
pub(crate) fn without_file(
    system: &mut System,
    file: &str,
    beside: Option<&str>,
) -> Option<(u16, Vec<usize>)> {
    let own = by_file(file)?;
    let kept = system.kept_named(own)?;
    let mut order = Vec::new();

    use_own(system, own, beside, &mut order);
    Some((system.kept[kept].instance(), order))
}

/// The modules each of these libraries' files imports that are not among
/// those winbox.js keeps alone, from each file's module reference table:
/// `VER.DLL` imports `LZEXPAND`, beside KERNEL, USER and KEYBOARD.
/// `COMMDLG.DLL`, `DDEML.DLL` and `LZEXPAND.DLL` import only KERNEL, GDI,
/// USER and KEYBOARD. As `library.ts`'s `OWN_IMPORTS`.
const OWN_IMPORTS: [(&str, &[&str]); 1] = [(crate::ver::NAME, &[crate::lzexpand::NAME])];

/// One of these with no file on the drive, loaded by an import or by
/// `LoadLibrary`: counted as its file would be, each import and each load
/// once more, each `FreeLibrary` and each importer's end once less, and
/// `GetModuleHandle` finding it while the count is not nought
/// (`kb/guides/without-windows.md`; **recorded** with the file by
/// `ddewep`). Loaded afresh, it brings what its file imports, and
/// `COMMDLG`'s data is the file's as it starts, its messages registered as
/// its file's entry point registers them (`commdlg/`). What the importer
/// holds of it; none for a name that is not one of these. As `useOwn`.
pub(crate) fn use_own(
    system: &mut System,
    name: &str,
    beside: Option<&str>,
    order: &mut Vec<usize>,
) -> Option<Held> {
    if !own_with_file(name) {
        return None;
    }

    let kept = system.kept_named(name)?;

    system.kept[kept].usage += 1;

    if system.kept[kept].usage > 1 {
        return Some(Held::Own(kept));
    }

    let own = system.kept[kept].module.name;

    for (importer, imports) in OWN_IMPORTS {
        if importer.eq_ignore_ascii_case(own) {
            for other in imports {
                if let Some(held) = system.import_one(other, None, beside, order) {
                    system.kept[kept].brought.push(held);
                }
            }
        }
    }

    if own.eq_ignore_ascii_case(crate::commdlg::NAME) {
        crate::commdlg::print_loaded(system);
        crate::commdlg::start(system);
    }

    Some(Held::Own(kept))
}

/// One of these with no file let go once: what its file would have
/// brought, once the count reaches nought and its data goes as the file's
/// goes (`freed_named`); else nothing. As `releaseOwn`.
pub(crate) fn release_own(system: &mut System, kept: usize) -> Vec<Held> {
    if system.kept[kept].usage == 0 {
        return Vec::new();
    }

    system.kept[kept].usage -= 1;

    if system.kept[kept].usage > 0 {
        return Vec::new();
    }

    let name = system.kept[kept].module.name;

    freed_named(system, name);
    std::mem::take(&mut system.kept[kept].brought)
}

/// The function that answers an export of `VER`'s, `LZEXPAND`'s or
/// `DDEML`'s.
fn implementation(module: &str, name: &str) -> Option<Implementation> {
    if module.eq_ignore_ascii_case(crate::ver::NAME) {
        crate::ver::implementation(name)
    } else if module.eq_ignore_ascii_case(crate::lzexpand::NAME) {
        crate::lzexpand::implementation(name)
    } else if module.eq_ignore_ascii_case(crate::ddeml::NAME) {
        crate::ddeml::implementation(name)
    } else {
        None
    }
}

/// What an import of an ordinal of a library loaded from its file links
/// to, and what `GetProcAddress` answers for it, where it is not the
/// file's entry: WinBox's stub, for an export WinBox answers. Its
/// segment's descriptor index and offset.
pub(crate) fn redirect(system: &mut System, module: usize, ordinal: u16) -> Option<(usize, u16)> {
    let name = system.modules[module].name.clone();

    if name.eq_ignore_ascii_case(crate::commdlg::NAME) {
        return crate::commdlg::redirect(system, module, ordinal);
    }

    let own = [crate::ver::NAME, crate::lzexpand::NAME, crate::ddeml::NAME]
        .into_iter()
        .find(|own| own.eq_ignore_ascii_case(&name))?;
    let export = Kept::named(own)?.export(ordinal)?;

    implementation(own, export.name)?;

    let kept = system.kept_named(own)?;

    Some((system.stubs(kept), STEP * (ordinal + 1)))
}

/// One of these whose file was loaded, let go: its library gone, and with
/// it its data segment, which WinBox's own stands for. DDEML's starts again
/// from its file's data when loaded again (`ddewep`). As `ownFreed`.
pub(crate) fn freed(system: &mut System, library: usize) {
    let name = system.modules[library].name.clone();

    freed_named(system, &name);
}

/// One of these let go, by its name, with its file or without.
fn freed_named(system: &mut System, name: &str) {
    if name.eq_ignore_ascii_case(crate::ddeml::NAME) {
        crate::ddeml::freed(system);
    }
}
