/**
 * The mode Windows runs in: standard mode, DOSX's, as every recording but
 * those in `oracle/fixtures/enhanced/` was made; or 386 enhanced mode,
 * WIN386's (`kb/guides/enhanced-mode.md`). KERNEL learns which as it
 * starts and answers by it (`KRNL386.EXE` seg1 `aa76`-`aa90`). The page
 * keeps it for each machine and kept program, and hands it to the engine
 * (`crates/winbox-web`, `WindowsMode` in `crates/winbox-win16`).
 */
export type WindowsMode = 'standard' | 'enhanced';
