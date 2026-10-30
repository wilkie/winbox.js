//! What `OLECLI` does as it is loaded, as its calls into USER, GDI and
//! KERNEL show it doing (each call it makes, logged with its arguments as
//! WinBox runs `OLECLI.DLL` from the drive): the seven clipboard formats of
//! OLE's protocol registered, its two window classes, the atoms of the
//! names its conversations and streams use, and the screen's resolution
//! asked for. As `src/win16/olecli/start.ts`.

use crate::commdlg::api::{Arg, text};

use super::core::{CLASS_NAME, LOGPIXELSX, LOGPIXELSY, Ole, R};

/// The formats, in the order registered: `cfObjectLink`, `cfLink`,
/// `cfOwnerLink`, `cfNative`, `cfBinary`, `cfFileName`, `cfNetworkName`.
pub(crate) const FORMATS: [&str; 7] = [
    "ObjectLink",
    "Link",
    "OwnerLink",
    "Native",
    "Binary",
    "FileName",
    "NetworkName",
];

/// The atoms, in the order added.
pub(crate) const ATOMS: [&str; 13] = [
    "ole",
    "StdDocumentName",
    "Save",
    "Change",
    "Close",
    "System",
    "OLEsystem",
    "Package",
    "MSDraw",
    "Clipboard",
    "METAFILEPICT",
    "DIB",
    "BITMAP",
];

/// The window classes: a document's conversations' and a server's, four
/// bytes of window words each, style nought, by the ordinal of the export
/// that is each one's procedure.
pub(crate) const CLASSES: [(&str, u16); 2] = [("OleDocWndClass", 100), ("OleSrvrWndClass", 101)];

/// A `WNDCLASS`'s bytes.
fn wndclass(procedure: u32, instance: u16, name: u32) -> Vec<u8> {
    [
        0,
        procedure as u16,
        (procedure >> 16) as u16,
        0,
        4,
        instance,
        0,
        0,
        0,
        0,
        0,
        name as u16,
        (name >> 16) as u16,
    ]
    .iter()
    .flat_map(|word| word.to_le_bytes())
    .collect()
}

/// The registrations made, once a session: the formats, the classes with
/// WinBox's procedures and its instance, the atoms.
pub(crate) async fn start(ole: &Ole<'_>, instance: u16) -> R<()> {
    if ole.state().started {
        return Ok(());
    }

    ole.state().started = true;

    let mut formats = Vec::new();

    for name in FORMATS {
        formats.push(
            ole.user("RegisterClipboardFormat", &[text(name.as_bytes())])
                .await? as u16,
        );
    }

    ole.state().formats = formats;

    for (name, ordinal) in CLASSES {
        let at = ole.near(CLASS_NAME);
        let mut bytes = name.as_bytes().to_vec();

        bytes.push(0);
        ole.write(at, &bytes);

        let procedure = super::export_address(ole.e, ordinal);

        ole.user(
            "RegisterClass",
            &[Arg::B(wndclass(procedure, instance, at))],
        )
        .await?;
    }

    for name in ATOMS {
        ole.add_atom_text(name.as_bytes()).await?;
    }

    // The screen's resolution asked for, each way, as the file asks.
    let dc = ole.get_dc().await?;

    for index in [LOGPIXELSX, LOGPIXELSY] {
        let caps = ole.device_caps(dc, index).await?;

        ole.mul_div(0x7fff, caps, 2540).await?;
    }

    ole.release_dc(dc).await
}
