"use strict";

export class Color {
    constructor(value, g = null, b = null, a = 255) {
        if (g !== null) {
            value = Color.rgbToColor(value, g, b, a);
        }

        this._value = value;
    }

    mix(secondary, amount = 0.5) {
        let newR = (this.red * (1 - amount)) + (secondary.red * amount);
        let newG = (this.green * (1 - amount)) + (secondary.green * amount);
        let newB = (this.blue * (1 - amount)) + (secondary.blue * amount);

        return new Color(newR, newG, newB);
    }

    get value() {
        return this._value;
    }

    get css() {
        return "rgba(" + [this.red, this.green, this.blue].join(",") + ", " + this.alpha + ")";
    }

    get hex() {
        return this._value.toString(16).padStart(6, "0");
    }

    get rgb() {
        return Color.colorToRgb(this._value);
    }

    get red() {
        return this.rgb.r;
    }

    get green() {
        return this.rgb.g;
    }

    get blue() {
        return this.rgb.b;
    }

    get alpha() {
        return this.rgb.a / 255.0;
    }

    get hue() {
        return this.hsl.h;
    }

    get saturation() {
        return this.hsl.s;
    }

    get light() {
        return this.hsl.l;
    }

    get brightness() {
        let rgb = this.rgb;
        return (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) / 256;
    }

    get hsl() {
        let rgb = this.rgb;
        return Color.rgbToHsl(rgb.r, rgb.g, rgb.b);
    }

    /**
     * Returns a new Color representing the current color inverted.
     *
     * It retains the alpha value.
     */
    invert() {
        return new Color((~this.value) | (this.value & 0xff000000));
    }

    // From https://stackoverflow.com/questions/36721830/convert-hsl-to-rgb-and-hex

    /**
     * Converts an HSL color value to RGB. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
     * Assumes h, s, and l are contained in the set [0, 1] and
     * returns r, g, and b in the set [0, 255].
     *
     * @param   {number} h The hue.
     * @param   {number} s The saturation.
     * @param   {number} l The lightness.
     * @return  {Array}    The RGB representation.
     */
    static hslToRgb(h, s, l) {
        var r, g, b;

        if (s == 0) {
            r = g = b = l; // achromatic
        } else {
            var hue2rgb = function hue2rgb(p, q, t) {
                if(t < 0) t += 1;
                if(t > 1) t -= 1;
                if(t < 1/6) return p + (q - p) * 6 * t;
                if(t < 1/2) return q;
                if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };

            var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            var p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    static rgbToHsl(r, g, b) {
        // Normalize to [0...1]
        r /= 255;
        g /= 255;
        b /= 255;

        let max = Math.max(r, g, b);
        let min = Math.min(r, g, b);

        var h, s, l = (max + min) / 2;

        if (max == min) {
            h = s = 0; // achromatic
        } else {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }

            h /= 6;
        }

        return {
            h: h,
            s: s,
            l: l
        };
    }

    static rgbToColor(r, g, b, a = 255) {
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    static colorToBgr(color) {
        return {
            a: (color >> 24) & 0xff,
            b: (color >> 16) & 0xff,
            g: (color >> 8)  & 0xff,
            r: (color >> 0)  & 0xff,
        };
    }

    static colorToRgb(color) {
        return {
            a: (color >> 24) & 0xff,
            r: (color >> 16) & 0xff,
            g: (color >> 8)  & 0xff,
            b: (color >> 0)  & 0xff,
        };
    }
}

export default Color;
