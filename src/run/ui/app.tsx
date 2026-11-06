/**
 * The run page: its banner; the side, of programs and files; the Windows
 * screen, the page's main content; and the trace. Three columns on a wide
 * screen, one beneath another, in that order, on a narrow one, the order the
 * keyboard takes them in; a link to the screen first, for the keyboard to
 * pass the side by.
 */

import Box from '@mui/material/Box';
import GlobalStyles from '@mui/material/GlobalStyles';
import Link from '@mui/material/Link';
import { Desktop } from './desktop.js';
import { FileBrowser } from './files.js';
import { DrivesPanel } from './drives.js';
import { Header } from './header.js';
import { KeptPanel } from './kept.js';
import {
  ChangesPanel,
  DisplayPanel,
  DropZone,
  FilesPanel,
  InstallPanel,
  MachinePanel,
  ProgramsPanel,
  WindowsPanel,
} from './panels.js';
import { Trace } from './trace.js';
import { usePageView } from './use.js';

/** Where the three columns become one. */
const WIDE = '@media (min-width: 1100px)';

/** Movement kept to none where the system asks for less: MUI's transitions and ripples among it. */
const still = (
  <GlobalStyles
    styles={{
      '@media (prefers-reduced-motion: reduce)': {
        '*, *::before, *::after': {
          animationDuration: '0.01ms !important',
          animationIterationCount: '1 !important',
          transitionDuration: '0.01ms !important',
          scrollBehavior: 'auto !important',
        },
      },
    }}
  />
);

export function App() {
  const view = usePageView();

  return (
    <>
      {still}
      <Link
        href="#main"
        sx={{
          position: 'absolute',
          left: 8,
          top: -48,
          zIndex: 'tooltip',
          p: 1,
          bgcolor: 'background.paper',
          '&:focus': { top: 8 },
        }}
      >
        Skip to the Windows desktop
      </Link>
      <Header view={view} />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 2,
          p: 2,
          [WIDE]: { gridTemplateColumns: '18rem minmax(0, 1fr) 20rem' },
        }}
      >
        <Box
          component="aside"
          aria-label="Programs and files"
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
        >
          <DropZone />
          {view && (
            <>
              <WindowsPanel view={view} />
              <ChangesPanel view={view} />
              <DisplayPanel view={view} />
              <MachinePanel view={view} />
              <DrivesPanel view={view} />
              <KeptPanel view={view} />
              <InstallPanel view={view} />
              <ProgramsPanel view={view} />
              <FilesPanel />
            </>
          )}
        </Box>
        <Desktop />
        <Trace />
      </Box>
      <FileBrowser />
    </>
  );
}
