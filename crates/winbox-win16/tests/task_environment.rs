//! What a task starts with and asks for first, as the `environ` and
//! `localgro` probes recorded it. Its local heap's other cases are
//! `winbox-machine`'s `local.rs` tests, and its `RegisterWindowMessage` case
//! `user.rs`'s.

mod support;

use winbox_machine::{LocalHeap, Memory};
use winbox_win16::task::task_environment;

/// The variables, a zero, a count of one and the kernel's path.
#[test]
fn a_task_environment_is_the_variables_a_zero_a_count_of_one_and_the_kernel_path() {
    assert_eq!(
        task_environment("C:\\WINDOWS"),
        b"windir=C:\\WINDOWS\0\0\x01\0C:\\WINDOWS\\SYSTEM\\KRNL386.EXE\0"
    );
}

/// `windir` after the DOS host's variables -- DOSBox's `PATH`, `COMSPEC` and
/// `BLASTER` -- where the nought that ends them lands at 75 and the count
/// after it, as `environ` recorded it.
#[test]
#[ignore = "decided: WinBox's task environment holds `windir` alone (the owner, \
            2026-11-09), where Windows under DOSBox has PATH, COMSPEC and BLASTER before \
            it (environ's records): WinBox has no Z: and no COMMAND.COM for them to name"]
fn a_task_environment_puts_windir_after_the_dos_hosts_variables() {
    let Some((_, records)) = support::run("environ") else {
        return;
    };
    let recorded = support::recorded("environ").unwrap();
    let first = |records: &[[String; 3]]| -> Vec<[String; 3]> {
        records
            .iter()
            .filter(|[function, ..]| function == "variable" || function == "count")
            .cloned()
            .collect()
    };

    assert_eq!(first(&records), first(&recorded));
}

/// A heap that may not grow does not: what does not fit answers nought, and
/// the heap's span stays what `LocalInit` gave it.
#[test]
fn a_local_heap_that_may_not_grow_does_not() {
    let mut memory = Memory::new();
    let mut local = LocalHeap::new(100);

    assert!(local.init(&mut memory, 0x10, 0x100));
    assert_eq!(local.local_alloc(&mut memory, 0, 0x100), 0);
    assert_eq!(local.span(&memory), 0xee);
}
