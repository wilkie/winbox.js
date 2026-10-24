//! A CD image's tracks as DOSBox 0.74-3's `CDROM_Interface_Image` holds
//! them (`cdrom_image.cpp`): what `SetDevice` (167-178) makes of an image's
//! file -- a cue sheet first (`LoadCueSheet`, 422-556), else one data track
//! (`LoadIsoFile`, 350-393) -- and the cooked sectors `isoDrive` reads
//! through it (`ReadSector`, 301-313, the track found by `GetTrack`,
//! 287-299). A disc's sector is the image's, counted from its first track's
//! start, whichever track holds the data: `isoDrive` reads sector 16 of the
//! whole disc (`loadImage`, `drive_iso.cpp` 516-526).
//!
//! The functions are DOSBox's, by its names, and do what its do: the sheet
//! read a line at a time as `ifstream::getline` reads one into 512 bytes,
//! its words as `>>` reads them, `AddTrack`'s arithmetic as it is, and a
//! file's stream failing for good once a read of it has failed, as a
//! `std::ifstream` does (`BinaryFile::read`, 59-64: `seekg` does nothing
//! on a stream whose fail bit is set). Audio tracks are kept in the list
//! but never played.

use std::cell::Cell;

use super::mbr::Sectors;

/// A raw sector's bytes, sync and header with them (`RAW_SECTOR_SIZE`).
pub const RAW_SECTOR_SIZE: i64 = 2352;

/// A cooked sector's bytes (`COOKED_SECTOR_SIZE`).
pub const COOKED_SECTOR_SIZE: i64 = 2048;

/// A line's most bytes, its ending nought among them (`MAX_LINE_LENGTH`).
const MAX_LINE_LENGTH: usize = 512;

/// A quoted name's most bytes, its ending nought among them
/// (`MAX_FILENAME_LENGTH`).
const MAX_FILENAME_LENGTH: usize = 256;

/// The file types an audio track's `FILE` may name and DOSBox's `SDL_sound`
/// take: `WAVE`, `AIFF` and `MP3` by name (515-516), and the first
/// extension each decoder lists (517-524) -- those of the `libSDL_sound`
/// 1.0 the oracle's DOSBox links, as `Sound_AvailableDecoders` lists them
/// (`MP3`, `669`, `WAV`, `AIFF`, `AU`, `OGG`, `VOC`, `RAW`, `SHN`, `FLAC`,
/// and `spx`, which an upper-cased type never is).
pub const AUDIO_TYPES: [&str; 12] = [
    "WAVE", "AIFF", "MP3", "669", "WAV", "AU", "OGG", "VOC", "RAW", "SHN", "FLAC", "spx",
];

/// A track's file (`TrackFile`).
#[derive(Debug)]
pub enum TrackFile {
    /// A `BINARY` file's bytes (`BinaryFile`).
    Binary(BinaryFile),
    /// An audio file's (`AudioFile`), which `SDL_sound` decodes: kept, never
    /// read here -- CD audio is not played yet -- and so of no length known
    /// (`AudioFile::getLength`).
    Audio(Box<dyn Sectors>),
}

/// A `BINARY` file's bytes as DOSBox's `BinaryFile` reads them through an
/// `ifstream` (47-72): a read that cannot be done whole fails, and leaves
/// the stream failed, so that every read and length after it fails too.
#[derive(Debug)]
pub struct BinaryFile {
    sectors: Box<dyn Sectors>,
    failed: Cell<bool>,
}

impl BinaryFile {
    pub fn new(sectors: Box<dyn Sectors>) -> Self {
        Self {
            sectors,
            failed: Cell::new(false),
        }
    }

    /// `BinaryFile::read` (59-64): `count` bytes from `seek`, or false.
    fn read(&self, buffer: &mut [u8], seek: i64) -> bool {
        if self.failed.get() || seek < 0 {
            self.failed.set(true);
            return false;
        }

        let size = self.sectors.size() as i64;

        self.sectors.read_at(seek as u64, buffer);

        if seek + buffer.len() as i64 > size {
            self.failed.set(true);
            return false;
        }

        true
    }

