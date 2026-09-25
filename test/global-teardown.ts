import { mergeShares, shareDirectory } from './oracle/conformance-shares';

/**
 * Merges what the conformance suite's shards wrote into the report the
 * knowledge base reads, if every shard replayed all of its fixtures. See
 * `test/oracle/conformance.ts`.
 */
export default function globalTeardown(): void {
  const directory = shareDirectory();

  if (directory) {
    mergeShares(directory);
  }
}
