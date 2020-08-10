"use strict";

import { SizableWindow } from "./windows/sizable-window.js";
import { FixedWindow } from "./windows/fixed-window.js";
import { Button } from "./controls/button.js";
import { Label } from "./controls/label.js";
import { TextBox } from "./controls/text-box.js";
import { CheckBox } from "./controls/check-box.js";
import { OptionButton } from "./controls/option-button.js";
import { Menu } from "./controls/menu.js";
import { ProgressBar } from "./controls/progress-bar.js";

export class ProgressWindow extends SizableWindow {
    constructor(options = {}) {
        super(options);

        this.resize(32*10, 32*10);

        this._progressBar = new ProgressBar({ font: "sserife.fon", size: 6, weight: 800 });
        this.append(this._progressBar);
        this._progressBar.move(32, 8);
        this._progressBar.resize(32*8, 16);
        this._progressBar.value = 0.5;

        //this._label = new CheckBox({ caption: "WHAT" });
        this._label = new OptionButton({ caption: "WHAT", font: "sserife.fon", size: 8, weight: 800 });
        this.append(this._label);
        this._label.move(32, 32);
        this._label.resize(100,16);
        this._label.alignment = "left";
        this._label.value = OptionButton.Value.Checked;

        this._label2 = new OptionButton({ caption: "OK", font: "sserife.fon", size: 8, weight: 800 });
        this.append(this._label2);
        this._label2.move(32, 48);
        this._label2.resize(100,16);
        this._label2.alignment = "left";

        this._label3 = new CheckBox({ caption: "WHAT", font: "sserife.fon", size: 8, weight: 800 });
        this.append(this._label3);
        this._label3.move(164, 32);
        this._label3.resize(100,16);
        this._label3.alignment = "left";

        this._label4 = new CheckBox({ caption: "OK", font: "sserife.fon", size: 8, weight: 800 });
        this.append(this._label4);
        this._label4.move(164, 48);
        this._label4.resize(100,16);
        this._label4.alignment = "left";
        this._label4.value = CheckBox.Value.Checked;

        this._button = new Button({ caption: "Button1", weight: 400, font: "EGA80WOA.FON", size: 9 });
        //this.append(this._button);

        this._button.resize(32*8, 32);
        this._button.move(32, 32);

        this._button2 = new Button({ caption: "Button2" });
        this.append(this._button2);

        this._button2.resize(32*8, 32);
        this._button2.move(32, 32+32+16);

        this._button3 = new Button({ caption: "Button3" });
        this.append(this._button3);

        this._button3.resize(32*8, 32);
        this._button3.move(32, 32+32+32+16+16); //*/

        this._text = new TextBox({ value: "OK WHATEVER", font: "sserife.fon", size: 8, weight: 800 });
        this.append(this._text);
        this._text.move(32, 32+32+32+32+16+16+16); //*/
        this._text.resize(118,19);
        this._text.alignment = "left";

        this._menu = new Menu({ font: "VGASYS.FON", caption: "Main" });
        let mnuFile = new Menu({ caption: "&File" });
        mnuFile.append(new Menu({ caption: "&Open" }));
        mnuFile.append(new Menu({ caption: "&Save" }));
        mnuFile.append(new Menu({ caption: "-" }));
        mnuFile.append(new Menu({ caption: "E&xit" }));
        this._menu.append(mnuFile);
        let mnuEdit = new Menu({ caption: "&Edit" });
        mnuEdit.append(new Menu({ caption: "&Open" }));
        mnuEdit.append(new Menu({ caption: "&Save" }));
        mnuEdit.append(new Menu({ caption: "-" }));
        mnuEdit.append(new Menu({ caption: "E&xit" }));
        this._menu.append(mnuEdit);
        this._menu.append(new Menu({ caption: "&View" }));

        this.append(this._menu);
    }
}

export default ProgressWindow;
