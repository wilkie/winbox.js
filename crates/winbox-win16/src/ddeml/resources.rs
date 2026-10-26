//! DDEML's data and its dialog as WinBox keeps them: no Windows file is
//! shipped, and none of Windows' bytes is copied here. The data segment is
//! laid out field by field from named constants (the names, the table, the
//! default parameters), each at the offset `DDEML.DLL`'s data segment (seg3,
//! 604 bytes) has it, each with the code that reads it; the dialog
//! `TERMDIALOG` is laid out from its controls. Where `DDEML.DLL` is on disk
//! the tests build both and compare them with the file's. As
//! `src/win16/ddeml/resources.ts`.

use super::{
    D_CLASS_CLIENT, D_CLASS_DMG, D_CLASS_FRAME, D_CLASS_HOLDING, D_CLASS_MONITOR, D_CLASS_SERVER,
    D_CONTEXT, D_TEXT_3000, D_TEXT_30000, D_TEXT_DDEML, D_TEXT_PROGMAN, D_TEXT_RETRY,
    D_TEXT_SHUTDOWN, D_WHO, D_XPARAMS,
};

/// The size of `DDEML.DLL`'s data segment (seg3): its initialized data, and
/// the fields set as it runs.
pub const DATA_SIZE: usize = 604;

/// Where the data segment's selector is relocated in (`DDEML.DLL`'s one
/// relocation of seg3): the segment half of the far pointer the default
/// transaction parameters hold to their result.
pub const XPARAMS_SELECTOR_AT: u16 = 0x170;

/// What the file holds there until the loader relocates it: `FFFFh`, the end
/// of the relocation's chain of fix-ups.
const XPARAMS_SELECTOR_UNRELOCATED: u16 = 0xffff;

// The words the data segment starts with, as a Windows data segment has
// them. Nothing in DDEML.DLL's code addresses ds:0004 or ds:0014 (seg1 and
// seg2 read out for both); they are kept as the file has them.
const HEADER_WORD_4: u16 = 5;
const HEADER_WORD_14: u16 = 1;

/// `D_SERIAL` (0024h) starts at 1; it numbers instances, conversations and
/// lists (`55af`'s callers, `0232`, `579b`, `69dd`).
const SERIAL_AT: u16 = 0x24;
const SERIAL_START: u16 = 1;

/// The default `CONVCONTEXT` (0026h, 16 bytes: `cb`, `wFlags`,
/// `wCountryID`, `iCodePage`, `dwLangID`, `dwSecurity`), given to a
/// conversation made with none (`6af4`, `6db6`; `DdeConnect` copies it).
const CONTEXT_CB: u16 = 0x10;
const CONTEXT_CODE_PAGE: u16 = 1004; // CP_WINANSI
const CONTEXT_CODE_PAGE_AT: u16 = D_CONTEXT + 6;

/// The windows' class names. `RegisterClass` is given them (`62e0`-`63a5`,
/// `630a` and on), `CreateWindow` the same offsets with the empty name at
/// 0036h (`0271`, `02b2`, `0322`, `073f`, `6a71`, `6f86`, `6fc5`, `7203`).
/// `DMGHeapWatchClass`, 0092h, is in no instruction of seg1 or seg2.
const CLASS_NAMES: &[(u16, &str)] = &[
    (D_CLASS_FRAME, "DMGFrame"),
    (D_CLASS_DMG, "DMGClass"),
    (D_CLASS_CLIENT, "DMGClientClass"),
    (D_CLASS_SERVER, "DMGServerClass"),
    (D_CLASS_MONITOR, "DMGMonitorClass"),
    (D_CLASS_HOLDING, "DMGHoldingClass"),
    (0x92, "DMGHeapWatchClass"),
];

// The callback filter: the `CBF_` flag that keeps each transaction type
// away, by the type's number, (`XTYP_*` & 0F0h) >> 4, a doubleword each from
// 00A6h (`5838`-`5846`, the client's own check `129a`-`12c2`). The types
// with no flag are nought.
const CBF_FAIL_CONNECTIONS: u32 = 0x2000;
const CBF_FAIL_ADVISES: u32 = 0x4000;
const CBF_FAIL_EXECUTES: u32 = 0x8000;
const CBF_FAIL_POKES: u32 = 0x10000;
const CBF_FAIL_REQUESTS: u32 = 0x20000;
const CBF_SKIP_CONNECT_CONFIRMS: u32 = 0x40000;
const CBF_SKIP_REGISTRATIONS: u32 = 0x80000;
const CBF_SKIP_UNREGISTRATIONS: u32 = 0x0010_0000;
const CBF_SKIP_DISCONNECTS: u32 = 0x0020_0000;

