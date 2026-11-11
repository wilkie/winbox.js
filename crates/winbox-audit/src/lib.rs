//! The paging audit (`kb/guides/paging.md`, "The audit"): its test,
//! `tests/paging.rs`, runs paging's probes in 386 enhanced mode with every
//! access to a page the set of present pages does not hold taken as
//! WIN386 takes it, and sets their records beside Windows'. Nothing here
//! but the crate the test belongs to.
