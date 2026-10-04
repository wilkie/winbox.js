//! A document printed: `StartDoc`, `StartPage`, `EndPage`, `EndDoc`,
//! `AbortDoc` and `SetAbortProc`, and the escapes that came before them.
//! **Recorded** by `printing`, with Windows' PostScript driver printing to a
//! file, for what does not depend on the driver:
//!
//! * Every call of a document printed succeeds, by the calls and by the
//!   escapes `STARTDOC`, `NEWFRAME` and `ENDDOC`, and the file is written.
//! * Before `StartDoc`, `StartPage` answers 1, `EndPage` -1 and `EndDoc` 1;
//!   after `AbortDoc`, `EndPage` -1 and `EndDoc` 1.
//! * The abort procedure is called as the document is written, each time
//!   with the printer's device context and nought. How often is the
//!   driver's; winbox.js's printer calls it as each page and the document
//!   are written.
//!
//! Only winbox.js's own printer prints (`printer.rs`); a device context of
//! anything else answers -1 to `StartDoc`, which is not recorded.

use winbox_cpu::{AX, DS, ES, SS};

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::printer::{PrintJob, clear_page, deliver, page_copy, printer_of};
use crate::system::System;

const SP_ERROR: i16 = -1;

const NEWFRAME: i16 = 1;
const ABORTDOC: i16 = 2;
const SETABORTPROC: i16 = 9;
const STARTDOC: i16 = 10;
const ENDDOC: i16 = 11;

fn answer(value: i16) -> Result<Answer, Stop> {
    Ok(Answer::Word(value as u16))
}

/// The abort procedure called, where there is one, with the printer's
/// device context and nought, AX, DS and ES the stack's segment.
async fn call_abort(engine: &Engine, hdc: u16, dc: usize) -> Result<(), Stop> {
    let (procedure, stack) = {
        let system = engine.system();
        let procedure = system
            .printing
            .printers
            .get(&dc)
            .map_or(0, |printer| printer.abort_proc);

        (procedure, system.cpu.segments[SS].selector)
    };

    if procedure != 0 {
        engine
            .call_with(
                procedure,
                &[GuestArg::Word(hdc), GuestArg::Word(0)],
                &[
                    Register::Word(AX, stack),
                    Register::Segment(DS, stack),
                    Register::Segment(ES, stack),
                ],
            )
            .await?;
    }

    Ok(())
}

/// The procedure kept, to be called as the document is written: a number
/// above nought, -1 for a device context not a printer's.
pub fn set_abort_proc(system: &mut System, hdc: u16, procedure: u32) -> i16 {
    let Some(dc) = printer_of(system, hdc) else {
        return SP_ERROR;
    };

    if let Some(printer) = system.printing.printers.get_mut(&dc) {
        printer.abort_proc = procedure;
    }

    1
}

/// A document started, by its name, and its first page cleared.
fn start_doc(system: &mut System, dc: usize, name: Vec<u8>) -> i16 {
    system.printing.started += 1;

    let serial = system.printing.started;

    if let Some(printer) = system.printing.printers.get_mut(&dc) {
        printer.job = Some(PrintJob {
            serial,
            name,
            port: printer.port.clone(),
            page_open: false,
            pages: Vec::new(),
        });
    }

    clear_page(system, dc);
    1
}

/// A document started, its name the `DOCINFO`'s, at most 255 bytes of it.
pub fn start_doc_info(system: &mut System, hdc: u16, info: u32) -> i16 {
    let Some(dc) = printer_of(system, hdc) else {
        return SP_ERROR;
    };
    let mut name = Vec::new();

    if info != 0 {
        let at = (info & 0xffff_0000) | (info.wrapping_add(2) & 0xffff);
        let bytes = system.read_far(at, 4);
        let far = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);

        if far != 0 {
            name = system
                .read_far(far, 255)
                .into_iter()
                .take_while(|&byte| byte != 0)
                .collect();
        }
    }

    start_doc(system, dc, name)
}

/// Answers 1 whether or not a document is being printed (`printing`).
pub fn start_page(system: &mut System, hdc: u16) -> i16 {
    let Some(dc) = printer_of(system, hdc) else {
        return SP_ERROR;
    };
    let printing = system
        .printing
        .printers
        .get(&dc)
        .is_some_and(|printer| printer.job.is_some());

    if printing {
        clear_page(system, dc);

        if let Some(job) = job_of(system, dc) {
            job.page_open = true;
        }
    }

    1
}

