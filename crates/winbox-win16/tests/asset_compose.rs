//! The base of C: composed from the asset bundle for each display, as the
//! TypeScript engine composes it: every placed file what Setup put on the
//! oracle's installation for that display, byte for byte, and the whole
//! listing -- paths, sizes, CRCs and stamps -- the one
//! `test/assets/compose_test.ts` holds the TypeScript composer to.
//!
//! The bundle is made by `pnpm assets` into `oracle/build/assets`, and the
//! installations are the oracle's; a checkout has neither until the oracle
//! is built, and then there is nothing to compare.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use winbox_win16::assets::{PoolFile, compose, composed_displays};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Zip's CRC-32, as the listing gives it.
fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;

    for &byte in data {
        crc ^= u32::from(byte);

        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                0xedb8_8320 ^ (crc >> 1)
            } else {
                crc >> 1
            };
        }
    }

    !crc
}

#[test]
fn composed_as_setup_laid_it_out_and_as_the_typescript_engine_composes_it() {
    let assets = root().join("oracle/build/assets");
    let Ok(manifest) = std::fs::read_to_string(assets.join("winbox-assets.json")) else {
        return;
    };
    let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
    let mut pool = BTreeMap::new();

    for file in manifest["files"].as_array().unwrap() {
        let path = file["path"].as_str().unwrap();

        if let Some(name) = path.strip_prefix("pool/") {
            pool.insert(
                name.to_string(),
                PoolFile {
                    data: std::fs::read(assets.join(path)).unwrap(),
                    date: u16::try_from(file["date"].as_u64().unwrap()).unwrap(),
                    time: u16::try_from(file["time"].as_u64().unwrap()).unwrap(),
                },
            );
        }
    }

    let setup: serde_json::Value =
        serde_json::from_str(include_str!("../data/setup.json")).unwrap();
    let listing: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root().join("test/assets/composed.json")).unwrap(),
    )
    .unwrap();
    let lookup = |name: &str| pool.get(name).cloned();
    let mut compared = 0;

    for display in composed_displays() {
        let composed = compose(&lookup, &display).unwrap();
        let drive = root()
            .join("oracle/build")
            .join(setup["displays"][&display]["drive"].as_str().unwrap());

        for file in &composed.files {
            let theirs = std::fs::read(drive.join(&file.path))
                .unwrap_or_else(|error| panic!("{display}: {}: {error}", file.path));

            assert!(theirs == file.data, "{display}: {}", file.path);
        }

        let ours: Vec<serde_json::Value> = composed
            .files
            .iter()
            .map(|file| {
                serde_json::json!([
                    file.path,
                    file.data.len(),
                    format!("{:08x}", crc32(&file.data)),
                    file.modified,
                ])
            })
            .collect();

        assert_eq!(
            serde_json::Value::Array(ours),
            listing[&display],
            "{display}"
        );
        compared += 1;
    }

    assert_eq!(compared, 10);
}