const FILTER_AT: u16 = 0xa6;

/// The type number (`XTYP_*` >> 4 & 0Fh) and its flag.
const FILTER: &[(u16, u32)] = &[
    (0x3, CBF_FAIL_ADVISES),          // XTYP_ADVSTART 1030h
    (0x5, CBF_FAIL_EXECUTES),         // XTYP_EXECUTE 4050h
    (0x6, CBF_FAIL_CONNECTIONS),      // XTYP_CONNECT 1060h
    (0x7, CBF_SKIP_CONNECT_CONFIRMS), // XTYP_CONNECT_CONFIRM 8070h
    (0x9, CBF_FAIL_POKES),            // XTYP_POKE 4090h
    (0xa, CBF_SKIP_REGISTRATIONS),    // XTYP_REGISTER 80A0h
    (0xb, CBF_FAIL_REQUESTS),         // XTYP_REQUEST 20B0h
    (0xc, CBF_SKIP_DISCONNECTS),      // XTYP_DISCONNECT 80C0h
    (0xd, CBF_SKIP_UNREGISTRATIONS),  // XTYP_UNREGISTER 80D0h
    (0xe, CBF_FAIL_CONNECTIONS),      // XTYP_WILDCONNECT 20E0h
];

/// The profile's strings: `GetProfileString` of `ShutdownTimeout` and
/// `ShutdownRetryTimeout` in the `DDEML` section, with the defaults `3000`
/// and `30000` (`00bf`-`0135`), and the name `Progman` whose atom the first
/// `DdeInitialize` adds (`0135`).
const PROFILE_TEXT: &[(u16, &str)] = &[
    (D_TEXT_3000, "3000"),
    (D_TEXT_SHUTDOWN, "ShutdownTimeout"),
    (D_TEXT_DDEML, "DDEML"),
    (D_TEXT_30000, "30000"),
    (D_TEXT_RETRY, "ShutdownRetryTimeout"),
    (0x11c, "DDEML"), // the section again, the retry timeout's (`00fa`)
    (D_TEXT_PROGMAN, "Progman"),
];

/// `TermDialog`, the dialog's name for `DialogBox` (`04b6`).
const TEXT_TERM_DIALOG: &str = "TermDialog";
const TEXT_TERM_DIALOG_AT: u16 = 0x12a;

/// A format string, `:(%04x)`, `wsprintf`'s (`2f05`).
const TEXT_HANDLE_FORMAT: &str = ":(%04x)";
const TEXT_HANDLE_FORMAT_AT: u16 = 0x136;

/// DDEML's signature, 13Eh to 168h: three strings, `Who` and `Made me?` --
/// the atoms `D_WHO` and `D_MADE_ME` become -- and the answer to the one
/// request DDEML answers itself, `Made me?` of `Who` (`5860`-`587e`, handed
/// out as `D_TEXT_STAAB`).
///
/// It is kept scrambled, as the first `DdeInitialize` unscrambles it in
/// place (`5990`-`59ad`): every byte from 13Eh up to the first nought byte
/// has 25h exclusive-or-ed on, so each string's own terminator is stored as
/// 25h, and the one real nought ends the blob (and the unscrambling).
const SIGNATURE_KEY: u8 = 0x25;
const SIGNATURE_STRINGS: &[&str] = &["Who", "Made me?", "DDEML - By Sanford Alyn Staab"];

/// The signature as stored: the strings, each with its terminator, with
/// every byte scrambled, and the blob's end.
pub fn scrambled_signature() -> Vec<u8> {
    let mut bytes = Vec::new();

    for string in SIGNATURE_STRINGS {
        bytes.extend(string.bytes().map(|byte| byte ^ SIGNATURE_KEY));
        bytes.push(SIGNATURE_KEY); // 0 ^ 25h
    }

    // The last string's terminator is the blob's real end, not scrambled.
    if let Some(last) = bytes.last_mut() {
        *last = 0;
    }

    bytes
}

