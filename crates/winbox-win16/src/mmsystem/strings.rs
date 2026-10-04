//! MMSYSTEM's strings, by their resource numbers: the error texts
//! `waveOutGetErrorText` and `mciGetErrorString` give, MCI's device types,
//! and the words its commands use. winbox.js keeps them itself, as it keeps
//! MMSYSTEM: no Windows file is shipped. Made to match the Windows 3.1 the
//! recordings are made on by `scripts/oracle/strings-table.mjs`.

/// Each string by its number, in order.
const STRINGS: &[(u16, &str)] = &[
    (0x000, "The specified command was carried out."),
    (0x001, "Undefined external error."),
    (
        0x002,
        "A device ID has been used that is out of range for your system.",
    ),
    (0x003, "The driver was not enabled."),
    (
        0x004,
        "The specified device is already in use. Wait until it is free, and then try again.",
    ),
    (0x005, "The specified device handle is invalid."),
    (0x006, "There is no driver installed on your system."),
    (
        0x007,
        "Not enough memory available for this task. Quit one or more applications to increase available memory, and then try again.",
    ),
    (
        0x008,
        "This function is not supported. Use the Capabilities function to determine which functions and messages the driver supports.",
    ),
    (
        0x009,
        "An error number was specified that is not defined in the system.",
    ),
    (0x00a, "An invalid flag was passed to a system function."),
    (
        0x00b,
        "An invalid parameter was passed to a system function.",
    ),
    (
        0x020,
        "The specified format is not supported or cannot be translated. Use the Capabilities function to determine the supported formats.",
    ),
    (
        0x021,
        "Cannot perform this operation while media data is still playing. Reset the device, or wait until the data is finished playing.",
    ),
    (
        0x022,
        "The wave header was not prepared. Use the Prepare function to prepare the header, and then try again.",
    ),
    (
        0x023,
        "Cannot open the device without using the WAVE_ALLOWSYNC flag. Use the flag, and then try again.",
    ),
    (
        0x040,
        "The MIDI header was not prepared. Use the Prepare function to prepare the header, and then try again.",
    ),
    (
        0x041,
        "Cannot perform this operation while media data is still playing. Reset the device, or wait until the data is finished playing.",
    ),
    (
        0x042,
        "A MIDI map was not found. There may be a problem with the driver, or the MIDIMAP.CFG file may be corrupt or missing.",
    ),
    (
        0x043,
        "The port is transmitting data to the device. Wait until the data has been transmitted, and then try again.",
    ),
    (
        0x044,
        "The current MIDI Mapper setup refers to a MIDI device that is not installed on the system. Use MIDI Mapper to edit the setup.",
    ),
    (
        0x045,
        "The current MIDI setup is damaged. Copy the original MIDIMAP.CFG file to the Windows SYSTEM directory, and then try again.",
    ),
    (
        0x101,
        "Invalid MCI device ID. Use the ID returned when opening the MCI device.",
    ),
    (
        0x103,
        "The driver cannot recognize the specified command parameter.",
    ),
    (0x105, "The driver cannot recognize the specified command."),
    (
        0x106,
        "There is a problem with your media device. Make sure it is working correctly or contact the device manufacturer.",
    ),
    (
        0x107,
        "The specified device is not open or is not recognized by MCI.",
    ),
    (
        0x108,
        "Not enough memory available for this task.\n\nQuit one or more applications to increase available memory, and then try again.",
    ),
    (
        0x109,
        "The device name is already being used as an alias by this application. Use a unique alias.",
    ),
    (
        0x10a,
        "There is an undetectable problem in loading the specified device driver.",
    ),
    (0x10b, "No command was specified."),
    (
        0x10c,
        "The output string was to large to fit in the return buffer. Increase the size of the buffer.",
    ),
    (
        0x10d,
        "The specified command requires a character-string parameter. Please provide one.",
    ),
    (0x10e, "The specified integer is invalid for this command."),
    (
        0x10f,
        "The device driver returned an invalid return type. Check with the device manufacturer about obtaining a new driver.",
    ),
    (
        0x110,
        "There is a problem with the device driver. Check with the device manufacturer about obtaining a new driver.",
    ),
    (
        0x111,
        "The specified command requires a parameter. Please supply one.",
    ),
    (
        0x112,
        "The MCI device you are using does not support the specified command.",
    ),
    (
        0x113,
        "Cannot find the specified file. Make sure the path and filename are correct.",
    ),
    (0x114, "The device driver is not ready."),
    (
        0x115,
        "A problem occurred in initializing MCI. Try restarting Windows.",
    ),
    (
        0x116,
        "There is a problem with the device driver. The driver has closed. Cannot access error.",
    ),
    (
        0x117,
        "Cannot use 'all' as the device name with the specified command.",
    ),
    (
        0x118,
        "Errors occurred in more than one device. Specify each command and device separately to determine which devices caused the errors.",
    ),
    (
        0x119,
        "Cannot determine the device type from the given filename extension.",
    ),
    (
        0x11a,
        "The specified parameter is out of range for the specified command.",
    ),
    (0x11c, "The specified parameters cannot be used together."),
    (
        0x11e,
        "Cannot save the specified file. Make sure you have enough disk space or are still connected to the network.",
    ),
    (
        0x11f,
        "Cannot find the specified device. Make sure it is installed or that the device name is spelled correctly.",
    ),
    (
        0x120,
        "The specified device is now being closed. Wait a few seconds, and then try again.",
    ),
    (
        0x121,
        "The specified alias is already being used in this application. Use a unique alias.",
    ),
    (
        0x122,
        "The specified parameter is invalid for this command.",
    ),
    (
        0x123,
        "The device driver is already in use. To share it, use the 'shareable' parameter with each 'open' command.",
    ),
    (
        0x124,
        "The specified command requires an alias, file, driver, or device name. Please supply one.",
    ),
    (
        0x125,
        "The specified value for the time format is invalid. Refer to the MCI documentation for valid formats.",
    ),
    (
        0x126,
        "A closing double-quotation mark is missing from the parameter value. Please supply one.",
    ),
    (
        0x127,
        "A parameter or value was specified twice. Only specify it once.",
    ),
    (
        0x128,
        "The specified file cannot be played on the specified MCI device. The file may be corrupt, or not in the correct format.",
    ),
    (0x129, "A null parameter block was passed to MCI."),
    (0x12a, "Cannot save an unnamed file. Supply a filename."),
    (
        0x12b,
        "You must specify an alias when using the 'new' parameter.",
    ),
    (
        0x12c,
        "Cannot use the 'notify' flag with auto-opened devices.",
    ),
    (0x12d, "Cannot use a filename with the specified device."),
    (
        0x12e,
        "Cannot carry out the commands in the order specified. Correct the command sequence, and then try again.",
    ),
    (
        0x12f,
        "Cannot carry out the specified command on an auto-opened device. Wait until the device is closed, and then try again.",
    ),
    (
        0x130,
        "The filename is invalid. Make sure the filename is not longer than 8 characters, followed by a period and an extension.",
    ),
    (
        0x131,
        "Cannot specify extra characters after a string enclosed in quotation marks.",
    ),
    (
        0x132,
        "The specified device is not installed on the system. Use the Drivers option in Control Panel to install the device.",
    ),
    (
        0x133,
        "Cannot access the specified file or MCI device. Try changing directories or restarting your computer.",
    ),
    (
        0x134,
        "Cannot access the specified file or MCI device because the application cannot change directories.",
    ),
    (
        0x135,
        "Cannot access specified file or MCI device because the application cannot change drives.",
    ),
    (
        0x136,
        "Specify a device or driver name that is less than 79 characters.",
    ),
    (
        0x137,
        "Specify a device or driver name that is less than 69 characters.",
    ),
    (
        0x138,
        "The specified command requires an integer parameter. Please provide one.",
    ),
    (
        0x140,
        "All wave devices that can play files in the current format are in use. Wait until a wave device is free, and then try again.",
    ),
    (
        0x141,
        "Cannot set the current wave device for play back because it is in use. Wait until the device is free, and then try again.",
    ),
    (
        0x142,
        "All wave devices that can record files in the current format are in use. Wait until a wave device is free, and then try again.",
    ),
    (
        0x143,
        "Cannot set the current wave device for recording because it is in use. Wait until the device is free, and then try again.",
    ),
    (
        0x144,
        "Any compatible waveform playback device may be used.",
    ),
    (
        0x145,
        "Any compatible waveform recording device may be used.",
    ),
    (
        0x146,
        "No wave device that can play files in the current format is installed. Use the Drivers option to install the wave device.",
    ),
    (
        0x147,
        "The device you are trying to play to cannot recognize the current file format.",
    ),
    (
        0x148,
        "No wave device that can record files in the current format is installed. Use the Drivers option to install the wave device.",
    ),
    (
        0x149,
        "The device you are trying to record from cannot recognize the current file format.",
    ),
    (
        0x150,
        "Cannot use the song-pointer time format and the SMPTE time-format together.",
    ),
    (
        0x151,
        "The specified MIDI device is already in use. Wait until it is free, and then try again.",
    ),
    (
        0x152,
        "The specified MIDI device is not installed on the system. Use the Drivers option in Control Panel to install the driver.",
    ),
    (
        0x153,
        "The current MIDI Mapper setup refers to a MIDI device that is not installed on the system. Use MIDI Mapper to edit the setup.",
    ),
    (0x154, "An error occurred using the specified port."),
    (
        0x155,
        "All multimedia timers are being used by other applications. Quit one of these applications, and then try again.",
    ),
    (0x156, "There is no current MIDI port."),
    (
        0x157,
        "There are no MIDI devices installed on the system. Use the Drivers option in Control Panel to install the driver.",
    ),
    (0x15a, "There is no display window."),
    (0x15b, "Could not create or use window."),
    (
        0x15c,
        "Cannot read the specified file. Make sure the file is still present, or check your disk or network connection.",
    ),
    (
        0x15d,
        "Cannot write to the specified file. Make sure you have enough disk space or are still connected to the network.",
    ),
    (0x201, "vcr"),
    (0x202, "videodisc"),
    (0x203, "overlay"),
    (0x204, "cdaudio"),
    (0x205, "dat"),
    (0x206, "scanner"),
    (0x207, "animation"),
    (0x208, "digitalvideo"),
    (0x209, "other"),
    (0x20a, "waveaudio"),
    (0x20b, "sequencer"),
    (0x20c, "not ready"),
    (0x20d, "stopped"),
    (0x20e, "playing"),
    (0x20f, "recording"),
    (0x210, "seeking"),
    (0x211, "paused"),
    (0x212, "open"),
    (0x213, "false"),
    (0x214, "true"),
    (0x215, "milliseconds"),
    (0x216, "hms"),
    (0x217, "msf"),
    (0x218, "frames"),
    (0x219, "smpte 24"),
    (0x21a, "smpte 25"),
    (0x21b, "smpte 30"),
    (0x21c, "smpte 30 drop"),
    (0x21d, "bytes"),
    (0x21e, "samples"),
    (0x21f, "tmsf"),
    (0x401, "parked"),
    (0x402, "CLV"),
    (0x403, "CAV"),
    (0x404, "other"),
    (0x405, "track"),
    (0x480, "pcm"),
    (0x481, "mapper"),
    (0x4c0, "PPQN"),
    (0x4c1, "SMPTE 24 Frame"),
    (0x4c2, "SMPTE 25 Frame"),
    (0x4c3, "SMPTE 30 Drop Frame"),
    (0x4c4, "SMPTE 30 Frame"),
    (0x4c6, "file"),
    (0x4c7, "midi"),
    (0x4c8, "smpte"),
    (0x4c9, "song pointer"),
    (0x4ca, "none"),
    (0x4cb, "mapper"),
    (0x7d0, "mmtask.tsk"),
    (0x7d1, "Unknown error returned from MCI command"),
];

/// One of MMSYSTEM's strings, by its number.
pub fn string(id: u16) -> Option<&'static [u8]> {
    STRINGS
        .binary_search_by_key(&id, |&(number, _)| number)
        .ok()
        .map(|at| STRINGS[at].1.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strings_are_in_order() {
        assert!(STRINGS.windows(2).all(|pair| pair[0].0 < pair[1].0));
        assert_eq!(string(0x20d), Some(&b"stopped"[..]));
        assert_eq!(string(0x10b), Some(&b"No command was specified."[..]));
        assert_eq!(string(0x0c), None);
    }
}
