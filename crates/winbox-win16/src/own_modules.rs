//! The libraries WinBox keeps whose file is loaded beside them when there
//! is one, each import of an export WinBox answers linked to WinBox's stub
//! (`linker.rs`, `GetProcAddress`): `COMMDLG` (`commdlg/`), `VER` (`ver/`),
//! `LZEXPAND` (`lzexpand/`) and `DDEML` (`ddeml/`). As
//! `src/win16/own-modules.ts`.

use crate::call::Implementation;
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
/// found by its file's name as the other modules it keeps are, its
/// instance; `COMMDLG`'s messages registered as its file's entry point
/// registers them (`commdlg/`).
pub(crate) fn without_file(system: &mut System, file: &str) -> Option<u16> {
    let own = by_file(file)?;
    let kept = system.kept_named(own)?;

    if own == crate::commdlg::NAME {
        crate::commdlg::start(system);
    }

    Some(system.kept[kept].instance())
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
    if system.modules[library]
        .name
        .eq_ignore_ascii_case(crate::ddeml::NAME)
    {
        crate::ddeml::freed(system);
    }
}