    /// `BinaryFile::getLength` (66-72): the file's size; -1 once failed.
    fn get_length(&self) -> i64 {
        if self.failed.get() {
            -1
        } else {
            self.sectors.size() as i64
        }
    }
}

impl TrackFile {
    /// The file's bytes as they are on the host.
    pub fn bytes(&self) -> &dyn Sectors {
        match self {
            TrackFile::Binary(file) => file.sectors.as_ref(),
            TrackFile::Audio(sectors) => sectors.as_ref(),
        }
    }

    /// `getLength`: none for an audio file, which only `SDL_sound` measures.
    fn get_length(&self) -> Option<i64> {
        match self {
            TrackFile::Binary(file) => Some(file.get_length()),
            TrackFile::Audio(_) => None,
        }
    }
}

/// A track as `CDROM_Interface_Image::Track` holds it (`cdrom.h` 144-153):
/// its number, its attribute (40h data, 0 audio), where it starts on the
/// disc and how long it is in sectors, where its first sector is in its
/// file, its sectors' size, whether mode 2, and its file, by its place in
/// `CdImage::files` -- none for the lead-out. `known` is false for a track
/// whose start needed an audio file's length, which is not measured here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CdTrack {
    pub number: i64,
    pub attr: u8,
    pub start: i64,
    pub length: i64,
    pub skip: i64,
    pub sector_size: i64,
    pub mode2: bool,
    pub file: Option<usize>,
    pub known: bool,
}

impl CdTrack {
    const EMPTY: Self = Self {
        number: 0,
        attr: 0,
        start: 0,
        length: 0,
        skip: 0,
        sector_size: 0,
        mode2: false,
        file: None,
        known: true,
    };
}

/// Why a cue sheet was not taken, and on which line (from 1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CueError {
    pub line: usize,
    pub reason: CueFailure,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CueFailure {
    /// A line too long for `getline`: "probably a binary file" (443).
    NotText,
    /// A command DOSBox does not know (540).
    Command(String),
    /// A track's type DOSBox does not know (482).
    TrackType(String),
    /// A `FILE` that could not be opened, or of a type DOSBox does not
    /// take (527-531): its name as the sheet gives it, and its type.
    File(String, String),
    /// An `INDEX` or `PREGAP` whose time is not `mm:ss:ff` (657-666).
    Frame,
    /// Tracks laid out as `AddTrack` refuses (558-606): the first not 1,
    /// numbers not consecutive, a track before the one before it ends, or
    /// its index 0 after its index 1.
    Layout,
}

impl std::fmt::Display for CueError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let line = self.line;

        match &self.reason {
            CueFailure::NotText => write!(f, "line {line} is too long for a cue sheet"),
            CueFailure::Command(command) => {
                write!(f, "line {line}: DOSBox knows no command {command:?}")
            }
            CueFailure::TrackType(kind) => {
                write!(f, "line {line}: DOSBox knows no track type {kind:?}")
            }
            CueFailure::File(name, kind) if kind == "BINARY" || AUDIO_TYPES.contains(&&**kind) => {
                write!(f, "line {line}: {name} not found")
            }
            CueFailure::File(name, kind) => {
                write!(
                    f,
                    "line {line}: {name} is of a type DOSBox does not take ({kind:?})"
                )
            }
            CueFailure::Frame => write!(f, "line {line}: a time not mm:ss:ff"),
            CueFailure::Layout => write!(f, "line {line}: tracks DOSBox does not lay out"),
        }
    }
}

/// The sheet's lines as `in.getline(buf, MAX_LINE_LENGTH)` reads them from
/// an `ifstream` (439-443).
struct Lines<'a> {
    source: &'a dyn Sectors,
    at: u64,
    eof: bool,
    chunk: Vec<u8>,
    chunk_at: u64,
}

impl<'a> Lines<'a> {
    fn new(source: &'a dyn Sectors) -> Self {
        Self {
            source,
            at: 0,
            eof: false,
            chunk: Vec::new(),
            chunk_at: 0,
        }
    }

    fn byte(&mut self, at: u64) -> u8 {
        if at < self.chunk_at || at >= self.chunk_at + self.chunk.len() as u64 {
            let length = (self.source.size() - at).min(4096) as usize;

            self.chunk = vec![0; length];
            self.chunk_at = at;
            self.source.read_at(at, &mut self.chunk);
        }

        self.chunk[(at - self.chunk_at) as usize]
    }

