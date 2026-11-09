//! The corpus run on the Rust engine and its calls compared with the
//! TypeScript engine's, as the survey recorded them: for each program, how
//! many of the Rust engine's calls agree with the TypeScript engine's in
//! order, up to where the Rust engine stopped, and why it stopped. A program
//! agrees to its stop when every call it made is the TypeScript engine's.
//!
//! And the screen as each run left it, and each box of USER's as it came
//! up, compared pixel for pixel with the TypeScript engine's
//! (`corpus/reports/<id>.png`, `<id>.box1.png`): both are winbox.js's
//! colours, so a screen alike is alike to the bit. A program surveyed with
//! steps -- keys pressed at set times -- has its keys pressed and its
//! screens kept where the TypeScript engine's report says it did.
//!
//! `cargo build --release -p winbox-win16 --example trace --example corpus`
//! then `target/release/examples/corpus`, from the repository's root, with
//! the corpus's programs and reports and the oracle's installations there.
//! With `--base assets`, each program's drive C: has beneath it the base
//! the asset bundle composes for its display (`oracle/build/assets`, `pnpm
//! assets`) in place of the installation, and its run is held to the same
//! reports: what differs is what the bundle's base changes
//! (`kb/topics/asset-bundle.md`).
//!
//! `WINBOX_TRACE` names another command to run in the trace example's
//! place, taking its arguments, its words split at spaces: `node
//! scripts/web/trace.mjs` runs the engine built for WebAssembly. Where
//! `WINBOX_TRACE_OUT` names a folder, what each program's trace printed is
//! kept there (`<id>.txt`), and how long each took (`<id>.ms`), to set
//! one runner's beside another's.

use std::fmt::Write as _;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;

#[derive(Deserialize)]
struct Manifest {
    programs: Vec<Program>,
}

#[derive(Deserialize)]
struct Program {
    id: String,
    #[serde(default)]
    title: String,
    run: String,
    #[serde(default)]
    survey: Option<Survey>,
    /// The letter of its disc, for a program on a disc of its own: its
    /// image, kept whole by `fetch.mjs`, mounted there.
    #[serde(default)]
    disc: Option<String>,
    /// Started as an install is: Program Manager the shell, given it as its
    /// command line (`trace --shell`).
    #[serde(default)]
    install: bool,
    #[serde(default)]
    source: Option<Source>,
}

#[derive(Deserialize, Default)]
struct Source {
    /// A disc's image's kind, `iso`, where the download is one.
    #[serde(default)]
    image: Option<String>,
}

#[derive(Deserialize, Default)]
struct Survey {
    #[serde(default)]
    display: Option<String>,
    /// Keys pressed at set times after the main run.
    #[serde(default)]
    steps: Vec<String>,
    /// The main run's seconds, where not the survey's ten.
    #[serde(default)]
    seconds: Option<f64>,
}

/// A call of the TypeScript engine's as the comparison reads it: `normal`,
/// and, where its answer is negative but would fit a word, also as the long
/// it may have been -- a function answering a long answers -1 as the long
/// all ones, and the report does not say which it was.
fn wanted(line: &str) -> (String, Option<String>) {
    let word = normal(line);
    let long = normal_with(line, true);

    (word.clone(), (long != word).then_some(long))
}

/// A call as the comparison reads it: its arguments left out, a negative
/// answer read as the unsigned word or long it was, and its spaces as one.
fn normal(line: &str) -> String {
    normal_with(line, false)
}

