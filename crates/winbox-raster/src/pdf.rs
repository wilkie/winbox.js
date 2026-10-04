//! Pages of palette indices as a PDF: one image a page, four bits a pixel
//! over the palette, deflated, filling a page the size the resolution makes
//! of it. What winbox.js's printer hands a document on as.
//!
//! The deflated bytes are `miniz_oxide`'s at its default level, where the
//! TypeScript engine's are the browser's `CompressionStream`'s: both are
//! the same pixels in the zlib format, but not byte for byte the same file.

use std::fmt::Write;

use crate::device_palette::Rgb;

/// A page's size in points, a seventy-second of an inch, rounded half up as
/// JavaScript's `Math.round` rounds.
fn points(pixels: usize, dpi: usize) -> usize {
    (pixels * 72 * 2 + dpi) / (dpi * 2)
}

/// The pages, each `width` by `height` indices, as a PDF at `dpi` dots an
/// inch, the first sixteen of `colours` its palette.
pub fn pdf_of(
    pages: &[Vec<u8>],
    width: usize,
    height: usize,
    dpi: usize,
    colours: &[Rgb],
) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut offsets: Vec<usize> = Vec::new();
    let mut object = |out: &mut Vec<u8>, body: &[&[u8]]| {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", offsets.len()).as_bytes());

        for piece in body {
            out.extend_from_slice(piece);
        }

        out.extend_from_slice(b"\nendobj\n");
        offsets.len()
    };

    let palette = colours
        .iter()
        .take(16)
        .fold(String::new(), |mut hex, [red, green, blue]| {
            let _ = write!(hex, "{red:02x}{green:02x}{blue:02x}");
            hex
        });
    let row = width.div_ceil(2);
    let (page_width, page_height) = (points(width, dpi), points(height, dpi));

    out.extend_from_slice(b"%PDF-1.4\n");

    // Objects 1 and 2 are the catalogue and the page tree; each page is
    // then its image, its contents and itself.
    let images: Vec<Vec<u8>> = pages
        .iter()
        .map(|page| {
            let mut packed = vec![0u8; row * height];

            for y in 0..height {
                for x in (0..width).step_by(2) {
                    let first = page.get(y * width + x).copied().unwrap_or(0) & 15;
                    let second = if x + 1 < width {
                        page.get(y * width + x + 1).copied().unwrap_or(0) & 15
                    } else {
                        0
                    };

                    packed[y * row + (x >> 1)] = (first << 4) | second;
                }
            }

            miniz_oxide::deflate::compress_to_vec_zlib(&packed, 6)
        })
        .collect();
    let content = format!("q {page_width} 0 0 {page_height} 0 0 cm /Page Do Q");

    object(&mut out, &[b"<< /Type /Catalog /Pages 2 0 R >>"]);

    let kids: Vec<String> = (0..pages.len())
        .map(|index| format!("{} 0 R", 3 + index * 3 + 2))
        .collect();

    object(
        &mut out,
        &[format!(
            "<< /Type /Pages /Kids [{}] /Count {} >>",
            kids.join(" "),
            pages.len()
        )
        .as_bytes()],
    );

    for data in &images {
        let header = format!(
            "<< /Type /XObject /Subtype /Image /Width {width} /Height {height} \
             /ColorSpace [/Indexed /DeviceRGB 15 <{palette}>] /BitsPerComponent 4 \
             /Filter /FlateDecode /Length {} >>\nstream\n",
            data.len()
        );
        let image = object(&mut out, &[header.as_bytes(), data, b"\nendstream"]);
        let contents = object(
            &mut out,
            &[format!(
                "<< /Length {} >>\nstream\n{content}\nendstream",
                content.len()
            )
            .as_bytes()],
        );

        object(
            &mut out,
            &[format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width} {page_height}] \
                 /Resources << /XObject << /Page {image} 0 R >> >> /Contents {contents} 0 R >>"
            )
            .as_bytes()],
        );
    }

    let xref = out.len();
    let mut trailer = format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1);

    for offset in &offsets {
        let _ = writeln!(trailer, "{offset:010} 00000 n ");
    }

    let _ = write!(
        trailer,
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
        offsets.len() + 1
    );
    out.extend_from_slice(trailer.as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lays_out_a_page_and_its_cross_references() {
        let pdf = pdf_of(&[vec![15, 0, 1]], 3, 1, 72, &[[0, 0, 0], [255, 255, 255]]);
        let text = String::from_utf8_lossy(&pdf);

        assert!(text.starts_with("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>"));
        assert!(text.contains("/Kids [5 0 R] /Count 1"));
        assert!(text.contains("/MediaBox [0 0 3 1]"));
        assert!(text.contains("<000000ffffff>"));
        assert!(text.contains("/XObject << /Page 3 0 R >> >> /Contents 4 0 R"));
        assert!(text.contains("xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n"));
        assert!(text.ends_with("%%EOF\n"));

        // Each object where the cross-reference says, counted in bytes.
        let find = |what: &[u8]| pdf.windows(what.len()).position(|at| at == what).unwrap();
        let xref = find(b"xref\n");
        let start = find(b"startxref\n") + 10;
        let tail = String::from_utf8_lossy(&pdf[xref..]).into_owned();

        assert_eq!(
            String::from_utf8_lossy(&pdf[start..]).trim_end_matches("\n%%EOF\n"),
            xref.to_string()
        );

        for (number, line) in tail.lines().skip(3).take(5).enumerate() {
            let offset: usize = line[..10].parse().unwrap();

            assert!(pdf[offset..].starts_with(format!("{} 0 obj\n", number + 1).as_bytes()));
        }
    }

    #[test]
    fn rounds_a_page_to_points_half_up() {
        assert_eq!(points(2550, 300), 612);
        assert_eq!(points(3300, 300), 792);
        assert_eq!(points(25, 300), 6);
        assert_eq!(points(1, 144), 1);
    }
}
