//! A MIDI file's length as `MCISEQ.DRV` counts it: to its last event before
//! the end of its longest track, the end's own delta not counted, **read
//! out** of the driver (seg3 `19a2`-`1b78`, `17e6`, `1aba`-`1b1c`) and
//! **recorded** by `seqlen` in each time format. The crate's `sequencer.rs`
//! tests hold the read-out's rules (`a_file_is_as_long_as_its_last_event_before_its_end`,
//! `times_are_counted_as_mciseq_counts_them`).

mod support;

use winbox_win16::mmsystem::sequencer::Song;

/// The probe's five files, as `seqlen.c` writes them, in its order.
fn files() -> Vec<Vec<u8>> {
    let header = |format: u8, tracks: u8| {
        vec![
            0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, tracks, 0, 0x60,
        ]
    };
    let track = |length: u8| vec![0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, length];
    let mark_and_tempo = [
        0, 0xff, 0x7f, 3, 0, 0, 0x41, 0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20,
    ];
    let note = |length: u8| vec![0, 0x90, 0x3c, 0x40, length, 0x80, 0x3c, 0x40];
    let end = |delta: u8| vec![delta, 0xff, 0x2f, 0];
    let join = |parts: &[&[u8]]| parts.concat();

    vec![
        // EOT96
        join(&[
            &header(0, 1),
            &track(26),
            &mark_and_tempo,
            &note(0x60),
            &end(0x60),
        ]),
        // EOT0
        join(&[
            &header(0, 1),
            &track(26),
            &mark_and_tempo,
            &note(0x60),
            &end(0),
        ]),
        // TEXT
        join(&[
            &header(0, 1),
            &track(34),
            &mark_and_tempo,
            &note(0x60),
            &[0x60, 0xff, 1, 4, 0x65, 0x6e, 0x64, 0x2e],
            &end(0x60),
        ]),
        // TWO
        join(&[
            &header(1, 2),
            &track(19),
            &mark_and_tempo,
            &[0x83, 0x60, 0xff, 0x2f, 0],
            &track(12),
            &note(0x60),
            &end(0),
        ]),
        // ODD
        join(&[
            &header(0, 1),
            &track(26),
            &mark_and_tempo,
            &note(0x5f),
            &end(1),
        ]),
    ]
}

/// The time formats `seqlen` asks the length in, in its order: song pointer,
/// milliseconds, SMPTE 24, 25, 30 drop and 30.
const FORMATS: [u32; 6] = [0x4001, 0, 4, 5, 7, 6];

/// A value as `mciSendString` writes it: an SMPTE time as its four bytes,
/// the lowest first, each of two digits.
fn shown(format: u32, value: u32) -> String {
    if (4..=7).contains(&format) {
        [0, 8, 16, 24]
            .map(|shift| format!("{:02}", (value >> shift) & 0xff))
            .join(":")
    } else {
        value.to_string()
    }
}

/// The recording's records: section, function, arguments, result.
fn recording() -> Vec<[String; 4]> {
    let text =
        std::fs::read_to_string(support::root().join("oracle/fixtures/seqlen.json")).unwrap();
    let fixture: serde_json::Value = serde_json::from_str(&text).unwrap();
    let field = |record: &serde_json::Value, key: &str| record[key].as_str().unwrap().to_string();

    fixture["records"]
        .as_array()
        .unwrap()
        .iter()
        .map(|record| {
            [
                field(record, "section"),
                field(record, "function"),
                field(record, "args"),
                field(record, "result"),
            ]
        })
        .collect()
}

#[test]
fn is_each_files_recorded_length_in_every_format() {
    let records = recording();
    let mut sections: Vec<&str> = Vec::new();

    for [section, ..] in &records {
        if !sections.contains(&section.as_str()) {
            sections.push(section);
        }
    }

    assert_eq!(sections.len(), files().len());

    for (file, section) in files().iter().zip(&sections) {
        let song = Song::parse(file).unwrap();
        let lengths = song.lengths();
        let length = |format: u32| {
            lengths
                .iter()
                .find(|&&(each, _)| each == format)
                .map(|&(_, value)| shown(format, value))
                .unwrap()
        };
        let mut wanted: Vec<String> = FORMATS.iter().map(|&format| length(format)).collect();

        // And song pointer again.
        wanted.push(wanted[0].clone());

        let recorded: Vec<String> = records
            .iter()
            .filter(|[each, _, args, _]| each == section && args == "status song length")
            .take(7)
            .map(|[_, _, _, result]| result.clone())
            .collect();

        assert_eq!(
            wanted
                .iter()
                .map(|text| format!("0 [{text}]"))
                .collect::<Vec<_>>(),
            recorded,
            "{section}"
        );
    }
}

#[test]
fn is_to_the_last_event_before_the_end_of_the_longest_track() {
    let songs: Vec<u32> = files()
        .iter()
        .map(|file| {
            Song::parse(file)
                .unwrap()
                .lengths()
                .into_iter()
                .find(|&(format, _)| format == 0x4001)
                .unwrap()
                .1
        })
        .collect();

    // EOT96 and EOT0: the end's own delta not counted, 96 ticks either way.
    // TEXT: a text event's delta counted as any event's. TWO: a first track
    // only of its end, 480 ticks in: nothing before it. ODD: 95 ticks, the
    // fraction of a sixteenth dropped.
    assert_eq!(songs, [4, 4, 8, 4, 3]);
}

/// The probe run whole, its answers up to each file's first play or seek
/// what `mciSendString` answered on Windows. Recorded on the installation
/// with a sound card, which this runs as the replay does, WinBox's own sound
/// driver installed.
#[test]
fn is_what_mci_send_string_answers_run_whole() {
    let Some((_, records)) = support::run("seqlen") else {
        return;
    };
    let before_moving = |records: &mut dyn Iterator<Item = (String, String)>| {
        let mut moved = false;
        let mut kept = Vec::new();

        for (args, result) in records {
            if args.starts_with("open ") {
                moved = false;
            } else if args.starts_with("play ") || args.starts_with("seek ") {
                moved = true;
            }

            if !moved {
                kept.push(format!("mci({args}) = {result}"));
            }
        }

        kept
    };
    let ours = before_moving(
        &mut records
            .into_iter()
            .filter(|[function, ..]| function == "mci")
            .map(|[_, args, result]| (args, result)),
    );
    let windows = before_moving(
        &mut recording()
            .into_iter()
            .filter(|[_, function, ..]| function == "mci")
            .map(|[_, _, args, result]| (args, result)),
    );

    assert_eq!(ours, windows);
}
