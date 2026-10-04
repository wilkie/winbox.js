//! Windows 3.1 itself, in Rust: a program loaded from its file and linked
//! to the modules it calls.

pub mod atoms;
pub mod call;
pub mod classes;
pub mod create;
pub mod cursor_pos;
pub mod display;
mod dos;
pub mod engine;
mod files_kernel;
pub mod handles;
pub mod icons;
mod kept;
pub mod kernel;
pub mod linker;
pub mod loader;
mod memory;
pub mod menus;
pub mod messages;
pub mod modules;
mod modules_kernel;
mod pointers;
pub mod profile;
mod profiles_kernel;
pub mod queue;
pub mod resources;
mod run;
pub mod system;
pub mod task;
pub mod user;
pub mod user_misc;
pub mod win87em;
pub mod window_queries;
pub mod windows;

pub use call::{Answer, Call, Stop};
pub use engine::{Engine, Register};
pub use loader::Module;
pub use modules::{Export, Kept};
pub use system::System;
