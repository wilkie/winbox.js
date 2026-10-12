//! `--script FILE`: what a run is to do at what time, for trying seamless
//! mode without a hand on the mouse. A line is a time in seconds from the
//! start and a step; `#` starts a remark.
//!
//! - `move X Y`, `press X Y`, `release X Y`, `click X Y`: the pointer, at a
//!   point of the emulated screen, as though the host's pointer were there
//!   (the left button).
//! - `key CODE`, `down CODE`, `up CODE`: a key pressed and let go, or one
//!   of the two, named as a page names it (`KeyN`, `Escape`, `AltLeft`).
//! - `drag X Y DX DY`: a press at X, Y and, when the engine hands the drag
//!   to the host, the host's window moved -- or sized, where the press is
//!   on the frame -- by DX, DY of the screen's pixels, as the host's drag
//!   would leave it, and the button let go. What the host's own drag does
//!   between is not tried.
//! - `minimize TITLE`, `restore TITLE`, `activate TITLE`: the host's
//!   window with that title minimized, restored or brought forward by the
//!   host's own calls, as its task bar does.
//! - `shots NAME`: `--seamless-shots` saved now, into a folder `NAME`.
//! - `quit`.

use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    Move(i16, i16),
    Press(i16, i16),
    Release(i16, i16),
    Click(i16, i16),
    Key(String),
    Down(String),
    Up(String),
    Drag(i16, i16, i32, i32),
    Minimize(String),
    Restore(String),
    Activate(String),
    Shots(String),
    Quit,
}

/// The steps, each at its time, in the order of their times.
#[derive(Debug, Default)]
pub struct Script {
    steps: Vec<(f64, Step)>,
}

fn step(words: &[&str]) -> Option<Step> {
    let number = |at: usize| words.get(at)?.parse::<i32>().ok();
    let point = || {
        Some((
            i16::try_from(number(1)?).ok()?,
            i16::try_from(number(2)?).ok()?,
        ))
    };
    let rest = || words.get(1..).map(|rest| rest.join(" "));

    Some(match *words.first()? {
        "move" => point().map(|(x, y)| Step::Move(x, y))?,
        "press" => point().map(|(x, y)| Step::Press(x, y))?,
        "release" => point().map(|(x, y)| Step::Release(x, y))?,
        "click" => point().map(|(x, y)| Step::Click(x, y))?,
        "key" => Step::Key(rest()?),
        "down" => Step::Down(rest()?),
        "up" => Step::Up(rest()?),
        "drag" => {
            let (x, y) = point()?;

            Step::Drag(x, y, number(3)?, number(4)?)
        }
        "minimize" => Step::Minimize(rest()?),
        "restore" => Step::Restore(rest()?),
        "activate" => Step::Activate(rest()?),
        "shots" => Step::Shots(rest()?),
        "quit" => Step::Quit,
        _ => return None,
    })
}

impl Script {
    pub fn parse(text: &str) -> Result<Self, String> {
        let mut steps = Vec::new();

        for (number, line) in text.lines().enumerate() {
            let line = line.split('#').next().unwrap_or("").trim();

            if line.is_empty() {
                continue;
            }

            let words: Vec<&str> = line.split_whitespace().collect();
            let at = words[0]
                .parse::<f64>()
                .map_err(|_| format!("line {}: no time", number + 1))?;
            let step = step(&words[1..]).ok_or_else(|| format!("line {}: {line}", number + 1))?;

            steps.push((at, step));
        }

        steps.sort_by(|a, b| a.0.total_cmp(&b.0));
        Ok(Self { steps })
    }

    pub fn read(file: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(file).map_err(|error| error.to_string())?;

        Self::parse(&text)
    }

    /// The steps due by `seconds`, taken.
    pub fn due(&mut self, seconds: f64) -> Vec<Step> {
        let count = self
            .steps
            .iter()
            .take_while(|(at, _)| *at <= seconds)
            .count();

        self.steps.drain(..count).map(|(_, step)| step).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_are_read_in_order_of_time() {
        let mut script = Script::parse(
            "2 key Escape # a remark\n\n1.5 click 10 20\n3 minimize Reversi game\n4 drag 50 5 30 -10\n",
        )
        .unwrap();

        assert_eq!(script.due(1.0), vec![]);
        assert_eq!(
            script.due(2.0),
            vec![Step::Click(10, 20), Step::Key("Escape".into())]
        );
        assert_eq!(
            script.due(10.0),
            vec![
                Step::Minimize("Reversi game".into()),
                Step::Drag(50, 5, 30, -10)
            ]
        );
    }

    #[test]
    fn a_line_not_understood_is_an_error() {
        assert!(Script::parse("1 fly 2 3").is_err());
        assert!(Script::parse("soon quit").is_err());
    }
}
