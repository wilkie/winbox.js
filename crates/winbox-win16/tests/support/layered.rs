//! `WINBOX_BASE=layers`: the asset bundle's base for a display split into
//! a stack of layers (`kb/formats/layer.md`), as programs installed in turn
//! would make one, each layer made over all those beneath it -- and drive
//! C: put together from that stack by `HostDrive::layered`, each layer
//! materialised once into a cache folder of the host's (`materialise_stack`).
//! What a program sees must be what it sees on `WINBOX_BASE=assets`, the
//! same base in one folder; `tests/layers_sweep.rs` holds every probe to
//! that. The TypeScript harness's twin is `test/layers/split.ts`.
//!
//! The stack, the lowest first:
//!
//! 1. the base's folders and files outside `WINDOWS\SYSTEM` that are not
//!    fonts or profiles: `WINDOWS`, `WINDOWS\TEMP`, `REG.DAT`;
//! 2. `WINDOWS\SYSTEM`, and its files that are not fonts or profiles;
//! 3. the fonts, `.FON`, `.FOT` and `.TTF`;
//! 4. the profiles, `.INI`;
//! 5. a decoy: a folder at the root, one in `WINDOWS`, and a file in each
//!    and in `WINDOWS\SYSTEM`, none of them the base's;
//! 6. the decoy's whiteout, each of those removed;
//! 7. the base's profiles, `MIDIMAP.CFG` and its first font again, and
//!    `WINDOWS\SYSTEM`'s stamp, each as the base has it: a file shadowed by
//!    the same bytes and stamp, which a program reads from the highest
//!    layer and writes by copying up from it.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::rc::Rc;

use winbox_machine::HostLayer;
use winbox_win16::assets::{Assets, STAMP};
use winbox_win16::layers::{
    FORMAT, Flat, Layer, LayerEntry, Made, Manifest, flatten, layer_id, materialise_stack,
    order_entries, stack_refusal,
};

/// What the decoy layer makes, which the layer over it removes: paths no
/// base has, stamped apart from the base's.
const DECOY_FOLDERS: [&str; 2] = ["DECOY", "WINDOWS\\DECOY"];
const DECOY_FILES: [&str; 4] = [
    "DECOY\\DECOY.TXT",
    "WINDOWS\\DECOY.INI",
    "WINDOWS\\DECOY\\DECOY.TXT",
    "WINDOWS\\SYSTEM\\DECOY.DLL",
];
/// 1 January 2021, noon.
const DECOY_STAMP: i64 = 1_609_502_400;

/// Whether a path is a folder's, or beneath it.
fn within(path: &str, folder: &str) -> bool {
    path == folder
        || path
            .strip_prefix(folder)
            .is_some_and(|rest| rest.starts_with('\\'))
}

/// A layer's path's extension, as a layer keeps it: upper case.
fn extension(path: &str) -> &str {
    let name = path.rsplit('\\').next().unwrap_or(path);

    name.rsplit_once('.').map_or("", |(_, extension)| extension)
}

/// Which of the first four layers a base's entry goes in.
fn group(entry: &LayerEntry) -> usize {
    let path = entry.path();
    let file = matches!(entry, LayerEntry::File { .. });

    if file && ["FON", "FOT", "TTF"].contains(&extension(path)) {
        2
    } else if file && extension(path) == "INI" {
        3
    } else {
        usize::from(within(path, "WINDOWS\\SYSTEM"))
    }
}

/// A layer of entries made over the layers given, its blobs from `from`.
fn made_over(
    entries: Vec<LayerEntry>,
    beneath: &[Layer],
    from: &BTreeMap<String, Rc<Vec<u8>>>,
) -> Layer {
    let entries = order_entries(entries).expect("a split layer names a path once");
    let blobs = entries
        .iter()
        .filter_map(|entry| match entry {
            LayerEntry::File { sha256, .. } => Some((sha256.clone(), Rc::clone(&from[sha256]))),
            _ => None,
        })
        .collect();

    Layer {
        manifest: Manifest {
            format: FORMAT,
            id: layer_id(&entries).expect("a split layer has an id"),
            over: beneath
                .iter()
                .map(|layer| layer.manifest.id.clone())
                .collect(),
            made: Made {
                by: "WinBox".to_string(),
                version: None,
                from: Some("WINBOX_BASE=layers".to_string()),
            },
            entries,
        },
        blobs,
    }
}

