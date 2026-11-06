/**
 * The trace of what the program calls: each function and how often, those
 * that reach nothing yet first, and the most recent calls. Each list scrolls
 * on its own, and takes the keyboard so that it can be scrolled from it.
 */

import Box from '@mui/material/Box';
import { useTrace } from './use.js';
import { Heading } from './section.js';

/** A list that scrolls, named by its heading and reachable from the keyboard. */
const scrolled = {
  maxHeight: '24rem',
  overflow: 'auto',
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  p: 1,
  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
} as const;

const mono = { fontFamily: 'monospace', fontSize: '0.75rem' } as const;

export function Trace() {
  const trace = useTrace();

  return (
    <Box
      component="aside"
      aria-label="API trace"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}
    >
      <Heading id="counts-heading">Functions called</Heading>
      <Box role="region" aria-labelledby="counts-heading" tabIndex={0} sx={scrolled}>
        <Box component="ul" id="counts" sx={{ listStyle: 'none', m: 0, p: 0, ...mono }}>
          {trace.rows.map((row) => (
            <Box
              component="li"
              key={row.name}
              className={row.stub ? 'stub' : ''}
              sx={
                row.stub
                  ? (theme) => ({
                      color: '#9a3412',
                      ...theme.applyStyles('dark', { color: '#f0a372' }),
                    })
                  : undefined
              }
            >
              {row.text}
            </Box>
          ))}
        </Box>
      </Box>
      <Heading id="recent-heading">Most recent calls</Heading>
      <Box role="region" aria-labelledby="recent-heading" tabIndex={0} sx={scrolled}>
        <Box
          component="pre"
          id="recent"
          sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...mono }}
        >
          {trace.recent}
        </Box>
      </Box>
    </Box>
  );
}