    /// The next line, to its first nought as `buf` is read as a C string,
    /// and whether `getline` failed: no more than 511 bytes stored, the
    /// fail bit set where the next is not the line's end, or where nothing
    /// at all was read.
    fn getline(&mut self) -> (Vec<u8>, bool) {
        let size = self.source.size();
        let mut stored = Vec::new();
        let mut extracted = false;
        let mut failed = false;

        loop {
            if self.at >= size {
                self.eof = true;
                failed = !extracted;
                break;
            }

            let c = self.byte(self.at);

            if c == b'\n' {
                self.at += 1;
                break;
            }

            if stored.len() == MAX_LINE_LENGTH - 1 {
                failed = true;
                break;
            }

            stored.push(c);
            extracted = true;
            self.at += 1;
        }

        if let Some(nought) = stored.iter().position(|&c| c == 0) {
            stored.truncate(nought);
        }

        (stored, failed)
    }
}

/// `isspace` in the C locale, which `>>` skips.
fn is_space(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\n' | 0x0b | 0x0c | b'\r')
}

/// A line as an `istringstream` of it is read (444): words by `>>`, its
/// fail and end bits.
struct Line {
    text: Vec<u8>,
    pos: usize,
    failed: bool,
}

impl Line {
    fn new(text: Vec<u8>) -> Self {
        Self {
            text,
            pos: 0,
            failed: false,
        }
    }

    /// `>> string`: white space skipped, the word to the next; nothing,
    /// and the stream failed, at its end.
    fn word(&mut self) -> String {
        if self.failed {
            return String::new();
        }

        while self.pos < self.text.len() && is_space(self.text[self.pos]) {
            self.pos += 1;
        }

        let from = self.pos;

        while self.pos < self.text.len() && !is_space(self.text[self.pos]) {
            self.pos += 1;
        }

        if from == self.pos {
            self.failed = true;
        }

        self.text[from..self.pos]
            .iter()
            .map(|&c| char::from(c))
            .collect()
    }

    /// `>> int`: a sign and digits; nought, and the stream failed, where
    /// there are none (C++11's `num_get`).
    fn int(&mut self) -> i64 {
        if self.failed {
            return 0;
        }

        while self.pos < self.text.len() && is_space(self.text[self.pos]) {
            self.pos += 1;
        }

        let (value, used) = scan_int(&self.text[self.pos..]);

        self.pos += used;

        value.unwrap_or_else(|| {
            self.failed = true;
            0
        })
    }

    /// `GetCueKeyword` (649-655): a word, upper-cased.
    fn keyword(&mut self) -> String {
        self.word().to_ascii_uppercase()
    }

    /// `GetCueFrame` (657-666): a word read as `%d:%d:%d`, its minutes,
    /// seconds and frames counted in frames (`MSF_TO_FRAMES`, SDL's
    /// `SDL_cdrom.h`: 75 to a second).
    fn frame(&mut self) -> Option<i64> {
        let msf = self.word();
        let mut text = msf.as_bytes();
        let mut parts = [0i64; 3];

        for (at, part) in parts.iter_mut().enumerate() {
            if at > 0 {
                if text.first() != Some(&b':') {
                    return None;
                }

                text = &text[1..];
            }

            let skipped = text.iter().take_while(|&&c| is_space(c)).count();
            let (value, used) = scan_int(&text[skipped..]);

            *part = value?;
            text = &text[skipped + used..];
        }

        Some((parts[0] * 60 + parts[1]) * 75 + parts[2])
    }

    /// `GetCueString` (668-684): a word; one beginning with a quote taken
    /// to the next quote, the quotes dropped -- read again from before the
    /// word, by `getline` to the first quote and then to the next, at most
    /// 255 bytes, the stream failed where the name is longer and at its
    /// end where there is no second quote.
    fn string(&mut self) -> String {
        let pos = self.pos;
        let failed = self.failed;
        let word = self.word();

        if !word.starts_with('"') {
            return word;
        }

        if word.len() > 1 && word.ends_with('"') {
            return word[1..word.len() - 1].to_string();
        }

        if word == "\"" {
            return String::new();
        }

        self.pos = pos;
        self.failed = failed;
        self.getline(b'"');
        self.getline(b'"')
    }