/// As `normal`, a negative answer that would fit a word read as a long
/// where `long` says.
fn normal_with(line: &str, long: bool) -> String {
    let mut line = line.to_string();

    // The arguments, from the first bracket to the last `) = `.
    if let (Some(open), Some(close)) = (line.find('('), line.rfind(") = "))
        && close >= open
    {
        line = format!("{} = {}", &line[..open], &line[close + 4..]);
    }

    if let Some(at) = line.find(" = -") {
        let digits: String = line[at + 4..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();

        if let Ok(value) = format!("-{digits}").parse::<i64>()
            && !digits.is_empty()
        {
            let unsigned = if long || value < -32768 {
                value + 4_294_967_296
            } else {
                value + 65536
            };

            line = format!(
                "{} = {unsigned}{}",
                &line[..at],
                &line[at + 4 + digits.len()..]
            );
        }
    }

    line.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The calls of a report, a call to a line -- but where an argument's
/// text holds a line's end, which carries the call on to the next: a line
/// that does not start as a call does, `MODULE.Name` and then a bracket or
/// a space, nor is the count of calls not kept, is the last call's still.
fn calls_of(report: &str) -> Vec<String> {
    let mut calls: Vec<String> = Vec::new();

    for line in report.lines() {
        let (module, rest) = line.split_once('.').unwrap_or(("", ""));
        let starts = !module.is_empty()
            && module
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
            && rest.find(['(', ' ']).is_some_and(|at| {
                at > 0
                    && rest[..at]
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            });

        match calls.last_mut() {
            Some(last) if !starts && !line.starts_with("... ") => {
                last.push('\n');
                last.push_str(line);
            }
            _ if line.is_empty() => {}
            _ => calls.push(line.to_string()),
        }
    }

    calls
}

/// Whether a line is a call: `MODULE.Name = ...`.
fn is_call(line: &str) -> bool {
    let Some((module, rest)) = line.split_once('.') else {
        return false;
    };

    !module.is_empty()
        && module
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        && rest
            .split_once(' ')
            .is_some_and(|(name, after)| !name.is_empty() && after.starts_with("= "))
}

/// Whether the Rust engine's call is the TypeScript engine's: the same, or
/// both with an address and the Rust engine's with no answer.
fn same(got: &str, want: &str) -> bool {
    if got == want {
        return true;
    }

    if !got.contains(" = @") {
        return false;
    }

    let want = match want.find(" = ") {
        Some(at) => {
            let rest = &want[at + 3..];

            match rest.find(' ') {
                Some(space) if rest[space..].starts_with(" @") => {
                    format!("{}{}", &want[..at], &rest[space..])
                }
                _ => want.to_string(),
            }
        }
        None => want.to_string(),
    };

    got.replacen(" = @", " @", 1) == want
}

/// A program's run, as the trace example is asked for it.
struct Run {
    exe: String,
    path: String,
    /// What drive C: has beneath it: `--windows` and an installation's
    /// folder, or `--assets` and the asset bundle's.
    base: (&'static str, String),
    display: String,
    screen: std::path::PathBuf,
    /// The TypeScript engine's calls.
    calls: usize,
    /// Its seconds on the clock: the survey's ten, and each step's.
    seconds: f64,
    /// Its report, where it pressed keys and kept screens at steps.
    marks: Option<std::path::PathBuf>,
    /// Images mounted beside C:, `D:corpus/cache/<id>/<id>.iso`.
    mounts: Vec<String>,
    /// Started as an install is, Program Manager the shell, with the
    /// oracle's A: and Z: beside C: as the TypeScript engine's run has
    /// them.
    install: bool,
}

/// The trace of a program, as the trace example prints it; what it printed
/// in a minute and twice its seconds, if it had not ended by then.
fn trace(run: &Run) -> String {
    let runner = std::env::var("WINBOX_TRACE")
        .unwrap_or_else(|_| "target/release/examples/trace".to_string());
    let mut words = runner.split_whitespace();
    let mut command = Command::new(words.next().unwrap_or("target/release/examples/trace"));

    command
        .args(words)
        // A program on a disc has no file of the host's: it is read from
        // its drive, by its path.
        .args((!run.exe.is_empty()).then_some(run.exe.as_str()))
        .args([
            "--path",
            &run.path,
            run.base.0,
            &run.base.1,
            "--display",
            &run.display,
            // The survey's boxKeys: Enter at each of three boxes.
            "--boxes",
            "3",
            // As far as the TypeScript engine's run went: its calls, and the
            // frame it was in at its time's end, as far as a frame can take
            // it.
            "--calls",
            &run.calls.to_string(),
            "--seconds",
            &(run.seconds + 0.1).to_string(),
            // Instructions enough for the seconds at the survey's rate.
            "--budget",
            &((run.seconds * 6_000_000.0) as u64).to_string(),
        ])
        .arg("--screen")
        .arg(&run.screen);

    // Its keys pressed and its screens kept where the TypeScript engine's
    // were.
    if let Some(marks) = &run.marks {
        command.arg("--marks").arg(marks);
    }

    for mount in &run.mounts {
        command.arg("--mount").arg(mount);
    }

    if run.install {
        command.arg("--shell").arg("--oracle-drives");
    }

    let Ok(mut child) = command.stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else {
        return String::new();
    };
    let mut stdout = child.stdout.take().expect("the trace's output");
    let reader = std::thread::spawn(move || {
        let mut out = String::new();

        let _ = stdout.read_to_string(&mut out);
        out
    });
    let started = Instant::now();

    while child.try_wait().ok().flatten().is_none() {
        if started.elapsed() > Duration::from_secs_f64(60.0 + run.seconds * 2.0) {
            let _ = child.kill();
            break;
        }

        std::thread::sleep(Duration::from_millis(20));
    }

    let _ = child.wait();

    let out = reader.join().unwrap_or_default();

    // Kept, and how long it took, where asked for.
    if let Some(folder) = kept_out() {
        let id = run
            .screen
            .file_stem()
            .map_or(String::new(), |stem| stem.to_string_lossy().into_owned());

        let _ = std::fs::create_dir_all(&folder);
        let _ = std::fs::write(folder.join(format!("{id}.txt")), &out);
        let _ = std::fs::write(
            folder.join(format!("{id}.ms")),
            format!("{}\n", started.elapsed().as_millis()),
        );
    }

    out
}

/// Where each trace's output is kept, and how long each took
/// (`WINBOX_TRACE_OUT`).
fn kept_out() -> Option<std::path::PathBuf> {
    std::env::var_os("WINBOX_TRACE_OUT").map(std::path::PathBuf::from)
}

/// How long a program is surveyed for, in seconds: its own, else ten, then
/// each step's, three where it gives none.
fn seconds_of(survey: &Survey) -> f64 {
    survey
        .steps
        .iter()
        .fold(survey.seconds.unwrap_or(10.0), |seconds, step| {
            seconds
                + step
                    .split_once(':')
                    .and_then(|(_, seconds)| seconds.parse::<f64>().ok())
                    .unwrap_or(3.0)
        })
}

/// When the TypeScript engine's run came to its last place, in
/// milliseconds: its steps may end past their seconds, where it skipped
/// ahead to a timer, and the run goes on as far as it went.
fn last_place(id: &str) -> f64 {
    std::fs::read_to_string(Path::new("corpus/reports").join(format!("{id}.json")))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|report| {
            report["stepMarks"].as_array().map(|marks| {
                marks
                    .iter()
                    .filter_map(|mark| mark["time"].as_f64())
                    .fold(0.0, f64::max)
            })
        })
        .unwrap_or(0.0)
}

/// Why a trace's run stopped, as it says, shortened.
fn stop_of(out: &str) -> String {
    out.lines()
        .find(|line| line.starts_with("stopped: "))
        .map(|line| line.chars().skip(9).take(66).collect())
        .unwrap_or_default()
}

/// A PNG's pixels as RGB bytes, and its size; none where it cannot be read.
fn pixels_of(file: &Path) -> Option<(u32, u32, Vec<u8>)> {
    let decoder = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(file).ok()?));
    let mut reader = decoder.read_info().ok()?;
    let mut buffer = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buffer).ok()?;
    let bytes = &buffer[..info.buffer_size()];
    let rgb = match info.color_type {
        png::ColorType::Rgb => bytes.to_vec(),
        png::ColorType::Rgba => bytes
            .chunks(4)
            .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
            .collect(),
        _ => return None,
    };

    Some((info.width, info.height, rgb))
}

