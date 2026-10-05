//! A program's run as the corpus's survey makes it, whoever makes it: the
//! trace example on a host's files, a browser's page, the tests. The keys
//! a TypeScript engine's survey report says it pressed, pressed where it
//! did (`stepMarks`); made-up keys and clicks after them (`scripted_input`);
//! USER's boxes that let no program run answered with Enter, each kept as
//! it came up; and each call the program made printed as it was answered,
//! with why the run stopped and where (`print_trace`).
//!
//! Nothing here reads or writes a host's files: the program's drives are
//! mounted, and its report read, by whoever runs it.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::fmt::Write as _;
use std::rc::Rc;

use winbox_cpu::Exit;
use winbox_ne::Executable;

use crate::call::Stop;
use crate::call_marks::{CallMark, MarkAction};
use crate::engine::Engine;
use crate::key_input::Key;
use crate::raster_input::{Pointer, PointerKind};
use crate::sys_error_box::{BoxHand, BoxInput};
use crate::system::System;

const VK_RETURN: u16 = 0x0d;

/// What a survey's run is asked for.
#[derive(Debug, Clone)]
pub struct Survey {
    /// The display, as winbox.js names it (`vga`, `ega`, `vga256` ...).
    pub display: String,
    /// The seconds on the clock the run may take: the survey's ten.
    pub seconds: f64,
    /// The instructions the run may take.
    pub budget: u64,
    /// The run stopped as the program makes its call after this many,
    /// where it has not stopped before.
    pub calls: Option<usize>,
    /// Up to how many of USER's boxes that let no program run are answered
    /// with Enter.
    pub boxes: usize,
    /// A TypeScript engine's survey report, its text: its keys pressed and
    /// its screens kept where it did (`stepMarks`).
    pub marks: Option<String>,
    /// Made-up keys and clicks, the same for the same seed
    /// (`scripted_input`); given with `marks`, only after the report's
    /// last key, and the report's screens not kept.
    pub input: Option<u64>,
    /// How many calls there were and only the last twenty printed.
    pub summary: bool,
    /// The instructions run at each call printed beside it, to set beside
    /// the TypeScript engine's where the two clocks part.
    pub counts: bool,
    /// The screens kept: where the run left it, or at the report's marks.
    pub screens: bool,
}

impl Default for Survey {
    fn default() -> Self {
        Self {
            display: "vga".to_string(),
            // The survey's ten seconds on the clock.
            seconds: 10.0,
            budget: 100_000_000,
            calls: None,
            boxes: 0,
            marks: None,
            input: None,
            summary: false,
            counts: false,
            screens: false,
        }
    }
}

/// A screen kept: its palette indices, and the colour each index showed as
/// then.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Screen {
    pub width: usize,
    pub height: usize,
    pub indices: Vec<u8>,
    /// A word `0x00RRGGBB` an index.
    pub colours: Vec<u32>,
}

impl Screen {
    /// Its pixels as the colours they showed, a word `0x00RRGGBB` a pixel,
    /// row by row: black for an index past the palette.
    pub fn rgb(&self) -> Vec<u32> {
        self.indices
            .iter()
            .map(|&index| self.colours.get(usize::from(index)).copied().unwrap_or(0))
            .collect()
    }

    /// The screen's pixels as they are, with no cursor over them, as the
    /// TypeScript engine's survey keeps a box of USER's as it comes up;
    /// none before there is a screen.
    pub fn bare(system: &System) -> Option<Self> {
        let screen = system.screen.as_ref()?;

        Some(Self {
            width: screen.width() as usize,
            height: screen.height() as usize,
            indices: screen.indices.borrow().clone(),
            colours: system.shown_lookup(screen),
        })
    }

    /// Palette indices of the screen's as a host shows them now, the
    /// cursor over them, in the colours it shows now.
    pub fn shown(system: &mut System, indices: &[u8]) -> Self {
        let screen = system.screen_bitmap();
        let (width, height) = (screen.width() as usize, screen.height() as usize);

        Self {
            width,
            height,
            indices: system.with_cursor(indices, width, height),
            colours: system.shown_lookup(&screen),
        }
    }
}

/// The run's end: why it stopped, what it printed, and what it kept.
pub struct Surveyed {
    pub stop: Stop,
    /// Each call the program made, and why the run stopped and where
    /// (`print_trace`).
    pub report: String,
    /// Where `screens` was asked for, the screen as the run left it, the
    /// cursor over it; or, where screens were kept at marks, each of those,
    /// with the cursor and the colours as the run ended.
    pub screens: Vec<Screen>,
    /// Each box of USER's answered, as it came up.
    pub boxes: Vec<Screen>,
    pub system: System,
}

