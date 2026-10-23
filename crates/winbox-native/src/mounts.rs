//! Disk and disc images as drives (`--mount`; `kb/topics/drives-and-disks.md`,
//! "The native build's drives"): a FAT image, a floppy's or a hard disk's,
//! or an ISO 9660 disc, each read where it is on the host, never written --
//! what programs write to a floppy is kept in its copy-on-write overlay
//! (`FatVolume`), as the owner chose, and saved only as a new file
//! (`save`, `--write-back`).
//!
//! Several images for one letter are an ordered set, as DOSBox's `IMGMOUNT`
//! takes several discs: the first is in the drive, and the others are put in
//! in turn (`next`, a disk by its number) or the drive emptied (`eject`),
//! by a line on standard input -- `a next`, `a 2`, `a eject`, `a save FILE`
//! -- or Ctrl+Shift+F12, which puts the next disk in each drive with a set,
//! as DOSBox's swap key does (`DriveManager::CycleAllDisks`).
//!
//! A drive given no letter takes the owner's (decision 3): a floppy A:, then
//! B:; a hard disk image the first free from D:; a disc the first free after
//! the hard disks.

use std::cell::RefCell;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use winbox_machine::{FatVolume, Files, IsoVolume, Sectors, Volume, is_floppy};

/// What an image is: DOSBox's `imgmount -t` kinds, as a probe's `.mounts`
/// names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Floppy,
    Hdd,
    Disc,
}

impl Kind {
    /// The kind's name, as `.mounts` and a kept program's media name it.
    pub fn name(self) -> &'static str {
        match self {
            Kind::Floppy => "floppy",
            Kind::Hdd => "hdd",
            Kind::Disc => "iso",
        }
    }

    /// Whether its disks are taken out and put in: a floppy's and a disc's.
    fn removable(self) -> bool {
        self != Kind::Hdd
    }
}

/// An image's bytes read from its file on the host as they are asked for,
/// the file opened only to read: a disc of hundreds of megabytes is never
/// held whole.
#[derive(Debug)]
struct FileSectors {
    file: RefCell<File>,
    size: u64,
}

impl FileSectors {
    fn open(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
        let size = file
            .metadata()
            .map_err(|error| format!("{}: {error}", path.display()))?
            .len();

        Ok(Self {
            file: RefCell::new(file),
            size,
        })
    }
}

impl Sectors for FileSectors {
    fn size(&self) -> u64 {
        self.size
    }

    fn read_at(&self, offset: u64, into: &mut [u8]) {
        into.fill(0);

        let mut file = self.file.borrow_mut();

        if file.seek(SeekFrom::Start(offset)).is_err() {
            return;
        }

        let mut done = 0;

        while done < into.len() {
            match file.read(&mut into[done..]) {
                Ok(0) | Err(_) => break,
                Ok(read) => done += read,
            }
        }
    }
}

/// An image opened as a drive: a disc for `.iso`, else a FAT volume -- a
/// floppy's where DOSBox takes the image for one (`is_floppy`: 2,880 KB or
/// less), a hard disk's else -- and a disc where it holds no FAT.
pub fn open_image(path: &Path) -> Result<(Kind, Box<dyn Volume>), String> {
    let disc = || {
        IsoVolume::new(FileSectors::open(path)?)
            .map(|volume| (Kind::Disc, Box::new(volume) as Box<dyn Volume>))
            .map_err(|error| {
                format!(
                    "{}: not a FAT or ISO 9660 image ({error:?})",
                    path.display()
                )
            })
    };
    let is_iso = path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("iso"));

    if is_iso {
        return disc();
    }

    let sectors = FileSectors::open(path)?;
    let kind = if is_floppy(&sectors) {
        Kind::Floppy
    } else {
        Kind::Hdd
    };

    match FatVolume::new(sectors, kind == Kind::Floppy) {
        Ok(volume) => Ok((kind, Box::new(volume))),
        Err(_) => disc(),
    }
}

/// A `--mount` as given: its letter, if one is, and its images in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub letter: Option<char>,
    pub paths: Vec<PathBuf>,
}

