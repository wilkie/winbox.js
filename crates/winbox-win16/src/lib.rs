//! Windows 3.1 itself, in Rust: a program loaded from its file and linked
//! to the modules it calls.

mod kept;
pub mod linker;
pub mod loader;
pub mod modules;
pub mod system;
pub mod task;

pub use loader::Module;
pub use modules::{Export, Kept};
pub use system::System;
