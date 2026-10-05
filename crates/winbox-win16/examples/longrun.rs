//! The corpus run long, with made-up input, to find what its programs meet
//! past the ten seconds the corpus comparison holds them to: each program
//! run on the trace example for minutes of its clock, given keys and clicks
//! (`trace --input`), USER's boxes answered; how far each got, why it
//! stopped, and its last calls, the stops gathered by their reason.
//!
//! `cargo build --release -p winbox-win16 --example trace --example longrun`
//! then `target/release/examples/longrun [--seconds 180] [--seed 1] [--jobs
//! 6] [--out DIR] [ID ...]`, from the repository's root, with the corpus's
//! programs and the oracle's installations there. Each program's last
//! screen is saved in `DIR` (a folder in the system's temporary directory
//! by default) as `<id>.png`.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;

#[derive(Deserialize)]
struct Manifest {
    programs: Vec<Program>,
}

#[derive(Deserialize, Clone)]
struct Program {
    id: String,
    run: String,
    #[serde(default)]
    survey: Option<Survey>,
}

#[derive(Deserialize, Default, Clone)]
struct Survey {
    #[serde(default)]
    display: Option<String>,
}

/// What a program's long run came to.
struct Outcome {
    id: String,
    /// Why it stopped, as the trace says, up to its count of instructions.
    stop: String,
    calls: String,
    clock: String,
    /// Its last calls, the last first.
    last: Vec<String>,
}

fn manifest(path: &str) -> Vec<Program> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Manifest>(&text).ok())
        .map(|manifest| manifest.programs)
        .unwrap_or_default()
}

/// A program run long on the trace example: what it printed, or nothing
/// where it could not be started; ended where it ran past twenty minutes
/// of the host's time.
fn run(program: &Program, seconds: f64, seed: u64, out: &Path) -> String {
    let short: String = program.id.to_ascii_uppercase().chars().take(8).collect();
    let display = program
        .survey
        .clone()
        .unwrap_or_default()
        .display
        .unwrap_or_else(|| "vga".to_string());
    let windows = if display == "vga" {
        "oracle/build/drive-c".to_string()
    } else {
        format!("oracle/build/drive-c-{display}")
    };
    let Ok(mut child) = Command::new("target/release/examples/trace")
        .arg(format!("corpus/programs/{}/{}", program.id, program.run))
        .args(["--path"])
        .arg(format!(
            "C:\\CORPUS\\{short}\\{}",
            program.run.to_ascii_uppercase()
        ))
        .args(["--windows", &windows, "--display", &display])
        .args(["--seconds", &seconds.to_string()])
        .args(["--budget", &((seconds * 20_000_000.0) as u64).to_string()])
        .args(["--input", &seed.to_string(), "--boxes", "50", "--summary"])
        .arg("--screen")
        .arg(out.join(format!("{}.png", program.id)))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return String::new();
    };
    let mut stdout = child.stdout.take().expect("the trace's output");
    let reader = std::thread::spawn(move || {
        let mut text = String::new();

        let _ = stdout.read_to_string(&mut text);
        text
    });
    let started = Instant::now();

    while child.try_wait().ok().flatten().is_none() {
        if started.elapsed() > Duration::from_mins(20) {
            let _ = child.kill();
            break;
        }

        std::thread::sleep(Duration::from_millis(100));
    }

    let _ = child.wait();
    reader.join().unwrap_or_default()
}

fn outcome(id: &str, text: &str) -> Outcome {
    let field = |prefix: &str| {
        text.lines()
            .find_map(|line| line.strip_prefix(prefix))
            .unwrap_or("?")
            .to_string()
    };
    let stop = text
        .lines()
        .find_map(|line| line.strip_prefix("stopped: "))
        .map_or_else(
            || "no answer from the trace (crashed, or past twenty minutes)".to_string(),
            |line| line.split(" after ").next().unwrap_or(line).to_string(),
        );
    let calls: Vec<&str> = text
        .lines()
        .filter(|line| line.contains(" = ") && line.contains(" @"))
        .collect();

    Outcome {
        id: id.to_string(),
        stop,
        calls: field("calls: "),
        clock: field("clock: "),
        last: calls
            .iter()
            .rev()
            .take(5)
            .map(|line| (*line).to_string())
            .collect(),
    }
}

/// A number from the command line, or what it was without one.
fn parsed<T: std::str::FromStr>(text: Option<String>, default: T) -> T {
    text.and_then(|text| text.parse().ok()).unwrap_or(default)
}

fn main() {
    let mut arguments = std::env::args().skip(1);
    let mut seconds = 180.0;
    let mut seed = 1;
    let mut jobs = 6;
    let mut out = std::env::temp_dir().join(format!("winbox-longrun-{}", std::process::id()));
    let mut ids = Vec::new();

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--seconds" => seconds = parsed(arguments.next(), seconds),
            "--seed" => seed = parsed(arguments.next(), seed),
            "--jobs" => jobs = parsed(arguments.next(), jobs),
            "--out" => out = arguments.next().map_or(out, PathBuf::from),
            _ => ids.push(argument),
        }
    }

    std::fs::create_dir_all(&out).expect("a folder for the screens");

    let programs: Vec<Program> = manifest("corpus/manifest.json")
        .into_iter()
        .chain(manifest("corpus/manifest.local.json"))
        .filter(|program| ids.is_empty() || ids.contains(&program.id))
        .filter(|program| {
            Path::new(&format!("corpus/programs/{}/{}", program.id, program.run)).exists()
        })
        .collect();
    let queue = Arc::new(Mutex::new(programs.clone()));
    let outcomes = Arc::new(Mutex::new(Vec::new()));
    let workers: Vec<_> = (0..jobs.max(1))
        .map(|_| {
            let queue = Arc::clone(&queue);
            let outcomes = Arc::clone(&outcomes);
            let out = out.clone();

            std::thread::spawn(move || {
                loop {
                    let Some(program) = queue.lock().expect("the queue").pop() else {
                        break;
                    };
                    let text = run(&program, seconds, seed, &out);

                    eprintln!("{} done", program.id);
                    outcomes
                        .lock()
                        .expect("the outcomes")
                        .push(outcome(&program.id, &text));
                }
            })
        })
        .collect();

    for worker in workers {
        let _ = worker.join();
    }

    let mut outcomes = Arc::try_unwrap(outcomes)
        .ok()
        .and_then(|outcomes| outcomes.into_inner().ok())
        .unwrap_or_default();

    outcomes.sort_by(|a, b| a.id.cmp(&b.id));

    for outcome in &outcomes {
        println!(
            "{:10} {:>9} calls {:>10} -- {}",
            outcome.id, outcome.calls, outcome.clock, outcome.stop
        );
    }

    // The stops, gathered by their reason; running out of time is getting
    // through.
    let mut stops: BTreeMap<&str, Vec<&Outcome>> = BTreeMap::new();

    for outcome in &outcomes {
        if outcome.stop != "Time" {
            stops.entry(&outcome.stop).or_default().push(outcome);
        }
    }

    println!(
        "\n{} of {} ran their {seconds} seconds; screens in {}",
        outcomes.len() - stops.values().map(Vec::len).sum::<usize>(),
        outcomes.len(),
        out.display()
    );

    for (stop, outcomes) in &stops {
        println!("\n{stop}:");

        for outcome in outcomes {
            println!(
                "  {} at {}, after {} calls",
                outcome.id, outcome.clock, outcome.calls
            );

            for call in &outcome.last {
                println!("      {call}");
            }
        }
    }
}
