"use strict";

import { FixedWindow } from '../../windows/fixed-window.js';

import { Label } from '../../controls/label.js';
import { Button } from '../../controls/button.js';

import { User } from '../user.js';

export async function MessageBox(hwndParent, lpszText, lpszTitle, fuStyle) {
    // Stop the task
    this.scheduler.task.halt();

    // Get the parent window
    let parentWindow = this.handles.resolve(hwndParent);

    // Create a dialog box
    let dialog = new FixedWindow({
        caption: lpszTitle
    });

    // And place a label on it for the message text
    let label = new Label({
        caption: lpszText
    });

    label.fitted = true;
    label.move(16, 16);

    dialog.append(label);

    let buttons = {};

    // TODO: Negotiate which buttons are visible
    if (fuStyle & User.MB_OK) {
    }

    if (fuStyle & User.MB_OKCANCEL) {
    }

    if (fuStyle & User.MB_RETRYCANCEL) {
    }

    if (fuStyle & User.MB_ABORTRETRYIGNORE) {
    }

    if (fuStyle & User.MB_YESNO) {
    }

    if (fuStyle & User.MB_YESNOCANCEL) {
    }

    // Negotiate the default button
    if (fuStyle & User.DEFBUTTON1) {
    }
    else if (fuStyle & User.DEFBUTTON2) {
    }
    else if (fuStyle & User.DEFBUTTON3) {
    }

    // Negotiate the icon to be used
    if (fuStyle & User.ICONSTOP) {
    }

    if (fuStyle & User.ICONINFORMATION) {
    }

    if (fuStyle & User.ICONQUESTION) {
    }

    if (fuStyle & User.ICONEXCLAMATION) {
    }

    let button = new Button({
        caption: "Ok"
    });

    button.resize(48, 24);

    dialog.append(button);

    buttons[User.IDOK] = button;

    this._desktop.append(dialog);

    label.fit();

    console.log(label.width);

    let width = label.width + 32;

    dialog.resize(width, (dialog.height - dialog.innerHeight) + 82);

    button.move((width - button.width) / 2, 36 + label.innerHeight);

    dialog.center();

    dialog.focus();

    let msgBoxHandle = this.handles.allocate(dialog);
    this.windows.halt(hwndParent, msgBoxHandle);

    // TODO: wait until the message box closes before returning to the app
    return new Promise( (resolve) => {
        // Return value is the button that was pressed
        [User.IDOK, User.IDABORT, User.IDCANCEL, User.IDIGNORE, User.IDNO,
         User.IDYES, User.IDRETRY].forEach( (id) => {
            let button = buttons[id];
            if (button) {
                button.on("click", () => {
                    dialog.destroy();
                    this.handles.free(msgBoxHandle);
                    this.windows.halt(hwndParent, null);
                    resolve(id);
                });
            }
         });
    });
}