/// `--mount [L:]IMAGE[,IMAGE...]`: a letter and a colon before the images
/// is the drive -- `A:/images/disk1.img` -- except, on a Windows host, where
/// a slash follows it: `C:\GAMES\GAME.ISO` is a path of the host's, with no
/// drive given, and `D:C:\GAMES\GAME.ISO` gives one.
pub fn parse_mount(spec: &str) -> Result<Request, String> {
    let bytes = spec.as_bytes();
    let host_path = cfg!(windows) && matches!(bytes.get(2), Some(b'\\' | b'/'));
    let lettered =
        bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && !host_path;
    let (letter, images) = if lettered {
        (Some(char::from(bytes[0]).to_ascii_uppercase()), &spec[2..])
    } else {
        (None, spec)
    };
    let paths: Vec<PathBuf> = images
        .split(',')
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .collect();

    if paths.is_empty() {
        return Err(format!("--mount {spec}: no image"));
    }

    Ok(Request { letter, paths })
}

/// A disk of a set: its image, and its drive's volume while it is out of
/// the drive -- none while it is in, where `Files` holds it.
#[derive(Debug)]
pub struct Disk {
    pub path: PathBuf,
    pub kind: Kind,
    volume: Option<Box<dyn Volume>>,
}

/// A drive's images, in order, and which is in it.
#[derive(Debug)]
pub struct Set {
    pub letter: char,
    pub disks: Vec<Disk>,
    /// The disk in the drive, or the one last in where it is empty.
    pub current: usize,
    pub ejected: bool,
}

impl Set {
    fn kind(&self) -> Kind {
        self.disks[0].kind
    }

    /// Where the drive is: its disk, by number and file, or empty.
    fn status(&self) -> String {
        let name = |disk: &Disk| {
            disk.path
                .file_name()
                .map_or_else(String::new, |name| name.to_string_lossy().to_string())
        };

        if self.ejected {
            format!("{}: empty ({} disks)", self.letter, self.disks.len())
        } else {
            format!(
                "{}: disk {} of {}, {} ({})",
                self.letter,
                self.current + 1,
                self.disks.len(),
                name(&self.disks[self.current]),
                self.kind().name()
            )
        }
    }
}

/// The first letter from `from` that no drive has.
fn first_free(taken: &[char], from: char, to: char) -> Option<char> {
    (from..=to).find(|letter| !taken.contains(letter))
}

/// Every image mounted, by drive.
#[derive(Debug, Default)]
pub struct Mounts {
    pub sets: Vec<Set>,
}

/// How many times Ctrl+Shift+F12 was pressed since the drives last looked.
static NEXT_ASKED: AtomicU32 = AtomicU32::new(0);

/// Whether Ctrl+Shift+F12 is the drives' and not Windows': only with images
/// mounted.
static CHORD: AtomicBool = AtomicBool::new(false);

/// Ctrl+Shift+F12 taken from Windows for the drives.
pub fn take_the_chord() {
    CHORD.store(true, Ordering::Relaxed);
}

/// Whether Ctrl+Shift+F12 is the drives'.
pub fn chord_taken() -> bool {
    CHORD.load(Ordering::Relaxed)
}

/// Ctrl+Shift+F12 pressed: the next disk in each drive with a set, at the
/// next frame (`input.rs`).
pub fn ask_next() {
    NEXT_ASKED.fetch_add(1, Ordering::Relaxed);
}

