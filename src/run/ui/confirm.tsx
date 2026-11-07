/**
 * Asking before what cannot be undone: forgetting what this browser keeps,
 * or discarding what an installer wrote. A modal dialog, named by its title
 * and described by its text, which holds the keyboard while it is open, has
 * Cancel focused first, closes on Escape as Cancel, and gives the focus
 * back to the control that opened it.
 */

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';

/** What is asked: the dialog's title, what it explains, and the button that does it. */
export interface Asking {
  title: string;
  text: string;
  action: string;

  /** Whether the action loses something (red, the default), or only goes on. */
  destructive?: boolean;
}

type Ask = (asking: Asking) => Promise<boolean>;

const AskContext = createContext<Ask>(async () => false);

/** The function that asks, and resolves true where the action was chosen. */
export const useConfirm = () => useContext(AskContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  /* What was asked last, kept while the dialog closes, so its words stay as it fades. */
  const [asked, setAsked] = useState<
    (Asking & { open: boolean; answer: (yes: boolean) => void }) | null
  >(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const ask = useCallback<Ask>(
    (asking) => new Promise((resolve) => setAsked({ ...asking, open: true, answer: resolve })),
    []
  );
  const answer = (yes: boolean) => {
    asked?.answer(yes);
    setAsked((was) => was && { ...was, open: false });
  };

  return (
    <AskContext.Provider value={ask}>
      {children}
      <Dialog
        open={asked?.open ?? false}
        onClose={() => answer(false)}
        /* Focused as the dialog comes in, once its focus trap has taken the focus. */
        slotProps={{ transition: { onEntering: () => cancel.current?.focus() } }}
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
      >
        <DialogTitle id="confirm-title">{asked?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-text">{asked?.text}</DialogContentText>
        </DialogContent>
        <DialogActions>
          {/* Cancel first and focused, as the dialog pattern has the least destructive
           * action: Enter on a dialog opened by mistake does nothing. */}
          <Button ref={cancel} onClick={() => answer(false)}>
            Cancel
          </Button>
          <Button
            color={asked?.destructive === false ? 'primary' : 'error'}
            variant="contained"
            onClick={() => answer(true)}
          >
            {asked?.action}
          </Button>
        </DialogActions>
      </Dialog>
    </AskContext.Provider>
  );
}
