//! Windows 3.1 itself, in Rust: a program loaded from its file and linked
//! to the modules it calls.

pub mod call;
mod dos;
pub mod engine;
mod files_kernel;
pub mod handles;
mod kept;
pub mod kernel;
pub mod linker;
pub mod loader;
mod memory;
pub mod modules;
mod modules_kernel;
mod pointers;
pub mod profile;
mod profiles_kernel;
pub mod resources;
mod run;
pub mod system;
pub mod task;
pub mod user;
pub mod win87em;

pub use call::{Answer, Call, Stop};
pub use engine::{Engine, Register};
pub use loader::Module;
pub use modules::{Export, Kept};
pub use system::System;