impl Mounts {
    /// The images asked for opened, each set given its letter: the letter
    /// given, else the owner's for its kind. A set is of one kind; a hard
    /// disk image is one alone, as a hard disk is not taken out; C: is the
    /// program's.
    pub fn open(requests: &[Request]) -> Result<Self, String> {
        let mut opened = Vec::new();

        for request in requests {
            let mut disks = Vec::new();

            for path in &request.paths {
                let (kind, volume) = open_image(path)?;

                disks.push(Disk {
                    path: path.clone(),
                    kind,
                    volume: Some(volume),
                });
            }

            let kind = disks[0].kind;

            if disks.iter().any(|disk| disk.kind != kind) {
                return Err(format!(
                    "--mount {}: a drive's images are of one kind: floppies, or discs",
                    request.paths[0].display()
                ));
            }

            if kind == Kind::Hdd && disks.len() > 1 {
                return Err(format!(
                    "--mount {}: a hard disk image is mounted alone, as a hard disk is not taken out",
                    request.paths[0].display()
                ));
            }

            opened.push((request.letter, disks));
        }

        let mut taken: Vec<char> = vec!['C'];

        for (letter, _) in &opened {
            match letter {
                Some('C') => return Err("--mount C: is the program's drive".to_string()),
                Some(letter) if taken.contains(letter) => {
                    return Err(format!("--mount {letter}: is given twice"));
                }
                Some(letter) => taken.push(*letter),
                None => {}
            }
        }

        let mut letters: Vec<Option<char>> = opened.iter().map(|(letter, _)| *letter).collect();
        let free = |taken: &[char], from: char, to: char, kind: Kind| {
            first_free(taken, from, to).ok_or(format!("no drive letter free for a {}", kind.name()))
        };

        // Floppies A: and B:, then hard disks from D:, then discs after them.
        for wanted in [Kind::Floppy, Kind::Hdd, Kind::Disc] {
            for (at, (_, disks)) in opened.iter().enumerate() {
                if letters[at].is_some() || disks[0].kind != wanted {
                    continue;
                }

                let letter = match wanted {
                    Kind::Floppy => free(&taken, 'A', 'B', wanted)?,
                    Kind::Hdd => free(&taken, 'D', 'Z', wanted)?,
                    Kind::Disc => {
                        let after_disks = opened
                            .iter()
                            .zip(&letters)
                            .filter(|((_, disks), _)| disks[0].kind == Kind::Hdd)
                            .filter_map(|(_, letter)| *letter)
                            .max()
                            .map_or('D', |letter| char::from(letter as u8 + 1));

                        free(&taken, after_disks, 'Z', wanted)?
                    }
                };

                letters[at] = Some(letter);
                taken.push(letter);
            }
        }

        let sets = opened
            .into_iter()
            .zip(letters)
            .map(|((_, disks), letter)| Set {
                letter: letter.expect("each set given a letter"),
                disks,
                current: 0,
                ejected: false,
            })
            .collect();

        Ok(Self { sets })
    }

    /// Whether anything is mounted.
    pub fn is_empty(&self) -> bool {
        self.sets.is_empty()
    }

    /// Each set's first disk put in its drive.
    pub fn mount(&mut self, files: &mut Files) {
        for set in &mut self.sets {
            if let Some(volume) = set.disks[set.current].volume.take() {
                files.mount_boxed(set.letter, volume);
            }
        }
    }

    /// The drives, one a line.
    pub fn status(&self) -> Vec<String> {
        self.sets.iter().map(Set::status).collect()
    }

    fn set_mut(&mut self, letter: char) -> Option<&mut Set> {
        self.sets.iter_mut().find(|set| set.letter == letter)
    }

    /// A drive's disk `to`, counted from nought, put in it, the disk that
    /// was in kept with what was written to it (`Files::swap`).
    pub fn insert(&mut self, files: &mut Files, letter: char, to: usize) -> Result<String, String> {
        let set = self
            .set_mut(letter)
            .ok_or(format!("{letter}: has no images mounted"))?;

        if to >= set.disks.len() {
            return Err(format!("{letter}: has {} disks", set.disks.len()));
        }

        if !set.kind().removable() {
            return Err(format!("{letter}: is a hard disk, not taken out"));
        }

        if !set.ejected && set.current == to {
            return Ok(set.status());
        }

        let volume = set.disks[to]
            .volume
            .take()
            .expect("a disk out of the drive holds its volume");
        let out = files.swap(letter, volume);

        if !set.ejected {
            set.disks[set.current].volume = out;
        }

        set.current = to;
        set.ejected = false;
        Ok(set.status())
    }