    /// `getline(buffer, MAX_FILENAME_LENGTH, delimiter)` on the line.
    fn getline(&mut self, delimiter: u8) -> String {
        if self.failed {
            return String::new();
        }

        let mut stored = Vec::new();
        let mut extracted = false;

        loop {
            if self.pos >= self.text.len() {
                if !extracted {
                    self.failed = true;
                }

                break;
            }

            let c = self.text[self.pos];

            if c == delimiter {
                self.pos += 1;
                break;
            }

            if stored.len() == MAX_FILENAME_LENGTH - 1 {
                self.failed = true;
                break;
            }

            stored.push(c);
            extracted = true;
            self.pos += 1;
        }

        stored.iter().map(|&c| char::from(c)).collect()
    }
}

/// A decimal integer as `%d` and `>> int` read one: a sign and digits;
/// none where no digit follows. How many bytes it took.
fn scan_int(text: &[u8]) -> (Option<i64>, usize) {
    let mut at = 0;
    let negative = matches!(text.first(), Some(b'-'));

    if matches!(text.first(), Some(b'-' | b'+')) {
        at = 1;
    }

    let digits = text[at..].iter().take_while(|c| c.is_ascii_digit()).count();

    if digits == 0 {
        return (None, 0);
    }

    let value = text[at..at + digits].iter().fold(0i64, |value, &c| {
        value.saturating_mul(10).saturating_add(i64::from(c - b'0'))
    });

    (Some(if negative { -value } else { value }), at + digits)
}

/// A disc's tracks and their files, as `CDROM_Interface_Image` holds them.
#[derive(Debug)]
pub struct CdImage {
    tracks: Vec<CdTrack>,
    files: Vec<TrackFile>,
    /// The disc's catalogue number, a `CATALOG` line's (`mcn`).
    pub mcn: String,
}

impl CdImage {
    /// `SetDevice` (167-178): the image's file read as a cue sheet, and
    /// where it is none, as one data track. `open` finds a file a cue
    /// sheet names, as `GetRealFileName` finds it (618-647), or none. Why
    /// not, where neither: the sheet's failure where the file read as one
    /// at least in part -- a line before it a cue sheet's, or the line
    /// itself a command DOSBox knows -- else none.
    pub fn set_device(
        image: Box<dyn Sectors>,
        open: &mut dyn FnMut(&str) -> Option<Box<dyn Sectors>>,
    ) -> Result<Self, Option<CueError>> {
        let sheet = match Self::load_cue_sheet(image.as_ref(), open) {
            Ok(image) => return Ok(image),
            Err((error, read)) => (read
                || !matches!(error.reason, CueFailure::NotText | CueFailure::Command(_)))
            .then_some(error),
        };

        Self::load_iso_file(image).ok_or(sheet)
    }

    /// `LoadIsoFile` (350-393): the file one data track, its layout the
    /// first whose sector 16 is a primary volume descriptor (`CanReadPVD`,
    /// 395-404) -- cooked 2,048-byte sectors, raw 2,352 (their data 16 in),
    /// mode 2 of 2,336 or 2,352 (24 in) -- as many sectors long as the file
    /// holds whole, and the lead-out after it.
    pub fn load_iso_file(image: Box<dyn Sectors>) -> Option<Self> {
        let file = BinaryFile::new(image);
        let (sector_size, mode2) = [
            (COOKED_SECTOR_SIZE, false),
            (RAW_SECTOR_SIZE, false),
            (2336, true),
            (RAW_SECTOR_SIZE, true),
        ]
        .into_iter()
        .find(|&(sector_size, mode2)| can_read_pvd(&file, sector_size, mode2))?;
        let length = file.get_length() / sector_size;
        let data = CdTrack {
            number: 1,
            attr: 0x40,
            length,
            sector_size,
            mode2,
            file: Some(0),
            ..CdTrack::EMPTY
        };
        let lead_out = CdTrack {
            number: 2,
            attr: 0,
            start: length,
            length: 0,
            file: None,
            ..data
        };

        Some(Self {
            tracks: vec![data, lead_out],
            files: vec![TrackFile::Binary(file)],
            mcn: String::new(),
        })
    }

