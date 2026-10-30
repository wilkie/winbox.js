//! The language driver: a library whose ordinal 1 USER hands its string
//! functions to while it is loaded. **Read out** of `USER.EXE`, and
//! **recorded** by `langdrv`; the TypeScript engine's `language-driver.ts`
//! is the same.
//!
//! * As USER starts, `SYSTEM.INI`'s `[boot] LANGUAGE.DLL` is loaded where it
//!   names one (seg3 `1ff5`-`2065`); the installation the recordings are
//!   made on names none, and winbox.js does not look.
//! * `SPI_LANGDRIVER` (seg41 `116f`) loads the file its `lpvParam` names
//!   (seg3 `1f34`): the driver loaded let go of with `FreeLibrary`, its
//!   file's name kept; no name, or an empty one, is done, and answers TRUE;
//!   else the file is loaded with `LoadLibrary` and its ordinal 1 found with
//!   `GetProcAddress`, and TRUE. Where either fails, the library loaded is
//!   let go of and the driver before loaded again by its file's name, and
//!   the call answers FALSE.
//! * With `SPIF_UPDATEINIFILE`, and only where it answers TRUE,
//!   `SYSTEM.INI`'s `[boot] LANGUAGE.DLL` is written with
//!   `WritePrivateProfileString`: the name given where a driver is loaded,
//!   else an empty one (`118a`-`11e5`). No `WM_WININICHANGE` is sent.
//! * While one is loaded, ten functions of seg11 call its procedure, Pascal,
//!   with a number, a word and a far pointer, in place of their own:
//!   `lstrcmp` 1 and `lstrcmpi` 1 with the word 1, the pointer the caller's
//!   two pointers on its stack, and the answer negated; `AnsiUpper` 2 and
//!   `AnsiLower` 3, the pointer their argument, the answer theirs;
//!   `AnsiUpperBuff` 4 and `AnsiLowerBuff` 5, the word the length; and
//!   `IsCharAlpha` 6, `IsCharAlphaNumeric` 7, `IsCharUpper` 8 and
//!   `IsCharLower` 9, the word the character and the pointer null.

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::modules_kernel::{free_library_handle, load_library_named, proc_numbered};
use crate::system::System;
use crate::user_misc::{
    ansi_convert, ansi_lower_byte, ansi_upper_byte, next_character, previous_character,
};
use winbox_cpu::{AX, CX, DX, SP, SS};

/// The driver loaded: its module and its ordinal 1.
#[derive(Debug, Clone, Copy)]
pub struct LanguageDriver {
    pub module: u16,
    pub proc: u32,
}

/// The ten functions the driver takes, for USER's table.
pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Async(match name {
        "lstrcmp" => lstrcmp,
        "lstrcmpi" => lstrcmpi,
        "AnsiUpper" => ansi_upper,
        "AnsiLower" => ansi_lower,
        "AnsiUpperBuff" => ansi_upper_buff,
        "AnsiLowerBuff" => ansi_lower_buff,
        "IsCharAlpha" => is_char_alpha,
        "IsCharAlphanumeric" => is_char_alphanumeric,
        "IsCharUpper" => is_char_upper,
        "IsCharLower" => is_char_lower,
        "StringFunc" => string_func,
        _ => return None,
    }))
}

impl Engine {
    /// The driver's procedure called: its answer, DX:AX.
    async fn call_language_driver(
        &self,
        proc: u32,
        number: u16,
        word: u16,
        pointer: u32,
    ) -> Result<u32, Stop> {
        let args = [
            GuestArg::Word(number),
            GuestArg::Word(word),
            GuestArg::Long(pointer),
        ];

        Ok(self.call_with(proc, &args, &[]).await?.0)
    }

    /// A library loaded as a driver: whether its ordinal 1 was found.
    async fn load_language_driver(&self, name: &str) -> Result<bool, Stop> {
        let module = load_library_named(self, name).await?;

        if module < 32 {
            return Ok(false);
        }

        let proc = proc_numbered(&mut self.system(), module, 1);

        if proc == 0 {
            free_library_handle(self, module).await?;
            return Ok(false);
        }

        self.system().language_driver = Some(LanguageDriver { module, proc });
        Ok(true)
    }