/// How many pixels of two screens differ: none where either is missing,
/// every pixel where their sizes do.
fn differing(ours: &Path, theirs: &Path) -> Option<usize> {
    let (width, height, ours) = pixels_of(ours)?;
    let (their_width, their_height, theirs) = pixels_of(theirs)?;

    if (width, height) != (their_width, their_height) {
        return Some((width * height) as usize);
    }

    Some(
        ours.chunks(3)
            .zip(theirs.chunks(3))
            .filter(|(a, b)| a != b)
            .count(),
    )
}

/// How many calls the TypeScript engine's run made: those it kept first,
/// those it counted and did not keep, and the last it kept.
fn total_of(want: &[(String, Option<String>)], kept: usize) -> usize {
    let Some(marker) = want.get(kept) else {
        return want.len();
    };
    let skipped: usize = marker
        .0
        .trim_start_matches("... ")
        .split(' ')
        .next()
        .and_then(|count| count.parse().ok())
        .unwrap_or(0);

    want.len() - 1 + skipped
}

/// Whether a run made as many calls as the TypeScript engine's, its last
/// ones the same, and how many it made: past the calls it kept first,
/// the report counts those it did not keep, then keeps the last.
fn whole_run(want: &[(String, Option<String>)], kept: usize, got: &[String]) -> (bool, usize) {
    let total = total_of(want, kept);

    if want.get(kept).is_none() {
        return (got.len() == want.len(), want.len());
    }

    let last = &want[kept + 1..];

    if got.len() != total {
        return (false, total);
    }

    let alike = got[total - last.len()..]
        .iter()
        .zip(last)
        .all(|(got, (line, long))| {
            same(got, line) || long.as_ref().is_some_and(|long| same(got, long))
        });

    (alike, total)
}