fn job_of(system: &mut System, dc: usize) -> Option<&mut PrintJob> {
    system.printing.printers.get_mut(&dc)?.job.as_mut()
}

/// The document dropped, nothing handed on.
pub fn abort_doc(system: &mut System, hdc: u16) -> i16 {
    let Some(dc) = printer_of(system, hdc) else {
        return SP_ERROR;
    };

    if let Some(printer) = system.printing.printers.get_mut(&dc) {
        printer.job = None;
    }

    clear_page(system, dc);
    1
}

/// The page drawn, kept; -1 with no document (`printing`).
async fn end_page(engine: &Engine, hdc: u16) -> Result<i16, Stop> {
    let dc = {
        let mut system = engine.system();
        let Some(dc) = printer_of(&system, hdc) else {
            return Ok(SP_ERROR);
        };

        if job_of(&mut system, dc).is_none() {
            return Ok(SP_ERROR);
        }

        let page = page_copy(&system, dc);

        if let Some(job) = job_of(&mut system, dc) {
            job.pages.push(page);
            job.page_open = false;
        }

        clear_page(&system, dc);
        dc
    };

    call_abort(engine, hdc, dc).await?;
    Ok(1)
}

/// The document handed on; 1 with none (`printing`).
async fn end_doc(engine: &Engine, hdc: u16) -> Result<i16, Stop> {
    let (dc, job) = {
        let mut system = engine.system();
        let Some(dc) = printer_of(&system, hdc) else {
            return Ok(SP_ERROR);
        };
        let Some(open) = job_of(&mut system, dc).map(|job| job.page_open) else {
            return Ok(1);
        };
        // A page drawn and not ended goes with it, as the escape `ENDDOC`
        // has it after the last `NEWFRAME`.
        let page = open.then(|| page_copy(&system, dc));
        let mut job = system
            .printing
            .printers
            .get_mut(&dc)
            .and_then(|printer| printer.job.take())
            .expect("the document");

        job.pages.extend(page);
        (dc, job)
    };

    call_abort(engine, hdc, dc).await?;
    deliver(&mut engine.system(), dc, job);
    Ok(1)
}

/// The escapes a printer takes that came before the calls: `NEWFRAME`, 1,
/// ends a page and starts the next; `ABORTDOC`, 2; `SETABORTPROC`, 9, its
/// procedure in the input; `STARTDOC`, 10, the document's name in the
/// input, `count` bytes of it; `ENDDOC`, 11. Every other escape answers
/// nought, `QUERYESCSUPPORT` too.
async fn printer_escape(
    engine: &Engine,
    hdc: u16,
    escape: i16,
    count: i16,
    input: u32,
) -> Result<i16, Stop> {
    match escape {
        NEWFRAME => {
            let serial = {
                let mut system = engine.system();
                let dc = printer_of(&system, hdc).expect("a printer");
                let Some(job) = job_of(&mut system, dc) else {
                    return Ok(SP_ERROR);
                };

                job.page_open = true;
                job.serial
            };
            let ended = end_page(engine, hdc).await?;
            let mut system = engine.system();

            // The page after it open, if the abort procedure left the
            // document as it was.
            if let Some(dc) = printer_of(&system, hdc)
                && let Some(job) = job_of(&mut system, dc)
                && job.serial == serial
            {
                job.page_open = true;
            }

            Ok(ended)
        }
        ABORTDOC => Ok(abort_doc(&mut engine.system(), hdc)),
        SETABORTPROC => Ok(set_abort_proc(&mut engine.system(), hdc, input)),
        STARTDOC => {
            let mut system = engine.system();
            let dc = printer_of(&system, hdc).expect("a printer");
            let name = if input == 0 {
                Vec::new()
            } else {
                system.read_far(input, usize::try_from(count).unwrap_or(0))
            };
            let started = start_doc(&mut system, dc, name);

            if let Some(job) = job_of(&mut system, dc) {
                job.page_open = true;
            }

            Ok(started)
        }
        ENDDOC => {
            {
                let mut system = engine.system();
                let dc = printer_of(&system, hdc).expect("a printer");

                // The escapes' last page is the one `NEWFRAME` left open;
                // with nothing drawn on it since, there is no page to add.
                if let Some(job) = job_of(&mut system, dc) {
                    job.page_open = false;
                }
            }

            end_doc(engine, hdc).await
        }
        _ => Ok(0),
    }
}