    /// `SPI_LANGDRIVER`'s work (seg3 `1f34`): whether a driver was loaded,
    /// or none asked for.
    async fn set_language_driver(&self, name: Option<&str>) -> Result<bool, Stop> {
        let before = self.system().language_driver.take();
        let mut path = None;

        if let Some(before) = before {
            path = Some(self.system().path_of(before.module));
            free_library_handle(self, before.module).await?;
        }

        let Some(name) = name.filter(|name| !name.is_empty()) else {
            return Ok(true);
        };

        if self.load_language_driver(name).await? {
            return Ok(true);
        }

        if let Some(path) = path.filter(|path| !path.is_empty()) {
            self.load_language_driver(&path).await?;
        }

        Ok(false)
    }

    /// `SystemParametersInfo`'s `SPI_LANGDRIVER` (seg41 `116f`-`11e5`):
    /// the driver the far pointer names loaded, and with
    /// `SPIF_UPDATEINIFILE` `SYSTEM.INI` written; no message is sent.
    pub(crate) async fn spi_language_driver(&self, far: u32, ini: u16) -> Result<bool, Stop> {
        let name = (far != 0).then(|| {
            let bytes = self.system().read_string(far);

            bytes
                .iter()
                .map(|&byte| char::from(byte))
                .collect::<String>()
        });

        if !self.set_language_driver(name.as_deref()).await? {
            return Ok(false);
        }

        if ini & 1 != 0 {
            let mut system = self.system();
            let value = if system.language_driver.is_some() {
                name.unwrap_or_default()
            } else {
                String::new()
            };
            let value: Vec<u8> = value.chars().map(|c| c as u8).collect();

            system.write_profile_entry(b"SYSTEM.INI", b"boot", b"LANGUAGE.DLL", &value);
        }

        Ok(true)
    }
}

/// The driver's procedure, where one is loaded.
fn driver(engine: &Engine) -> Option<u32> {
    engine.system().language_driver.map(|driver| driver.proc)
}

/// A comparison: the driver's answer negated, as a word (seg11 `0048`-
/// `0055`), given where the caller's two pointers are on its stack.
fn compared(engine: &Engine, mut args: Args, word: u16, own: crate::call::Sync) -> Later<'_> {
    Box::pin(async move {
        let Some(proc) = driver(engine) else {
            return own(&mut engine.system(), &mut args);
        };
        let pointer = args.address_above(&engine.system(), 0);
        let answer = engine.call_language_driver(proc, 1, word, pointer).await?;

        Ok(Answer::Word((answer as u16).wrapping_neg()))
    })
}

fn lstrcmp(engine: &Engine, args: Args) -> Later<'_> {
    compared(engine, args, 0, crate::user::lstrcmp)
}

fn lstrcmpi(engine: &Engine, args: Args) -> Later<'_> {
    compared(engine, args, 1, crate::user::lstrcmpi)
}

/// A conversion of a string or a character: the driver's answer, DX:AX.
fn converted(engine: &Engine, mut args: Args, number: u16, own: crate::call::Sync) -> Later<'_> {
    Box::pin(async move {
        let Some(proc) = driver(engine) else {
            return own(&mut engine.system(), &mut args);
        };
        let pointer = args.dword(&engine.system());

        Ok(Answer::Dword(
            engine
                .call_language_driver(proc, number, 0, pointer)
                .await?,
        ))
    })
}

fn ansi_upper(engine: &Engine, args: Args) -> Later<'_> {
    converted(engine, args, 2, crate::user_misc::ansi_upper)
}

fn ansi_lower(engine: &Engine, args: Args) -> Later<'_> {
    converted(engine, args, 3, crate::user_misc::ansi_lower)
}

/// A buffer's conversion: the driver's answer, AX.
fn buffered(engine: &Engine, mut args: Args, number: u16, own: crate::call::Sync) -> Later<'_> {
    Box::pin(async move {
        let Some(proc) = driver(engine) else {
            return own(&mut engine.system(), &mut args);
        };
        let (pointer, count) = {
            let system = engine.system();
            let pointer = args.dword(&system);

            (pointer, args.word(&system))
        };
        let answer = engine
            .call_language_driver(proc, number, count, pointer)
            .await?;

        Ok(Answer::Word(answer as u16))
    })
}

fn ansi_upper_buff(engine: &Engine, args: Args) -> Later<'_> {
    buffered(engine, args, 4, crate::user_misc::ansi_upper_buff)
}