/// How a program's screen, and each box of USER's it met, differ from the
/// TypeScript engine's: nothing where they are alike.
fn screen_differences(id: &str, screen: &Path) -> Vec<String> {
    let theirs = |name: String| Path::new("corpus/reports").join(name);
    let mut differences = Vec::new();

    match differing(screen, &theirs(format!("{id}.png"))) {
        Some(0) => {}
        Some(count) => differences.push(format!("screen {count} px")),
        None => differences.push("screen missing".to_string()),
    }

    // A run with steps: the screen after each step, `-2` on.
    for at in 2.. {
        let stem = screen
            .file_stem()
            .map_or(String::new(), |stem| stem.to_string_lossy().into_owned());
        let ours = screen.with_file_name(format!("{stem}-{at}.png"));
        let theirs = theirs(format!("{id}-{at}.png"));

        match (ours.exists(), theirs.exists()) {
            (false, false) => break,
            (true, true) => {
                if let Some(count) = differing(&ours, &theirs).filter(|&count| count > 0) {
                    differences.push(format!("step {at} {count} px"));
                }
            }
            (true, false) => differences.push(format!("step {at} only here")),
            (false, true) => differences.push(format!("step {at} only there")),
        }
    }

    for at in 1..=3 {
        let ours = screen.with_extension(format!("box{at}.png"));
        let theirs = theirs(format!("{id}.box{at}.png"));

        match (ours.exists(), theirs.exists()) {
            (false, false) => break,
            (true, true) => {
                if let Some(count) = differing(&ours, &theirs).filter(|&count| count > 0) {
                    differences.push(format!("box {at} {count} px"));
                }
            }
            (true, false) => differences.push(format!("box {at} only here")),
            (false, true) => differences.push(format!("box {at} only there")),
        }
    }

    differences
}

fn manifest(path: &str) -> Vec<Program> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Manifest>(&text).ok())
        .map(|manifest| manifest.programs)
        .unwrap_or_default()
}

/// What drive C: has beneath it on a display: the oracle's installation
/// for it, or with `assets` the bundle's base.
fn base_of(assets: bool, display: &str) -> (&'static str, String) {
    if assets {
        ("--assets", "oracle/build/assets".to_string())
    } else if display == "vga" {
        ("--windows", "oracle/build/drive-c".to_string())
    } else {
        ("--windows", format!("oracle/build/drive-c-{display}"))
    }
}

/// `--write DIR`: the folder each program's report is written into.
fn write_to() -> Option<std::path::PathBuf> {
    std::env::args()
        .collect::<Vec<_>>()
        .windows(2)
        .find(|pair| pair[0] == "--write")
        .map(|pair| std::path::PathBuf::from(&pair[1]))
}

/// How many calls the survey keeps from a run's start, and from its end,
/// the rest counted between (`survey_test.ts`'s `keepCalls` and tail).
const KEPT_FIRST: usize = 100_000;
const KEPT_LAST: usize = 1_000;

