import { NULL } from '../consts.js';

import { WPARAM, LPARAM, HWND, UINT, LRESULT } from '../types.js';

import { Executable } from '../../executable.js';

import { User } from '../user.js';

import { Util } from '../../util.js';

import { FixedWindow } from '../../windows/fixed-window.js';

import { Label } from '../../controls/label.js';
import { Button } from '../../controls/button.js';
import { TextBox } from '../../controls/text-box.js';

import { Color } from '../../raster/color.js';

// TODO: Call CreateWindowEx(...) instead

export async function DialogBox(hinst, lpszDlgTemp, hwndOwner, dlgprc) {
    console.log("DialogBox", arguments);

    // Resolve the handle
    let module = this.handles.resolve(hinst);

    // Fail out if the handle is not found
    if (!module) {
        return NULL;
    }

    // Determine the call procedure address
    let procCS = (dlgprc >> 16) & 0xffff;
    let procIP = dlgprc & 0xffff;

    let executable = this.scheduler.task.executable;

    let id = 0xffff;
    let name = null;
    if (lpszDlgTemp instanceof String || (typeof lpszDlgTemp) == 'string') {
        name = lpszDlgTemp.toUpperCase();
    }
    else {
        id = lpszDlgTemp;
    }

    let resourceInfo = null;
    for (let i = 0; i < executable.resources.length; i++) {
        let resourceType = executable.resources[i];
        if (resourceType.id == Executable.RESOURCES.Dialog) {
            for (let j = 0; j < resourceType.entries.length; j++) {
                let resource = resourceType.entries[j];
                if (resource.id == id || resource.name === name) {
                    resourceInfo = resource;
                    break;
                }
            }
        }
    }

    if (resourceInfo) {
        console.log(resourceInfo);
        let data = new Uint8Array(await executable.readResource(resourceInfo));
        let view = new DataView(data.buffer);

        // Read the header
        let position = 0;
        let style = view.getUint32(position, true);
        position += 4;

        // Read the number of items
        let count = view.getUint8(position)
        position++;

        // Read initial properties
        let x = view.getInt16(position, true);
        position += 2;
        let y = view.getInt16(position, true);
        position += 2;
        let width = view.getUint16(position, true);
        position += 2;
        let height = view.getUint16(position, true);
        position += 2;

        let fonts = this.fonts.lookup("MS Sans Serif");
        let font = fonts.fontFor(8);
        let avgWidth = font.header.dfAvgWidth + 2;
        let avgHeight = font.header.dfPixHeight;

        console.log("original width:", width, "height:", height);

        x = Math.floor(x * avgWidth / 4);
        y = Math.floor(y * avgHeight / 8);
        width = Math.floor(width * avgWidth / 4);
        height = Math.floor(height * avgHeight / 8);

        console.log("scaled width:", width, "height:", height);

        // Read menu name
        let ordinal = view.getUint16(position, true);
        position += 2;

        // Read dialog caption
        let title = "";
        title = Util.readString(view, position, resourceInfo.length - position);
        position += title.length + 1;

        // If the DS_SETFONT is part of the style, we get the font name and size
        let fontSize = -1;
        let fontName = "";
        if (style & User.DS_SETFONT) {
            fontSize = view.getUint16(position, true);
            position += 2;

            fontName = Util.readString(view, position, resourceInfo.length - position);
            position += fontName.length + 1;
        }

        // Create the dialog box
        let dialog = new FixedWindow({
            font: this.fonts.lookup("System"),
            size: 8,
            width: 800
        });
        dialog.caption = title;
        dialog.move(x, y);
        dialog.resize(width, height);
        dialog.hide();
        this._desktop.append(dialog);

        console.log("template:", lpszDlgTemp, "font:", fontSize, fontName, "x:", x, "y:", y, "width:", width, "height:", height, "title:", title, "menu:", ordinal, "items:", count);

        let controls = [];

        // Read each dialog item
        for (let i = 0; i < count; i++) {
            let x = view.getInt16(position, true);
            position += 2;
            let y = view.getInt16(position, true);
            position += 2;
            let width = view.getUint16(position, true);
            position += 2;
            let height = view.getUint16(position, true);
            position += 2;

            // We need to convert dialog units to screen units
            x = Math.floor(x * avgWidth / 4);
            y = Math.floor(y * avgHeight / 8);
            width = Math.floor(width * avgWidth / 4);
            height = Math.floor(height * avgHeight / 8);

            // Read id
            let id = view.getUint16(position, true);
            position += 2;

            // Read control style
            let style = view.getUint32(position, true);
            position += 4;

            // Read class
            let classId = view.getUint8(position);
            position++;

            let className = "";
            if (!(classId & 0x80) && classId != 0) {
                position--;
                className = Util.readString(view, position, resourceInfo.length - position);
                position += className.length + 1;
            }

            // Read the text
            let textId = view.getUint8(position);
            position++;
            let text = "";
            if (textId == 0xff) {
                textId = view.getUint16(position, true)
            }
            else if (textId != 0x0) {
                position--;
                text = Util.readString(view, position, resourceInfo.length - position);
                position += text.length + 1;
            }

            // Read extra bytes
            let extra = view.getUint8(position);
            position++;

            console.log("item", "id:", id, "x:", x, "y:", y, "width:", width, "height:", height, "class:", classId.toString(16), className, "style:", style.toString(16), "text:", textId.toString(16), text, "extra:", extra.toString(16));

            // Create the item based on the class
            let control = null;
            switch (classId) {
                case 0x80: // Button / Frame
                    if (style & 0x10000) {
                        control = new Button({ caption: text, font: this.fonts.lookup("MS Sans Serif"), size: 8, weight: 800 });
                        let hwndControl = 0;
                        control.on("click", (e) => {
                            // Send WM_COMMAND, BN_CLICKED
                            this.scheduler.call(User, procCS, procIP, [
                                [hWnd, HWND], [User.WM_COMMAND, UINT],
                                [control.data.id, WPARAM], [(hwndControl << 16) | User.BN_CLICKED, LPARAM]
                            ], LRESULT);
                        });
                    }
                    break;
                case 0x81: // TextBox
                    control = new TextBox({ value: text, font: this.fonts.lookup("MS Sans Serif"), size: 8, weight: 800 });
                    break;
                case 0x82: // Label
                    control = new Label({ caption: text, font: this.fonts.lookup("MS Sans Serif"), size: 8, weight: 800 });
                    control.backgroundColor = new Color(255, 255, 255, 0);

                    if (style & 0x1) {
                        // Centered
                        control.alignment = "center";
                    }
                    break;
            }

            if (control) {
                control.data.id = id;
                control.data.extra = extra;
                control.move(x, y);
                control.resize(width, height);
                controls.push(control);
            }
        }

        controls.reverse().forEach( (control) => {
            dialog.append(control);
        });

        // Wait until the dialog box closes before returning to the app
        let promise = new Promise( (resolve) => {
            dialog.data.resolve = (ret) => {
                // Destroy the dialog
                dialog.destroy();

                // Return execution and return the value provided by EndDialog
                resolve(ret);
            };
        });

        // Create the dialog window handle
        let hWnd = this.handles.allocate(dialog);

        // Send WM_SETFONT (if DS_SETFONT is specified)
        if (style & User.DS_SETFONT) {
            /*
            let hfont = this.handles.allocate(fonts);
            await this.scheduler.call(User, procCS, procIP, [
                [hWnd, HWND], [User.WM_SETFONT, UINT],
                [hfont, WPARAM], [0, LPARAM] // redraw?
            ], LRESULT);
            */
        }

        // Send WM_INITDIALOG
        await this.scheduler.call(User, procCS, procIP, [
            [hWnd, HWND], [User.WM_INITDIALOG, UINT],
            [hWnd, WPARAM], [0, LPARAM]
        ], LRESULT);

        // Show the dialog
        dialog.show();
        let computedStyle = window.getComputedStyle(dialog.element);
        let paddingWidth = (parseInt(computedStyle.paddingLeft) || 0) + (parseInt(computedStyle.paddingRight) || 0);
        let paddingHeight = (parseInt(computedStyle.paddingTop) || 0) + (parseInt(computedStyle.paddingBottom) || 0);
        width -= paddingWidth;
        height -= paddingHeight;

        console.log("console", height, dialog.height, dialog.innerHeight,
                      height + (dialog.height - dialog.innerHeight));
        dialog.resize(width + (dialog.width - dialog.innerWidth),
                      height + (dialog.height - dialog.innerHeight));
        console.log("console", height, dialog.height, dialog.innerHeight,
                      height + (dialog.height - dialog.innerHeight));

        return promise;
    }
}
