/**
 * The run page's theme: MUI's own look, light and dark as the system has it
 * -- a CSS-variables theme whose two schemes switch on
 * `prefers-color-scheme`, with no script choosing -- in the system's own
 * font. Focus is drawn as an outline on every control, not left to the
 * ripple, and the Windows screen is never themed (`desktop.tsx`).
 */

import { createTheme } from '@mui/material/styles';

const focusRing = ({ theme }: { theme: any }) => ({
  outline: `2px solid ${theme.vars.palette.primary.main}`,
  outlineOffset: 2,
});

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'media' },
  colorSchemes: {
    light: true,
    /* MUI's dark error red with dark text on it, not white: white on #f44336
     * is 3.7 to 1, under AA's 4.5 for a contained button's words. */
    dark: {
      palette: {
        error: {
          main: '#f44336',
          light: '#e57373',
          dark: '#d32f2f',
          contrastText: 'rgba(0, 0, 0, 0.87)',
        },
      },
    },
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    MuiButtonBase: {
      styleOverrides: {
        root: (props) => ({ '&.Mui-focusVisible': focusRing(props) }),
      },
    },
    MuiButton: {
      defaultProps: { size: 'small', variant: 'outlined' },
      styleOverrides: { root: { textTransform: 'none' } },
    },
    MuiFormControlLabel: {
      defaultProps: { slotProps: { typography: { variant: 'body2' } } },
    },
    MuiLink: {
      styleOverrides: {
        root: (props) => ({ '&:focus-visible': focusRing(props) }),
      },
    },
  },
});
