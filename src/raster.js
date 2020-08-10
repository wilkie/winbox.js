"use strict";

export class Raster {
    static _drawCircle(ctx, x, y, dx, dy, style = 0) {
        let imageData = ctx.getImageData(x, y, dx, dy);
        let data = imageData.data;

        // Let's do a Bresenham's circle algorithm, because why not.
        let r = Math.floor(dx / 2);
        let nx = 0;
        let ny = r;
        let decision = 3 - (2 * r);

        let setpixel = (px, py) => {
            px = px + r;
            py = py + r;
            let position = ((py * dx) + px) * 4;
            data[position + 0] = 0x00;
            data[position + 1] = 0x00;
            data[position + 2] = 0x00;
            data[position + 3] = 0xff;
        };

        let plot = () => {
            if (style == 0) {
                // Stroke
                setpixel(nx, ny);
                setpixel(-nx, ny);
                setpixel(nx, -ny);
                setpixel(-nx, -ny);
                setpixel(ny, nx);
                setpixel(-ny, nx);
                setpixel(ny, -nx);
                setpixel(-ny, -nx);
            }
            else {
                // Fill
                // Very inefficient, but it fills a Bersenham's circle!
                // Line between (ny, -nx) and (ny, nx), etc
                for (let sx = -nx; sx <= nx; sx++) {
                    setpixel(sx, ny);
                }
                for (let sx = -ny; sx <= ny; sx++) {
                    setpixel(sx, nx);
                }
                for (let sx = -nx; sx <= nx; sx++) {
                    setpixel(sx, -ny);
                }
                for (let sx = -ny; sx <= ny; sx++) {
                    setpixel(sx, -nx);
                }
            }
        };

        // TODO: need to plot one extra time for even radii hmm
        while(ny >= nx) {
            plot();

            nx++;
            if (decision > 0) {
                ny--;
                decision = decision + (4 * (nx - ny)) + 10;
            }
            else {
                decision = decision + (4 * nx) + 6;
            }
        }

        ctx.putImageData(imageData, x, y);
    }

    static drawCircle(ctx, x, y, dx, dy) {
        Raster._drawCircle(ctx, x, y, dx, dy, 0);
    }

    static fillCircle(ctx, x, y, dx, dy) {
        Raster._drawCircle(ctx, x, y, dx, dy, 1);
    }

    static drawLine(ctx, x, y, x2, y2) {
    }
}

export default Raster;