fn ansi_lower_buff(engine: &Engine, args: Args) -> Later<'_> {
    buffered(engine, args, 5, crate::user_misc::ansi_lower_buff)
}

/// An `IsChar` function: the driver's answer, AX, the character in the
/// word (seg11 `0235`-`0240`).
fn is_char(engine: &Engine, mut args: Args, number: u16, own: crate::call::Sync) -> Later<'_> {
    Box::pin(async move {
        let Some(proc) = driver(engine) else {
            return own(&mut engine.system(), &mut args);
        };
        let character = args.word(&engine.system()) & 0xff;
        let answer = engine
            .call_language_driver(proc, number, character, 0)
            .await?;

        Ok(Answer::Word(answer as u16))
    })
}

fn is_char_alpha(engine: &Engine, args: Args) -> Later<'_> {
    is_char(engine, args, 6, crate::user_misc::is_char_alpha)
}

fn is_char_alphanumeric(engine: &Engine, args: Args) -> Later<'_> {
    is_char(engine, args, 7, crate::user_misc::is_char_alphanumeric)
}

fn is_char_upper(engine: &Engine, args: Args) -> Later<'_> {
    is_char(engine, args, 8, crate::user_misc::is_char_upper)
}

fn is_char_lower(engine: &Engine, args: Args) -> Later<'_> {
    is_char(engine, args, 9, crate::user_misc::is_char_lower)
}

impl System {
    /// USER's data segment's selector, whose high byte its `IsChar`
    /// functions leave in AH (seg11 `0215`).
    pub(crate) fn user_data_selector(&self) -> u16 {
        self.kept_named("USER").map_or(0, |kept| {
            winbox_machine::segment_selector(self.kept[kept].data)
        })
    }
}

/// USER's ordinal 470, `StringFunc` (`USER.EXE` seg11 `02e7`): four string
/// routines behind one entry, chosen by CX through the table at `02df` --
/// 1 `AnsiNext`'s body, 2 `AnsiPrev`'s, 3 `AnsiUpper` and 4 `AnsiLower`
/// through their entries' tails, the last two by the language driver where
/// one is loaded. Each pops its own arguments, 4 bytes or `AnsiPrev`'s 8.
/// **Recorded** by `strfunc`. Another CX is not followed: nothing popped,
/// the registers left. As `src/win16/user/string-func.ts`.
fn string_func(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        let (routine, ss, sp) = {
            let system = engine.system();

            (
                system.cpu.regs[CX],
                system.cpu.segments[SS].selector,
                system.cpu.regs[SP],
            )
        };

        if !(1..=4).contains(&routine) {
            return Ok(Answer::Nothing);
        }

        let word = |system: &System, at: u16| {
            let bytes = system.read_far(u32::from(ss) << 16 | u32::from(sp.wrapping_add(at)), 2);

            u16::from_le_bytes([bytes[0], bytes[1]])
        };
        let dword = |system: &System, at: u16| {
            u32::from(word(system, at.wrapping_add(2))) << 16 | u32::from(word(system, at))
        };
        let (first, second) = {
            let system = engine.system();

            (dword(&system, 4), dword(&system, 8))
        };

        // The far return at SP, the arguments above it, the last pushed
        // first.
        let answer = match routine {
            1 => next_character(&engine.system(), first),
            2 => previous_character(second, first),
            number => match driver(engine) {
                Some(proc) => {
                    engine
                        .call_language_driver(proc, number - 1, 0, first)
                        .await?
                }
                None => ansi_convert(
                    &mut engine.system(),
                    first,
                    if number == 3 {
                        ansi_upper_byte
                    } else {
                        ansi_lower_byte
                    },
                ),
            },
        };

        // The arguments popped: the far return moved up over them.
        let pops: u16 = if routine == 2 { 8 } else { 4 };
        let mut system = engine.system();
        let ip = word(&system, 0);
        let cs = word(&system, 2);

        system.write_far(
            u32::from(ss) << 16 | u32::from(sp.wrapping_add(pops)),
            &ip.to_le_bytes(),
        );
        system.write_far(
            u32::from(ss) << 16 | u32::from(sp.wrapping_add(pops + 2)),
            &cs.to_le_bytes(),
        );
        system.cpu.regs[SP] = sp.wrapping_add(pops);
        system.cpu.regs[AX] = answer as u16;
        system.cpu.regs[DX] = (answer >> 16) as u16;

        Ok(Answer::Nothing)
    })
}