/// The default transaction parameters (`D_XPARAMS`, 016Eh), the 1Ch bytes of
/// `DdeClientTransaction`'s parameters block a client conversation points to
/// with none of its own (`69f9`: the conversation's field 16h is 016Eh and
/// its segment): `pdwResult` -- a far pointer to the doubleword at 016Ah,
/// `FFFFFFFFh`, its segment relocated at 0170h --, the time-out 1, `wType`
/// 1062h and `wFmt` 1; the item, conversation, size and data nought.
const XPARAMS_RESULT_AT: u16 = 0x16a;
const XPARAMS_NO_RESULT: u32 = 0xffff_ffff;
const XPARAMS_TIMEOUT: u32 = 1;
const XPARAMS_TYPE: u16 = 0x1062;
const XPARAMS_FORMAT: u16 = 1;

/// Two words and a string of the C library that `DDEML.DLL`'s code does not
/// address (no instruction of seg1 or seg2 reads 0190h-019Fh), kept as the
/// file has them.
const LIBRARY_WORD_190: u16 = 0x0100;
const LIBRARY_TAG_196: &str = "pspsps";

/// The C library's run-time error text. `<<NMSG>>` is the prefix 8 bytes
/// before the banner `C RUNTIME ERROR ` (01A8h, handed to the writer at
/// `7519`); the table at 01B9h is searched by `74e0` (`lodsw` of a code, a
/// zero-ended text after it, `FFFFh` ending the table).
const NMSG_PREFIX_AT: u16 = 0x1a0;
const NMSG_PREFIX: &str = "<<NMSG>>";
const NMSG_BANNER_AT: u16 = 0x1a8;
const NMSG_BANNER: &str = "C RUNTIME ERROR ";
const NMSG_TABLE_AT: u16 = 0x1b9;

const NMSG_TABLE: &[(u16, &str)] = &[
    (0, "R6000\r\n- stack overflow\r\n"),
    (3, "R6003\r\n- integer divide by 0\r\n"),
    (9, "R6009\r\n- not enough space for environment\r\n"),
    (0xfc, "\r\n"),
    (0xff, "run-time error "),
];
const NMSG_TABLE_END: u16 = 0xffff;
/// One byte more after the table's end, `FFh`.
const NMSG_TABLE_LAST: u8 = 0xff;

fn put16(data: &mut [u8], at: u16, value: u16) {
    let at = usize::from(at);

    data[at..at + 2].copy_from_slice(&value.to_le_bytes());
}

