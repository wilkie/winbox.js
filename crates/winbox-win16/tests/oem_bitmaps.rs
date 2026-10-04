//! The display drivers' OEM bitmaps, read as the TypeScript engine's
//! `driverResources` reads them: each bitmap's size and a digest of its
//! indices, taken from that engine over the same drivers. The drivers are
//! the installation's, under `oracle/build`, which a checkout does not have
//! until the oracle is built; without them there is nothing to read.

use std::path::Path;

use winbox_ne::Executable;
use winbox_raster::DisplayKind;
use winbox_win16::icons::DriverResources;

/// FNV-1a of the bytes, as the digests were taken.
fn fnv(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0x811c_9dc5, |hash, &byte| {
        (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193)
    })
}

const VGA: &str = "32734:17x17:69cbf7c0 32735:17x17:5e6dd78 32736:17x17:3eaaadc0 32737:17x17:22a1a9b2 32738:7x9:ec499f7e 32739:7x11:a7c7229b 32740:17x17:20e467a 32741:17x17:ce21ca7a 32742:17x17:3ea7f0ba 32743:17x17:b553471a 32744:19x18:a1ebc688 32745:19x18:b684c228 32746:19x18:848743c8 32747:19x18:5ec88c40 32748:19x18:8c1d2110 32749:19x18:57915d40 32750:17x17:6f6621d6 32751:17x17:8e1a9eb6 32752:17x17:c9f29b56 32753:17x17:736888d6 32754:36x18:54719e99 32755:25x19:8285468f 32756:25x19:18fbbdd0 32757:25x19:b90aa109 32758:30x10:110be4ad 32759:56x39:aef06fe5 32760:14x14:f009d63d 32761:15x15:9d4e21cb 32762:15x15:fdddc6c3 32763:15x15:3e7124ab 32764:15x15:dac6d79f 32765:15x15:82c17b84 32766:13x14:5c8f7c5 32767:50x19:ae1959fb";
const HERCULES: &str = "32734:16x11:3d628427 32735:16x11:a192b717 32736:15x11:425be550 32737:15x11:9fd6e15b 32738:7x9:aa581c5c 32739:7x11:5098ec23 32740:16x11:1402bf39 32741:16x11:55bcc59 32742:15x11:f85f1bc0 32743:15x11:b813ab60 32744:17x16:6995688d 32745:17x16:6b6ad381 32746:17x16:cee4bb41 32747:17x16:8f0d2b9d 32748:17x16:50a4cc59 32749:17x16:bd26dcd9 32750:16x11:7b5ea9fb 32751:16x11:77c0371b 32752:15x11:aa46d38f 32753:15x11:b09dae4f 32754:38x16:3636ae33 32755:25x14:4a37e96b 32756:25x14:3e669f12 32757:25x14:a01398a7 32758:30x10:e9ef953d 32759:56x33:bc6daf92 32760:14x14:555d1db3 32761:15x13:c193b469 32762:20x13:2e6c1639 32763:20x13:f2b0bb39 32764:15x16:97bf3d67 32765:15x16:ea1aa497 32766:13x14:2151ba55 32767:50x14:aaab601f";
const EGA: &str = "32734:17x14:df366261 32735:17x14:ff190221 32736:17x14:90ad4e31 32737:17x14:5bde6051 32738:7x9:ec499f7e 32739:7x11:a7c7229b 32740:18x14:c0df45e9 32741:18x14:b2189f69 32742:17x14:273f2772 32743:17x14:295fb8f2 32744:19x16:f6922ca5 32745:19x16:440f94e1 32746:19x16:33522b21 32747:19x16:2d81322d 32748:19x16:340ce151 32749:19x16:d4de13d1 32750:18x14:9b9eee81 32751:18x14:582e9461 32752:17x14:a2a9b0ca 32753:17x14:d6f7eb8a 32754:36x16:ce4af3a9 32755:25x14:19de78f 32756:25x14:9ef38d28 32757:25x14:c035ca33 32758:30x10:110be4ad 32759:56x33:787492f8 32760:14x14:b6ef6517 32761:15x13:3a820ec5 32762:20x13:f8033971 32763:20x13:c7d4e0d1 32764:15x16:85667ec3 32765:15x16:73665e33 32766:18x14:97d2ce59 32767:50x14:d80e63ab";

fn read(drive: &str, file: &str, display: DisplayKind) -> Option<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../oracle/build")
        .join(drive)
        .join("WINDOWS/SYSTEM")
        .join(file);
    let driver = Executable::parse(std::fs::read(path).ok()?).unwrap();
    let oem = DriverResources::read_oem(&driver, display).unwrap();
    let mut ids: Vec<_> = oem.keys().copied().collect();

    ids.sort_unstable();
    Some(
        ids.iter()
            .map(|id| {
                let bitmap = &oem[id];

                format!(
                    "{id}:{}x{}:{:x}",
                    bitmap.width(),
                    bitmap.height(),
                    fnv(&bitmap.indices.borrow())
                )
            })
            .collect::<Vec<_>>()
            .join(" "),
    )
}

#[test]
fn as_the_typescript_engine_reads_them() {
    let drivers = [
        ("drive-c", "VGA.DRV", 16, false, VGA),
        ("drive-c-hercules", "HERCULES.DRV", 2, false, HERCULES),
        ("drive-c-ega", "EGA.DRV", 16, true, EGA),
    ];

    for (drive, file, colors, ega, want) in drivers {
        if let Some(read) = read(drive, file, DisplayKind { colors, ega }) {
            assert_eq!(read, want, "{file}");
        }
    }
}
