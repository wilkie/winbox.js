//! GDI's strings, by their resource numbers: the spooler's messages and
//! the Print To File box's. winbox.js keeps them itself, as it keeps GDI:
//! no Windows file is shipped. Made to match the Windows 3.1 the
//! recordings are made on by `scripts/oracle/strings-table.mjs`; the twin
//! of `src/win16/gdi/strings.ts`.

/// Each string by its number, in order.
const STRINGS: &[(u16, &str)] = &[
    (
        0x064,
        "Windows cannot write to this port. The port settings may not match those required by your printer.\n\nUse the Printers option in Control Panel or the Printer Setup command in Print Manager to specify the correct port settings, and then try again.",
    ),
    (
        0x065,
        "The printer on this port is out of paper or is not connected to your computer.\n\nCheck the printer cable or network connection to make sure the printer is connected, or refresh the printer's paper supply, and then resume the print queue.",
    ),
    (
        0x066,
        "The printer on this port is offline or not selected.\n\nMake sure the printer is online and selected, and then resume the print queue.",
    ),
    (
        0x067,
        "The printer on this port is not responding.\n\nCheck the printer or increase the Transmission Retry value in the Printers Connect dialog box, and then resume the print queue.",
    ),
    (
        0x068,
        "Windows cannot write to this file. The disk may be full. Delete any unwanted files, and then try again.",
    ),
    (0x069, "Invalid TrueType Font Detected"),
    (
        0x06a,
        "An application used a Truetype font that caused an error in Windows.\n\nQuit all applications, and then restart Windows.",
    ),
];

/// A string of GDI's, by its number.
pub fn string(id: u16) -> Option<&'static str> {
    STRINGS
        .iter()
        .find(|(number, _)| *number == id)
        .map(|(_, text)| *text)
}
