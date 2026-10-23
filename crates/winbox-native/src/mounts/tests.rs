//! Images as drives: `--mount` read, each set given its letter, a set's
//! disks put in and taken out with what was written to each kept, saved
//! only as a new file, and remembered by a kept program.

use super::*;

/// A folder of the host's for a test, let go of after it.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "winbox-native-mounts-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);

        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    /// A probe's image copied in, by the name given.
    fn image(&self, image: &str, name: &str) -> PathBuf {
        let to = self.0.join(name);

        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../oracle/probes/images")
                .join(image),
            &to,
        )
        .unwrap();
        to
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn request(letter: Option<char>, paths: &[&PathBuf]) -> Request {
    Request {
        letter,
        paths: paths.iter().map(|path| (*path).clone()).collect(),
    }
}

fn letters(mounts: &Mounts) -> Vec<(char, &'static str, usize)> {
    mounts
        .sets
        .iter()
        .map(|set| (set.letter, set.kind().name(), set.disks.len()))
        .collect()
}

#[test]
fn a_mount_is_read_with_its_letter_or_none() {
    assert_eq!(
        parse_mount("A:d1.img,d2.img").unwrap(),
        Request {
            letter: Some('A'),
            paths: vec![PathBuf::from("d1.img"), PathBuf::from("d2.img")],
        }
    );
    assert_eq!(
        parse_mount("d:../game.iso").unwrap().letter,
        Some('D'),
        "a letter, then a relative path"
    );

    // A path alone names no drive; on a Windows host, nor does one of the
    // host's own drives, which elsewhere is the drive and a path.
    for spec in ["game.iso", "../images/game.iso"] {
        let parsed = parse_mount(spec).unwrap();

        assert_eq!(parsed.letter, None, "{spec}");
        assert_eq!(parsed.paths, [PathBuf::from(spec)]);
    }

    for spec in [r"C:\GAMES\GAME.ISO", "d:/images/game.iso"] {
        let parsed = parse_mount(spec).unwrap();

        if cfg!(windows) {
            assert_eq!(parsed.letter, None, "{spec}");
            assert_eq!(parsed.paths, [PathBuf::from(spec)]);
        } else {
            assert_eq!(
                parsed.letter,
                spec.chars().next().map(|c| c.to_ascii_uppercase())
            );
            assert_eq!(parsed.paths, [PathBuf::from(&spec[2..])]);
        }
    }

    assert_eq!(
        parse_mount(r"D:C:\GAMES\GAME.ISO").unwrap(),
        Request {
            letter: Some('D'),
            paths: vec![PathBuf::from(r"C:\GAMES\GAME.ISO")],
        }
    );

    assert!(parse_mount("A:").is_err());
    assert!(parse_mount(",").is_err());
}

#[test]
fn each_set_is_given_the_owners_letter_for_its_kind() {
    let scratch = Scratch::new("letters");
    let floppy = scratch.image("imgflop.img", "DISK1.IMG");
    let second = scratch.image("imgwrite.img", "DISK2.IMG");
    let hdd = scratch.image("imghdd.img", "HDD.IMG");
    let disc = scratch.image("imgcd.iso", "GAME.ISO");

    // Floppies A: then B:, a hard disk from D:, a disc after it.
    let mounts = Mounts::open(&[
        request(None, &[&disc]),
        request(None, &[&hdd]),
        request(None, &[&floppy, &second]),
        request(None, &[&second]),
    ])
    .unwrap();

    assert_eq!(
        letters(&mounts),
        [
            ('E', "iso", 1),
            ('D', "hdd", 1),
            ('A', "floppy", 2),
            ('B', "floppy", 1)
        ]
    );

    // A letter given is taken first; the rest find the first free.
    let mounts = Mounts::open(&[
        request(None, &[&hdd]),
        request(Some('D'), &[&disc]),
        request(None, &[&disc]),
        request(Some('A'), &[&floppy]),
        request(None, &[&second]),
    ])
    .unwrap();

    assert_eq!(
        letters(&mounts),
        [
            ('E', "hdd", 1),
            ('D', "iso", 1),
            ('F', "iso", 1),
            ('A', "floppy", 1),
            ('B', "floppy", 1)
        ]
    );

    // No disc is taken for a FAT image by its name alone, nor the other way.
    let named = scratch.image("imgcd.iso", "NOTFAT.IMG");

    assert_eq!(
        letters(&Mounts::open(&[request(None, &[&named])]).unwrap()),
        [('D', "iso", 1)]
    );
    assert!(Mounts::open(&[request(None, &[&scratch.image("imgflop.img", "FLOP.ISO")])]).is_err());

    // Refused: C:, a letter twice, a set of two kinds, two hard disks in one
    // drive, a third floppy, an image not there.
    for refused in [
        vec![request(Some('C'), &[&floppy])],
        vec![
            request(Some('A'), &[&floppy]),
            request(Some('A'), &[&second]),
        ],
        vec![request(None, &[&floppy, &disc])],
        vec![request(None, &[&hdd, &hdd])],
        vec![
            request(None, &[&floppy]),
            request(None, &[&floppy]),
            request(None, &[&floppy]),
        ],
        vec![request(None, &[&scratch.0.join("NONE.IMG")])],
    ] {
        assert!(Mounts::open(&refused).is_err(), "{refused:?}");
    }
}

