//! The asset bundle's modules -- `USER.EXE`, `SHELL.DLL` and the display
//! drivers with every segment's bytes made nought (`src/assets/ne.ts`) --
//! read as the whole files do: the same resource table, so the same
//! resource handles (`resources.rs`'s `resource_handle` numbers them by
//! their places in it); the same bytes for each resource; the same
//! `DriverResources::read` and `read_oem`; and the same `OEMBIN` values.
//!
//! The bundle is made by `pnpm assets` into `oracle/build/assets`, and the
//! whole files are the oracle's installations; a checkout has neither
//! until the oracle is built, and then there is nothing to compare.

use std::path::{Path, PathBuf};

use winbox_ne::{Executable, ResourceId};
use winbox_raster::{DevicePalette, DisplayKind};
use winbox_win16::display::oembin_values;
use winbox_win16::icons::DriverResources;

const RT_STRING: u16 = 6;

fn build() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../oracle/build")
}

fn parse(path: PathBuf) -> Option<Executable> {
    Some(Executable::parse(std::fs::read(path).ok()?).unwrap())
}

/// The bundle's module and the installation's file of the same name.
fn pair(drive: &str, name: &str) -> Option<(Executable, Executable)> {
    let zeroed = parse(build().join("assets/modules").join(name))?;
    let whole = parse(build().join(drive).join("WINDOWS/SYSTEM").join(name))?;

    Some((zeroed, whole))
}

/// The resource table as it is laid out, every entry's place and identity.
fn table(executable: &Executable) -> String {
    format!("{:?}", executable.resources)
}

/// Each resource's bytes, by type and entry; USER's string tables left
/// out, one of which holds the licensee Setup wrote into the installed
/// file.
fn resource_bytes(executable: &Executable, user: bool) -> Vec<(String, Vec<u8>)> {
    executable
        .resources
        .iter()
        .filter(|kind| !(user && kind.id == ResourceId::Number(RT_STRING)))
        .flat_map(|kind| {
            kind.entries.iter().map(move |entry| {
                (
                    format!("{:?}/{:?}", kind.id, entry.id),
                    executable.resource_bytes(entry).to_vec(),
                )
            })
        })
        .collect()
}

/// `DriverResources::read`'s answer, its maps in order of id.
fn driver_resources(driver: &Executable, user: &Executable, kind: DisplayKind) -> String {
    let mut palette = DevicePalette::for_display(kind.colors, kind.ega, kind.ibm);
    let read = DriverResources::read(driver, Some(user), kind.colors, &mut palette);
    let mut icons: Vec<_> = read.icons.iter().collect();
    let mut cursors: Vec<_> = read.cursors.iter().collect();
    let mut images: Vec<_> = read.cursor_images.iter().collect();
    let mut sizes: Vec<_> = read.bitmap_sizes.iter().collect();

    icons.sort_by_key(|(id, _)| **id);
    cursors.sort_unstable();
    images.sort_by_key(|(id, _)| **id);
    sizes.sort_by_key(|(id, _)| **id);
    format!(
        "{icons:?} {cursors:?} {images:?} {sizes:?} {:?}",
        read.application_icon
    )
}

/// `read_oem`'s bitmaps: each one's id, size and indices.
fn oem(driver: &Executable, kind: DisplayKind) -> Vec<(u16, i32, i32, Vec<u8>)> {
    let bitmaps = DriverResources::read_oem(driver, kind).unwrap();
    let mut out: Vec<_> = bitmaps
        .iter()
        .map(|(id, bitmap)| {
            (
                *id,
                bitmap.width(),
                bitmap.height(),
                bitmap.indices.borrow().clone(),
            )
        })
        .collect();

    out.sort_by_key(|entry| entry.0);
    out
}

/// Every `OEMBIN` resource's values.
fn oembins(executable: &Executable) -> Vec<String> {
    executable
        .resources
        .iter()
        .filter(|kind| matches!(&kind.id, ResourceId::Name(name) if name.eq_ignore_ascii_case("OEMBIN")))
        .flat_map(|kind| &kind.entries)
        .map(|entry| format!("{:?}", oembin_values(executable.resource_bytes(entry))))
        .collect()
}

#[test]
fn zeroed_modules_read_as_the_whole_files() {
    let colour = |colors, ega, ibm| DisplayKind { colors, ega, ibm };
    let drivers = [
        ("drive-c", "VGA.DRV", colour(16, false, false)),
        ("drive-c-svga", "SUPERVGA.DRV", colour(16, false, false)),
        ("drive-c-ega", "EGA.DRV", colour(16, true, false)),
        ("drive-c-hercules", "HERCULES.DRV", colour(2, false, false)),
        ("drive-c-8514", "8514.DRV", colour(256, false, true)),
        ("drive-c-xga256", "XGA.DRV", colour(256, false, true)),
        ("drive-c-vga256", "SVGA256.DRV", colour(256, false, false)),
    ];
    let Some((user, whole_user)) = pair("drive-c", "USER.EXE") else {
        return;
    };

    assert_eq!(table(&user), table(&whole_user), "USER.EXE");
    assert_eq!(
        resource_bytes(&user, true),
        resource_bytes(&whole_user, true),
        "USER.EXE"
    );

    if let Some((shell, whole_shell)) = pair("drive-c", "SHELL.DLL") {
        assert_eq!(table(&shell), table(&whole_shell), "SHELL.DLL");
        assert_eq!(
            resource_bytes(&shell, false),
            resource_bytes(&whole_shell, false),
            "SHELL.DLL"
        );
    }

    let mut compared = 0;

    for (drive, name, kind) in drivers {
        let Some((driver, whole)) = pair(drive, name) else {
            continue;
        };

        assert_eq!(table(&driver), table(&whole), "{name}");
        assert_eq!(
            resource_bytes(&driver, false),
            resource_bytes(&whole, false),
            "{name}"
        );
        assert_eq!(
            driver_resources(&driver, &user, kind),
            driver_resources(&whole, &whole_user, kind),
            "{name}"
        );
        assert_eq!(oem(&driver, kind), oem(&whole, kind), "{name}");
        assert_eq!(oembins(&driver), oembins(&whole), "{name}");
        assert!(!oembins(&driver).is_empty(), "{name} has OEMBIN");
        assert!(
            driver
                .segments
                .iter()
                .all(|segment| segment.relocations.is_empty()),
            "{name}: no relocations left"
        );
        compared += 1;
    }

    // The 256-colour driver is in the bundle only where the Driver
    // Library's files were fetched; the retail ones always are.
    assert!(compared >= drivers.len() - 1, "{compared} drivers compared");
}