    /// `LoadCueSheet` (422-556), line by line. Why not, and whether any
    /// line was read as a cue sheet's before it.
    // DOSBox's function is one loop over the lines, kept whole here.
    #[allow(clippy::too_many_lines)]
    pub fn load_cue_sheet(
        cue: &dyn Sectors,
        open: &mut dyn FnMut(&str) -> Option<Box<dyn Sectors>>,
    ) -> Result<Self, (CueError, bool)> {
        let mut image = Self {
            tracks: Vec::new(),
            files: Vec::new(),
            mcn: String::new(),
        };
        let mut track = CdTrack::EMPTY;
        let mut shift = 0i64;
        let mut curr_pregap = 0i64;
        let mut total_pregap = 0i64;
        let mut prestart = 0i64;
        let mut can_add_track = false;
        let mut lines = Lines::new(cue);
        let mut number = 0;
        let mut read = false;

        while !lines.eof {
            let (text, failed) = lines.getline();

            number += 1;

            let fail = |reason| {
                Err((
                    CueError {
                        line: number,
                        reason,
                    },
                    read,
                ))
            };

            if failed && !lines.eof {
                return fail(CueFailure::NotText);
            }

            let mut line = Line::new(text);
            let command = line.keyword();
            let mut layout = true;

            match command.as_str() {
                "TRACK" => {
                    if can_add_track {
                        layout = image.add_track(
                            &mut track,
                            &mut shift,
                            prestart,
                            &mut total_pregap,
                            curr_pregap,
                        );
                    }

                    track.start = 0;
                    track.skip = 0;
                    curr_pregap = 0;
                    prestart = 0;
                    track.number = line.int();

                    let kind = line.keyword();

                    (track.sector_size, track.attr, track.mode2) = match kind.as_str() {
                        "AUDIO" => (RAW_SECTOR_SIZE, 0, false),
                        "MODE1/2048" => (COOKED_SECTOR_SIZE, 0x40, false),
                        "MODE1/2352" => (RAW_SECTOR_SIZE, 0x40, false),
                        "MODE2/2336" => (2336, 0x40, true),
                        "MODE2/2352" => (RAW_SECTOR_SIZE, 0x40, true),
                        _ => return fail(CueFailure::TrackType(kind)),
                    };
                    can_add_track = true;
                }
                "INDEX" => {
                    let index = line.int();
                    let Some(frame) = line.frame() else {
                        return fail(CueFailure::Frame);
                    };

                    if index == 1 {
                        track.start = frame;
                    } else if index == 0 {
                        prestart = frame;
                    }
                }
                "FILE" => {
                    if can_add_track {
                        layout = image.add_track(
                            &mut track,
                            &mut shift,
                            prestart,
                            &mut total_pregap,
                            curr_pregap,
                        );
                    }

                    can_add_track = false;

                    let name = line.string();
                    let kind = line.keyword();

                    track.file = None;

                    let file = if kind == "BINARY" {
                        open(&name).map(|file| TrackFile::Binary(BinaryFile::new(file)))
                    } else if AUDIO_TYPES.contains(&kind.as_str()) {
                        open(&name).map(TrackFile::Audio)
                    } else {
                        None
                    };

                    let Some(file) = file else {
                        return fail(CueFailure::File(name, kind));
                    };

                    image.files.push(file);
                    track.file = Some(image.files.len() - 1);
                }
                "PREGAP" => {
                    let Some(frame) = line.frame() else {
                        return fail(CueFailure::Frame);
                    };

                    curr_pregap = frame;
                }
                "CATALOG" => image.mcn = line.string(),
                "CDTEXTFILE" | "FLAGS" | "ISRC" | "PERFORMER" | "POSTGAP" | "REM"
                | "SONGWRITER" | "TITLE" | "" => {}
                _ => return fail(CueFailure::Command(command)),
            }

            if !layout {
                return fail(CueFailure::Layout);
            }

            read |= !command.is_empty();
        }

        let layout = |number| {
            Err((
                CueError {
                    line: number,
                    reason: CueFailure::Layout,
                },
                read,
            ))
        };

        // The last track, and the lead-out after it.
        if !image.add_track(
            &mut track,
            &mut shift,
            prestart,
            &mut total_pregap,
            curr_pregap,
        ) {
            return layout(number);
        }

        track.number += 1;
        track.attr = 0;
        track.start = 0;
        track.length = 0;
        track.file = None;

        if !image.add_track(&mut track, &mut shift, 0, &mut total_pregap, 0) {
            return layout(number);
        }

        Ok(image)
    }

