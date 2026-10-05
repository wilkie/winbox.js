//! The engine's run goes deep -- a program's call answered by calling back
//! into it, which calls again -- so the page's module is given a stack of
//! 8 MiB, put first, below its statics, where running past its end traps
//! rather than writing over them. The module keeps its own memory: unlike
//! the hybrid core's (`winbox-wasm`), it shares none with JavaScript.
//!
//! These are this module's terms alone, so they are given for its own link
//! here, and not to every WebAssembly build in the workspace.

fn main() {
    println!("cargo::rerun-if-changed=build.rs");

    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        for arg in ["--stack-first", "-zstack-size=8388608"] {
            println!("cargo::rustc-cdylib-link-arg={arg}");
        }
    }
}
