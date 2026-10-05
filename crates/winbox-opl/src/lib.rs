//! An Ad Lib for WinBox: the Yamaha YM3812 (OPL2) as DOSBox 0.74-3, the
//! oracle WinBox is measured against, emulates it.
//!
//! DOSBox 0.74-3 with its default settings (`oplemu=default`, which
//! adlib.cpp treats as `fast`) runs its own OPL core, dbopl, at
//! `oplrate=44100`. This crate is a faithful port of that core
//! ([`dbopl`]), of the Adlib module around it that programs see through
//! the ports ([`adlib`]), and of the few lines of DOSBox's mixer that shape
//! the FM channel's output ([`mixer`]). For the same register writes and
//! the same calls, it gives the same samples as DOSBox, bit for bit; the
//! tests in tests/dosbox.rs hold it to vectors recorded from DOSBox's own
//! dbopl.cpp.
//!
//! The code is ported from DOSBox, copyright (C) 2002-2010 The DOSBox
//! Team, under the GNU General Public License version 2 or (at your
//! option) any later version; the port is under the same terms, which
//! lets it be part of WinBox under the GNU Affero General Public License
//! version 3 or later.
//!
//! The crate has no dependencies, no clock and no threads: the caller says
//! what time it is (in milliseconds of emulated time) and how many samples
//! it wants, so it runs the same natively and in WebAssembly.

pub mod adlib;
pub mod dbopl;
#[rustfmt::skip] // As gen_tables.cpp prints it, so regenerate.sh can compare.
mod dbopl_tables;
pub mod mixer;

pub use adlib::{Adlib, Mode};
pub use dbopl::{Chip, Handler, OPLRATE};

/// DOSBox 0.74-3's default `oplrate`, and its default mixer `rate`.
pub const DEFAULT_RATE: u32 = 44100;