    /// `AddTrack` (558-606): a track put after the others, its start on
    /// the disc and where it begins in its file worked out from the one
    /// before it -- in the same file, from where this one's index 1 is;
    /// in another, after the whole of the one before's file, its last
    /// sector counted where it is cut short.
    fn add_track(
        &mut self,
        curr: &mut CdTrack,
        shift: &mut i64,
        prestart: i64,
        total_pregap: &mut i64,
        curr_pregap: i64,
    ) -> bool {
        // Frames between index 0 and index 1 are skipped.
        let skip = if prestart > 0 {
            if prestart > curr.start {
                return false;
            }

            curr.start - prestart
        } else {
            0
        };

        // The first track, whose number must be 1.
        if self.tracks.is_empty() {
            if curr.number != 1 {
                return false;
            }

            curr.skip = skip * curr.sector_size;
            curr.start += curr_pregap;
            *total_pregap = curr_pregap;
            self.tracks.push(*curr);
            return true;
        }

        let prev = *self.tracks.last().unwrap();
        let mut prev_length = prev.length;
        // Whether this track's start is known: not after an audio file.
        let mut known = prev.known;

        if prev.file == curr.file {
            // The same file as the track before.
            curr.start += *shift;
            prev_length = curr.start + *total_pregap - prev.start - skip;
            curr.skip += prev.skip + prev_length * prev.sector_size + skip * curr.sector_size;
            *total_pregap += curr_pregap;
            curr.start += *total_pregap;
        } else {
            // Another file: the one before's whole length.
            let length = prev.file.and_then(|file| self.files[file].get_length());

            if let Some(length) = length {
                let tmp = length - prev.skip;

                prev_length = tmp / prev.sector_size;

                if tmp % prev.sector_size != 0 {
                    prev_length += 1;
                }
            } else {
                known = false;
            }

            curr.start += prev.start + prev_length + curr_pregap;
            curr.skip = skip * curr.sector_size;
            *shift += prev.start + prev_length;
            *total_pregap = curr_pregap;
        }

        self.tracks.last_mut().unwrap().length = prev_length;
        curr.known = known;

        // DOSBox's checks.
        if curr.number <= 1
            || prev.number + 1 != curr.number
            || (known && curr.start < prev.start + prev_length)
            || curr.length < 0
        {
            return false;
        }

        self.tracks.push(*curr);
        true
    }

    /// The files the tracks are in, as the sheet names them in turn.
    pub fn files(&self) -> &[TrackFile] {
        &self.files
    }

    /// The tracks, the lead-out last.
    pub fn tracks(&self) -> &[CdTrack] {
        &self.tracks
    }

    /// `HasDataTrack` (608-615): whether any track is data.
    pub fn has_data_track(&self) -> bool {
        self.tracks.iter().any(|track| track.attr == 0x40)
    }

    /// `GetTrack` (287-299): the number of the track a sector is in, from
    /// its start to the next's, the lead-out none; -1 for none. A track
    /// whose start is not known ends the search.
    pub fn get_track(&self, sector: i64) -> i64 {
        for pair in self.tracks.windows(2) {
            let (curr, next) = (&pair[0], &pair[1]);

            if !curr.known || !next.known {
                return -1;
            }

            if curr.start <= sector && sector < next.start {
                return curr.number;
            }
        }

        -1
    }

