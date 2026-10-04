//! The corpus run on the Rust engine and its calls compared with the
//! TypeScript engine's, as the survey recorded them: for each program, how
//! many of the Rust engine's calls agree with the TypeScript engine's in
//! order, up to where the Rust engine stopped, and why it stopped. A program
//! agrees to its stop when every call it made is the TypeScript engine's.
//!
//! `cargo build --release -p winbox-win16 --example trace --example corpus`
//! then `target/release/examples/corpus`, from the repository's root, with
//! the corpus's programs and reports and the oracle's installations there.

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

#[derive(Deserialize)]
struct Survey {
    #[serde(default)]
    display: Option<String>,
}

/// A call as the comparison reads it: its arguments left out, a negative
/// answer read as the unsigned word or long it was, and its spaces as one.
fn normal(line: &str) -> String {
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
            let unsigned = if value < -32768 {
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

/// The trace of a program, as the trace example prints it; what it printed
/// in a minute, if it had not ended by then.
fn trace(exe: &str, path: &str, windows: &str, display: &str) -> String {
    let Ok(mut child) = Command::new("target/release/examples/trace")
        .args([
            exe,
            "--path",
            path,
            "--windows",
            windows,
            "--display",
            display,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
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
        if started.elapsed() > Duration::from_mins(1) {
            let _ = child.kill();
            break;
        }

        std::thread::sleep(Duration::from_millis(20));
    }

    let _ = child.wait();
    reader.join().unwrap_or_default()
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

    for program in programs {
        let exe = format!("corpus/programs/{}/{}", program.id, program.run);
        let report = format!("corpus/reports/{}.calls.txt", program.id);

        if !Path::new(&exe).exists() || !Path::new(&report).exists() {
            continue;
        }

        let want: Vec<String> = std::fs::read_to_string(&report)
            .unwrap_or_default()
            .lines()
            .filter(|line| !line.is_empty())
            .map(normal)
            .collect();
        let short: String = program.id.to_ascii_uppercase().chars().take(8).collect();
        let path = format!("C:\\CORPUS\\{short}\\{}", program.run.to_ascii_uppercase());
        let display = program
            .survey
            .and_then(|survey| survey.display)
            .unwrap_or_else(|| "vga".to_string());
        let windows = if display == "vga" {
            "oracle/build/drive-c".to_string()
        } else {
            format!("oracle/build/drive-c-{display}")
        };
        let out = trace(&exe, &path, &windows, &display);
        let got: Vec<String> = out
            .lines()
            .filter(|line| is_call(line))
            .map(normal)
            .collect();
        let mut n = 0;

        while n < got.len() && n < want.len() && same(&got[n], &want[n]) {
            n += 1;
        }

        if n == got.len() {
            agree += 1;
        }

        let stop: String = out
            .lines()
            .find(|line| line.starts_with("stopped: "))
            .map(|line| line.chars().skip(9).take(66).collect())
            .unwrap_or_default();
        let mut row = format!("{} {n}/{} {stop}", program.id, got.len());

        if n < got.len() {
            let _ = write!(
                row,
                "\n    TS:   {}\n    RUST: {}",
                want.get(n).map_or("", String::as_str),
                got[n]
            );
        }

        rows.push(row);
    }

    for row in &rows {
        println!("{row}");
    }

    println!("agree to their stop: {agree} of {}", rows.len());
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }
}
