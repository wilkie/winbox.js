//! COMMDLG's resources, WinBox's own: no Windows file is shipped. Made to
//! match the Windows 3.1 the recordings are made on, as the TypeScript
//! engine's `strings.ts`, `file-open-dialog.ts` and
//! `multi-file-open-dialog.ts` are, by `scripts/oracle/strings-table.mjs`
//! and `scripts/oracle/dialog-template.mjs`.

/// COMMDLG's strings, by their resource numbers: the messages and names of
/// its dialogs.
pub const STRINGS: &[(u16, &str)] = &[
    (0x100, "File Exists"),
    (
        0x101,
        "%s\nThis file already exists.\n\nReplace existing file?",
    ),
    (0x102, "Exiting"),
    (0x103, "Do you really want to exit?"),
    (0x180, "Open"),
    (0x181, "Save As"),
    (0x182, "Save File as &Type:"),
    (
        0x183,
        "Drive %c: does not exist.\n\nPlease verify that the correct drive is given.",
    ),
    (
        0x184,
        "Cannot read drive %c:.\n\nPlease verify the drive door is closed and that the disk is formatted and free of errors.",
    ),
    (
        0x185,
        "A different disk is expected in drive %c:.\n\nPlease insert the appropriate disk.",
    ),
    (
        0x186,
        "The disk in drive %c: is not formatted.\n\nPlease insert a formatted disk and try this operation again.",
    ),
    (
        0x187,
        "%s\nCannot find this file.\n\nPlease verify that the correct path and filename are given.",
    ),
    (
        0x188,
        "%s\nPath does not exist.\n\nPlease verify that the correct path is given.",
    ),
    (0x189, "%s\nThis filename is not valid."),
    (
        0x18a,
        "%s\nThis file is already in use.\n\nUse a new filename or close the file in use by another application.",
    ),
    (
        0x18b,
        "%s\nCannot access this file.\n\nPlease verify security privileges on the network drive.",
    ),
    (
        0x18c,
        "%s\nThis file exists and is read-only.\nUse a different filename.",
    ),
    (0x18d, "%s\nDOS critical error.\nCannot access file."),
    (
        0x18e,
        "%s\nThis filename is a reserved device name.\n\nUse a different filename.",
    ),
    (
        0x18f,
        "Disk %c: is write-protected.\nA file cannot be saved on a write-protected disk.",
    ),
    (
        0x190,
        "Not enough disk space on drive %c:.\n\nDelete one or more files on this disk to increase available space or use a different disk.",
    ),
    (
        0x191,
        "%s\nToo many files already open.\n\nClose one or more applications or files, and try again.",
    ),
    (0x192, "%s\nThis file does not exist.\n\nCreate the file?"),
    (
        0x193,
        "%s\nThis file is on a network drive with create but no modify privileges.\n\nAsk the administrator of this network to change this condition.",
    ),
    (0x194, "Cannot select drive %c:."),
    (0x300, "FileOpen"),
    (0x301, "FileSave"),
    (0x302, "ExitChanges"),
    (0x303, "ChooseColor"),
    (0x304, "FindText"),
    (0x305, "ReplaceText"),
    (0x306, "FormatChar"),
    (0x307, "FontInfo"),
    (0x308, "PrintDlg"),
    (0x309, "PrintSetupDlg"),
    (0x30a, "MultiFileOpen"),
    (0x40d, "Close"),
    (0x410, "Black"),
    (0x411, "Maroon"),
    (0x412, "Green"),
    (0x413, "Olive"),
    (0x414, "Navy"),
    (0x415, "Purple"),
    (0x416, "Teal"),
    (0x417, "Gray"),
    (0x418, "Silver"),
    (0x419, "Red"),
    (0x41a, "Lime"),
    (0x41b, "Yellow"),
    (0x41c, "Blue"),
    (0x41d, "Fuschia"),
    (0x41e, "Aqua"),
    (0x41f, "White"),
    (0x420, "DlgInstData"),
    (0x430, "High"),
    (0x431, "Medium"),
    (0x432, "Low"),
    (0x433, "Draft"),
    (0x440, "Printer:  "),
    (0x441, "Default Printer ("),
    (0x442, "%s on %s (%s)"),
    (0x443, "ExtDeviceMode"),
    (0x444, "DeviceMode"),
    (0x445, "DeviceCapabilities"),
    (0x446, "(currently %s)"),
    (0x447, "%s on %s%s"),
    (0x448, "Print Setup"),
    (0x44a, "Size must be a number."),
    (0x44b, "Size must be between %d and %d points."),
    (
        0x44c,
        "This font style is imitated for the display. The closest matching style will be used for printing.",
    ),
    (
        0x44d,
        "This is a TrueType font. This same font will be used on both your printer and your screen.",
    ),
    (
        0x44e,
        "This is a printer font.  The closest matching Windows font will be used on your screen.",
    ),
    (
        0x44f,
        "This is a screen font.  The closest matching printer font will be used for printing.",
    ),
    (0x450, "The 'From' value is below the minimum page."),
    (0x451, "The 'From' value is above the maximum page."),
    (0x452, "The 'To' value is below the minimum page."),
    (0x453, "The 'To' value is above the maximum page."),
    (
        0x454,
        "The 'From' field contains non-numeric characters or a number greater than 65535.",
    ),
    (
        0x455,
        "The 'To' field contains non-numeric characters or a number greater than 65535.",
    ),
    (
        0x456,
        "The 'From' and 'To' fields are empty and the Pages button is pressed.",
    ),
    (0x457, "The 'Copies' field is empty."),
    (0x458, "The 'Copies' field contains non-numeric characters."),
    (0x459, "The 'Copies' field must contain a positive value."),
    (
        0x45a,
        "No default printer\n\nUse Control Panel to install and select a default printer",
    ),
    (
        0x45b,
        "%s driver file %s not found.  Please reinstall through Control Panel or choose another printer.",
    ),
    (0x481, "Letter 8 1/2 x 11 in"),
    (0x482, "Letter Small 8 1/2 x 11 in"),
    (0x483, "Tabloid 11 x 17 in"),
    (0x484, "Ledger 17 x 11 in"),
    (0x485, "Legal 8 1/2 x 14 in"),
    (0x486, "Statement 5 1/2 x 8 1/2 in"),
    (0x487, "Executive 7 1/2 x 10 in"),
    (0x488, "A3 297 x 420 mm"),
    (0x489, "A4 210 x 297 mm"),
    (0x48a, "A4 Small 210 x 297 mm"),
    (0x48b, "A5 148 x 210 mm"),
    (0x48c, "B4 250 x 354"),
    (0x48d, "B5 182 x 257 mm"),
    (0x48e, "Folio 8 1/2 x 13 in"),
    (0x48f, "Quarto 215 x 275 mm"),
    (0x490, "10x14 in"),
    (0x491, "11x17 in"),
    (0x492, "Note 8 1/2 x 11 in"),
    (0x493, "Envelope #9 3 7/8 x 8 7/8 in"),
    (0x494, "Envelope #10 4 1/8 x 9 1/2 in"),
    (0x495, "Envelope #11 4 1/2 x 10 3/8 in"),
    (0x496, "Envelope #12 4 \u{be} x 11 in"),
    (0x497, "Envelope #14 5 x 11 1/2 in"),
    (0x498, "C size sheet"),
    (0x499, "D size sheet"),
    (0x49a, "E size sheet"),
    (0x49b, "Envelope DL 110 x 220 mm"),
    (0x49c, "Envelope C5 162 x 229 mm"),
    (0x49d, "Envelope C3 324 x 458 mm"),
    (0x49e, "Envelope C4 229 x 324 mm"),
    (0x49f, "Envelope C6 114 x 162 mm"),
    (0x4a0, "Envelope C65 114 x 229 mm"),
    (0x4a1, "Envelope B4 250 x 353 mm"),
    (0x4a2, "Envelope B5 176 x 250 mm"),
    (0x4a3, "Envelope B6 176 x 125 mm"),
    (0x4a4, "Envelope 110 x 230 mm"),
    (0x4a5, "Envelope Monarch 3 7/8 x 7 1/2 in"),
    (0x4a6, "6 3/4 Envelope 3 5/8 x 6 1/2 in"),
    (0x4a7, "US Std Fanfold 14 7/8 x 11 in"),
    (0x4a8, "German Std Fanfold 8 1/2 x 12 in"),
    (0x4a9, "German Legal Fanfold 8 1/2 x 13 in"),
    (0x500, "Fonts"),
    (
        0x501,
        "There are no fonts installed;\r\nRun Control Panel to install fonts.",
    ),
    (
        0x502,
        "Invalid font name.\nChoose a font from the list of fonts.",
    ),
    (
        0x503,
        "Invalid font style.\nChoose a style from the list of styles.",
    ),
    (0x504, "Regular"),
    (0x505, "Bold"),
    (0x506, "Italic"),
    (0x507, "Bold Italic"),
    (0x580, "User Defined Size"),
];