/// The base split into the stack above, the lowest first, each layer made
/// over all those beneath it; refused by nothing.
pub fn split(base: &Layer) -> Vec<Layer> {
    let mut blobs = base.blobs.clone();
    let mut groups: Vec<Vec<LayerEntry>> = vec![Vec::new(); 4];

    for entry in &base.manifest.entries {
        groups[group(entry)].push(entry.clone());
    }

    let decoy_bytes = Rc::new(b"A decoy of WinBox's: a layer above removes it.\r\n".to_vec());
    let decoy_hash = winbox_win16::sha256::sha256_hex(&decoy_bytes);

    blobs.insert(decoy_hash.clone(), decoy_bytes.clone());

    let decoy: Vec<LayerEntry> = DECOY_FOLDERS
        .iter()
        .map(|path| LayerEntry::Folder {
            path: (*path).to_string(),
            modified: DECOY_STAMP,
        })
        .chain(DECOY_FILES.iter().map(|path| LayerEntry::File {
            path: (*path).to_string(),
            sha256: decoy_hash.clone(),
            size: decoy_bytes.len() as u64,
            modified: DECOY_STAMP,
        }))
        .collect();
    let whiteout: Vec<LayerEntry> = [
        "DECOY",
        "WINDOWS\\DECOY",
        "WINDOWS\\DECOY.INI",
        "WINDOWS\\SYSTEM\\DECOY.DLL",
    ]
    .iter()
    .map(|path| LayerEntry::Removed {
        path: (*path).to_string(),
    })
    .collect();
    let first_font =
        base.manifest.entries.iter().find(|entry| {
            matches!(entry, LayerEntry::File { .. }) && extension(entry.path()) == "FON"
        });
    let same: Vec<LayerEntry> = base
        .manifest
        .entries
        .iter()
        .filter(|entry| match entry {
            LayerEntry::File { path, .. } => {
                extension(path) == "INI"
                    || path == "WINDOWS\\SYSTEM\\MIDIMAP.CFG"
                    || first_font.is_some_and(|font| font.path() == path)
            }
            LayerEntry::Folder { path, modified } => {
                path == "WINDOWS\\SYSTEM" && *modified == STAMP
            }
            LayerEntry::Removed { .. } => false,
        })
        .cloned()
        .collect();

    let mut stack: Vec<Layer> = Vec::new();

    for entries in groups.into_iter().chain([decoy, whiteout, same]) {
        let layer = made_over(entries, &stack, &blobs);

        stack.push(layer);
    }

    let manifests: Vec<&Manifest> = stack.iter().map(|layer| &layer.manifest).collect();

    assert_eq!(stack_refusal(&manifests), None, "the split base is refused");
    stack
}

/// A display's base as layers: what `HostDrive::layered` takes, the
/// highest first, each materialised into the host's temporary folder; and
/// the stack flattened, for a drive held in memory.
pub struct Stacked {
    pub lowers: Vec<HostLayer>,
    pub flat: Flat,
}

thread_local! {
    static STACKED: std::cell::RefCell<BTreeMap<String, Rc<Stacked>>> =
        std::cell::RefCell::default();
}

/// The cache the layers are materialised into.
pub fn cache() -> PathBuf {
    std::env::temp_dir().join("winbox-layers")
}

/// The bundle's base for a display, split (`split`) and materialised, once
/// a thread.
pub fn stacked(assets: &Assets, display: &str) -> Rc<Stacked> {
    STACKED.with(|stacked| {
        Rc::clone(
            stacked
                .borrow_mut()
                .entry(display.to_string())
                .or_insert_with(|| {
                    let composed = assets
                        .compose(display)
                        .unwrap_or_else(|error| panic!("the asset bundle's base: {error}"));
                    let stack = split(&Layer::base(&composed, &assets.id, display));
                    let cache = cache();

                    std::fs::create_dir_all(&cache).unwrap();

                    Rc::new(Stacked {
                        lowers: materialise_stack(&stack, &cache)
                            .unwrap_or_else(|error| panic!("the layered base: {error}")),
                        flat: flatten(&stack)
                            .unwrap_or_else(|error| panic!("the layered base: {error}")),
                    })
                }),
        )
    })
}
