/** A panel of the page's side: a section under its own heading, the second level. */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { type ReactNode } from 'react';

export function Section({
  title,
  children,
  id,
  headingId,
  labelled = false,
  hidden = false,
}: {
  title: ReactNode;
  children: ReactNode;
  id?: string;
  headingId?: string;
  /** Whether the section is named by its heading, as a region. */
  labelled?: boolean;
  hidden?: boolean;
}) {
  return (
    <Box
      component="section"
      id={id}
      hidden={hidden}
      aria-labelledby={labelled ? headingId : undefined}
      sx={{ display: hidden ? 'none' : 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Heading id={headingId}>{title}</Heading>
      {children}
    </Box>
  );
}

/** A panel's heading, as small capitals in the secondary text's colour. */
export function Heading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <Typography
      variant="overline"
      component="h2"
      id={id}
      color="text.secondary"
      sx={{ lineHeight: 1.6, fontWeight: 600 }}
    >
      {children}
    </Typography>
  );
}

/** A note under a heading, in the secondary text's colour. */
export function Note({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <Typography id={id} variant="body2" color="text.secondary">
      {children}
    </Typography>
  );
}