impl std::fmt::Debug for Surveyed {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Surveyed")
            .field("stop", &self.stop)
            .field("report", &self.report)
            .field("screens", &self.screens.len())
            .field("boxes", &self.boxes.len())
            .finish_non_exhaustive()
    }
}

/// A run made ready, to be run (`Survey::finish` after it).
#[derive(Debug)]
pub struct Prepared {
    boxes: Rc<RefCell<Vec<Option<Screen>>>>,
}

/// The program loaded from `path`, as DOS names it, linked and made ready
/// to run, started in its own folder, as Program Manager starts a program
/// whose item's working directory is where the program is. Its drives are
/// mounted first, and the display set (`Survey::system`).
///
/// # Errors
///
/// Where the program's registers cannot be set.
pub fn start(system: &mut System, executable: Executable, path: &str) -> Result<(), Exit> {
    let (program, libraries) = system.load(executable, path);

    system.link(program);
    system.start(program, libraries, "")?;

    if let Some((folder, _)) = path.rsplit_once('\\')
        && folder.len() > 2
    {
        system.files.set_path(folder);
    }

    Ok(())
}

impl Survey {
    /// A system on the display asked for; none where winbox.js knows no
    /// such display.
    pub fn system(&self) -> Option<System> {
        let mut system = System::new();

        system.display = crate::display::mode(&self.display)?;
        Some(system)
    }

    /// A started program's run made ready: its calls logged, the report's
    /// marks and the made-up input set, USER's boxes answered.
    pub fn prepare(&self, system: &mut System) -> Prepared {
        system.log = Some(Vec::new());
        system.calls_until = self.calls;

        if let Some(marks) = &self.marks {
            system.call_marks.marks = marks_of(marks);
        }

        // Made up from two seconds in, or after the report's keys: what the
        // corpus's steps answer (SimTower's question of sound) answered so.
        if let Some(seed) = self.input {
            let size = (system.display.width, system.display.height);
            let marks = &mut system.call_marks.marks;

            marks.retain(|mark| !matches!(mark.action, MarkAction::Shot));

            let from = marks.back().map_or(2000.0, |mark| mark.time + 1500.0);

            marks.extend(scripted_input(seed, from, self.seconds, size));
        }

        Prepared {
            boxes: answer_boxes(system, self.boxes),
        }
    }

    /// The run ended: its screens kept, where asked for, and its trace.
    pub fn finish(&self, mut system: System, stop: Stop, prepared: &Prepared) -> Surveyed {
        let mut screens = Vec::new();

        if self.screens {
            let kept = std::mem::take(&mut system.call_marks.shots);

            if kept.is_empty() {
                let screen = system.screen_bitmap();
                let indices = screen.indices.borrow().clone();

                screens.push(Screen::shown(&mut system, &indices));
            }

            for indices in &kept {
                screens.push(Screen::shown(&mut system, indices));
            }
        }

        let boxes = prepared.boxes.borrow_mut().drain(..).flatten().collect();

        Surveyed {
            report: print_trace(&system, &stop, self.summary, self.counts),
            stop,
            screens,
            boxes,
            system,
        }
    }

    /// A started program run as asked, to its end.
    pub fn run(&self, mut system: System) -> Surveyed {
        let prepared = self.prepare(&mut system);
        let engine = Engine::new(system);
        let stop = engine.run(self.budget, self.seconds);

        self.finish(engine.into_system(), stop, &prepared)
    }
}

/// A step of a hand at the box: a key pressed and released, the left button
/// pressed and released at a point of the screen, or the screen taken.
#[derive(Debug, Clone, Copy)]
pub enum Step {
    Key(u16),
    Click(i16, i16),
    Shoot,
}

