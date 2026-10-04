//! Windows 3.1 itself, in Rust: a program loaded from its file and linked
//! to the modules it calls.

pub mod call;
mod dos;
mod kept;
pub mod kernel;
pub mod linker;
pub mod loader;
pub mod modules;
pub mod run;
pub mod system;
pub mod task;
pub mod user;

pub use call::{Answer, Call, Stop};
pub use loader::Module;
pub use modules::{Export, Kept};
pub use system::System;