/// A program's report, written as the TypeScript survey writes its own
/// (`test/corpus/survey_test.ts`): `<id>.json`, `<id>.calls.txt`, and its
/// screens, `<id>.png`, `<id>-2.png` on after steps, `<id>.boxN.png`, from
/// the trace's screens in `screens`. The calls are the Rust engine's
/// lines, `MODULE.Name = answer @cs:ip`, which keep no arguments; the
/// TypeScript survey's show them as its argument types decode them. A
/// run's steps' places (`stepMarks`) are what the run was given, the
/// TypeScript report's, kept as it has them. A screen alike pixel for
/// pixel with the report's already there is written as that file, its bytes
/// as they were (PNG encoders differ), so `--write corpus/reports` leaves
/// every unchanged screen unchanged.
fn write_report(dir: &Path, id: &str, title: &str, out: &str, screens: &Path) -> Vec<String> {
    let calls: Vec<&str> = out.lines().filter(|line| is_call(line)).collect();
    let name = |line: &str| line.split([' ', '(']).next().unwrap_or("").to_string();
    let mut functions: Vec<String> = calls.iter().map(|line| name(line)).collect();

    functions.sort();
    functions.dedup();

    let mut stubs: Vec<(String, usize)> = Vec::new();

    for line in calls.iter().filter(|line| line.contains(" stub ")) {
        let called = name(line);

        match stubs.iter_mut().find(|(each, _)| *each == called) {
            Some((_, count)) => *count += 1,
            None => stubs.push((called, 1)),
        }
    }

    let boxes: Vec<std::path::PathBuf> = (1..=3)
        .map(|at| screens.join(format!("{id}.box{at}.png")))
        .take_while(|file| file.exists())
        .collect();
    let ended = out.lines().any(|line| line.starts_with("stopped: Ended"));
    let quoted = |text: &str| serde_json::to_string(text).unwrap();
    let mut json = format!(
        "{{\n \"id\": {},\n \"title\": {},\n \"calls\": {},\n \"functions\": {},\n \"stubs\": ",
        quoted(id),
        quoted(title),
        calls.len(),
        functions.len()
    );

    if stubs.is_empty() {
        json.push_str("{}");
    } else {
        let listed: Vec<String> = stubs
            .iter()
            .map(|(name, count)| format!("\n  {}: {count}", quoted(name)))
            .collect();

        let _ = write!(json, "{{{}\n }}", listed.join(","));
    }

    let last: Vec<String> = calls[calls.len().saturating_sub(15)..]
        .iter()
        .map(|line| format!("\n  {}", quoted(&name(line))))
        .collect();
    let _ = write!(
        json,
        ",\n \"faulted\": {},\n \"ended\": {ended},\n \"failure\": null,\n \"last\": [{}\n ]",
        !boxes.is_empty(),
        last.join(",")
    );

    // The places a run with steps was given, as its TypeScript report has
    // them.
    let theirs = std::fs::read_to_string(Path::new("corpus/reports").join(format!("{id}.json")))
        .unwrap_or_default();

    if let Some(at) = theirs.find(",\n \"stepMarks\": [") {
        let marks = &theirs[at..];
        let end = marks.find("\n ]").map_or(marks.len(), |end| end + 3);

        json.push_str(&marks[..end]);
    }

    json.push_str("\n}\n");

    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(dir.join(format!("{id}.json")), json);

    let kept: Vec<String> = if calls.len() > KEPT_FIRST + KEPT_LAST {
        calls[..KEPT_FIRST]
            .iter()
            .map(|line| (*line).to_string())
            .chain([format!(
                "... {} calls not kept ...",
                calls.len() - KEPT_FIRST - KEPT_LAST
            )])
            .chain(
                calls[calls.len() - KEPT_LAST..]
                    .iter()
                    .map(|line| (*line).to_string()),
            )
            .collect()
    } else {
        calls.iter().map(|line| (*line).to_string()).collect()
    };
    let _ = std::fs::write(dir.join(format!("{id}.calls.txt")), kept.join("\n"));

    write_screens(dir, id, screens)
}

