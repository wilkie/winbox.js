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
    run: String,
    #[serde(default)]
    survey: Option<Survey>,
}

#[derive(Deserialize, Default)]
struct Survey {
    #[serde(default)]
    display: Option<String>,
    /// Keys pressed at set times after the main run.
    #[serde(default)]
    steps: Vec<String>,
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
    windows: String,
    display: String,
    screen: std::path::PathBuf,
    /// The TypeScript engine's calls.
    calls: usize,
    /// Its seconds on the clock: the survey's ten, and each step's.
    seconds: f64,
    /// Its report, where it pressed keys and kept screens at steps.
    marks: Option<std::path::PathBuf>,
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
        .args([
            run.exe.as_str(),
            "--path",
            &run.path,
            "--windows",
            &run.windows,
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

/// How long a program is surveyed for, in seconds: ten, then each step's,
/// three where it gives none.
fn seconds_of(survey: &Survey) -> f64 {
    survey.steps.iter().fold(10.0, |seconds, step| {
        seconds
            + step
                .split_once(':')
                .and_then(|(_, seconds)| seconds.parse::<f64>().ok())
                .unwrap_or(3.0)
    })
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

fn main() {
    let programs = manifest("corpus/manifest.json")
        .into_iter()
        .chain(manifest("corpus/manifest.local.json"));
    let mut rows = Vec::new();
    let mut agree = 0;
    let mut alike = 0;
    let mut whole_alike = 0;
    let mut compared = 0;
    let screens = std::env::temp_dir().join(format!("winbox-corpus-{}", std::process::id()));

    std::fs::create_dir_all(&screens).expect("a folder for the screens");

    for program in programs {
        let exe = format!("corpus/programs/{}/{}", program.id, program.run);
        let report = format!("corpus/reports/{}.calls.txt", program.id);

        if !Path::new(&exe).exists() || !Path::new(&report).exists() {
            continue;
        }

        let want: Vec<(String, Option<String>)> =
            calls_of(&std::fs::read_to_string(&report).unwrap_or_default())
                .iter()
                .map(|line| wanted(line))
                .collect();
        let short: String = program.id.to_ascii_uppercase().chars().take(8).collect();
        let path = format!("C:\\CORPUS\\{short}\\{}", program.run.to_ascii_uppercase());
        let survey = program.survey.unwrap_or_default();
        let display = survey.display.clone().unwrap_or_else(|| "vga".to_string());
        let windows = if display == "vga" {
            "oracle/build/drive-c".to_string()
        } else {
            format!("oracle/build/drive-c-{display}")
        };
        let screen = screens.join(format!("{}.png", program.id));
        // The TypeScript engine keeps its first calls and its last, the
        // rest counted between: past its first, there is nothing to compare.
        let kept = want
            .iter()
            .position(|(line, _)| line.starts_with("... ") && line.ends_with(" calls not kept ..."))
            .unwrap_or(want.len());
        let total = total_of(&want, kept);
        let seconds = seconds_of(&survey);
        let out = trace(&Run {
            exe: exe.clone(),
            path: path.clone(),
            windows: windows.clone(),
            display: display.clone(),
            screen: screen.clone(),
            calls: total,
            seconds,
            marks: (!survey.steps.is_empty())
                .then(|| Path::new("corpus/reports").join(format!("{}.json", program.id))),
        });
        let got: Vec<String> = out
            .lines()
            .filter(|line| is_call(line))
            .map(normal)
            .collect();
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
