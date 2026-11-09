//! Every export takes off the stack exactly what Windows' own takes off.
//!
//! A Win16 function is called Pascal: the caller pushes the arguments and the
//! function removes them as it returns. Each export of a kept module returns
//! by the size its table gives (`kept.rs`'s `pops`), so a size that is wrong
//! leaves every caller's stack wrong by the difference -- a stub declared as
//! taking nothing, called with a word, returns into the word.
//! `scripts/oracle/argument-sizes.mjs` reads the right size out of the
//! installation's own module, and this holds every table to it.
//!
//! Skipped where the oracle's installation is not built, or where Node, which
//! the script runs on, is not there.

use std::path::{Path, PathBuf};
use std::process::Command;

use winbox_win16::Kept;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Where the reading is wrong, by module and ordinal, and why.
///
/// * `Throw` never returns to its caller. It reloads the stack from the catch
///   buffer and returns from the `Catch` that filled it, so the `RETF` it
///   reaches is `Catch`'s; its own two arguments are six bytes.
/// * `CreateScalableFontResource`'s check of its arguments has an error
///   return of `RETF 0Ch`, but the function itself reads its fourth argument
///   at `[bp+12h]` and returns by `RETF 0Eh`: the check covers the three
///   pointers and forgets the `UINT`.
/// * `DirectedYield` moves its return address over its argument and drops
///   the word with `ADD SP,2` before it goes on as `Yield`, whose `RETF`
///   takes nothing (`KRNL386.EXE` seg1 `7cff`): its task handle is two bytes.
/// * GDI's driver helpers 201 to 219 but `DMEnumDFonts`, `DMStrBlt` and
///   `DMExtTextOut` are `mov cx,nnnn` and a jump to `Brute` (seg13 `0171`),
///   whose plain `RETF` comes after it has moved its caller's frame down by
///   20h bytes and let the display driver's routine take the arguments: CL
///   less the four words of the frame is what each takes, as the display
///   driver's own routine of that offset does.
/// * `EMSCopy`'s `RETF 0Eh` (`KRNL386.EXE` seg1 `a940`) is never reached: its
///   entry lies past the limit KERNEL cuts its first code segment to (seg1
///   `b565`-`b573`), and the oracle runs on into the block the heap gave
///   next, `MMSYSTEM`'s `timeGetSystemTime`, which pops six bytes
///   (`MMSYSTEM.DLL` seg1 `0000`-`0026`; probes emscopy and emspast).
const EXCEPTIONS: &[(&str, u16, u16)] = &[
    ("KERNEL", 56, 6),
    ("GDI", 310, 14),
    ("KERNEL", 150, 2),
    ("GDI", 201, 32),
    ("GDI", 202, 12),
    ("GDI", 207, 14),
    ("GDI", 208, 28),
    ("GDI", 209, 16),
    ("GDI", 210, 18),
    ("GDI", 212, 14),
    ("GDI", 215, 24),
    ("GDI", 216, 40),
    ("GDI", 217, 26),
    ("GDI", 218, 50),
    ("GDI", 219, 32),
    ("KERNEL", 160, 6),
];

/// The modules held, each with its file in the installation's system folder
/// of the drive named.
const MODULES: &[(&str, &str, &str)] = &[
    ("KERNEL", "drive-c", "KRNL386.EXE"),
    ("USER", "drive-c", "USER.EXE"),
    ("GDI", "drive-c", "GDI.EXE"),
    ("KEYBOARD", "drive-c", "KEYBOARD.DRV"),
    ("TOOLHELP", "drive-c", "TOOLHELP.DLL"),
    ("SHELL", "drive-c", "SHELL.DLL"),
    ("COMMDLG", "drive-c", "COMMDLG.DLL"),
    ("MMSYSTEM", "drive-c", "MMSYSTEM.DLL"),
    ("SOUND", "drive-c", "SOUND.DRV"),
    ("WIN87EM", "drive-c", "WIN87EM.DLL"),
    ("SYSTEM", "drive-c", "SYSTEM.DRV"),
    ("DISPLAY", "drive-c", "VGA.DRV"),
    ("DISPLAY", "drive-c-ega", "EGA.DRV"),
    ("DISPLAY", "drive-c-svga", "SUPERVGA.DRV"),
    ("DISPLAY", "drive-c-hercules", "HERCULES.DRV"),
    ("DISPLAY", "drive-c-vga256", "SVGA256.DRV"),
    ("DISPLAY", "drive-c-8514", "8514.DRV"),
    ("DISPLAY", "drive-c-xga256", "XGA.DRV"),
];

/// Each ordinal's size as the script reads it out of the file; `None` where
/// it reads none.
fn read_sizes(path: &Path) -> Option<Vec<(u16, Option<u16>)>> {
    let output = Command::new("node")
        .arg(root().join("scripts/oracle/argument-sizes.mjs"))
        .arg(path)
        .arg("--json")
        .current_dir(root())
        .output()
        .ok()?;

    assert!(
        output.status.success(),
        "argument-sizes.mjs {}: {}",
        path.display(),
        String::from_utf8_lossy(&output.stderr)
    );

    let sizes: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(&output.stdout).unwrap();

    Some(
        sizes
            .into_iter()
            .map(|(ordinal, size)| {
                (
                    ordinal.parse().unwrap(),
                    size.as_u64().map(|size| size as u16),
                )
            })
            .collect(),
    )
}

#[test]
fn each_kept_module_takes_what_windows_own_takes() {
    let system = root().join("oracle/build/drive-c/WINDOWS/SYSTEM");

    if !system.is_dir() {
        return;
    }

    let mut wrong = Vec::new();

    for &(name, drive, file) in MODULES {
        let path = root()
            .join("oracle/build")
            .join(drive)
            .join("WINDOWS/SYSTEM")
            .join(file);

        if !path.is_file() {
            continue;
        }

        let module = if name == "DISPLAY" {
            Kept::display_driver(file)
        } else {
            Kept::named(name).unwrap_or_else(|| panic!("{name} kept"))
        };
        let Some(sizes) = read_sizes(&path) else {
            return;
        };

        for (ordinal, read) in sizes {
            let size = EXCEPTIONS
                .iter()
                .find(|&&(module, at, _)| module == name && at == ordinal)
                .map(|&(_, _, size)| size)
                .or(read);
            let Some(size) = size else {
                continue;
            };
            let export = module.export(ordinal);
            let declared = export.map_or(0, |export| export.pops);

            if declared != size {
                wrong.push(format!(
                    "{file} {ordinal} {}: {declared}, Windows {size}",
                    export.map_or("(none)", |export| export.name)
                ));
            }
        }
    }

    assert!(wrong.is_empty(), "{wrong:#?}");
}