/// A program's screens, from the trace's in `screens`, written into `dir`,
/// and no box an earlier run left there: the files' names. A screen whose
/// pixels are the report's already there is that file, as it was
/// encoded, so that writing the reports afresh changes no screen that has
/// not changed.
fn write_screens(dir: &Path, id: &str, screens: &Path) -> Vec<String> {
    let mut written = Vec::new();

    if let Ok(entries) = std::fs::read_dir(screens) {
        for entry in entries.flatten() {
            let file = entry.file_name().to_string_lossy().into_owned();
            let own = file == format!("{id}.png")
                || (file.starts_with(&format!("{id}-")) && is_png(&file))
                || (file.starts_with(&format!("{id}.box")) && is_png(&file));

            if !own {
                continue;
            }

            let there = Path::new("corpus/reports").join(&file);
            let from = if differing(&entry.path(), &there) == Some(0) {
                there
            } else {
                entry.path()
            };
            let to = dir.join(&file);
            let itself = from
                .canonicalize()
                .ok()
                .is_some_and(|from| to.canonicalize().ok() == Some(from));

            if itself || std::fs::copy(&from, &to).is_ok() {
                written.push(file);
            }
        }
    }

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let file = entry.file_name().to_string_lossy().into_owned();

            if file.starts_with(&format!("{id}.box")) && is_png(&file) && !written.contains(&file) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    written.sort();
    written
}

/// Whether a file's name is a PNG's, as the survey names its screens.
fn is_png(file: &str) -> bool {
    Path::new(file)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
}

/// What `--write` wrote set beside the TypeScript survey's reports
/// (`corpus/reports`): how many files are the same to the byte, and of the
/// rest, the calls alike as the comparison reads them (`normal`, their
/// arguments left out) and the screens alike pixel for pixel.
fn compare_written(dir: &Path, ids: &[(String, Vec<String>)]) {
    let theirs = Path::new("corpus/reports");
    let same = |name: &str| {
        std::fs::read(dir.join(name))
            .ok()
            .is_some_and(|ours| std::fs::read(theirs.join(name)).is_ok_and(|theirs| theirs == ours))
    };
    let (mut json, mut calls, mut calls_alike, mut pngs, mut png_bytes, mut png_pixels) =
        (0, 0, 0, 0, 0, 0);
    let mut apart = Vec::new();

    for (id, screens) in ids {
        if same(&format!("{id}.json")) {
            json += 1;
        } else {
            apart.push(format!("{id}.json"));
        }

        let name = format!("{id}.calls.txt");

        if same(&name) {
            calls += 1;
        }

        let read = |folder: &Path| {
            calls_of(&std::fs::read_to_string(folder.join(&name)).unwrap_or_default())
        };
        let (ours, want) = (read(dir), read(theirs));

        if ours.len() == want.len()
            && ours
                .iter()
                .zip(&want)
                .all(|(got, want)| same_call(&normal(got), want))
        {
            calls_alike += 1;
        } else {
            apart.push(name);
        }

        for screen in screens {
            pngs += 1;

            if same(screen) {
                png_bytes += 1;
            }

            if differing(&dir.join(screen), &theirs.join(screen)) == Some(0) {
                png_pixels += 1;
            } else {
                apart.push(screen.clone());
            }
        }
    }

    println!(
        "written: {} programs; .json the same to the byte {json}; .calls.txt to the byte {calls}, \
         alike without arguments {calls_alike}; screens {pngs}, to the byte {png_bytes}, \
         pixel for pixel {png_pixels}",
        ids.len()
    );

    if !apart.is_empty() {
        println!("written and differing: {}", apart.join(", "));
    }
}

/// Whether a call written here, read as the comparison reads it, is the
/// TypeScript survey's line: the same, or a negative answer it wrote that
/// is the word or the long here (`wanted`), or one with no answer either
/// side.
fn same_call(got: &str, want: &str) -> bool {
    let (word, long) = wanted(want);

    same(got, &word)
        || long.as_ref().is_some_and(|long| same(got, long))
        || same(&word, got)
        || (want.starts_with("... ") && got == normal(want))
}

/// `--base assets`: drive C: has the asset bundle's base beneath it, not
/// the oracle's installation, against the same reports.
fn on_assets() -> bool {
    std::env::args()
        .collect::<Vec<_>>()
        .windows(2)
        .any(|pair| pair[0] == "--base" && pair[1] == "assets")
}