    /// `ReadSector` (301-313), cooked, as `isoDrive::readSector` asks for
    /// it: the sector's 2,048 bytes of data -- 16 into a raw sector, 24
    /// into a mode 2 one -- or none, where no track holds it or its file
    /// cannot be read there. An audio file's sectors are not read here.
    pub fn read_sector(&self, sector: u32) -> Option<[u8; COOKED_SECTOR_SIZE as usize]> {
        let number = self.get_track(i64::from(sector));

        if number < 1 {
            return None;
        }

        let track = self.tracks.get(number as usize - 1)?;
        let mut seek = track.skip + (i64::from(sector) - track.start) * track.sector_size;

        if track.sector_size == RAW_SECTOR_SIZE && !track.mode2 {
            seek += 16;
        }

        if track.mode2 {
            seek += 24;
        }

        let mut buffer = [0u8; COOKED_SECTOR_SIZE as usize];

        match self.files.get(track.file?)? {
            TrackFile::Binary(file) => file.read(&mut buffer, seek).then_some(buffer),
            TrackFile::Audio(_) => None,
        }
    }
}

/// `CanReadPVD` (395-404): whether sector 16 in a layout is a primary
/// volume descriptor -- type 1, `CD001`, version 1.
fn can_read_pvd(file: &BinaryFile, sector_size: i64, mode2: bool) -> bool {
    let mut seek = 16 * sector_size;

    if sector_size == RAW_SECTOR_SIZE && !mode2 {
        seek += 16;
    }

    if mode2 {
        seek += 24;
    }

    let mut pvd = [0u8; COOKED_SECTOR_SIZE as usize];

    // The read's result is not looked at: a failed one leaves what it read.
    file.read(&mut pvd, seek);
    pvd[0] == 1 && &pvd[1..6] == b"CD001" && pvd[6] == 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn sheet(text: &str, files: &[(&str, usize)]) -> Result<CdImage, (CueError, bool)> {
        let files: HashMap<String, usize> = files
            .iter()
            .map(|&(name, size)| (name.to_string(), size))
            .collect();

        CdImage::load_cue_sheet(&text.as_bytes().to_vec(), &mut |name| {
            files
                .get(name)
                .map(|&size| Box::new(vec![0u8; size]) as Box<dyn Sectors>)
        })
    }

    fn starts(image: &CdImage) -> Vec<(i64, i64, i64, i64)> {
        image
            .tracks()
            .iter()
            .map(|track| (track.number, track.start, track.length, track.skip))
            .collect()
    }

    #[test]
    fn lays_out_one_file_as_add_track_does() {
        let image = sheet(
            "FILE \"game.bin\" BINARY\r\n  TRACK 01 MODE1/2352\r\n    INDEX 01 00:00:00\r\n  \
             TRACK 02 AUDIO\r\n    INDEX 00 00:10:00\r\n    INDEX 01 00:12:00\r\n",
            &[("game.bin", 2352 * 1500)],
        )
        .unwrap();

        // Track 2's index 1 at 900 frames, its 150 of pregap skipped in the
        // file; the lead-out after the file's 1,500 sectors.
        assert_eq!(
            starts(&image),
            vec![(1, 0, 750, 0), (2, 900, 600, 900 * 2352), (3, 1500, 0, 0)]
        );
        assert_eq!(image.get_track(16), 1);
        assert_eq!(image.get_track(899), 1);
        assert_eq!(image.get_track(900), 2);
        assert_eq!(image.get_track(1500), -1);
    }

    #[test]
    fn lays_out_a_file_to_a_track() {
        let image = sheet(
            "FILE \"Game (Track 1).bin\" BINARY\n TRACK 01 MODE1/2352\n  INDEX 01 00:00:00\n\
             FILE \"Game (Track 2).bin\" BINARY\n TRACK 02 AUDIO\n  INDEX 00 00:00:00\n  \
             INDEX 01 00:02:00\n",
            &[
                ("Game (Track 1).bin", 2352 * 300 + 100),
                ("Game (Track 2).bin", 2352 * 450),
            ],
        )
        .unwrap();

        // Track 1 counted 301 sectors, its last cut short; track 2's index
        // 0 at 00:00:00 is no index 0 to `AddTrack` (`prestart > 0`), so
        // nothing is skipped and its start is 150 on.
        assert_eq!(
            starts(&image),
            vec![(1, 0, 301, 0), (2, 451, 450, 0), (3, 901, 0, 0)]
        );
    }

    #[test]
    fn refuses_what_dosbox_refuses() {
        let reason = |text: &str| sheet(text, &[("a.bin", 2352 * 20)]).unwrap_err().0.reason;

        assert_eq!(
            reason("\u{feff}FILE a.bin BINARY\nTRACK 01 MODE1/2352\nINDEX 01 00:00:00\n"),
            CueFailure::Command("\u{ef}\u{bb}\u{bf}FILE".to_string())
        );
        assert_eq!(
            reason("FILE b.bin BINARY\n"),
            CueFailure::File("b.bin".into(), "BINARY".into())
        );
        assert_eq!(
            reason("FILE a.bin MOTOROLA\n"),
            CueFailure::File("a.bin".into(), "MOTOROLA".into())
        );
        assert_eq!(
            reason("FILE a.bin BINARY\nTRACK 01 MODE2/2048\n"),
            CueFailure::TrackType("MODE2/2048".into())
        );
        assert_eq!(
            reason("FILE a.bin BINARY\nTRACK 02 MODE1/2352\nINDEX 01 00:00:00\n"),
            CueFailure::Layout
        );
        assert_eq!(
            reason("FILE a.bin BINARY\nTRACK 01 MODE1/2352\nINDEX 01 0:0\n"),
            CueFailure::Frame
        );
        assert_eq!(
            reason("FILE a.bin BINARY\nTRACK 01 MODE1/2352\nARRANGER x\n"),
            CueFailure::Command("ARRANGER".into())
        );
        assert_eq!(reason(&"x".repeat(600)), CueFailure::NotText);
    }

    #[test]
    fn reads_words_as_its_streams_do() {
        // Keywords in any case, quoted names with spaces, a name 255 bytes
        // long, CRLF, comments and ignored commands, a last line without
        // its end.
        let long = "n".repeat(255);
        let text = format!(
            "rem a comment\r\ncatalog 0123456789012\r\nfile \"{long}\" binary\r\ntrack 1 mode1/2048\r\n\
             title \"x y\"\r\nindex 1 0:0:0"
        );
        let image = sheet(&text, &[(long.as_str(), 2048 * 20)]).unwrap();

        assert_eq!(image.mcn, "0123456789012");
        assert_eq!(starts(&image), vec![(1, 0, 20, 0), (2, 20, 0, 0)]);

        // A quoted name with a space in it is read by `getline`, 255 bytes
        // at most; one longer fails the stream, and its type's word.
        let spaced = format!("a {}", "n".repeat(253));
        let text = format!("FILE \"{spaced}\" BINARY\nTRACK 01 MODE1/2048\nINDEX 01 00:00:00\n");

        assert!(sheet(&text, &[(spaced.as_str(), 2048 * 20)]).is_ok());

        let longer = format!("{spaced}n");
        let text = format!("FILE \"{longer}\" BINARY\n");

        assert_eq!(
            sheet(&text, &[(longer.as_str(), 2048)])
                .unwrap_err()
                .0
                .reason,
            CueFailure::File("n".repeat(0) + &longer[..255], String::new())
        );
    }

    #[test]
    fn keeps_audio_files_unplayed() {
        let image = sheet(
            "FILE data.bin BINARY\nTRACK 01 MODE1/2048\nINDEX 01 00:00:00\n\
             FILE \"t2.ogg\" OGG\nTRACK 02 AUDIO\nINDEX 01 00:00:00\n",
            &[("data.bin", 2048 * 40), ("t2.ogg", 1000)],
        )
        .unwrap();

        assert_eq!(image.tracks().len(), 3);
        assert_eq!(image.tracks()[1].start, 40);
        assert!(!image.tracks()[2].known);
        assert_eq!(image.get_track(16), 1);
        assert_eq!(image.get_track(40), -1);
    }

    #[test]
    fn a_failed_read_fails_the_file_for_good() {
        let file = BinaryFile::new(Box::new(vec![0u8; 100]));
        let mut buffer = [0u8; 50];

        assert!(file.read(&mut buffer, 0));
        assert!(!file.read(&mut buffer, 80));
        assert!(!file.read(&mut buffer, 0));
        assert_eq!(file.get_length(), -1);
    }
}
