//! The WebAssembly core shares the machine's memory with JavaScript
//! (`src/emulator/memory.ts`): it imports that memory rather than making its
//! own, and keeps its stack and statics below the 128 KiB the memory keeps
//! for it, where the page table begins: a stack of 64 KiB, which the core,
//! with no recursion, does not come near.
//!
//! These are this module's terms alone, so they are given for its own link
//! here, and not to every WebAssembly build in the workspace.

fn main() {
    println!("cargo::rerun-if-changed=build.rs");

    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        for arg in ["--import-memory", "--stack-first", "-zstack-size=65536"] {
            println!("cargo::rustc-cdylib-link-arg={arg}");
        }
    }
}