fn put32(data: &mut [u8], at: u16, value: u32) {
    let at = usize::from(at);

    data[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

/// A string's characters at `at`; the terminator is the nought already
/// there. The offset after the terminator.
fn put_text(data: &mut [u8], at: u16, string: &str) -> u16 {
    let start = usize::from(at);

    data[start..start + string.len()].copy_from_slice(string.as_bytes());

    at + string.len() as u16 + 1
}

/// DDEML's initialized data: the 604 bytes of the data segment, the fields
/// the code sets as it runs (the instance, the heap, the arrays, the
/// profile's buffer) nought. The segment's selector is not in it: the
/// relocation at `XPARAMS_SELECTOR_AT` is the loader's.
pub fn data() -> Vec<u8> {
    let mut data = vec![0u8; DATA_SIZE];
    let data = data.as_mut_slice();

    put16(data, 4, HEADER_WORD_4);
    put16(data, 0x14, HEADER_WORD_14);
    put16(data, SERIAL_AT, SERIAL_START);
    put16(data, D_CONTEXT, CONTEXT_CB);
    put16(data, CONTEXT_CODE_PAGE_AT, CONTEXT_CODE_PAGE);

    for &(at, name) in CLASS_NAMES {
        put_text(data, at, name);
    }

    for &(kind, flag) in FILTER {
        put32(data, FILTER_AT + kind * 4, flag);
    }

    for &(at, text) in PROFILE_TEXT {
        put_text(data, at, text);
    }

    put_text(data, TEXT_TERM_DIALOG_AT, TEXT_TERM_DIALOG);
    put_text(data, TEXT_HANDLE_FORMAT_AT, TEXT_HANDLE_FORMAT);

    let signature = scrambled_signature();

    data[usize::from(D_WHO)..usize::from(D_WHO) + signature.len()].copy_from_slice(&signature);

    put32(data, XPARAMS_RESULT_AT, XPARAMS_NO_RESULT);
    put16(data, D_XPARAMS, XPARAMS_RESULT_AT); // pdwResult's offset
    put16(data, XPARAMS_SELECTOR_AT, XPARAMS_SELECTOR_UNRELOCATED); // its segment, relocated
    put32(data, D_XPARAMS + 4, XPARAMS_TIMEOUT);
    put16(data, D_XPARAMS + 8, XPARAMS_TYPE);
    put16(data, D_XPARAMS + 0xa, XPARAMS_FORMAT);

    put16(data, 0x190, LIBRARY_WORD_190);
    put_text(data, 0x196, LIBRARY_TAG_196);
    put_text(data, NMSG_PREFIX_AT, NMSG_PREFIX);
    put_text(data, NMSG_BANNER_AT, NMSG_BANNER);

    let mut at = NMSG_TABLE_AT;

    for &(code, text) in NMSG_TABLE {
        put16(data, at, code);
        at = put_text(data, at + 2, text);
    }

    put16(data, at, NMSG_TABLE_END);
    data[usize::from(at) + 2] = NMSG_TABLE_LAST;

    data.to_vec()
}

// `TermDialog`, `DdeUninitialize`'s dialog of a partner that did not
// answer. A Windows 3.1 `DLGTEMPLATE`: style, the number of controls, the
// box, the menu and class names (none), the caption, the font's size and
// name; then each control: its box, id, style, class, text, and no extra data.

const WS_POPUP: u32 = 0x8000_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_CHILD: u32 = 0x4000_0000;
const WS_CAPTION: u32 = 0x00c0_0000;
const WS_SYSMENU: u32 = 0x0008_0000;
const WS_GROUP: u32 = 0x0002_0000;
const WS_TABSTOP: u32 = 0x0001_0000;
const DS_SYSMODAL: u32 = 0x02;
const DS_SETFONT: u32 = 0x40;
const DS_MODALFRAME: u32 = 0x80;
const BS_DEFPUSHBUTTON: u32 = 1;

const CLASS_BUTTON: u8 = 0x80;
const CLASS_STATIC: u8 = 0x82;

// The buttons' ids are the ones `DialogBox` ends with: `IDABORT` (Close),
// `IDRETRY` (Retry), `IDIGNORE` (Continue), what `TermDialog` tests (`04cb`).
const IDRETRY: u16 = 4;
const IDIGNORE: u16 = 5;
const IDABORT: u16 = 3;

/// One control of the template.
struct Control {
    x: u16,
    y: u16,
    cx: u16,
    cy: u16,
    id: u16,
    style: u32,
    class: u8,
    text: &'static str,
}

const TERM_DIALOG_STYLE: u32 =
    WS_POPUP | WS_VISIBLE | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_SETFONT | DS_SYSMODAL;
const TERM_DIALOG_BOX: [u16; 4] = [91, 34, 181, 137];
const TERM_DIALOG_CAPTION: &str = "Windows DDE";
const TERM_DIALOG_FONT_SIZE: u16 = 8;
const TERM_DIALOG_FONT: &str = "Helv";

const TEXT_STYLE: u32 = WS_CHILD | WS_VISIBLE | WS_GROUP;
const BUTTON_STYLE: u32 = WS_CHILD | WS_VISIBLE | WS_TABSTOP;

/// The notice and an explanation for each button (101-104), the buttons,
/// and the bullets.
const TERM_DIALOG_CONTROLS: &[Control] = &[
    Control {
        x: 7,
        y: 7,
        cx: 168,
        cy: 23,
        id: 101,
        style: TEXT_STYLE,
        class: CLASS_STATIC,
        text: "An application using DDE did not respond to the system's exit command.",
    },
    Control {
        x: 27,
        y: 32,
        cx: 148,
        cy: 24,
        id: 102,
        style: TEXT_STYLE,
        class: CLASS_STATIC,
        text: "Choose Retry to attempt to close the application and return to Windows.",
    },
    Control {
        x: 27,
        y: 58,
        cx: 148,
        cy: 24,
        id: 103,
        style: TEXT_STYLE,
        class: CLASS_STATIC,
        text: "Choose Continue to repeatedly attempt to close the application and return to Windows.",
    },
    Control {
        x: 27,
        y: 84,
        cx: 148,
        cy: 24,
        id: 104,
        style: TEXT_STYLE,
        class: CLASS_STATIC,
        text: "Choose Close to exit the application that is not responding.  You may lose any unsaved information in this application.",
    },
    Control {
        x: 15,
        y: 117,
        cx: 40,
        cy: 14,
        id: IDRETRY,
        style: BUTTON_STYLE | BS_DEFPUSHBUTTON,
        class: CLASS_BUTTON,
        text: "Retry",
    },
    Control {
        x: 70,
        y: 117,
        cx: 40,
        cy: 14,
        id: IDIGNORE,
        style: BUTTON_STYLE,
        class: CLASS_BUTTON,
        text: "Continue",
    },
    Control {
        x: 125,
        y: 117,
        cx: 40,
        cy: 14,
        id: IDABORT,
        style: BUTTON_STYLE,
        class: CLASS_BUTTON,
        text: "Close",
    },
    Control {
        x: 21,
        y: 33,
        cx: 6,
        cy: 24,
        id: 108,
        style: TEXT_STYLE,
        class: CLASS_STATIC,
        text: "*",
    },
    Control {
        x: 21,
        y: 59,
        cx: 6,
        cy: 24,
        id: 109,
        style: TEXT_STYLE,
        class: CLASS_STATIC,
        text: "*",
    },
    Control {
        x: 21,
        y: 85,
        cx: 6,
        cy: 24,
        id: 110,
        style: TEXT_STYLE,
        class: CLASS_STATIC,
        text: "*",
    },
];

fn string(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend_from_slice(value.as_bytes());
    bytes.push(0);
}

/// `TermDialog`'s `DLGTEMPLATE`, made from its controls.
pub fn term_dialog() -> Vec<u8> {
    let mut bytes = Vec::new();

    bytes.extend_from_slice(&TERM_DIALOG_STYLE.to_le_bytes());
    bytes.push(TERM_DIALOG_CONTROLS.len() as u8);

    for value in TERM_DIALOG_BOX {
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    string(&mut bytes, ""); // menu
    string(&mut bytes, ""); // class
    string(&mut bytes, TERM_DIALOG_CAPTION);
    bytes.extend_from_slice(&TERM_DIALOG_FONT_SIZE.to_le_bytes());
    string(&mut bytes, TERM_DIALOG_FONT);

    for control in TERM_DIALOG_CONTROLS {
        for value in [control.x, control.y, control.cx, control.cy, control.id] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }

        bytes.extend_from_slice(&control.style.to_le_bytes());
        bytes.push(control.class);
        string(&mut bytes, control.text);
        bytes.push(0); // no extra data
    }

    bytes
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    /// The oracle installation's `DDEML.DLL`, where it is on disk.
    fn file() -> Option<Vec<u8>> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../oracle/build/drive-c/WINDOWS/SYSTEM/DDEML.DLL");

        std::fs::read(path).ok()
    }

    fn word(bytes: &[u8], at: usize) -> usize {
        usize::from(u16::from_le_bytes([bytes[at], bytes[at + 1]]))
    }

    /// A segment's bytes in a 16 bit `NE` file: its sector, shifted by the
    /// alignment, and its length.
    fn segment(bytes: &[u8], number: usize) -> &[u8] {
        let header = word(bytes, 0x3c);
        let shift = word(bytes, header + 0x32);
        let table = header + word(bytes, header + 0x22);
        let entry = table + (number - 1) * 8;
        let start = word(bytes, entry) << shift;

        &bytes[start..start + word(bytes, entry + 2)]
    }

    #[test]
    fn data_is_the_size_of_the_segment() {
        let data = data();

        assert_eq!(data.len(), DATA_SIZE);
        assert_eq!(
            &data[usize::from(XPARAMS_SELECTOR_AT)..usize::from(XPARAMS_SELECTOR_AT) + 2],
            &[0xff, 0xff]
        );
    }

    #[test]
    fn data_is_ddeml_dlls_data_segment() {
        let Some(file) = file() else {
            return;
        };

        assert_eq!(data().as_slice(), segment(&file, 3));
    }

    #[test]
    fn term_dialog_is_ddeml_dlls_resource() {
        let Some(file) = file() else {
            return;
        };
        let template = term_dialog();

        assert!(
            file.windows(template.len())
                .any(|window| window == template)
        );
    }
}
