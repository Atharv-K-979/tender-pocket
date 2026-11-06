#!/usr/bin/env python3
"""Generate deterministic text-only specification PDFs for the spec-upload journey (S18).

    python3 k6/data/make_spec_pdfs.py            # writes k6/data/spec_text_8p.pdf, spec_text_24p.pdf

Standard library only. Each page carries numbered clauses ("1.1 Display shall ...") with > 80
characters of text, so DocumentGeneratorService treats every page as text (not scanned,
MIN_PAGE_TEXT_CHARS = 80, DocumentGeneratorService.java:1706-1710) and batches 4 pages per AI
call (MAX_NATIVE_PDF_BATCH_PAGES, :1510): 8 pages -> 2 batches, 24 pages -> 6 batches.
The clause numbers become SOURCE CLAUSE KEYS, which the mock AI answers exactly.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ITEMS = ["Multipara Patient Monitor", "Infusion Pump", "Defibrillator", "ECG Machine", "Syringe Pump", "Pulse Oximeter"]
REQS = ["Display shall be minimum 12 inch colour TFT with touch screen",
        "Shall monitor ECG, SpO2, NIBP, temperature and respiration",
        "Battery backup of minimum 4 hours with indicator",
        "Shall be USFDA or CE certified with valid certificate",
        "Alarm limits shall be user adjustable with audio and visual alarms",
        "Warranty of 5 years followed by CMC of 5 years",
        "Supplier shall provide training to clinical staff at site"]


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def page_lines(n: int) -> list[str]:
    item = ITEMS[(n - 1) % len(ITEMS)]
    sec = n
    lines = [f"TECHNICAL SPECIFICATIONS - SCHEDULE {sec}", f"{sec}. {item}"]
    for k, r in enumerate(REQS, start=1):
        lines.append(f"{sec}.{k} {r}.")
    lines.append("The bidder shall submit a clause-by-clause compliance statement for this schedule.")
    return lines


def build_pdf(pages: int) -> bytes:
    objs: list[bytes] = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(pages))
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>".encode())
    font_id = 3 + 2 * pages
    for i in range(pages):
        content_lines = ["BT", "/F1 11 Tf", "14 TL", "56 780 Td"]
        for line in page_lines(i + 1):
            content_lines.append(f"({esc(line)}) Tj T*")
        content_lines.append("ET")
        stream = "\n".join(content_lines).encode("latin-1")
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 {font_id} 0 R >> >> "
                    f"/Contents {4 + 2 * i} 0 R >>".encode())
        objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, o in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def main() -> int:
    for pages in (8, 24):
        p = HERE / f"spec_text_{pages}p.pdf"
        p.write_bytes(build_pdf(pages))
        print(f"wrote {p} ({p.stat().st_size} bytes, {pages} pages)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