/// `Escape`: a printer's escapes for printing a document, else what the
/// display's driver answers (`calls/escape.rs`).
pub(crate) fn escape_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hdc, number, count, input, printer) = {
            let system = engine.system();
            let hdc = args.word(&system);
            let number = args.signed(&system);
            let count = args.signed(&system);
            let input = args.dword(&system);
            let _output = args.dword(&system);

            (
                hdc,
                number,
                count,
                input,
                printer_of(&system, hdc).is_some(),
            )
        };

        if printer {
            return answer(printer_escape(engine, hdc, number, count, input).await?);
        }

        answer(super::calls::escape(&engine.system(), hdc, number, input))
    })
}

fn start_doc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let info = args.dword(system);

    answer(start_doc_info(system, hdc, info))
}

fn start_page_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);

    answer(start_page(system, hdc))
}

fn abort_doc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);

    answer(abort_doc(system, hdc))
}

fn set_abort_proc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let procedure = args.dword(system);

    answer(set_abort_proc(system, hdc, procedure))
}

fn end_page_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hdc = args.word(&engine.system());

        answer(end_page(engine, hdc).await?)
    })
}

fn end_doc_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hdc = args.word(&engine.system());

        answer(end_doc(engine, hdc).await?)
    })
}

pub fn implementation(name: &str) -> Option<crate::call::Implementation> {
    use crate::call::Implementation::{Async, Sync};

    Some(match name {
        "StartDoc" => Sync(start_doc_call),
        "StartPage" => Sync(start_page_call),
        "EndPage" => Async(end_page_call),
        "EndDoc" => Async(end_doc_call),
        "AbortDoc" => Sync(abort_doc_call),
        "SetAbortProc" => Sync(set_abort_proc_call),
        "GetSpoolJob" => Sync(super::spool_job::get_spool_job_call),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::printer::create_printer_dc;

    #[test]
    fn answers_out_of_order_as_recorded() {
        let mut system = System::new();
        let hdc = create_printer_dc(&mut system, "LPT1:".to_string());

        assert_eq!(start_page(&mut system, hdc), 1);
        assert_eq!(set_abort_proc(&mut system, hdc, 0x1234_0010), 1);
        assert_eq!(start_doc_info(&mut system, hdc, 0), 1);
        assert_eq!(start_page(&mut system, hdc), 1);
        assert_eq!(abort_doc(&mut system, hdc), 1);
        assert!(
            system
                .printing
                .printers
                .values()
                .all(|printer| printer.job.is_none())
        );
    }

    #[test]
    fn a_context_not_a_printers_answers_an_error() {
        let mut system = System::new();
        let hdc = crate::gdi::dc::create_dc(&mut system, b"DISPLAY").unwrap();

        assert_eq!(start_doc_info(&mut system, hdc, 0), SP_ERROR);
        assert_eq!(start_page(&mut system, hdc), SP_ERROR);
        assert_eq!(abort_doc(&mut system, hdc), SP_ERROR);
        assert_eq!(set_abort_proc(&mut system, hdc, 0), SP_ERROR);
    }

    /// A call's future run through, as one with no abort procedure to
    /// call is never left waiting.
    fn now<T>(future: impl Future<Output = Result<T, Stop>>) -> T {
        let mut future = std::pin::pin!(future);
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());

        match future.as_mut().poll(&mut context) {
            std::task::Poll::Ready(answer) => answer.expect("an answer"),
            std::task::Poll::Pending => panic!("left waiting"),
        }
    }

    /// Bytes put in a block of global memory: their far pointer.
    fn scratch(system: &mut System, bytes: &[u8]) -> u32 {
        let index = system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, 64, 0x42)
            .expect("a block");
        let far = u32::from(winbox_machine::segment_selector(index)) << 16;

        system.write_far(far, bytes);
        far
    }

    #[test]
    fn the_escapes_print_the_pages_newframe_ended() {
        let mut system = System::new();
        let hdc = create_printer_dc(&mut system, "LPT1:".to_string());
        let dc = printer_of(&system, hdc).unwrap();
        let name = scratch(&mut system, b"AB\0CD");
        let engine = Engine::new(system);

        assert_eq!(now(printer_escape(&engine, hdc, NEWFRAME, 0, 0)), SP_ERROR);
        // The name is the count's bytes of the input, noughts and all.
        assert_eq!(now(printer_escape(&engine, hdc, STARTDOC, 4, name)), 1);
        assert_eq!(
            job_of(&mut engine.system(), dc).unwrap().name,
            b"AB\0C".to_vec()
        );
        assert!(job_of(&mut engine.system(), dc).unwrap().page_open);
        assert_eq!(now(printer_escape(&engine, hdc, NEWFRAME, 0, 0)), 1);
        assert_eq!(now(printer_escape(&engine, hdc, NEWFRAME, 0, 0)), 1);
        assert!(job_of(&mut engine.system(), dc).unwrap().page_open);
        assert_eq!(now(printer_escape(&engine, hdc, 8, 2, name)), 0);
        // ENDDOC adds no page of its own: two NEWFRAMEs, two pages.
        assert_eq!(now(printer_escape(&engine, hdc, ENDDOC, 0, 0)), 1);

        let system = engine.into_system();
        let printed = &system.printing.printed;

        assert_eq!(printed.len(), 1);
        assert_eq!(printed[0].name, b"AB\0C".to_vec());
        assert!(
            String::from_utf8_lossy(&printed[0].pdf).contains("/Count 2 >>"),
            "two pages"
        );
    }

    #[test]
    fn a_name_of_a_count_below_nought_is_empty() {
        let mut system = System::new();
        let hdc = create_printer_dc(&mut system, "LPT1:".to_string());
        let dc = printer_of(&system, hdc).unwrap();
        let name = scratch(&mut system, b"AB");
        let engine = Engine::new(system);

        assert_eq!(now(printer_escape(&engine, hdc, STARTDOC, -1, name)), 1);
        assert!(job_of(&mut engine.system(), dc).unwrap().name.is_empty());
    }

    #[test]
    fn end_doc_takes_the_page_left_open() {
        let mut system = System::new();
        let hdc = create_printer_dc(&mut system, "LPT1:".to_string());
        let title = scratch(&mut system, b"Title\0");
        // A DOCINFO: its size, then the far pointer to the name.
        let info = scratch(&mut system, &[]);
        let mut docinfo = vec![10, 0];

        docinfo.extend_from_slice(&title.to_le_bytes());
        system.write_far(info, &docinfo);

        let engine = Engine::new(system);

        assert_eq!(now(end_page(&engine, hdc)), SP_ERROR);
        assert_eq!(now(end_doc(&engine, hdc)), 1);
        assert_eq!(start_doc_info(&mut engine.system(), hdc, info), 1);
        assert_eq!(start_page(&mut engine.system(), hdc), 1);
        assert_eq!(now(end_page(&engine, hdc)), 1);
        assert_eq!(start_page(&mut engine.system(), hdc), 1);
        assert_eq!(now(end_doc(&engine, hdc)), 1);
        assert_eq!(now(end_doc(&engine, hdc)), 1);

        let system = engine.into_system();
        let printed = &system.printing.printed;

        assert_eq!(printed.len(), 1);
        assert_eq!(printed[0].name, b"Title".to_vec());
        assert!(String::from_utf8_lossy(&printed[0].pdf).contains("/Count 2 >>"));
    }

    #[test]
    fn the_printer_has_its_own_capabilities() {
        let mut system = System::new();
        let hdc = create_printer_dc(&mut system, "LPT1:".to_string());

        assert_eq!(crate::gdi::get_device_caps(&system, hdc, 8), 2550);
        assert_eq!(crate::gdi::get_device_caps(&system, hdc, 10), 3300);
        assert_eq!(crate::gdi::get_device_caps(&system, hdc, 2), 2);
        assert_eq!(crate::gdi::get_device_caps(&system, hdc, 90), 300);
        assert_eq!(crate::gdi::get_device_caps(&system, hdc, 16), 0xffff);
    }
}