    /// A drive's next disk put in, the first after the last; the disk after
    /// the one taken out where it is empty.
    pub fn next(&mut self, files: &mut Files, letter: char) -> Result<String, String> {
        let set = self
            .set_mut(letter)
            .ok_or(format!("{letter}: has no images mounted"))?;
        let to = (set.current + 1) % set.disks.len();

        self.insert(files, letter, to)
    }

    /// A drive's disk taken out, the drive left empty (`Files::eject`).
    pub fn eject(&mut self, files: &mut Files, letter: char) -> Result<String, String> {
        let set = self
            .set_mut(letter)
            .ok_or(format!("{letter}: has no images mounted"))?;

        if !set.kind().removable() {
            return Err(format!("{letter}: is a hard disk, not taken out"));
        }

        if !set.ejected {
            set.disks[set.current].volume = files.eject(letter);
            set.ejected = true;
        }

        Ok(set.status())
    }

    /// Ctrl+Shift+F12: the next disk in every drive with more than one, as
    /// DOSBox's swap key cycles every drive with a set
    /// (`DriveManager::CycleAllDisks`, `drives.cpp` 173-191).
    pub fn cycle(&mut self, files: &mut Files) -> Vec<String> {
        let letters: Vec<char> = self
            .sets
            .iter()
            .filter(|set| set.disks.len() > 1)
            .map(|set| set.letter)
            .collect();

        letters
            .into_iter()
            .map(|letter| self.next(files, letter).unwrap_or_else(|error| error))
            .collect()
    }

    /// A disk of a drive as programs have written it; none for a disc.
    fn image(files: &Files, set: &Set, disk: usize) -> Option<Vec<u8>> {
        if !set.ejected && set.current == disk {
            files.image(set.letter)
        } else {
            set.disks[disk].volume.as_ref()?.image()
        }
    }

    /// Whether programs have written to a disk.
    fn changed(files: &Files, set: &Set, disk: usize) -> bool {
        if !set.ejected && set.current == disk {
            files.image_changed(set.letter)
        } else {
            set.disks[disk]
                .volume
                .as_ref()
                .is_some_and(|volume| volume.changed())
        }
    }

    /// The disk in a drive, as programs have written it, saved as a new
    /// file: never over a file there, the image itself among them.
    pub fn save(&self, files: &Files, letter: char, to: &Path) -> Result<String, String> {
        let set = self
            .sets
            .iter()
            .find(|set| set.letter == letter)
            .ok_or(format!("{letter}: has no images mounted"))?;

        if set.ejected {
            return Err(format!("{letter}: is empty"));
        }

        let bytes = Self::image(files, set, set.current)
            .ok_or(format!("{letter}: is a disc, which nothing is written to"))?;

        write_new(to, &bytes)?;
        Ok(format!("{letter}: saved as {}", to.display()))
    }

    /// The disks programs wrote to, each named by its drive and its image.
    pub fn written(&self, files: &Files) -> Vec<String> {
        self.sets
            .iter()
            .flat_map(|set| {
                set.disks
                    .iter()
                    .enumerate()
                    .filter(|&(at, _)| Self::changed(files, set, at))
                    .map(|(_, disk)| format!("{}: {}", set.letter, disk.path.display()))
            })
            .collect()
    }

    /// `--write-back DIR`: each disk programs wrote to saved into `dir` by
    /// its image's own name, a new file, as the run ends; one whose name is
    /// taken there -- the image itself, where `dir` is its folder -- is not.
    pub fn write_back(&self, files: &Files, dir: &Path) -> Vec<String> {
        let mut said = Vec::new();

        for set in &self.sets {
            for (at, disk) in set.disks.iter().enumerate() {
                if !Self::changed(files, set, at) {
                    continue;
                }

                let Some(bytes) = Self::image(files, set, at) else {
                    continue;
                };
                let Some(name) = disk.path.file_name() else {
                    continue;
                };
                let to = dir.join(name);

                said.push(match write_new(&to, &bytes) {
                    Ok(()) => format!(
                        "{}: {} as written saved as {}",
                        set.letter,
                        disk.path.display(),
                        to.display()
                    ),
                    Err(error) => format!("{}: {error}", set.letter),
                });
            }
        }

        said
    }