/// One of COMMDLG's strings by its resource number.
pub fn string(id: u16) -> Option<&'static str> {
    STRINGS
        .iter()
        .find(|&&(number, _)| number == id)
        .map(|&(_, text)| text)
}

/// COMMDLG's dialog 1536: the Open and Save As box, `FILEOPENORD`.
pub const FILE_OPEN_DIALOG: &str = concat!(
    "c000c8800e240018000801860000004f70656e00080048656c7600060006004c",
    "0009004204000002508246696c6520264e616d653a0000060010005a000c0080",
    "0480048150810000060020005a00440060045310a1508300006e0006005c0009",
    "00ffff0000025082264469726563746f726965733a00006e0012005c00090040",
    "04800002508200006e0020005c00440061045310a150830000060068005a0009",
    "00410400000250824c6973742046696c6573206f662026547970653a00000600",
    "72005a00240070044300a1508500006e0068005c000900430400000250824472",
    "69267665733a00006e0072005c00440071045303a150850000d000060032000e",
    "00010001000350804f4b0000d000180032000e000200000003508043616e6365",
    "6c0000d0002e0032000e000e0400000350802648656c700000d000440032000c",
    "00100403000350802652656164204f6e6c790000000000000000000000000000",
);

/// COMMDLG's dialog 1537: the Open box that takes several files,
/// `MULTIFILEOPENORD`.
pub const MULTI_FILE_OPEN_DIALOG: &str = concat!(
    "c000c8800e240018000801860000004f70656e00080048656c7600060006004c",
    "000a004204000002508246696c6520264e616d653a0000060010005a000c0080",
    "0480048150810000060020005a00440060045318a1508300006e0006005c0009",
    "00ffff0000025082264469726563746f726965733a00006e0010005c00090040",
    "04800002508200006e0020005c00440061045310a150830000060066005a0009",
    "00410400000250824c6973742046696c6573206f662026547970653a00000600",
    "70005a00240070044300a1508500006e0066005c000900430400000250824472",
    "69267665733a00006e0070005c00440071045303a150850000d000060032000e",
    "00010001000350804f4b0000d000180032000e000200000003508043616e6365",
    "6c0000d0002e0032000e000e0400000350802648656c700000d000440032000c",
    "00100403000350802652656164204f6e6c790000000000000000000000000000",
);
