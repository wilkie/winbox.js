/**
 * Chooses the seed for the run and reports it, so any run can be replayed.
 *
 * Workers inherit the environment, so setting it here fixes it for the whole
 * run even though each worker re-seeds per test.
 */
export default function globalSetup(): void {
  if (!process.env.WINBOX_TEST_SEED) {
    process.env.WINBOX_TEST_SEED = String((Math.random() * 0xffffffff) >>> 0);
  }

  process.stdout.write(
    `\nRandom seed: ${process.env.WINBOX_TEST_SEED} ` +
      `(re-run with WINBOX_TEST_SEED=${process.env.WINBOX_TEST_SEED} to reproduce)\n`
  );
}