    /// A line typed on the console while a program runs: `a next`, `a 2`,
    /// `a eject`, `a save FILE`, `a` (where it is), `drives`, `help`. What
    /// is said back.
    pub fn command(&mut self, files: &mut Files, line: &str) -> Vec<String> {
        let line = line.trim();
        let (first, rest) = line
            .split_once(char::is_whitespace)
            .map_or((line, ""), |(first, rest)| (first, rest.trim()));
        let first = first.trim_end_matches(':');

        if first.is_empty() {
            return Vec::new();
        }

        if first.eq_ignore_ascii_case("drives") {
            return self.status();
        }

        let mut letters = first.chars();
        let letter = match (letters.next(), letters.next()) {
            (Some(letter), None) if letter.is_ascii_alphabetic() => letter.to_ascii_uppercase(),
            _ => return vec![HELP.to_string()],
        };
        let (verb, operand) = rest
            .split_once(char::is_whitespace)
            .map_or((rest, ""), |(verb, operand)| (verb, operand.trim()));
        let said = match verb.to_ascii_lowercase().as_str() {
            "" => self
                .sets
                .iter()
                .find(|set| set.letter == letter)
                .map(Set::status)
                .ok_or(format!("{letter}: has no images mounted")),
            "next" => self.next(files, letter),
            "eject" => self.eject(files, letter),
            "save" if !operand.is_empty() => self.save(files, letter, Path::new(operand)),
            number => match number.parse::<usize>() {
                Ok(number) if number > 0 => self.insert(files, letter, number - 1),
                _ => Err(HELP.to_string()),
            },
        };

        vec![said.unwrap_or_else(|error| error)]
    }

    /// What the console and Ctrl+Shift+F12 asked for since the last frame,
    /// done, and what is said of it told on the standard error.
    pub fn poll(&mut self, files: &mut Files) {
        while let Some(line) = crate::console::try_line() {
            for said in self.command(files, &line) {
                eprintln!("{said}");
            }
        }

        for _ in 0..NEXT_ASKED.swap(0, Ordering::Relaxed) {
            for said in self.cycle(files) {
                eprintln!("{said}");
            }
        }
    }
}

impl Mounts {
    /// The images as a kept program remembers them: each set's in order,
    /// its letter pinned, each file by its full path.
    pub fn media(&self) -> Vec<crate::programs::Medium> {
        self.sets
            .iter()
            .flat_map(|set| {
                set.disks.iter().map(|disk| {
                    let full = std::fs::canonicalize(&disk.path).unwrap_or(disk.path.clone());

                    crate::programs::Medium {
                        letter: set.letter.to_string(),
                        kind: disk.kind.name().to_string(),
                        name: disk
                            .path
                            .file_name()
                            .map_or_else(String::new, |name| name.to_string_lossy().to_string()),
                        size: std::fs::metadata(&disk.path).map_or(0, |metadata| metadata.len()),
                        path: full.to_string_lossy().to_string(),
                    }
                })
            })
            .collect()
    }
}

/// A kept program's images as `--mount`s: one a letter, its images in
/// order, the letter as it was pinned.
pub fn requests_of(media: &[crate::programs::Medium]) -> Vec<Request> {
    let mut requests: Vec<Request> = Vec::new();

    for medium in media {
        let letter = medium.letter.chars().next().map(|c| c.to_ascii_uppercase());
        let path = PathBuf::from(&medium.path);

        match requests.last_mut() {
            Some(last) if last.letter == letter => last.paths.push(path),
            _ => requests.push(Request {
                letter,
                paths: vec![path],
            }),
        }
    }

    requests
}

/// What the console's commands are.
const HELP: &str = "drives: a next | a 2 | a eject | a save FILE | a | drives";

/// Bytes written to a new file: never over one there.
fn write_new(to: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write as _;

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                format!(
                    "{}: is there already; an image is saved as a new file, never over one",
                    to.display()
                )
            } else {
                format!("{}: {error}", to.display())
            }
        })?;

    file.write_all(bytes)
        .map_err(|error| format!("{}: {error}", to.display()))
}

#[cfg(test)]
mod tests;
