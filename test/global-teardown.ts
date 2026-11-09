import { mergeShares, shareDirectory } from './oracle/conformance-shares';

/**
 * Clears away what the conformance suite's shards wrote, rewriting the
 * fixtures' costs from it where asked. The report the knowledge base reads,
 * `kb/data/conformance.json`, is the Rust replay's alone. See
 * `test/oracle/conformance.ts`.
 */
export default function globalTeardown(): void {
  const directory = shareDirectory();

  if (directory) {
    mergeShares(directory);
  }
}