#[allow(clippy::too_many_lines)]
fn main() {
    let assets = on_assets();
    let programs = manifest("corpus/manifest.json")
        .into_iter()
        .chain(manifest("corpus/manifest.local.json"));
    let mut rows = Vec::new();
    let mut agree = 0;
    let mut alike = 0;
    let mut whole_alike = 0;
    let mut compared = 0;
    let screens = std::env::temp_dir().join(format!("winbox-corpus-{}", std::process::id()));
    let write = write_to();
    let mut written = Vec::new();

    std::fs::create_dir_all(&screens).expect("a folder for the screens");

    for program in programs {
        // A program on a disc of its own is read from the disc, not from a
        // file of the host's.
        let image = program.disc.as_ref().map(|_| {
            let kind = program
                .source
                .as_ref()
                .and_then(|source| source.image.clone())
                .unwrap_or_else(|| "iso".to_string());

            format!("corpus/cache/{0}/{0}.{kind}", program.id)
        });
        let exe = match &image {
            Some(_) => String::new(),
            None => format!("corpus/programs/{}/{}", program.id, program.run),
        };
        let report = format!("corpus/reports/{}.calls.txt", program.id);

        if !Path::new(image.as_deref().unwrap_or(&exe)).exists() || !Path::new(&report).exists() {
            continue;
        }

        let want: Vec<(String, Option<String>)> =
            calls_of(&std::fs::read_to_string(&report).unwrap_or_default())
                .iter()
                .map(|line| wanted(line))
                .collect();
        let short: String = program.id.to_ascii_uppercase().chars().take(8).collect();
        let path = if image.is_some() {
            program.run.to_ascii_uppercase()
        } else {
            format!("C:\\CORPUS\\{short}\\{}", program.run.to_ascii_uppercase())
        };
        let survey = program.survey.unwrap_or_default();
        let display = survey.display.clone().unwrap_or_else(|| "vga".to_string());
        let base = base_of(assets, &display);
        let screen = screens.join(format!("{}.png", program.id));
        // The TypeScript engine keeps its first calls and its last, the
        // rest counted between: past its first, there is nothing to compare.
        let kept = want
            .iter()
            .position(|(line, _)| line.starts_with("... ") && line.ends_with(" calls not kept ..."))
            .unwrap_or(want.len());
        let total = total_of(&want, kept);
        let seconds = seconds_of(&survey).max(last_place(&program.id) / 1000.0);
        let out = trace(&Run {
            exe: exe.clone(),
            path: path.clone(),
            base,
            display: display.clone(),
            screen: screen.clone(),
            calls: total,
            seconds,
            marks: (!survey.steps.is_empty())
                .then(|| Path::new("corpus/reports").join(format!("{}.json", program.id))),
            mounts: match (&program.disc, &image) {
                (Some(letter), Some(image)) => vec![format!("{letter}:{image}")],
                _ => Vec::new(),
            },
            install: program.install,
        });
        let got: Vec<String> = out
            .lines()
            .filter(|line| is_call(line))
            .map(normal)
            .collect();

        if let Some(dir) = &write {
            written.push((
                program.id.clone(),
                write_report(dir, &program.id, &program.title, &out, &screens),
            ));
        }
        let mut n = 0;

        // The TypeScript engine's last call may have had no answer by the
        // end of its run: a call it was waiting in, which a run on as far
        // as its frame went has answered.
        while n < got.len()
            && n < kept
            && (same(&got[n], &want[n].0)
                || want[n].1.as_ref().is_some_and(|long| same(&got[n], long))
                || (n + 1 == want.len() && same(&want[n].0, &got[n])))
        {
            n += 1;
        }

        if n == got.len() || (n == kept && kept < want.len()) {
            agree += 1;
        }

        // And the whole run: as many calls as the TypeScript engine's, and
        // its last calls -- those it kept after the ones it counted -- the
        // same.
        let (whole, total) = whole_run(&want, kept, &got);

        if whole {
            whole_alike += 1;
        }

        let stop = stop_of(&out);
        let mut row = format!("{} {n}/{} {stop}", program.id, got.len());

        if !whole {
            let _ = write!(row, " -- of {total} calls");
        }

        if n == kept && kept < want.len() {
            let _ = write!(row, " -- all {kept} it kept");
        } else if n < got.len() {
            let _ = write!(
                row,
                "\n    TS:   {}\n    RUST: {}",
                want.get(n).map_or("", |(line, _)| line.as_str()),
                got[n]
            );
        }

        // The screen it left, and each box as it came up, against the
        // TypeScript engine's.
        let differences = screen_differences(&program.id, &screen);

        compared += 1;

        if differences.is_empty() {
            alike += 1;
        } else {
            let _ = write!(row, "\n    screens: {}", differences.join(", "));
        }

        rows.push(row);
    }

    let _ = std::fs::remove_dir_all(&screens);

    for row in &rows {
        println!("{row}");
    }

    println!("agree to their stop: {agree} of {}", rows.len());
    println!("whole runs alike: {whole_alike} of {}", rows.len());
    println!("screens alike: {alike} of {compared}");

    if assets {
        held_to_list(&rows);
    }

    if let Some(dir) = &write {
        compare_written(dir, &written);
    }
}