/// A hand that, as each box comes up, takes the screen and then does the
/// next list of steps in turn; the screens taken, as `shoot` makes of them.
pub fn hand<T: 'static>(
    boxes: Vec<Vec<Step>>,
    shoot: impl Fn(&System) -> T + 'static,
) -> (BoxHand, Rc<RefCell<Vec<T>>>) {
    let shots = Rc::new(RefCell::new(Vec::new()));
    let taken = Rc::clone(&shots);
    let mut boxes: VecDeque<Vec<Step>> = boxes.into();
    let mut steps = VecDeque::new();
    let mut released = None;

    let hand = BoxHand(Box::new(move |system: &System, shown: bool| {
        if shown {
            steps = boxes.pop_front().unwrap_or_default().into();
            taken.borrow_mut().push(shoot(system));
        }

        if let Some(up) = released.take() {
            return Some(BoxInput::Pointer(up));
        }

        loop {
            match steps.pop_front()? {
                Step::Key(key) => return Some(BoxInput::Key(key)),
                Step::Click(x, y) => {
                    let press = |kind, buttons| Pointer {
                        kind,
                        x,
                        y,
                        button: 0,
                        buttons,
                        double: false,
                    };

                    released = Some(press(PointerKind::Up, 0));
                    return Some(BoxInput::Pointer(press(PointerKind::Down, 1)));
                }
                Step::Shoot => taken.borrow_mut().push(shoot(system)),
            }
        }
    }));

    (hand, shots)
}

/// USER's boxes that let no program run, up to `boxes` of them, answered
/// with Enter as they come up, each kept as it came up, as the TypeScript
/// engine's survey answers and keeps them (`boxKeys`): none kept before
/// there is a screen.
fn answer_boxes(system: &mut System, boxes: usize) -> Rc<RefCell<Vec<Option<Screen>>>> {
    if boxes == 0 {
        return Rc::default();
    }

    let (hand, shots) = hand(vec![vec![Step::Key(VK_RETURN)]; boxes], Screen::bare);

    system.box_hand = Some(hand);
    shots
}

/// Each call the program made, as it was answered, and why the run
/// stopped and where: with `summary`, how many there were and only the
/// last twenty; with `counts`, the instructions run at each.
pub fn print_trace(system: &System, stop: &Stop, summary: bool, counts: bool) -> String {
    let mut out = String::new();
    let log = system.log.as_deref().unwrap_or_default();
    let shown = if summary {
        let _ = writeln!(out, "calls: {}", log.len());
        let _ = writeln!(out, "clock: {} ms", system.clock.now(system.instructions));
        &log[log.len().saturating_sub(20)..]
    } else {
        log
    };

    for call in shown {
        let result = call.result.map_or(String::new(), |value| value.to_string());
        let stub = if call.stub { " stub" } else { "" };
        let counted = if counts {
            format!(" #{}", call.instructions)
        } else {
            String::new()
        };

        let _ = writeln!(
            out,
            "{}.{} = {}{stub} @{:x}:{:x}{counted}",
            call.module, call.name, result, call.caller.0, call.caller.1
        );
    }

    let _ = writeln!(
        out,
        "stopped: {stop:?} after {} instructions, AX={:04x} at {:04x}:{:04x}",
        system.instructions,
        system.cpu.regs[winbox_cpu::AX],
        system.cpu.segments[winbox_cpu::CS].selector,
        system.cpu.ip
    );

    for fault in &system.application_faults {
        let _ = writeln!(out, "application fault: {fault}");
    }

    if !system.unanswered_dos.is_empty() {
        let _ = writeln!(
            out,
            "DOS functions not answered: {:04x?}",
            system.unanswered_dos
        );
    }

    let at = system.cpu.segments[winbox_cpu::CS].base + u32::from(system.cpu.ip);

    let _ = writeln!(out, "bytes: {:02x?}", system.cpu.bus.read(at, 8));

    // The segment registers and the general ones, where it stopped.
    let names = ["ES", "CS", "SS", "DS", "FS", "GS"];
    let segments: Vec<String> = names
        .iter()
        .enumerate()
        .map(|(index, name)| format!("{name}={:04x}", system.cpu.segments[index].selector))
        .collect();
    let registers: Vec<String> = ["AX", "CX", "DX", "BX", "SP", "BP", "SI", "DI"]
        .iter()
        .enumerate()
        .map(|(index, name)| format!("{name}={:04x}", system.cpu.regs[index]))
        .collect();

    let _ = writeln!(
        out,
        "registers: {} {}",
        segments.join(" "),
        registers.join(" ")
    );
    out
}

