//! The console's standard input, a line at a time, read on a thread of its
//! own once anything asks for it: the drives' commands are taken between
//! frames while a program runs (`mounts.rs`), and a question asked before
//! or after the run (`ask`) is answered by the next line, so the two never
//! wait on each other for the one stdin.

use std::sync::mpsc::{Receiver, channel};
use std::sync::{Mutex, OnceLock};

/// The lines read, in turn; the sender let go of at the input's end.
fn lines() -> &'static Mutex<Receiver<String>> {
    static LINES: OnceLock<Mutex<Receiver<String>>> = OnceLock::new();

    LINES.get_or_init(|| {
        let (send, receive) = channel();

        std::thread::spawn(move || {
            let stdin = std::io::stdin();

            loop {
                let mut line = String::new();

                match stdin.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        if send.send(line).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        Mutex::new(receive)
    })
}

/// The next line, waited for; none at the input's end.
pub fn line() -> Option<String> {
    lines().lock().ok()?.recv().ok()
}

/// A line already typed, if there is one; none, without waiting, if not.
pub fn try_line() -> Option<String> {
    lines().lock().ok()?.try_recv().ok()
}
