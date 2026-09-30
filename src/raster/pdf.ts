'use strict';

/**
 * Pages of palette indices as a PDF: one image a page, four bits a pixel
 * over the palette, deflated, filling a page the size the resolution makes
 * of it. What winbox.js's printer hands a document on as (`printer.ts`).
 */

async function deflate(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));

  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const text = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff);

export async function pdfOf(
  pages: Uint8Array[],
  width: number,
  height: number,
  dpi: number,
  colours: number[][]
) {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (bytes: Uint8Array) => {
    parts.push(bytes);
    size += bytes.length;
  };
  const object = (body: Uint8Array[] | string) => {
    offsets.push(size);
    push(text(`${offsets.length} 0 obj\n`));

    for (const piece of typeof body === 'string' ? [text(body)] : body) {
      push(piece);
    }

    push(text('\nendobj\n'));

    return offsets.length;
  };

  const points = (pixels: number) => Math.round((pixels * 72) / dpi);
  const palette = colours
    .slice(0, 16)
    .map((rgb) => rgb.map((value) => value.toString(16).padStart(2, '0')).join(''))
    .join('');
  const row = Math.ceil(width / 2);

  push(text('%PDF-1.4\n'));

  /* Objects 1 and 2 are the catalogue and the page tree; each page is then
   * its image, its contents and itself. */
  const kids: number[] = [];
  const pageObjects: [Uint8Array[], string, (tree: number) => string][] = [];

  for (const page of pages) {
    const packed = new Uint8Array(row * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x += 2) {
        const first = page[y * width + x] & 15;
        const second = x + 1 < width ? page[y * width + x + 1] & 15 : 0;

        packed[y * row + (x >> 1)] = (first << 4) | second;
      }
    }

    const data = await deflate(packed);
    const content = `q ${points(width)} 0 0 ${points(height)} 0 0 cm /Page Do Q`;

    pageObjects.push([
      [
        text(
          `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
            `/ColorSpace [/Indexed /DeviceRGB 15 <${palette}>] /BitsPerComponent 4 ` +
            `/Filter /FlateDecode /Length ${data.length} >>\nstream\n`
        ),
        data,
        text('\nendstream'),
      ],
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      (tree) =>
        `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${points(width)} ${points(height)}] ` +
        `/Resources << /XObject << /Page %IMAGE% 0 R >> >> /Contents %CONTENT% 0 R >>`,
    ]);
  }

  object('<< /Type /Catalog /Pages 2 0 R >>');

  const pagesAt = 3;
  const kidsOf = pageObjects.map((_, index) => pagesAt + index * 3 + 2);

  object(
    `<< /Type /Pages /Kids [${kidsOf.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${pages.length} >>`
  );

  for (const [image, content, page] of pageObjects) {
    const imageAt = object(image);
    const contentAt = object(content);

    kids.push(
      object(page(2).replace('%IMAGE%', String(imageAt)).replace('%CONTENT%', String(contentAt)))
    );
  }

  const xref = size;

  push(
    text(
      `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n` +
        offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
        `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    )
  );

  const out = new Uint8Array(size);
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}