/// On the bundle's base, each program that differs held to the list of
/// those that do, with why (`test/oracle/assets-differences.json`): those
/// that differ and are not listed, and those listed that no longer differ.
/// A program differs where its row says more than its calls agreeing to
/// their stop, all of them, and its screens alike: where the calls part,
/// the screens differ (each on a line of its own), or the run is not whole
/// (` -- of `).
fn held_to_list(rows: &[String]) {
    let differing: Vec<String> = rows
        .iter()
        .filter(|row| row.contains('\n') || row.contains(" -- of "))
        .filter_map(|row| row.split(' ').next().map(str::to_string))
        .collect();
    let listed: serde_json::Value = std::fs::read_to_string("test/oracle/assets-differences.json")
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let listed = listed["corpus"].as_object().cloned().unwrap_or_default();
    let ran: Vec<&str> = rows
        .iter()
        .filter_map(|row| row.split(' ').next())
        .collect();
    let unlisted: Vec<&String> = differing
        .iter()
        .filter(|id| !listed.contains_key(id.as_str()))
        .collect();
    let gone: Vec<&String> = listed
        .keys()
        .filter(|id| ran.contains(&id.as_str()) && !differing.contains(id))
        .collect();

    println!(
        "differing on the bundle's base: {} of {}, not listed: {unlisted:?}, listed and alike: {gone:?}",
        differing.len(),
        rows.len()
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_string_with_a_line_break_runs_its_call_on() {
        let report = "USER._WSPRINTF(1, Player %d\nWon $%d, 2) = 27 @f:2\nGDI.X() = 1 @f:3\n";

        assert_eq!(
            calls_of(report),
            vec![
                "USER._WSPRINTF(1, Player %d\nWon $%d, 2) = 27 @f:2",
                "GDI.X() = 1 @f:3"
            ]
        );
        assert_eq!(normal(&calls_of(report)[0]), "USER._WSPRINTF = 27 @f:2");
    }

    #[test]
    fn reads_a_call_as_the_comparison_does() {
        assert_eq!(
            normal("GDI.GetObject(1, 2) = -1 @f:2"),
            "GDI.GetObject = 65535 @f:2"
        );
        assert_eq!(
            normal("KERNEL.X() = -40000 @f:2"),
            "KERNEL.X = 4294927296 @f:2"
        );
        assert!(is_call("USER.GetDC = 1 @f:1"));
        assert!(!is_call("stopped: Ended"));
        assert!(same(
            "USER.UpdateWindow = @f:11f",
            "USER.UpdateWindow = @f:11f"
        ));
        assert!(same("USER.X = @f:1", "USER.X = 5 @f:1"));
        assert_eq!(
            wanted("GDI.SetPixel(0, 1, 2, 3) = -1 @17:729"),
            (
                "GDI.SetPixel = 65535 @17:729".to_string(),
                Some("GDI.SetPixel = 4294967295 @17:729".to_string())
            )
        );
        assert_eq!(wanted("GDI.X() = 5 @1:2").1, None);
        assert_eq!(
            calls_of("GDI.A({f:p\nq}) = 3 @1:2\n... 5 calls not kept ...\nUSER.B = 1 @1:3\n"),
            [
                "GDI.A({f:p\nq}) = 3 @1:2",
                "... 5 calls not kept ...",
                "USER.B = 1 @1:3"
            ]
        );
        assert_eq!(
            normal(&calls_of("GDI.A({f:p\nq}) = 3 @1:2")[0]),
            "GDI.A = 3 @1:2"
        );
    }
}