/// The keys a TypeScript engine's survey report says it pressed, and the
/// screens it took, each where it did (`stepMarks`): the calls made by
/// then. A key's message has the time it had there. None where the text
/// is not a report.
pub fn marks_of(report: &str) -> VecDeque<CallMark> {
    let report: serde_json::Value = serde_json::from_str(report).unwrap_or_default();
    let mut marks = VecDeque::new();

    for mark in report["stepMarks"].as_array().into_iter().flatten() {
        let calls = mark["calls"].as_u64().unwrap_or(0) as usize;
        let instructions = mark["instructions"].as_u64().unwrap_or(0);
        let action = match (mark["key"].as_str(), mark["code"].as_str()) {
            (Some(key), Some(code)) => MarkAction::Key {
                down: mark["kind"].as_str() == Some("down"),
                key: Key {
                    code: code.to_string(),
                    key: key.to_string(),
                    repeat: false,
                    alt: false,
                },
                time: mark["time"].as_f64().unwrap_or(0.0) as u32,
            },
            _ => MarkAction::Shot,
        };

        marks.push_back(CallMark {
            instructions,
            calls,
            time: mark["time"].as_f64().unwrap_or(0.0),
            action,
        });
    }

    marks
}

/// What a person might do, made up the same way for the same seed: from
/// `from` milliseconds of the clock, every second and a half, a key pressed
/// and let go -- Enter, Space, Escape, Tab, an arrow or a letter -- or the
/// left button pressed and let go at a point of the screen, the mouse moved
/// there first. Not any recorded person's: for finding what a longer run
/// meets.
pub fn scripted_input(
    seed: u64,
    from: f64,
    seconds: f64,
    (width, height): (i16, i16),
) -> VecDeque<CallMark> {
    const KEYS: &[(&str, &str)] = &[
        ("Enter", "\r"),
        ("Space", " "),
        ("Escape", ""),
        ("Tab", "\t"),
        ("ArrowUp", ""),
        ("ArrowDown", ""),
        ("ArrowLeft", ""),
        ("ArrowRight", ""),
        ("KeyA", "a"),
        ("KeyN", "n"),
        ("KeyY", "y"),
        ("Digit1", "1"),
    ];
    let mut state = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
    let mut next = |below: u64| {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (state >> 33) % below.max(1)
    };
    let mark = |time: f64, action: MarkAction| CallMark {
        instructions: 0,
        calls: 0,
        time,
        action,
    };
    let pointer = |kind: PointerKind, x: i16, y: i16, buttons: u8| Pointer {
        kind,
        x,
        y,
        button: 0,
        buttons,
        double: false,
    };
    let mut marks = VecDeque::new();
    let mut time = from;

    while time < seconds * 1000.0 {
        if next(2) == 0 {
            let (code, text) = KEYS[next(KEYS.len() as u64) as usize];
            let key = Key {
                code: code.to_string(),
                key: text.to_string(),
                repeat: false,
                alt: false,
            };

            marks.push_back(mark(
                time,
                MarkAction::Key {
                    down: true,
                    key: key.clone(),
                    time: time as u32,
                },
            ));
            marks.push_back(mark(
                time + 50.0,
                MarkAction::Key {
                    down: false,
                    key,
                    time: (time + 50.0) as u32,
                },
            ));
        } else {
            let x = next(width.max(1) as u64) as i16;
            let y = next(height.max(1) as u64) as i16;

            marks.push_back(mark(
                time,
                MarkAction::Pointer(pointer(PointerKind::Move, x, y, 0)),
            ));
            marks.push_back(mark(
                time + 50.0,
                MarkAction::Pointer(pointer(PointerKind::Down, x, y, 1)),
            ));
            marks.push_back(mark(
                time + 150.0,
                MarkAction::Pointer(pointer(PointerKind::Up, x, y, 0)),
            ));
        }

        time += 1500.0;
    }

    marks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reports_marks_read_from_its_text() {
        let report = r#"{"stepMarks": [
            {"calls": 3, "instructions": 900, "time": 2500.5, "kind": "down", "key": "a", "code": "KeyA"},
            {"calls": 4, "instructions": 1200, "time": 2600}
        ]}"#;
        let marks = marks_of(report);

        assert_eq!(marks.len(), 2);
        assert_eq!((marks[0].calls, marks[0].instructions), (3, 900));
        assert!(matches!(
            &marks[0].action,
            MarkAction::Key { down: true, key, time: 2500 } if key.code == "KeyA"
        ));
        assert!(matches!(marks[1].action, MarkAction::Shot));
        assert!(marks_of("not a report").is_empty());
    }

    #[test]
    fn the_same_seed_makes_the_same_input() {
        let one = scripted_input(3, 2000.0, 10.0, (640, 480));
        let two = scripted_input(3, 2000.0, 10.0, (640, 480));

        assert!(!one.is_empty());
        assert_eq!(format!("{one:?}"), format!("{two:?}"));
        assert!(one.iter().all(|mark| mark.time >= 2000.0));
    }
}