/// A file written to a drive through DOS's files, as a program writes one.
fn write(files: &mut Files, path: &str, bytes: &[u8]) {
    let handle = files.create(path).unwrap();

    files.resolve(handle).unwrap().write(bytes);
    files.close(handle);
}

#[test]
#[allow(clippy::too_many_lines)]
fn a_sets_disks_are_put_in_and_taken_out_keeping_what_was_written() {
    let scratch = Scratch::new("swap");
    let first = scratch.image("imgflop.img", "DISK1.IMG");
    let second = scratch.image("imgwrite.img", "DISK2.IMG");
    let disc = scratch.image("imgcd.iso", "GAME.ISO");
    let originals = [
        std::fs::read(&first).unwrap(),
        std::fs::read(&second).unwrap(),
    ];
    let mut mounts = Mounts::open(&[
        request(Some('A'), &[&first, &second]),
        request(None, &[&disc]),
    ])
    .unwrap();
    let mut files = Files::new();

    mounts.mount(&mut files);
    assert_eq!(
        mounts.status(),
        [
            "A: disk 1 of 2, DISK1.IMG (floppy)",
            "D: disk 1 of 1, GAME.ISO (iso)"
        ]
    );
    assert_eq!(files.label('D').as_deref(), Some("WINBOXCD.202"));

    write(&mut files, r"A:\FIRST.TXT", b"on the first");
    files.set_current('A', r"A:\SUBDIR\".to_string());

    // The second disk in, the folder kept; written to; the first back, as
    // it was written.
    assert_eq!(
        mounts.command(&mut files, "a next"),
        ["A: disk 2 of 2, DISK2.IMG (floppy)"]
    );
    assert_eq!(files.current('A'), r"A:\SUBDIR\");
    assert!(files.lookup('A', &[String::new()], "FIRST.TXT").is_none());
    write(&mut files, r"A:\SECOND.TXT", b"on the second");
    assert_eq!(
        mounts.command(&mut files, "A: 1"),
        ["A: disk 1 of 2, DISK1.IMG (floppy)"]
    );
    assert!(files.lookup('A', &[String::new()], "FIRST.TXT").is_some());
    assert!(files.lookup('A', &[String::new()], "SECOND.TXT").is_none());

    // Taken out: no disk, as DOSBox's floppy drive with nothing mounted;
    // the next is the one after it.
    assert_eq!(
        mounts.command(&mut files, "a eject"),
        ["A: empty (2 disks)"]
    );
    assert!(files.mounted('A') && !files.has_disk('A'));
    assert_eq!(mounts.command(&mut files, "a"), ["A: empty (2 disks)"]);
    assert_eq!(
        mounts.command(&mut files, "a next"),
        ["A: disk 2 of 2, DISK2.IMG (floppy)"]
    );
    assert!(files.lookup('A', &[String::new()], "SECOND.TXT").is_some());

    // A disc is taken out, and stays a CD-ROM drive.
    assert_eq!(
        mounts.command(&mut files, "d eject"),
        ["D: empty (1 disks)"]
    );
    assert!(files.remote('D') && !files.has_disk('D'));
    assert_eq!(
        mounts.command(&mut files, "d 1"),
        ["D: disk 1 of 1, GAME.ISO (iso)"]
    );

    // Ctrl+Shift+F12: the next disk in each drive with more than one.
    assert_eq!(
        mounts.cycle(&mut files),
        ["A: disk 1 of 2, DISK1.IMG (floppy)"]
    );

    // What cannot be done is said.
    assert_eq!(mounts.command(&mut files, "a 3"), ["A: has 2 disks"]);
    assert_eq!(
        mounts.command(&mut files, "b next"),
        ["B: has no images mounted"]
    );
    assert_eq!(mounts.command(&mut files, "a spin"), [HELP]);
    assert_eq!(mounts.command(&mut files, "drives").len(), 2);
    assert!(mounts.command(&mut files, "  ").is_empty());

    // Saved only as a new file: the disk in the drive, as written.
    let saved = scratch.0.join("SAVED.IMG");
    let said = mounts.command(&mut files, &format!("a save {}", saved.display()));

    assert_eq!(said, [format!("A: saved as {}", saved.display())]);
    assert_eq!(std::fs::read(&saved).unwrap(), files.image('A').unwrap());
    assert_ne!(std::fs::read(&saved).unwrap(), originals[0]);
    assert!(
        mounts.command(&mut files, &format!("a save {}", first.display()))[0]
            .contains("never over one")
    );
    assert!(mounts.command(&mut files, "d save X.ISO")[0].contains("disc"));

    // Both disks were written to; --write-back saves each, the one out of
    // the drive too, and not into their own folder, where their names are
    // taken.
    assert_eq!(
        mounts.written(&files),
        [
            format!("A: {}", first.display()),
            format!("A: {}", second.display())
        ]
    );

    let back = scratch.0.join("back");

    std::fs::create_dir_all(&back).unwrap();

    let said = mounts.write_back(&files, &back);

    assert_eq!(said.len(), 2, "{said:?}");

    let one = std::fs::read(back.join("DISK1.IMG")).unwrap();
    let two = std::fs::read(back.join("DISK2.IMG")).unwrap();

    assert_eq!(one, files.image('A').unwrap());
    assert_ne!(two, originals[1]);
    assert_eq!(two.len(), originals[1].len());
    assert!(
        mounts
            .write_back(&files, &scratch.0)
            .iter()
            .all(|said| said.contains("never over one"))
    );

    // The images themselves were never written.
    assert_eq!(std::fs::read(&first).unwrap(), originals[0]);
    assert_eq!(std::fs::read(&second).unwrap(), originals[1]);

    // The second disk as saved holds what was written to it.
    let mut again = Files::new();

    again.mount('A', FatVolume::new(two, true).unwrap());
    assert_eq!(
        again
            .read_from(r"A:\", "SECOND.TXT")
            .map(|(_, bytes)| bytes),
        Some(b"on the second".to_vec())
    );
}

#[test]
fn a_programs_images_are_remembered_with_their_letters() {
    let scratch = Scratch::new("media");
    let first = scratch.image("imgflop.img", "DISK1.IMG");
    let second = scratch.image("imgwrite.img", "DISK2.IMG");
    let disc = scratch.image("imgcd.iso", "GAME.ISO");
    let mounts =
        Mounts::open(&[request(None, &[&disc]), request(None, &[&first, &second])]).unwrap();
    let media = mounts.media();

    assert_eq!(
        media
            .iter()
            .map(|medium| format!(
                "{} {} {} {}",
                medium.letter, medium.kind, medium.name, medium.size
            ))
            .collect::<Vec<_>>(),
        [
            "D iso GAME.ISO 395264",
            "A floppy DISK1.IMG 1474560",
            "A floppy DISK2.IMG 1474560"
        ]
    );
    assert!(
        media
            .iter()
            .all(|medium| Path::new(&medium.path).is_absolute())
    );

    // Mounted again as they were, the letters pinned.
    let again = Mounts::open(&requests_of(&media)).unwrap();

    assert_eq!(letters(&again), [('D', "iso", 1), ('A', "floppy", 2)]);
    assert_eq!(again.media(), media);
}
