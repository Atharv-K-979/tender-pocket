#!/usr/bin/env python3
"""
generate_bid_docx.py
High-fidelity Microsoft Word (.docx) generator for Bid Documents.
Supports both Portrait and Landscape orientations for Mark Enterprises and Marken Healthtech.
Uses authentic letterhead templates (ME_Portrait / Healthtech_Portrait / ME_Landscape / Healthtech_Landscape)
to preserve exact native headers, footers, watermarks, drawingML shapes, and margins without OpenXML corruption.
"""

import sys
import os
import json
import argparse
import docx
from docx.shared import Inches, Pt, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.enum.section import WD_ORIENT
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

def resolve_path(candidates):
    for c in candidates:
        if c and os.path.exists(c):
            return os.path.abspath(c)
    return candidates[0] if candidates else None

def get_root_dir():
    here = os.path.abspath(os.path.dirname(__file__))
    candidates = [
        os.path.abspath(os.path.join(here, '..')), # frontend
        os.path.abspath(os.path.join(here, '../..')), # tender-pocket root
        os.getcwd(),
        os.path.abspath(os.path.join(os.getcwd(), 'frontend'))
    ]
    for c in candidates:
        if os.path.exists(os.path.join(c, 'public', 'letterheads', 'ME_Portrait.docx')):
            return c
        if os.path.exists(os.path.join(c, 'frontend', 'public', 'letterheads', 'ME_Portrait.docx')):
            return os.path.join(c, 'frontend')
    return os.getcwd()

# ---------------------------------------------------------------------------
# OpenXML Table Styling Helpers
# ---------------------------------------------------------------------------

def set_cell_margins(cell, top=70, bottom=70, left=70, right=70):
    """Set cell padding in twips/dxa (20 dxa = 1 pt)."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(
        f'<w:tcMar {nsdecls("w")}>'
        f'<w:top w:w="{top}" w:type="dxa"/>'
        f'<w:bottom w:w="{bottom}" w:type="dxa"/>'
        f'<w:left w:w="{left}" w:type="dxa"/>'
        f'<w:right w:w="{right}" w:type="dxa"/>'
        f'</w:tcMar>'
    )
    tcPr.append(tcMar)

def set_cell_shading(cell, color_hex):
    """Set background fill color for a table cell. FFFFFF/clear/none is skipped to keep cell transparent over watermark."""
    if not color_hex or color_hex.upper() in ('FFFFFF', 'NONE', 'CLEAR', 'TRANSPARENT'):
        return
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{color_hex}"/>')
    tcPr.append(shd)

def set_cell_border(cell, top=None, bottom=None, left=None, right=None):
    """Set individual borders on a cell."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = parse_xml(f'<w:tcBorders {nsdecls("w")}/>')
    if top:
        tcBorders.append(parse_xml(f'<w:top {nsdecls("w")} w:val="{top.get("val", "single")}" w:sz="{top.get("sz", 4)}" w:space="0" w:color="{top.get("color", "auto")}"/>'))
    if bottom:
        tcBorders.append(parse_xml(f'<w:bottom {nsdecls("w")} w:val="{bottom.get("val", "single")}" w:sz="{bottom.get("sz", 4)}" w:space="0" w:color="{bottom.get("color", "auto")}"/>'))
    if left:
        tcBorders.append(parse_xml(f'<w:left {nsdecls("w")} w:val="{left.get("val", "single")}" w:sz="{left.get("sz", 4)}" w:space="0" w:color="{left.get("color", "auto")}"/>'))
    if right:
        tcBorders.append(parse_xml(f'<w:right {nsdecls("w")} w:val="{right.get("val", "single")}" w:sz="{right.get("sz", 4)}" w:space="0" w:color="{right.get("color", "auto")}"/>'))
    tcPr.append(tcBorders)

def set_table_borders_none(tbl):
    """Make table borders invisible."""
    tbl.style = None
    tblPr = tbl._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        f'<w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/>'
        f'<w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/>'
        f'</w:tblBorders>'
    )
    tblPr.append(borders)

def set_row_cant_split(row):
    """Prevent table row from splitting across a page boundary."""
    trPr = row._tr.get_or_add_trPr()
    trPr.append(parse_xml(f'<w:cantSplit {nsdecls("w")}/>'))

def set_repeat_header(row):
    """Repeat header row on each page if table splits."""
    trPr = row._tr.get_or_add_trPr()
    trPr.append(parse_xml(f'<w:tblHeader {nsdecls("w")}/>'))

# ---------------------------------------------------------------------------
# Bid document typography (both companies): Cambria headings + Cambria body,
# Portrait A4: 12pt body text, 16pt headings (subtitles 14pt). Landscape keeps its compact sizes
# because the single-page declarations do not fit an A4 landscape page at 12pt.
# ---------------------------------------------------------------------------

BID_FONT = 'Cambria'
BID_BODY_PT = 12
BID_HEADING_MIN_PT = 14
BID_HEADING_MAX_PT = 16
_FIXED_SIZE_TABLES = set()


def set_page_break_before(paragraph_element):
    """Start a new page at this paragraph (pageBreakBefore) instead of inserting a separate break paragraph.

    A separate break paragraph lands on a fresh page when the previous page is exactly full, which
    produced blank pages between bid documents.
    """
    pPr = paragraph_element.get_or_add_pPr()
    if pPr.find(qn('w:pageBreakBefore')) is None:
        pPr.insert(0, OxmlElement('w:pageBreakBefore'))


def first_paragraph_after(body, marker):
    """First w:p appended to the body after the element `marker` (searching into tables)."""
    started = marker is None
    for child in body.iterchildren():
        if not started:
            started = child is marker
            continue
        if child.tag == qn('w:p'):
            return child
        if child.tag == qn('w:tbl'):
            p_in_tbl = child.find('.//' + qn('w:p'))
            if p_in_tbl is not None:
                return p_in_tbl
    return None


def fix_table_grid(tbl, widths):
    """Lock a table to explicit column widths (fixed layout) so Word cannot widen it past the margins.

    Widths are applied to the grid and to every cell, including merged header cells (gridSpan).
    """
    total = sum(int(w) for w in widths)
    tblPr = tbl._tbl.tblPr
    for tag in ('w:tblW', 'w:tblLayout'):
        old = tblPr.find(qn(tag))
        if old is not None:
            tblPr.remove(old)
    tblPr.append(parse_xml(f'<w:tblW {nsdecls("w")} w:w="{total // 635}" w:type="dxa"/>'))
    tblPr.append(parse_xml(f'<w:tblLayout {nsdecls("w")} w:type="fixed"/>'))
    old_mar = tblPr.find(qn('w:tblCellMar'))
    if old_mar is not None:
        tblPr.remove(old_mar)
    # Narrow side padding (2.5pt) so long e-mail ids and 10-digit mobile numbers stay on one line
    tblPr.append(parse_xml(f'<w:tblCellMar {nsdecls("w")}><w:left w:w="50" w:type="dxa"/><w:right w:w="50" w:type="dxa"/></w:tblCellMar>'))
    for gc, w in zip(tbl._tbl.tblGrid.findall(qn('w:gridCol')), widths):
        gc.set(qn('w:w'), str(int(w) // 635))
    for tr in tbl._tbl.tr_lst:
        col = 0
        for tc in tr.tc_lst:
            span = tc.grid_span
            if col < len(widths):
                tc.width = Emu(sum(int(w) for w in widths[col:col + span]))
            col += span


def keep_table_font_size(tbl):
    """Exclude a dense directory table (service stations, matrix) from the 12pt normalisation."""
    _FIXED_SIZE_TABLES.add(tbl._tbl)


def apply_bid_typography(doc, body_pt=BID_BODY_PT, heading_min_pt=BID_HEADING_MIN_PT):
    """Force Cambria on every body run and normalise sizes: body text -> 12pt, headings -> 14-16pt.

    Letterhead header/footer parts are separate XML parts and are not touched.
    """
    from docx.text.run import Run
    # Word's "single" spacing for Cambria is already ~1.17x the font size, so multiples above 1.0
    # (1.15 / 1.18 / 1.2) make lines ~15% taller than the PDF version. Normalise to single spacing.
    for spacing in doc.element.body.iter(qn('w:spacing')):
        line = spacing.get(qn('w:line'))
        rule = spacing.get(qn('w:lineRule'))
        if line is not None and rule in (None, 'auto') and int(line) > 240:
            spacing.set(qn('w:line'), '240')
    # Table cells are always left aligned: justified text in narrow columns stretches the word gaps.
    for tbl in doc.element.body.iter(qn('w:tbl')):
        for jc in tbl.iter(qn('w:jc')):
            if jc.getparent().tag == qn('w:pPr') and jc.get(qn('w:val')) in ('both', 'distribute'):
                jc.set(qn('w:val'), 'left')
    for r_elm in doc.element.body.iter(qn('w:r')):
        if r_elm.find(qn('w:t')) is None:
            continue
        run = Run(r_elm, None)
        run.font.name = BID_FONT
        rFonts = run._r.get_or_add_rPr().get_or_add_rFonts()
        for attr in ('w:eastAsia', 'w:cs'):
            rFonts.set(qn(attr), BID_FONT)
        anc = r_elm.getparent()
        while anc is not None and anc.tag != qn('w:tbl'):
            anc = anc.getparent()
        if anc is not None and anc in _FIXED_SIZE_TABLES:
            continue
        size = run.font.size.pt if run.font.size is not None else None
        if size is not None and size >= 13:
            run.font.size = Pt(min(BID_HEADING_MAX_PT, max(heading_min_pt, size)))
        else:
            run.font.size = Pt(body_pt)

# ---------------------------------------------------------------------------
# Formatting Helpers
# ---------------------------------------------------------------------------

def is_doc_landscape(doc):
    """Check if the first section of the document is landscape."""
    try:
        return doc.sections[0].page_width > doc.sections[0].page_height
    except Exception:
        return False

def add_heading(doc, text, is_theme_a, subtitle=None, doc_date=None):
    """Add standardized document heading."""
    landscape = is_doc_landscape(doc)
    if not landscape:
        p_blank = doc.add_paragraph()
        p_blank.paragraph_format.space_before = Pt(0)
        p_blank.paragraph_format.space_after = Pt(0)
        p_blank.paragraph_format.line_spacing = Pt(4)
        r_blank = p_blank.add_run()
        r_blank.font.size = Pt(2)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(0) if landscape else Pt(4)
    p.paragraph_format.space_after = Pt(2) if (subtitle or landscape) else Pt(6)
    p.paragraph_format.keep_with_next = True

    r = p.add_run(text)
    r.bold = True
    r.font.name = BID_FONT
    r.font.size = Pt(14) if landscape else Pt(16)
    r.font.color.rgb = RGBColor(0, 0, 0)
    r.font.underline = True

    if subtitle:
        p_sub = doc.add_paragraph()
        p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_sub.paragraph_format.space_before = Pt(0)
        p_sub.paragraph_format.space_after = Pt(2) if landscape else Pt(6)
        p_sub.paragraph_format.keep_with_next = True
        r_sub = p_sub.add_run(subtitle)
        r_sub.bold = True
        r_sub.italic = True if is_theme_a else False
        r_sub.font.name = BID_FONT
        r_sub.font.size = Pt(14) if (is_theme_a or not landscape) else Pt(10)
        r_sub.font.color.rgb = RGBColor(0, 0, 0)

    if doc_date and not is_theme_a:
        p_d = doc.add_paragraph()
        p_d.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        p_d.paragraph_format.space_before = Pt(0)
        p_d.paragraph_format.space_after = Pt(2) if landscape else Pt(4)
        p_d.paragraph_format.keep_with_next = True
        r_d = p_d.add_run(f"Date: {doc_date}")
        r_d.bold = False
        r_d.font.name = 'Cambria'
        r_d.font.size = Pt(9.5) if landscape else Pt(10)

def add_address_block(doc, authority_name, authority_dept, authority_address, is_theme_a):
    """Add recipient authority address block."""
    landscape = is_doc_landscape(doc)
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(1) if landscape else Pt(2)
    p.paragraph_format.space_after = Pt(2) if landscape else Pt(4)
    p.paragraph_format.line_spacing = 1.15
    p.paragraph_format.keep_with_next = True

    font_name = BID_FONT
    font_size = (Pt(11) if is_theme_a else Pt(10)) if landscape else (Pt(12) if is_theme_a else Pt(10))

    r_to = p.add_run("To,\n" if is_theme_a else "To\n")
    if is_theme_a:
        r_to.bold = True
    r_to.font.name = font_name
    r_to.font.size = font_size

    if authority_name:
        for line in authority_name.split('\n'):
            line = line.strip()
            if line:
                r_name = p.add_run(f"{line}\n")
                if is_theme_a:
                    r_name.bold = True
                r_name.font.name = font_name
                r_name.font.size = font_size

    if authority_dept and authority_dept.strip():
        r_dept = p.add_run(f"{authority_dept.strip()}\n")
        r_dept.font.name = font_name
        r_dept.font.size = font_size

    if authority_address and authority_address.strip():
        r_addr = p.add_run(f"{authority_address.strip()}\n")
        r_addr.font.name = font_name
        r_addr.font.size = font_size

    # Drop the trailing line break so the block does not end with an empty line
    if p.runs and p.runs[-1].text.endswith('\n'):
        p.runs[-1].text = p.runs[-1].text[:-1]

def add_subject_ref(doc, subject, ref_label, bid_number, bid_date, is_theme_a):
    """Add subject and reference line."""
    landscape = is_doc_landscape(doc)
    font_name = BID_FONT
    font_size = (Pt(11) if is_theme_a else Pt(10)) if landscape else (Pt(12) if is_theme_a else Pt(10))

    if subject:
        p_s = doc.add_paragraph()
        p_s.paragraph_format.space_before = Pt(1) if landscape else Pt(2)
        p_s.paragraph_format.space_after = Pt(1) if landscape else Pt(2)
        p_s.paragraph_format.keep_with_next = True
        r_lbl = p_s.add_run("Subject\t: " if not is_theme_a else "Subject: ")
        r_lbl.bold = True
        r_lbl.font.name = font_name
        r_lbl.font.size = font_size
        r_val = p_s.add_run(subject.strip())
        r_val.bold = True
        r_val.font.name = font_name
        r_val.font.size = font_size

    p_r = doc.add_paragraph()
    p_r.paragraph_format.space_before = Pt(1) if landscape else Pt(2)
    p_r.paragraph_format.space_after = Pt(3) if landscape else Pt(5)
    p_r.paragraph_format.keep_with_next = True
    r_rlbl = p_r.add_run(f"{ref_label}\t: " if not is_theme_a else f"{ref_label}: ")
    r_rlbl.bold = True
    r_rlbl.font.name = font_name
    r_rlbl.font.size = font_size
    r_rval = p_r.add_run(f"Bid No.: {bid_number.strip()}, Dated: {bid_date.strip()}.")
    r_rval.bold = True
    r_rval.font.name = font_name
    r_rval.font.size = font_size

def add_body_paragraph(doc, text, is_theme_a, bold=False, italic=False, space_after=5, bullet=None, keep_with_next=False, line_spacing=None, font_size=None):
    """Add standard body paragraph with precise font, spacing, and justification."""
    landscape = is_doc_landscape(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.space_before = Pt(0)
    
    act_space_after = min(space_after, 4) if landscape else space_after
    act_line_spacing = line_spacing if line_spacing is not None else (1.15)

    p.paragraph_format.space_after = Pt(act_space_after)
    p.paragraph_format.line_spacing = act_line_spacing
    if keep_with_next:
        p.paragraph_format.keep_with_next = True

    font_name = BID_FONT
    if font_size is None:
        font_size = (Pt(11) if is_theme_a else Pt(10)) if landscape else (Pt(12) if is_theme_a else Pt(10))

    if bullet:
        r_b = p.add_run(f"{bullet} ")
        r_b.bold = True
        r_b.font.name = font_name
        r_b.font.size = font_size

    r = p.add_run(text)
    r.bold = bold
    r.italic = italic
    r.font.name = font_name
    r.font.size = font_size
    return p

def add_signatory_block(doc, profile, is_theme_a, root_dir, place, date, is_landscape=False):
    """Add side-by-side signature & stamp block with horizontal details alignment in landscape."""
    landscape = is_landscape or is_doc_landscape(doc)
    font_name = BID_FONT

    # Header line: "On behalf of..."
    p_hdr = doc.add_paragraph()
    p_hdr.paragraph_format.space_before = Pt(2) if landscape else Pt(3)
    p_hdr.paragraph_format.space_after = Pt(2)
    p_hdr.paragraph_format.keep_with_next = True
    
    hdr_text = f"On behalf of {profile['short_name']}" if is_theme_a else f"For and on behalf of {profile['legal_name']}"
    r_hdr = p_hdr.add_run(hdr_text)
    r_hdr.bold = True
    r_hdr.italic = True if is_theme_a else False
    r_hdr.font.name = font_name
    r_hdr.font.size = (Pt(10.5) if is_theme_a else Pt(10)) if landscape else (Pt(12) if is_theme_a else Pt(10))

    sig_file = profile.get('sig_path')
    stamp_file = profile.get('stamp_path')

    if landscape:
        stamp_sig_img = 'me_stamp_sig.png' if is_theme_a else 'healthtech_stamp_sig.png'
        stamp_sig_path = resolve_path([
            os.path.join(root_dir, 'public', 'images', stamp_sig_img),
            os.path.join(root_dir, 'frontend', 'public', 'images', stamp_sig_img),
            os.path.join(root_dir, 'public', 'assets', 'brand', 'mark-enterprises' if is_theme_a else 'marken-healthtech', 'stamp_sig.png'),
            os.path.join(root_dir, 'frontend', 'public', 'assets', 'brand', 'mark-enterprises' if is_theme_a else 'marken-healthtech', 'stamp_sig.png')
        ])

        if stamp_sig_path and os.path.exists(stamp_sig_path):
            # 2 columns [Details | Single Combined Sign & Stamp]
            tbl = doc.add_table(rows=1, cols=2)
            tbl.autofit = False
            tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
            set_table_borders_none(tbl)
            set_row_cant_split(tbl.rows[0])

            w_det = Inches(2.55 if is_theme_a else 3.2)
            w_sig = Inches(2.45 if is_theme_a else 2.2)

            c_det = tbl.rows[0].cells[0]
            c_det.width = w_det
            c_det.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            set_cell_margins(c_det, top=0, bottom=0, left=0, right=10)
            p_det = c_det.paragraphs[0]
            p_det.paragraph_format.space_before = Pt(0)
            p_det.paragraph_format.space_after = Pt(0)
            p_det.paragraph_format.line_spacing = 1.15
            p_det.paragraph_format.keep_with_next = True

            r_nm = p_det.add_run(f"Name: {profile['signatory_name']}\n")
            r_nm.bold = True
            r_nm.font.name = font_name
            r_nm.font.size = Pt(10.5) if is_theme_a else Pt(10)

            if is_theme_a:
                r_ds = p_det.add_run(f"{profile['signatory_designation']}\n")
                r_ds.font.name = font_name
                r_ds.font.size = Pt(10)

                r_pd = p_det.add_run(f"Place: {place}\nDate: {date}")
                r_pd.font.name = font_name
                r_pd.font.size = Pt(10)
            else:
                r_ds = p_det.add_run(f"{profile['signatory_designation']}")
                r_ds.font.name = font_name
                r_ds.font.size = Pt(9.5)

            c_img = tbl.rows[0].cells[1]
            c_img.width = w_sig
            c_img.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            set_cell_margins(c_img, top=0, bottom=0, left=10, right=0)
            p_img = c_img.paragraphs[0]
            p_img.paragraph_format.space_before = Pt(0)
            p_img.paragraph_format.space_after = Pt(0)
            p_img.paragraph_format.keep_with_next = True

            try:
                r_img = p_img.add_run()
                r_img.add_picture(stamp_sig_path, width=Inches(2.3 if is_theme_a else 2.0))
            except Exception:
                p_img.add_run("(Signature & Stamp)")
        else:
            # Fallback 3 columns [Details | Signature | Stamp]
            tbl = doc.add_table(rows=1, cols=3)
            tbl.autofit = False
            tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
            set_table_borders_none(tbl)
            set_row_cant_split(tbl.rows[0])

            w_det = Inches(3.0)
            w_sig = Inches(1.85)
            w_st = Inches(1.4)

            c_det = tbl.rows[0].cells[0]
            c_det.width = w_det
            c_det.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            p_det = c_det.paragraphs[0]
            p_det.paragraph_format.space_before = Pt(0)
            p_det.paragraph_format.space_after = Pt(0)
            p_det.paragraph_format.line_spacing = 1.15
            p_det.paragraph_format.keep_with_next = True

            r_nm = p_det.add_run(f"Name: {profile['signatory_name']}\n")
            r_nm.bold = True
            r_nm.font.name = font_name
            r_nm.font.size = Pt(10.5) if is_theme_a else Pt(10)

            if is_theme_a:
                r_ds = p_det.add_run(f"{profile['signatory_designation']}\n")
                r_ds.font.name = font_name
                r_ds.font.size = Pt(10)

                r_pd = p_det.add_run(f"Place: {place}\nDate: {date}")
                r_pd.font.name = font_name
                r_pd.font.size = Pt(10)
            else:
                r_ds = p_det.add_run(f"{profile['signatory_designation']}")
                r_ds.font.name = font_name
                r_ds.font.size = Pt(9.5)

            c_sig = tbl.rows[0].cells[1]
            c_sig.width = w_sig
            c_sig.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            p_sig = c_sig.paragraphs[0]
            p_sig.paragraph_format.space_before = Pt(0)
            p_sig.paragraph_format.space_after = Pt(0)
            p_sig.paragraph_format.keep_with_next = True
            if sig_file and os.path.exists(sig_file):
                try:
                    r_img = p_sig.add_run()
                    r_img.add_picture(sig_file, width=Inches(1.7))
                except Exception:
                    p_sig.add_run("(Signature)")
            else:
                p_sig.add_run("(Signature)")

            c_stamp = tbl.rows[0].cells[2]
            c_stamp.width = w_st
            c_stamp.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            p_stamp = c_stamp.paragraphs[0]
            p_stamp.paragraph_format.space_before = Pt(0)
            p_stamp.paragraph_format.space_after = Pt(0)
            p_stamp.paragraph_format.keep_with_next = True
            if stamp_file and os.path.exists(stamp_file):
                try:
                    r_st = p_stamp.add_run()
                    r_st.add_picture(stamp_file, width=Inches(1.2))
                except Exception:
                    p_stamp.add_run("(Seal / Stamp)")
            else:
                p_stamp.add_run("(Seal / Stamp)")
    else:
        # Portrait Mode
        stamp_sig_img = 'me_stamp_sig.png' if is_theme_a else 'healthtech_stamp_sig.png'
        stamp_sig_path = resolve_path([
            os.path.join(root_dir, 'public', 'images', stamp_sig_img),
            os.path.join(root_dir, 'frontend', 'public', 'images', stamp_sig_img),
            os.path.join(root_dir, 'public', 'assets', 'brand', 'mark-enterprises' if is_theme_a else 'marken-healthtech', 'stamp_sig.png'),
            os.path.join(root_dir, 'frontend', 'public', 'assets', 'brand', 'mark-enterprises' if is_theme_a else 'marken-healthtech', 'stamp_sig.png')
        ])
        if stamp_sig_path and os.path.exists(stamp_sig_path):
            p_img = doc.add_paragraph()
            p_img.paragraph_format.space_before = Pt(1)
            p_img.paragraph_format.space_after = Pt(1)
            p_img.paragraph_format.keep_with_next = True
            r_img = p_img.add_run()
            r_img.add_picture(stamp_sig_path, width=Inches(2.3 if is_theme_a else 2.05))
        else:
            # Fallback 2 columns [Signature | Stamp]
            tbl = doc.add_table(rows=1, cols=2)
            tbl.autofit = False
            tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
            set_table_borders_none(tbl)
            set_row_cant_split(tbl.rows[0])

            c_sig = tbl.rows[0].cells[0]
            c_sig.width = Inches(2.6)
            c_sig.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            p_sig = c_sig.paragraphs[0]
            p_sig.paragraph_format.space_before = Pt(0)
            p_sig.paragraph_format.space_after = Pt(0)
            p_sig.paragraph_format.keep_with_next = True
            if sig_file and os.path.exists(sig_file):
                try:
                    r_img = p_sig.add_run()
                    r_img.add_picture(sig_file, width=Inches(2.25))
                except Exception:
                    p_sig.add_run("(Signature)")
            else:
                p_sig.add_run("(Signature)")

            c_stamp = tbl.rows[0].cells[1]
            c_stamp.width = Inches(2.0)
            c_stamp.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            p_stamp = c_stamp.paragraphs[0]
            p_stamp.paragraph_format.space_before = Pt(0)
            p_stamp.paragraph_format.space_after = Pt(0)
            p_stamp.paragraph_format.keep_with_next = True
            if stamp_file and os.path.exists(stamp_file):
                try:
                    r_st = p_stamp.add_run()
                    r_st.add_picture(stamp_file, width=Inches(1.45))
                except Exception:
                    p_stamp.add_run("(Seal / Stamp)")
            else:
                p_stamp.add_run("(Seal / Stamp)")

        p_det = doc.add_paragraph()
        p_det.paragraph_format.space_before = Pt(1)
        p_det.paragraph_format.space_after = Pt(0)
        p_det.paragraph_format.line_spacing = 1.15
        # last paragraph of the document: must not be kept with the next document's first line

        r_nm = p_det.add_run(f"Name: {profile['signatory_name']}\n")
        r_nm.bold = True
        r_nm.font.name = font_name
        r_nm.font.size = Pt(12) if is_theme_a else Pt(10)

        if is_theme_a:
            r_ds = p_det.add_run(f"{profile['signatory_designation']}\n")
            r_ds.font.name = font_name
            r_ds.font.size = Pt(12)

            r_pd = p_det.add_run(f"Place: {place}\nDate: {date}")
            r_pd.font.name = font_name
            r_pd.font.size = Pt(12)
        else:
            r_ds = p_det.add_run(f"{profile['signatory_designation']}")
            r_ds.font.name = font_name
            r_ds.font.size = Pt(10)

# ---------------------------------------------------------------------------
# Document Builders (1 to 20)
# ---------------------------------------------------------------------------

def build_doc_1(doc, p, d, a):
    """Doc 1: Bidder Particulars / Information"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    add_heading(doc, "BIDDER PARTICULARS" if a else "BIDDER INFORMATION", a, doc_date=d.get('date'))
    
    if a:
        rows_data = [
            ("Address of the Bidder", f": {p['full_address']}"),
            ("Name of the Manufacturer", f": {p['manufacturer_name']}"),
            ("Address of the Manufacturer", f": {p['manufacturer_address']}"),
            ("Name and address of the person\nTo whom all references shall be made\nregarding this tender inquiry.", f": Mr. {p['signatory_name']}\n: Address: {p.get('signatory_address') or p['full_address']}"),
            ("Mobile no", f": {p['phones'][1] if len(p['phones']) > 1 else p['phones'][0]}"),
            ("Telephone", ": 0253-299 5112"),
            ("Telex", ": NA"),
            ("Fax", ": NA"),
            ("Email address", ": info@markworld.com / tender@markenworld.com"),
            ("Witness", f": {p.get('witness_details') or 'Mr. Shreedhar Shingare (Cell No.: 09011104332)'}")
        ]
        tbl = doc.add_table(rows=len(rows_data) + 1, cols=2)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        tbl.autofit = False

        font_name = BID_FONT
        hdr_color = '4F81BD'

        hdr_cells = tbl.rows[0].cells
        set_repeat_header(tbl.rows[0])
        set_row_cant_split(tbl.rows[0])
        hdr_cells[0].text = "Name of the Bidder"
        hdr_cells[1].text = p['short_name']
        w0 = Inches(4.2) if is_landscape else Inches(3.2)
        w1 = Inches(6.4) if is_landscape else Inches(4.3)
        hdr_cells[0].width = w0
        hdr_cells[1].width = w1

        for c_idx, c in enumerate(hdr_cells):
            set_cell_shading(c, hdr_color)
            set_cell_margins(c, top=50 if is_landscape else 75, bottom=50 if is_landscape else 75, left=70, right=70)
            if not is_landscape:
                # Remove middle line of partition between col 0 and col 1
                set_cell_border(c,
                    top={'color': hdr_color, 'sz': 8},
                    bottom={'color': hdr_color, 'sz': 8},
                    left={'color': hdr_color, 'sz': 8} if c_idx == 0 else None,
                    right={'color': hdr_color, 'sz': 8} if c_idx == 1 else None
                )
            else:
                set_cell_border(c, top={'color': hdr_color, 'sz': 8}, bottom={'color': hdr_color, 'sz': 8}, left={'color': hdr_color, 'sz': 4}, right={'color': hdr_color, 'sz': 4})
            for p_elem in c.paragraphs:
                p_elem.alignment = WD_ALIGN_PARAGRAPH.LEFT
                for r in p_elem.runs:
                    r.bold = True
                    r.font.name = font_name
                    r.font.size = Pt(11) if is_landscape else Pt(12)
                    r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

        for idx, row in enumerate(rows_data):
            row_cells = tbl.rows[idx + 1].cells
            set_row_cant_split(tbl.rows[idx + 1])
            row_cells[0].text = row[0]
            row_cells[1].text = row[1]
            row_cells[0].width = w0
            row_cells[1].width = w1
            for c_idx, c in enumerate(row_cells):
                set_cell_margins(c, top=80 if is_landscape else 130, bottom=80 if is_landscape else 130, left=70, right=70)
                if not is_landscape:
                    # Remove middle vertical divider between col 0 and col 1, use #4F81BD borders matching Image 3
                    set_cell_border(c,
                        bottom={'color': '4F81BD', 'sz': 6},
                        top={'color': '4F81BD', 'sz': 6},
                        left={'color': '4F81BD', 'sz': 6} if c_idx == 0 else None,
                        right={'color': '4F81BD', 'sz': 6} if c_idx == 1 else None
                    )
                else:
                    set_cell_border(c,
                        bottom={'color': '4F81BD', 'sz': 6},
                        top={'color': '4F81BD', 'sz': 6},
                        left={'color': '4F81BD', 'sz': 6},
                        right={'color': '4F81BD', 'sz': 6}
                    )
                for p_elem in c.paragraphs:
                    p_elem.paragraph_format.line_spacing = 1.18 if is_landscape else 1.25
                    p_elem.paragraph_format.space_before = Pt(0)
                    p_elem.paragraph_format.space_after = Pt(0)
                    for r in p_elem.runs:
                        r.font.name = font_name
                        r.font.size = Pt(10.5) if is_landscape else Pt(12)
                        if c_idx == 0 or (c_idx == 1 and idx == 8):
                            r.bold = True
    else:
        # Theme B (Healthtech)
        rows_data = [
            ("1.", "Name of the Bidder", f": {p['short_name']}"),
            ("2.", "Address of the Bidder", f": {p['full_address']}"),
            ("3.", "Name of the Manufacturer", f": {p['manufacturer_name']}"),
            ("4.", "Address of the Manufacturer", f": {p['manufacturer_address']}"),
            ("5.", "Name and address of the person:\nTo whom all references shall be made\nregarding this tender inquiry.", f": Mr. {p['signatory_name']}\nAddress: {p.get('signatory_address') or p['full_address']}"),
            ("6.", "Telephone", ": 0253-299 5112"),
            ("7.", "Telex", ": NA"),
            ("8.", "Fax", ": NA"),
            ("9.", "Email address", ": info@markworld.com / tender@markenworld.com"),
            ("10.", "Witness", f": {p.get('witness_details') or 'Mr. Shreedhar Shingare (Cell No.: 09011104332)'}")
        ]
        tbl = doc.add_table(rows=len(rows_data), cols=3)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        tbl.autofit = False
        font_name = 'Cambria'
        widths = [Inches(0.8), Inches(4.0), Inches(5.8)] if is_landscape else [Inches(0.6), Inches(2.9), Inches(4.0)]

        for idx, row in enumerate(rows_data):
            row_cells = tbl.rows[idx].cells
            set_row_cant_split(tbl.rows[idx])
            row_cells[0].text = row[0]
            row_cells[1].text = row[1]
            row_cells[2].text = row[2]
            for c_idx in range(3):
                c = row_cells[c_idx]
                c.width = widths[c_idx]
                set_cell_margins(c, top=75 if is_landscape else 125, bottom=75 if is_landscape else 125, left=70, right=70)
                set_cell_border(c,
                    top={'color': '000000', 'sz': 4},
                    bottom={'color': '000000', 'sz': 4},
                    left={'color': '000000', 'sz': 4},
                    right={'color': '000000', 'sz': 4}
                )
                for p_elem in c.paragraphs:
                    p_elem.paragraph_format.line_spacing = 1.18 if is_landscape else 1.25
                    p_elem.paragraph_format.space_before = Pt(0)
                    p_elem.paragraph_format.space_after = Pt(0)
                    if c_idx == 0:
                        p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    for r in p_elem.runs:
                        r.font.name = font_name
                        r.font.size = Pt(9.5) if is_landscape else Pt(10)
                        if c_idx in (0, 1) or (c_idx == 2 and idx == 8):
                            r.bold = True

    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_2(doc, p, d, a):
    """Doc 2: OEM Declaration"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    add_heading(doc, "OEM DECLARATION", a, doc_date=d.get('date'))
    p_sub = doc.add_paragraph()
    p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_sub.paragraph_format.space_before = Pt(2)
    p_sub.paragraph_format.space_after = Pt(6)
    p_sub.paragraph_format.keep_with_next = True
    r_sub = p_sub.add_run("TO WHOM SO EVER IT MAY CONCERN")
    r_sub.bold = True
    r_sub.font.underline = True
    r_sub.font.size = Pt(11)

    add_body_paragraph(doc, f"We {p['short_name']} who are established and reputable manufacturers or producers of Medical, Blood bank, hospital, & Cold Chain Equipment and Furniture having production facilities at {p['manufacturer_address']}.", a)
    add_body_paragraph(doc, "We declare that we are original equipment Manufacturer (OEM) of quoted product.", a)

    # Quoted items table
    tbl = doc.add_table(rows=2, cols=5)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    set_repeat_header(tbl.rows[0])
    set_row_cant_split(tbl.rows[0])
    set_row_cant_split(tbl.rows[1])

    font_name = BID_FONT
    headers = ["Sr no", "List of quoted items", "Model", "Mfg. Brand / Make", "Qty"]
    widths = [Inches(0.9), Inches(4.7), Inches(1.9), Inches(2.1), Inches(1.0)] if is_landscape else [Inches(0.7), Inches(3.1), Inches(1.3), Inches(1.4), Inches(0.7)]

    for idx, c in enumerate(tbl.rows[0].cells):
        c.text = headers[idx]
        c.width = widths[idx]
        set_cell_margins(c, top=75, bottom=75, left=60, right=60)
        set_cell_border(c, top={'color': '000000', 'sz': 6}, bottom={'color': '000000', 'sz': 6}, left={'color': '000000', 'sz': 4}, right={'color': '000000', 'sz': 4})
        for p_elem in c.paragraphs:
            p_elem.paragraph_format.line_spacing = 1.2
            p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if idx in (0, 4) else WD_ALIGN_PARAGRAPH.LEFT
            for r in p_elem.runs:
                r.bold = True
                r.font.name = font_name
                r.font.size = Pt(10.5) if is_landscape else Pt(12)
                r.font.color.rgb = RGBColor(0, 0, 0)

    data_row = ["01", d.get('productDescription', 'Equipment / Goods'), d.get('offeredModel', '-'), d.get('offeredMake', 'MarkEn'), str(d.get('qty', '1'))]
    for idx, c in enumerate(tbl.rows[1].cells):
        c.text = data_row[idx]
        c.width = widths[idx]
        set_cell_margins(c, top=75, bottom=75, left=60, right=60)
        set_cell_border(c, bottom={'color': '000000', 'sz': 6}, top={'color': '000000', 'sz': 4}, left={'color': '000000', 'sz': 4}, right={'color': '000000', 'sz': 4})
        for p_elem in c.paragraphs:
            p_elem.paragraph_format.line_spacing = 1.2
            p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if idx in (0, 4) else WD_ALIGN_PARAGRAPH.LEFT
            for r in p_elem.runs:
                r.font.name = font_name
                r.font.size = Pt(10) if is_landscape else Pt(11.5)
                if idx == 1:
                    r.bold = True

    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_3(doc, p, d, a):
    """Doc 3: Manufacturer Declaration"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    add_heading(doc, "MANUFACTURER DECLARATION", a, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, None, p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    add_body_paragraph(doc, p['salutation'], a, bold=True)
    add_body_paragraph(doc, f"We, {p['legal_name']}, who are proven and reputable manufacturers of Blood Bank Equipment, Medical Cold Chain Equipment, Medical Equipment’s and Furniture and Hospital Furniture, Refrigerated Van, Mobile Dental Van, Mobile Health Unit having factories at {p['manufacturer_address']}, hereby declare that we are participating in the above referred tender as Original Equipment Manufacturer (OEM).", a)
    add_body_paragraph(doc, "Since we are the OEM, we are submitting the bid directly and no separate authorization in favour of any dealer/distributor is required.", a)
    add_body_paragraph(doc, "We further confirm that no other supplier or firm or individual is authorized by us to submit a bid, process the same further and enter into a contract against your requirement as contained in the above referred tender documents for the above goods manufactured by us.", a)
    add_body_paragraph(doc, "We also hereby extend our full warranty and CAMC, as applicable, as per tender terms & conditions pertaining to the above referred tender / bid.", a)
    add_body_paragraph(doc, "We hereby confirm that we shall be fully responsible for the satisfactory execution of the contract and the spares for the equipment shall be available for at least 10 years from the date of supply of equipment.", a)
    add_body_paragraph(doc, "We also confirm that the price quoted by us is final and shall not exceed the price which we would have quoted to any other bidder or authority for similar supply.", a)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_4(doc, p, d, a):
    """Doc 4: Bid Form"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    add_heading(doc, "BID FORM", a, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Bid Form", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    
    fs = (Pt(11) if a else Pt(9.5)) if is_landscape else (Pt(12) if a else Pt(10))
    ls = 1.05 if is_landscape else 1.15
    sa = 1.5 if is_landscape else (3.0 if a else 1.5)

    add_body_paragraph(doc, p['salutation'], a, bold=True, space_after=sa, font_size=fs, line_spacing=ls)
    add_body_paragraph(doc, f"We, the undersigned have examined the above mentioned bidding document, including amendment/corrigendum (if any), the receipt of which is hereby confirmed. We now offer to supply and deliver {d.get('productDescription', 'Equipment / Goods')} in conformity with your above referred document for the sum as shown in the Price Schedules attached herewith and made part of this bid. If our bid is accepted, we undertake to supply the goods and perform the services as mentioned in the bidding documents, in accordance with the delivery schedule specified in the List of Requirements.", a, space_after=sa, font_size=fs, line_spacing=ls)
    add_body_paragraph(doc, "We further confirm that, if our bid is accepted, we shall provide you with a performance security of required amount in an acceptable form in terms of ‘General Conditions Contract’ read with modification, if any ‘Special Conditions of Contract’, in Section – V and all other terms and conditions as mentioned in bidding document for due performance of the contract.", a, space_after=sa, font_size=fs, line_spacing=ls)
    add_body_paragraph(doc, "We agree to keep our bid valid for acceptance as required in the ‘General Instruction to Bidders’, read with modification, if any in ‘Special Instructions to Bidders’ or for subsequently extended period, if any, agreed to by us. We also accordingly confirm to abide by this bid up to the aforesaid period and this bid may be accepted any time before the expiry of the aforesaid period. We further confirm that, until a formal contract is executed, this bid read with your written acceptance thereof within the aforesaid period shall constitute a binding contract between us.", a, space_after=sa, font_size=fs, line_spacing=ls)
    add_body_paragraph(doc, "We further understand that you are not bound to accept the lowest or any bid you may receive against your above-referred advertised tender enquiry.", a, space_after=sa, font_size=fs, line_spacing=ls)
    add_body_paragraph(doc, "We confirm that we do not stand deregistered/banned/blacklisted by any Central Govt. Ministries/Departments/Hospitals/Institutes.", a, space_after=sa, font_size=fs, line_spacing=ls)
    add_body_paragraph(doc, "We confirm that we fully agree to the terms and conditions specified in the above mentioned bid document, including amendment/corrigendum if any.", a, space_after=sa, font_size=fs, line_spacing=ls)
    add_body_paragraph(doc, "“We hereby certify that if at any time, information furnished by us is proved to be false or incorrect, we are liable for any action as deemed fit by the purchaser in addition to forfeiture of the bid security.”", a, bold=True, space_after=sa, font_size=fs, line_spacing=ls)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a, space_after=sa, font_size=fs, line_spacing=ls)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_5(doc, p, d, a):
    """Doc 5: Bid Security Declaration Form"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    add_heading(doc, "BID SECURITY DECLARATION FORM", a, subtitle="(Rule 170 of General Financial Rule 2017)", doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Bid Security Declaration Form", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    add_body_paragraph(doc, p['salutation'], a, bold=True)
    add_body_paragraph(doc, "We the undersigned declare that;", a)
    sec_period = d.get('bidSecurityPeriod', '180 Days' if a else 'Six (06) months')
    add_body_paragraph(doc, f"We accept that we may be suspended to submit bids for contract(s) with you for a period of {sec_period} from the Date of bid opening if we are in a breach of any obligation under the bid conditions, because We", a)
    add_body_paragraph(doc, "have withdrawn/modified our bid during the period of bid validity specified in the form of bid; or", a, bullet="a)")
    add_body_paragraph(doc, "having been notified of the acceptance of our bid by the purchaser during the period of bid validity", a, bullet="b)")
    add_body_paragraph(doc, "fail or refuse to execute the contract, or", a, bullet="c)")
    add_body_paragraph(doc, "Fail or refuse to submit the Performance Security of the amount specified in the bid.", a, bullet="d)")
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_6(doc, p, d, a):
    """Doc 6: Acceptance of Tender Terms and Conditions"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    title = "UNDERTAKING" if a else "ACCEPTANCE OF TENDER TERMS AND CONDITIONS"
    subtitle = "(Acceptance of Tender Terms and Conditions as per Bid)" if a else None
    add_heading(doc, title, a, subtitle=subtitle, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Acceptance of Tender Terms and Conditions as per Bid.", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    add_body_paragraph(doc, p['salutation'], a, bold=True)
    b1 = "1." if a else "a)"
    b2 = "2." if a else "b)"
    b3 = "3." if a else "c)"
    b4 = "4." if a else "d)"
    b5 = "5." if a else "e)"
    add_body_paragraph(doc, "We have downloaded/obtained the tender documents for the above-mentioned bid in reference to Supply & Installation of Equipment’s from the web site namely GeM Portal.", a, bullet=b1)
    add_body_paragraph(doc, "We hereby certify that we have reviewed entire terms and conditions of the tender documents (including all documents like annexure, schedules, etc., which is form part of the Contract Agreement and we shall abide hereby to the terms / conditions / Warranty / CMC / Delivery / Clauses contained therein.", a, bullet=b2)
    add_body_paragraph(doc, "The corrigendum(s) issued from time to time by your department / organization also has been taken into consideration, while submitting this acceptance letter.", a, bullet=b3)
    add_body_paragraph(doc, "We hereby unconditionally accept the tender conditions of above mentioned tender and its corrigendum(s) in totality / entirely.", a, bullet=b4)
    add_body_paragraph(doc, "In case any provision of this bid / tender are found violated, your department / organization shall be at liberty to reject this and we shall not have any claim/ right against the department in satisfaction of this condition.", a, bullet=b5)
    if a:
        add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    else:
        add_body_paragraph(doc, "Yours faithfully,", a, space_after=2)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_7(doc, p, d, a):
    """Doc 7: Spare Parts (Availability up to 10 Years)"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    add_heading(doc, "DECLARATION", a, subtitle="(for Availability of Spare Parts up to 10 Years)", doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, None, p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    add_body_paragraph(doc, p['salutation'], a, bold=True)
    add_body_paragraph(doc, "We certify that the equipment being/quoted is the latest model and that spares for the equipment will be available for a period of at least 10 years and we also guarantee that we will keep the organization informed of any update of the equipment over a period of 10 years.", a)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_8(doc, p, d, a):
    """Doc 8: Undertaking for Warranty"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    subtitle = "(Acceptance of Warranty Period and Terms and Conditions)" if a else None
    add_heading(doc, "UNDERTAKING FOR WARRANTY", a, subtitle=subtitle, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Undertaking for Warranty", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    add_body_paragraph(doc, p['salutation'], a, bold=True)
    scope = "Blood Bank, Cold Chain, Medical, Hospital Equipment’s and Furniture"
    add_body_paragraph(doc, f"We, {p['short_name']} ourselves as an Established and Reputable, Indigenous Manufacturers of {scope}, do hereby guarantee and warranty all work performed as part of the bid for a period of as per bid terms from the Date of supply. We commit to repairing any defective spare parts associated with our work at no additional charges to the product.", a)
    add_body_paragraph(doc, f"We, do hereby confirm our participation in the tender for the supply of {d.get('productDescription', 'Equipment / Goods')}, as per the specifications outlined in the bid documents.", a)
    add_body_paragraph(doc, "Having thoroughly reviewed the bid, including the warranty period and terms and conditions specified in the bid documents, we would like to express our acceptance of the stated terms. We understand and acknowledge the importance of complying with the conditions set forth in the bid to ensure a smooth and successful collaboration.", a)
    add_body_paragraph(doc, "By submitting this confirmation, we affirm our commitment to adhere to the warranty terms and conditions as outlined in the bid documents. We assure you that, if awarded the contract, we will fulfill our obligations with the utmost professionalism and in accordance with the agreed-upon terms.", a)
    add_body_paragraph(doc, "We fully understand and acknowledge the importance of the warranty duration in meeting your requirements. Our commitment to providing a as per bid terms warranty reflects our confidence in the quality and durability of our products.", a)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_8a(doc, p, d, a):
    """Doc 8a: Undertaking for Warranty (General Scope)"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    add_heading(doc, "UNDERTAKING FOR WARRANTY", a, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Undertaking for Warranty", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    sa = 2.0 if is_landscape else 5.0
    add_body_paragraph(doc, p['salutation'], a, bold=True, space_after=sa)
    scope = "Cold chain , Medical Equipment’s and Hospital Furniture" if not a else "Blood Bank, Cold Chain, Medical, Hospital Equipment’s and Furniture"
    add_body_paragraph(doc, f"We, {p['short_name']} ourselves as an Established and Reputable, Indigenous Manufacturers of {scope} do hereby guarantee and warranty all work performed as part of the bid for a period of as per bid terms from the date of supply. We commit to repairing any defective spare parts associated with our work at no additional charges to the product.", a, space_after=sa)
    add_body_paragraph(doc, "We fully understand and acknowledge the importance of the warranty duration in meeting your requirements. Our commitment to providing a as per bid terms warranty reflects our confidence in the quality and durability of our products. This undertaking is a testament to our dedication to customer satisfaction and our assurance of the reliability of our offerings.", a, space_after=sa)
    add_body_paragraph(doc, "We are more than willing to address any queries and provide the necessary clarifications.", a, space_after=sa)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a, space_after=sa)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_8b(doc, p, d, a):
    """Doc 8b: Undertaking for Warranty (Product-Specific Scope)"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    prod = d.get('productDescription', 'Equipment / Goods')
    add_heading(doc, "UNDERTAKING FOR WARRANTY", a, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Undertaking for Warranty", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    sa = 2.0 if is_landscape else 5.0
    add_body_paragraph(doc, p['salutation'], a, bold=True, space_after=sa)
    add_body_paragraph(doc, f"We, {p['short_name']} ourselves as an Established and Reputable, Indigenous Manufacturers of {prod} do hereby guarantee and warranty all work performed as part of the bid for a period of as per bid terms from the date of supply. We commit to repairing any defective spare parts associated with our work at no additional charges to the product.", a, space_after=sa)
    add_body_paragraph(doc, "We fully understand and acknowledge the importance of the warranty duration in meeting your requirements. Our commitment to providing a as per bid terms warranty reflects our confidence in the quality and durability of our products. This undertaking is a testament to our dedication to customer satisfaction and our assurance of the reliability of our offerings.", a, space_after=sa)
    add_body_paragraph(doc, "We are more than willing to address any queries and provide the necessary clarifications.", a, space_after=sa)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a, space_after=sa)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_9(doc, p, d, a):
    """Doc 9: Price Declaration"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    add_heading(doc, "PRICE DECLARATION", a, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Price Declaration", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    sa = 2.0 if is_landscape else (5.0 if not a else 4)
    add_body_paragraph(doc, p['salutation'], a, bold=True, space_after=sa)
    add_body_paragraph(doc, f"We {p['short_name']} having registered office at {p['manufacturer_address']}, hereby declare that the rates quoted in the tender submitted for {d.get('productDescription', 'Equipment / Goods')}, are not higher than the rates quoted to other Government Departments/Government Undertakings or any prevailing contracts, and they are not higher than the Maximum Retail Price (MRP).", a, space_after=sa)
    add_body_paragraph(doc, "We assure that our pricing is fair, competitive, and in compliance with all applicable regulations. The rates provided in this tender are consistent with our pricing practices across various government entities and ongoing contracts.", a, space_after=sa)
    add_body_paragraph(doc, "If required, we are willing to provide any additional documentation or evidence to substantiate this declaration.", a, space_after=sa)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a, space_after=sa)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_10(doc, p, d, a):
    """Doc 10: Declaration for Demonstration"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    title = "DECLARATION" if a else "DECLARATION FOR DEMONSTRATION"
    subtitle = "(for Demonstration)" if a else None
    add_heading(doc, title, a, subtitle=subtitle, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Declaration for Demonstration", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    sa = 2.0 if is_landscape else 3.0
    add_body_paragraph(doc, p['salutation'], a, bold=True, space_after=sa)
    add_body_paragraph(doc, f"We {p['short_name']} having registered office at {p['manufacturer_address']}.", a, space_after=sa)
    add_body_paragraph(doc, "We, the undersigned, hereby declare our commitment to arranging a demonstration of our product at our own expense. We understand the importance of showcasing the features and capabilities of our product to your satisfaction.", a, space_after=sa)
    add_body_paragraph(doc, "Terms of the Declaration:", a, bold=True, space_after=sa)
    add_body_paragraph(doc, "Demo Arrangement: We commit to organizing and conducting a comprehensive demonstration of our product as per your requirements.", a, space_after=sa)
    add_body_paragraph(doc, "Cost Coverage: All expenses related to the demonstration, including travel, accommodation, and any other associated costs, will be borne entirely by us.", a, space_after=sa)
    add_body_paragraph(doc, "Location and Timing: We are flexible and willing to conduct the demo at a location of your choice. We will coordinate with your team to determine a suitable Date and time for the demonstration.", a, space_after=sa)
    add_body_paragraph(doc, "Customization: If there are specific aspects or features you wish to focus on during the demo, please communicate them in advance so that we can tailor our presentation to meet your needs.", a, space_after=sa)
    add_body_paragraph(doc, "Feedback and Adjustments: We welcome any feedback you may have during or after the demonstration. If there are areas that require further clarification or adjustments, we commit to addressing them promptly.", a, space_after=sa)
    if not a:
        add_body_paragraph(doc, "By signing this declaration, both parties affirm their understanding and agreement to the terms outlined herein. We look forward to the opportunity to showcase our product and demonstrate how it can meet and exceed your expectations.", a, space_after=sa)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a, space_after=sa)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_11(doc, p, d, a):
    """Doc 11: Declaration on Non-Blacklisting / Debarring"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    title = "DECLARATION" if a else "DECLARATION ON NON-BLACKLISTING / DEBARRING"
    subtitle = "(on Non-Blacklisting / Debarring)" if a else None
    add_heading(doc, title, a, subtitle=subtitle, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Declaration on Non-Blacklisting / Debarring", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    add_body_paragraph(doc, p['salutation'], a, bold=True)
    bl_period = d.get('blacklistYears', '(5) Five' if a else 'three')
    add_body_paragraph(doc, f"We {p['short_name']} having registered office at {p['manufacturer_address']}. Hereby declare that our firm has not been found guilty of malpractice, misconduct, or blacklisted/debarred either by the Public Health Department, Government of Maharashtra, and all State Governments or by any local authority and other State Government/Central Government's Organizations in the past {bl_period} years.", a)
    add_body_paragraph(doc, "We take great pride in maintaining a high standard of ethical conduct and compliance with all applicable regulations. Our commitment to integrity and professionalism is reflected in our business practices, and we strive to uphold the trust placed in us by our clients and stakeholders.", a)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_12(doc, p, d, a):
    """Doc 12: Undertaking for Financial Standing"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    title = "UNDERTAKING" if a else "UNDERTAKING FOR FINANCIAL STANDING"
    subtitle = "(For Financial Standing)" if a else None
    add_heading(doc, title, a, subtitle=subtitle, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Undertaking for Financial Standing", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    add_body_paragraph(doc, p['salutation'], a, bold=True)
    add_body_paragraph(doc, f"We, {p['short_name']}, represented by the company, located at {p['manufacturer_address']}, hereby provide the following undertaking regarding our financial standing:", a)
    scope = 'Blood Bank Equipment, Medical Cold Chain Equipment, Medical Equipment’s and Furniture and Hospital Furniture, Refrigerated Van, Mobile Dental Van, Mobile Health Unit' if a else 'Medical Equipment’s and Hospital Furniture'
    add_body_paragraph(doc, f"Business Nature: We are established and reputable indigenous manufacturers of {scope}.", a)
    add_body_paragraph(doc, f"Location: Our manufacturing facilities are situated at {p['manufacturer_address']}.", a)
    add_body_paragraph(doc, "Financial Standing: We declare that, to the best of our knowledge and belief, as of the Date of this undertaking:", a)
    add_body_paragraph(doc, "a. We are not under liquidation, court receivership, or any similar proceedings.\nb. We are not bankrupt.", a)
    add_body_paragraph(doc, "Commitment: We undertake to promptly inform the concerned parties if there are any changes in our financial standing during any agreements or contracts.", a)
    add_body_paragraph(doc, "Accuracy of Information: The information provided in this undertaking is true and accurate to the best of our knowledge, and we understand the legal consequences of providing false information.", a)
    add_body_paragraph(doc, "We hereby affix our signature and company seal to confirm the authenticity of this undertaking.", a)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_13(doc, p, d, a):
    """Doc 13: Declaration for Certificate of Country of Origin"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    title = "DECLARATION" if a else "DECLARATION FOR CERTIFICATE OF COUNTRY OF ORIGIN"
    subtitle = "(For Certificate of Country of Origin)" if a else None
    add_heading(doc, title, a, subtitle=subtitle, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Declaration for Certificate Of Country of Origin Reference", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    add_body_paragraph(doc, p['salutation'], a, bold=True)
    prod = d.get('productDescription', 'Equipment / Goods')
    add_body_paragraph(doc, f"We {p['short_name']} introduce ourselves as an Established and Reputable, Indigenous Manufacturers of {prod} would like to inform you that the quoted product {prod}, is manufactured by us and we are Self-Manufacturer of the same. This product is made entirely in our Company using the raw materials available in India.", a)
    add_body_paragraph(doc, f"We ensure that no foreign raw materials are used in our manufactured products i.e {prod}. However, we assure you that the products we manufacture are entirely Indian made and that we are the Original Equipment’s Manufacture (OEM) of the original products.", a)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def add_local_content_table(doc, p, d, a, is_landscape):
    """Local content table (Tender No | Local Content % | Location of Local Value Addition)."""
    tbl = doc.add_table(rows=2, cols=3)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    set_repeat_header(tbl.rows[0])
    set_row_cant_split(tbl.rows[0])
    set_row_cant_split(tbl.rows[1])

    hdr_color = '4F81BD' if a else 'FFFFFF'
    hdr_text_color = RGBColor(0xFF, 0xFF, 0xFF) if a else RGBColor(0, 0, 0)
    font_name = BID_FONT
    headers = ["Tender No", "Local Content Calculated as above %", "Location of Local Value Addition"]
    widths = [Inches(3.2), Inches(3.2), Inches(4.2)] if is_landscape else [Inches(2.2), Inches(2.2), Inches(2.8)]

    for idx, c in enumerate(tbl.rows[0].cells):
        c.text = headers[idx]
        c.width = widths[idx]
        set_cell_shading(c, hdr_color)
        set_cell_margins(c, top=70, bottom=70, left=60, right=60)
        set_cell_border(c, top={'color': '000000' if not a else hdr_color, 'sz': 8}, bottom={'color': '000000' if not a else hdr_color, 'sz': 8}, left={'color': '000000' if not a else hdr_color, 'sz': 4}, right={'color': '000000' if not a else hdr_color, 'sz': 4})
        for p_elem in c.paragraphs:
            p_elem.paragraph_format.line_spacing = 1.18
            p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if idx == 1 else WD_ALIGN_PARAGRAPH.LEFT
            for r in p_elem.runs:
                r.bold = True
                r.font.name = font_name
                r.font.size = Pt(10)
                r.font.color.rgb = hdr_text_color

    loc_pct = d.get('localContentPercentage', p.get('localContentPct', '100%'))
    loc_addr = d.get('localContentLocation', p.get('manufacturer_address'))
    data_row = [f"{d.get('bidNumber')}\nDated: {d.get('bidDate')}", loc_pct, loc_addr]

    for idx, c in enumerate(tbl.rows[1].cells):
        c.text = data_row[idx]
        c.width = widths[idx]
        set_cell_margins(c, top=70, bottom=70, left=60, right=60)
        set_cell_border(c, bottom={'color': '000000' if not a else 'A0A0A0', 'sz': 4}, left={'color': '000000' if not a else 'A0A0A0', 'sz': 4}, right={'color': '000000' if not a else 'A0A0A0', 'sz': 4})
        for p_elem in c.paragraphs:
            p_elem.paragraph_format.line_spacing = 1.18
            p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if idx == 1 else WD_ALIGN_PARAGRAPH.LEFT
            for r in p_elem.runs:
                r.font.name = font_name
                r.font.size = Pt(9.5)
                if idx in (0, 1):
                    r.bold = True

def build_doc_14(doc, p, d, a):
    """Doc 14: Declaration Certificate for Local Content (Page 1)"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    add_heading(doc, "DECLARATION CERTIFICATE FOR LOCAL CONTENT", a, doc_date=d.get('date'))
    add_body_paragraph(doc, "This declaration must form part of the bid documentation. It serves as a declaration for the bidder and local content.", a, bold=True, space_after=3)
    add_body_paragraph(doc, "General: -", a, bold=True, space_after=2)
    add_body_paragraph(doc, "I the undersigned, in submitting the accompanying bid do hereby make the following statements that I certify to be true and complete in every respect:", a, bullet="a)", space_after=2)
    add_body_paragraph(doc, "I have read and understood the requirement of local content (LC) and same is specified as percentage calculated in accordance with the definition provided at clause 2 of revised Public Procurement (preference to Make in India) Order 2017.", a, bullet="b)", space_after=2)
    add_body_paragraph(doc, "“Local content” as per above order means the amount of value added in India which shall be the total value of items procured (excluding net domestic indirect taxes) minus the value of imported content in the item (including all customs duties) as a proportion of the total value in percent.", a, bullet="c)", space_after=2)
    add_body_paragraph(doc, "I have satisfied myself that the goods/services/works to be delivered in terms of the above-specified bid comply with the local content requirements as specified in the tender for ‘Class-I Local Supplier’ / ‘Class-II Local Supplier’, and as above.", a, bullet="d)", space_after=2)
    add_body_paragraph(doc, "I understand that a bidder can seek benefit of either Public Procurement Policy for MSEs–Order 2012 or Public Procurement (preference to Make in India) Order 2017 and not both and once the option is declared / selected it is not permitted to be modified subsequently. Accordingly, I seek the benefit from the below declared purchase preference policy only.", a, bullet="e)", space_after=2)
    add_body_paragraph(doc, "I seek benefits against the following policy only (Select only one Option):", a, bullet="f)", space_after=3)

    pref_policy = d.get('preferencePolicy', p.get('preferencePolicy', 'PPP MII 2017'))
    is_msme = 'MSME' in pref_policy.upper()

    # Policy Checkbox Table
    cb_tbl = doc.add_table(rows=2, cols=2)
    set_table_borders_none(cb_tbl)
    cb_tbl.autofit = False

    font_name = BID_FONT
    rows_def = [
        ("[✔]" if is_msme else "[  ]", "1) PPP MSME Order 2012 (applicable for MSE manufacturers)"),
        ("[✔]" if not is_msme else "[  ]", "2) PPP MII 2017 (applicable for Class I suppliers as well as MSE manufacturers)")
    ]
    w0 = Inches(0.8) if is_landscape else Inches(0.6)
    w1 = Inches(9.8) if is_landscape else Inches(6.5)

    for r_i, (box, label) in enumerate(rows_def):
        c0, c1 = cb_tbl.rows[r_i].cells
        c0.width = w0
        c1.width = w1
        c0.text = box
        c1.text = label
        set_cell_margins(c0, top=30, bottom=30, left=40, right=40)
        set_cell_margins(c1, top=30, bottom=30, left=40, right=40)
        for r in c0.paragraphs[0].runs:
            r.bold = True
            r.font.name = font_name
            r.font.size = Pt(11)
        for r in c1.paragraphs[0].runs:
            r.bold = True
            r.font.name = font_name
            r.font.size = Pt(9.5)

    # The local content table stays on page 1 directly under the line that introduces it
    intro = "g)" if a else "e)"
    add_body_paragraph(doc, f"{intro} The local content calculated using the definition given above are as under:", a, space_after=2 if is_landscape else 4, keep_with_next=True)
    add_local_content_table(doc, p, d, a, is_landscape)

def build_doc_15(doc, p, d, a):
    """Doc 15: Declaration Certificate for Local Content (Page 2)"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    if not a:
        add_heading(doc, "DECLARATION CERTIFICATE FOR LOCAL CONTENT (CONTD.)", a, doc_date=d.get('date'))
    elif not is_landscape:
        p_blank = doc.add_paragraph()
        p_blank.paragraph_format.space_before = Pt(0)
        p_blank.paragraph_format.space_after = Pt(0)
        p_blank.paragraph_format.line_spacing = Pt(12)
        r_blank = p_blank.add_run()
        r_blank.font.size = Pt(11)
    add_body_paragraph(doc, "h) I accept that the Procurement Authority / Institution / MDL / Nodal Ministry has the right to request that the local content be verified in terms of the requirements of revised Public Procurement (preference to Make in India) Order 2017 dtd.16.09.2020 and I shall furnish the document / information on demand. Failure on my part to furnish the data will be treated as false declaration as per PPP MII Order 2017. In case of contract being awarded, I undertake to retain the relevant documents for 7 years from date of execution.", a)
    add_body_paragraph(doc, "i) I understand that the submission of incorrect data, or data that are not verifiable as described in revised Public Procurement (preference to Make in India) Order 2017, may result in the Procurement Authority / Nodal Ministry / MDL imposing any or all of the remedies as provided for in Clause 9 of the Revised Public Procurement (preference to Make in India) Order 2017 dated 16.09.2020.", a)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_16(doc, p, d, a):
    """Doc 16: Escalation Matrix (For Service Support)"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    title = "ESCALATION MATRIX" if a else "ESCALATION MATRIX FOR SERVICE SUPPORT"
    subtitle = "(For Service Support)" if a else None
    add_heading(doc, title, a, subtitle=subtitle, doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, "Escalation Matrix for Service Support", p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    add_body_paragraph(doc, p['salutation'], a, bold=True)
    add_body_paragraph(doc, "We hereby submit the Escalation Matrix with Telephone Numbers for Service Support for our quoted product as under:", a, space_after=4)

    matrix_data = [
        ("1.", "Mr. Sanjay Sadade", "General Manager", "Administration", "9225126772", "support@markenworld.com"),
        ("2.", "Mr. Shridhar Shingare", "Tender Manager", "Institution Business Division", "9011104332", "info@markenworld.com"),
        ("3.", "Mr. Eknath Mandal", "Production Manager", "Delays of machine design and Technical Error.", "9225102371", "support@markenworld.com"),
        ("4.", "Mr. Sachin Shisode", "Service Head", "Servicing Delay", "8390900347", "support@markenworld.com")
    ]

    tbl = doc.add_table(rows=len(matrix_data) + 1, cols=6)
    if not a:
        keep_table_font_size(tbl)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    set_repeat_header(tbl.rows[0])
    set_row_cant_split(tbl.rows[0])

    hdr_color = '4F81BD' if a else 'C5D9EF'
    hdr_text_color = RGBColor(0xFF, 0xFF, 0xFF) if a else RGBColor(0, 0, 0)
    font_name = BID_FONT
    border_color = '4F81BD' if a else 'A0A0A0'
    headers = ["Sr. No", "Name of Responsible Person", "Designation", "Triggers When", "Contact Number", "Email ID's"]
    # Portrait widths fit the printable width (ME 7.48in, Healthtech 6.99in) with each e-mail id on one line
    if is_landscape:
        widths = [Inches(0.8), Inches(2.3), Inches(1.9), Inches(1.9), Inches(1.4), Inches(2.3)]
    elif a:
        # 12pt Cambria: e-mail id needs 2.14in, a 10-digit number 1.04in (incl. cell padding)
        widths = [Inches(0.45), Inches(1.4), Inches(1.2), Inches(1.2), Inches(1.05), Inches(2.15)]
    else:
        # 11pt Cambria: e-mail id needs 1.97in, a 10-digit number 0.96in (incl. cell padding)
        widths = [Inches(0.45), Inches(1.3), Inches(1.1), Inches(1.12), Inches(0.98), Inches(2.0)]

    for idx, c in enumerate(tbl.rows[0].cells):
        c.text = headers[idx]
        c.width = widths[idx]
        set_cell_shading(c, hdr_color)
        set_cell_margins(c, top=65, bottom=65, left=50, right=50)
        set_cell_border(c, top={'color': border_color, 'sz': 8}, bottom={'color': border_color, 'sz': 8}, left={'color': border_color, 'sz': 4}, right={'color': border_color, 'sz': 4})
        for p_elem in c.paragraphs:
            p_elem.paragraph_format.line_spacing = 1.18
            p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if idx in (0, 4) else WD_ALIGN_PARAGRAPH.LEFT
            for r in p_elem.runs:
                r.bold = True
                r.font.name = font_name
                r.font.size = Pt(9.5) if is_landscape else (Pt(12) if a else Pt(11))
                r.font.color.rgb = hdr_text_color

    for r_i, row_val in enumerate(matrix_data):
        row_cells = tbl.rows[r_i + 1].cells
        set_row_cant_split(tbl.rows[r_i + 1])
        for c_i, val in enumerate(row_val):
            c = row_cells[c_i]
            c.text = val
            c.width = widths[c_i]
            set_cell_margins(c, top=65, bottom=65, left=50, right=50)
            set_cell_border(c, bottom={'color': '95B3D7' if a else 'A0A0A0', 'sz': 4}, top={'color': '95B3D7' if a else 'A0A0A0', 'sz': 4}, left={'color': '95B3D7' if a else 'A0A0A0', 'sz': 4}, right={'color': '95B3D7' if a else 'A0A0A0', 'sz': 4})
            for p_elem in c.paragraphs:
                p_elem.paragraph_format.line_spacing = 1.18
                p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if c_i in (0, 4) else WD_ALIGN_PARAGRAPH.LEFT
                for r in p_elem.runs:
                    r.font.name = font_name
                    r.font.size = Pt(9) if is_landscape else (Pt(12) if a else Pt(11))

    fix_table_grid(tbl, widths)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def get_stations_data(is_theme_a):
    if is_theme_a:
        return [
            {"city": "(H.O.) Nashik, Maharashtra.", "addr": "Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007 Maharashtra", "contact": "Mr. Sachin Shisode,\nMr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Delhi.", "addr": "B-50, South Extension, Part -1, New Delhi – 110049.", "contact": "Adarsh Kumar Arora", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Ambala, Haryana.", "addr": "5337, Punjabi Mohalla, Ambala Cantt, Ambala, Haryana, 133001", "contact": "Mr. Deepak Pawaiya,\nMr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Jaipur, Rajasthan.", "addr": "Plot No.438, Vivek Vihar Colony, New Sanganer Road, Sodala. Jaipur - 302001, Rajasthan", "contact": "Mr. Devendra Hire,\nMr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Lucknow, Uttar Pradesh.", "addr": "14 - Manas nagar colony, Jiamau, Hazratganj, Opp. RTD, DGP Jagmohan Yadav Residency, Lucknow – 226001 Uttar Pradesh.", "contact": "Mr. Anil Aher,\nMr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Hyderabad, Telangana.", "addr": "P NO.478, Lane Number 4 IDA Cherlapally, Hyderabad, Medchal Malkajgiri-500051 Telangana", "contact": "Mr. Chandu,\nMr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Ahmedabad, Gujarat.", "addr": "M/s. Sevamed Solutions Private Limited, Ahmedabad, Gujarat – 382421", "contact": "Mr. Paresh Sohni,\nMr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Jammu, Jammu & Kashmir", "addr": "M/s. Facio Marketing Solutions, 1st Floor, GQ Building, Near Rahat Hospital, Bathindi Morh, Sunjwan Road, Jammu - 181152", "contact": "Mr. Zeeshan,\nMr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Kolkata, West Bengal.", "addr": "P Bhogilal Pvt Ltd, 117b, Chittaranjan Avenue, Central Avenue, Kolkata - 700073 West Bengal", "contact": "Mr. Nilesh Mehta,\nMr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Amritsar, Punjab", "addr": "Kaze Pharmaceuticals Private Limited. 1st Floor Sco 14, Cabin No. 1, Mansa Devi Complex, Sector 5, Swastik Vihar, Panchkula, Haryana", "contact": "Mr. Santosh chaudhari,\nMr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Bhubaneshwar, Odisha", "addr": "GITANJALI ASSOCIATES, Cuttack Road, 128, Laxmi Sagar, Bhubaneshwar 715006 Odisha", "contact": "Mr. Mohd Ismile Alimulah", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Kamrup, Assam.", "addr": "J.M. Distributor, Ground Floor, 10, Surana Building, Jail Road, Fancy Bazar, Kamrup Metropolitan, Assam, 781001", "contact": "Mr. Pratik Chaudhari,\nMr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Ernakulam, Kerala", "addr": "ASA Diagnostics Private Limited, Ist Floor, 54/2824-D, Muttathil Lane, Kochi, Ernakulam, Kerala, 682020", "contact": "Mr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Bhopal, Madhya Pradesh", "addr": "Imagers Sales PVT. Ltd. C-13/7 Simi Apartment Phase 3 Padmanabh Nagar, Near Prabhat Petrol Pump, Bhopal (M.P.) - 462023", "contact": "Mr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"},
            {"city": "Bangalore Karnataka", "addr": "M/s KK Allianze, No.178/2, Govindarao Street, Seshadripuram, Bangalore-560020", "contact": "Mr. Shridhar Shingare", "email": "info@markenworld.com\nsupport@markenworld.com", "mob": "9175559646\n9011104332"}
        ]
    else:
        return [
            {"city": "( H.O.) Nashik, Maharashtra.", "addr": "Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007 Maharashtra", "contact": "Mr. Sachin Shisode,", "email": "support@markenworld.com,\ninfo@markenworld.com", "mob": "8390900347\n9175559646"},
            {"city": "Mumbai, Maharashtra.", "addr": "410 , 4th floor, Maker Chamber V, Nariman point, Mumbai 400021 Maharashtra", "contact": "Mr. Shridhar Shingare,", "email": "support@markenworld.com,\ninfo@markenworld.com", "mob": "9011104332\n9175559646"},
            {"city": "South Delhi.", "addr": "Office No.515, 5th Floor, Tower-DLF, Jasola-110025 South Delhi", "contact": "Mr. Vinit Sharma,", "email": "support@markenworld.com,\ninfo@markenworld.com", "mob": "8527027321\n9175559646"},
            {"city": "Ambala, Haryana.", "addr": "B. Block 3031 CCC Zirakpur, Chandigarh-140603 Haryana", "contact": "Mr. Deepak Pawaiya,", "email": "support@markenworld.com,\ninfo@markenworld.com", "mob": "9175550259\n9175559646"},
            {"city": "Jaipur, Rajasthan.", "addr": "Plot No.438, Vivek Vihar Colony, New Sanganer Road, Sodala. Jaipur - 302001, Rajasthan", "contact": "Mr. Devendra Hire,", "email": "support@markenworld.com,\ninfo@markenworld.com", "mob": "8208463830\n9175559646"},
            {"city": "Lucknow, Uttar Pradesh.", "addr": "14 - Manas nagar colony, Jiamau, Hazratganj, Opp. RTD, DGP Jagmohan Yadav Residency, Lucknow – 226001 Uttar Pradesh.", "contact": "Mr. Anil Aher,", "email": "support@markenworld.com,\ninfo@markenworld.com", "mob": "9146489605\n9175559646"},
            {"city": "Hyderabad, Telangana.", "addr": "P NO.478, Lane Number 4 IDA Cherlapally, Hyderabad, Medchal Malkajgiri-500051 Telangana", "contact": "Mr. Chandu,", "email": "support@markenworld.com,\ninfo@markenworld.com", "mob": "9000959574\n9175559646"},
            {"city": "Trivandrum, Kerala", "addr": "Manasa Enterprises Dot Space Business Center, Kowdiar, Devasomboard Road, Trivandrum-695003 Kerala", "contact": "Meera Budhan", "email": "support@markenworld.com,\ninfo@markenworld.com", "mob": "8589999138\n9175559646"},
            {"city": "Ahmedabad, Gujarat.", "addr": "Pulse Biomed LLP, A314, Advance Business Park, Shahibag, Ahmedabad-380004 Gujarat", "contact": "Paresh Sohni", "email": "support@markenworld.com,\ninfo@markenworld.com", "mob": "9898081574\n9175559646"},
            {"city": "Jammu, Jammu & Kashmir", "addr": "Vista Electronic Care, 05-JDA, Behind Laxmi Naryan Mandir, New Rehari, Jammu, Jammu & Kashmir 180001", "contact": "Vikram Gupta", "email": "support@markenworld.com,\ninfo@markenworld.com", "mob": "7006171371\n9175559646"},
            {"city": "Amritsar, Punjab", "addr": "Jai Shiva Enterprises, Sale and Service 185, New Colony, Near Amar Jyoti School, Amritsar", "contact": "Sanjay Kumar", "email": "sanjay.kumar3333@gmail.com", "mob": "9216275044"},
            {"city": "Kolkata, West Bengal.", "addr": "P Bhogilal Pvt Ltd, 117b, Chittaranjan Avenue, Central Avenue, Kolkata - 700073 West Bengal", "contact": "Nilesh Pratapray Mehta", "email": "support@markenworld.com,\ninfo@markenworld.com", "mob": "9175559646"},
            {"city": "Karnataka.", "addr": "SB4-30/6, Bhoomi Complex, Main Road, Siddakatte, Bantwal Taluka, Dakshina Kannada, Karnataka, 574237", "contact": "Sunil Kotin Ref Karnataka", "email": "info@markenworld.com,\ntender@markenworld.com", "mob": "9594947178"},
            {"city": "Madhya Pradesh", "addr": "C-13/7 Simi Apartment Phase 3 Padmanabh Nagar, Near Prabhat Petrol Pump, Bhopal (M.P.) - 462023", "contact": "Shruti Yadav", "email": "info@markenworld.com,\ntender@markenworld.com", "mob": "9011104332"},
            {"city": "Assam", "addr": "JM Distributor Surana Building, Jail Road, Fancy Bazar, Guwahati - 7810001", "contact": "Mr. Pratik Chaudhari", "email": "info@markenworld.com,\ntender@markenworld.com", "mob": "9864030081"},
            {"city": "Bihar", "addr": "FAIRDEAL MEDITECH Flat No 306, Wazeer Apartment, New Patliputra Colony, Patna, Bihar, 800013", "contact": "Mr. Shubham", "email": "info@markenworld.com,\ntender@markenworld.com", "mob": "9431018743"}
        ]

def build_doc_17_18(doc, p, d, a):
    """Doc 17 & 18: Details of After Sales Service Stations (Page 1 & 2)"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    stations = get_stations_data(a)
    split_idx = 8 if is_landscape else (10 if a else 9)
    p1_stations = stations[:split_idx]
    p2_stations = stations[split_idx:]

    hdr_color = '4F81BD' if a else 'D4DCE3'
    hdr_text_color = RGBColor(0xFF, 0xFF, 0xFF) if a else RGBColor(0, 0, 0)
    font_name = BID_FONT
    # Portrait widths must fit the printable width (ME 7.48in, Healthtech 6.99in); the e-mail column
    # is wide enough for "support@markenworld.com" on one line.
    if is_landscape:
        widths = [Inches(0.7), Inches(1.9), Inches(3.2), Inches(1.6), Inches(2.2), Inches(1.0)]
    elif a:
        widths = [Inches(0.4), Inches(1.1), Inches(1.85), Inches(1.05), Inches(2.1), Inches(0.95)]
    else:
        widths = [Inches(0.38), Inches(1.0), Inches(1.6), Inches(0.95), Inches(2.05), Inches(1.0)]

    # Page 1
    add_heading(doc, "DETAILS OF AFTER SALES SERVICE STATION", a, doc_date=d.get('date'))
    tbl1 = doc.add_table(rows=len(p1_stations) + 2, cols=6)
    keep_table_font_size(tbl1)
    tbl1.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl1.autofit = False
    set_repeat_header(tbl1.rows[0])
    set_repeat_header(tbl1.rows[1])
    set_row_cant_split(tbl1.rows[0])
    set_row_cant_split(tbl1.rows[1])

    c0_0 = tbl1.rows[0].cells[0]
    c0_0.merge(tbl1.rows[1].cells[0])
    c0_0.text = "Sr. No."

    c0_1 = tbl1.rows[0].cells[1]
    c0_1.merge(tbl1.rows[1].cells[1])
    c0_1.text = "City & State"

    c0_2 = tbl1.rows[0].cells[2]
    c0_2.merge(tbl1.rows[1].cells[2])
    c0_2.text = "Full Address with Pin code"

    c0_3 = tbl1.rows[0].cells[3]
    c0_3.merge(tbl1.rows[1].cells[3])
    c0_3.text = "Contact Person Name"

    c0_4 = tbl1.rows[0].cells[4]
    c0_4.merge(tbl1.rows[0].cells[5])
    c0_4.text = "Contact Numbers with STD Code"

    c1_4 = tbl1.rows[1].cells[4]
    c1_4.text = "Email ID"

    c1_5 = tbl1.rows[1].cells[5]
    c1_5.text = "Mobile No."

    for row_idx in (0, 1):
        for c_idx, c in enumerate(tbl1.rows[row_idx].cells):
            set_cell_shading(c, hdr_color)
            set_cell_margins(c, top=35, bottom=35, left=35, right=35)
            set_cell_border(c, top={'color': '4F81BD' if a else '000000', 'sz': 8}, bottom={'color': '4F81BD' if a else '000000', 'sz': 8}, left={'color': '4F81BD' if a else '000000', 'sz': 4}, right={'color': '4F81BD' if a else '000000', 'sz': 4})
            for p_elem in c.paragraphs:
                p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if (row_idx == 0 and c_idx >= 4) or c_idx == 0 else WD_ALIGN_PARAGRAPH.LEFT
                for r in p_elem.runs:
                    r.bold = True
                    r.font.name = font_name
                    r.font.size = Pt(8.8) if is_landscape else (Pt(11) if a else Pt(10.5))
                    r.font.color.rgb = hdr_text_color

    for r_i, st in enumerate(p1_stations):
        row_cells = tbl1.rows[r_i + 2].cells
        set_row_cant_split(tbl1.rows[r_i + 2])
        vals = [str(r_i + 1), st['city'], st['addr'], st['contact'], st['email'], st['mob']]
        for c_i, val in enumerate(vals):
            c = row_cells[c_i]
            c.text = val
            c.width = widths[c_i]
            st_border = 'A0A0A0' if a else '000000'
            set_cell_border(c, bottom={'color': st_border, 'sz': 4}, top={'color': st_border, 'sz': 4}, left={'color': st_border, 'sz': 4}, right={'color': st_border, 'sz': 4})
            for p_elem in c.paragraphs:
                p_elem.paragraph_format.line_spacing = 1.15
                p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if c_i in (0, 5) else WD_ALIGN_PARAGRAPH.LEFT
                for r in p_elem.runs:
                    r.font.name = font_name
                    r.font.size = Pt(8.5) if is_landscape else (Pt(11) if a else Pt(10.5))
                    if c_i in (0, 1):
                        r.bold = True
                    if c_i == 4 and a:
                        r.font.color.rgb = RGBColor(0x00, 0x00, 0xFF)
                    elif c_i == 4 and not a:
                        r.font.color.rgb = RGBColor(0x05, 0x63, 0xC1)

    # Continuation page: the next paragraph carries the page break
    p_brk = doc.add_paragraph()
    p_brk.paragraph_format.space_before = Pt(0)
    p_brk.paragraph_format.space_after = Pt(0)
    p_brk.paragraph_format.line_spacing = Pt(2)
    set_page_break_before(p_brk._p)

    # Page 2
    if not a:
        add_heading(doc, "DETAILS OF AFTER SALES SERVICE STATION (CONTD.)", a, doc_date=d.get('date'))
    elif not is_landscape:
        p_blank = doc.add_paragraph()
        p_blank.paragraph_format.space_before = Pt(0)
        p_blank.paragraph_format.space_after = Pt(0)
        p_blank.paragraph_format.line_spacing = Pt(12)
        r_blank = p_blank.add_run()
        r_blank.font.size = Pt(11)

    tbl2 = doc.add_table(rows=len(p2_stations) + 2, cols=6)
    keep_table_font_size(tbl2)
    tbl2.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl2.autofit = False
    set_repeat_header(tbl2.rows[0])
    set_repeat_header(tbl2.rows[1])
    set_row_cant_split(tbl2.rows[0])
    set_row_cant_split(tbl2.rows[1])

    c2_0_0 = tbl2.rows[0].cells[0]
    c2_0_0.merge(tbl2.rows[1].cells[0])
    c2_0_0.text = "Sr. No."

    c2_0_1 = tbl2.rows[0].cells[1]
    c2_0_1.merge(tbl2.rows[1].cells[1])
    c2_0_1.text = "City & State"

    c2_0_2 = tbl2.rows[0].cells[2]
    c2_0_2.merge(tbl2.rows[1].cells[2])
    c2_0_2.text = "Full Address with Pin code"

    c2_0_3 = tbl2.rows[0].cells[3]
    c2_0_3.merge(tbl2.rows[1].cells[3])
    c2_0_3.text = "Contact Person Name"

    c2_0_4 = tbl2.rows[0].cells[4]
    c2_0_4.merge(tbl2.rows[0].cells[5])
    c2_0_4.text = "Contact Numbers with STD Code"

    c2_1_4 = tbl2.rows[1].cells[4]
    c2_1_4.text = "Email ID"

    c2_1_5 = tbl2.rows[1].cells[5]
    c2_1_5.text = "Mobile No."

    for row_idx in (0, 1):
        for c_idx, c in enumerate(tbl2.rows[row_idx].cells):
            set_cell_shading(c, hdr_color)
            set_cell_margins(c, top=35, bottom=35, left=35, right=35)
            set_cell_border(c, top={'color': '4F81BD' if a else '000000', 'sz': 8}, bottom={'color': '4F81BD' if a else '000000', 'sz': 8}, left={'color': '4F81BD' if a else '000000', 'sz': 4}, right={'color': '4F81BD' if a else '000000', 'sz': 4})
            for p_elem in c.paragraphs:
                p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if (row_idx == 0 and c_idx >= 4) or c_idx == 0 else WD_ALIGN_PARAGRAPH.LEFT
                for r in p_elem.runs:
                    r.bold = True
                    r.font.name = font_name
                    r.font.size = Pt(8.8) if is_landscape else (Pt(11) if a else Pt(10.5))
                    r.font.color.rgb = hdr_text_color

    for r_i, st in enumerate(p2_stations):
        row_cells = tbl2.rows[r_i + 2].cells
        set_row_cant_split(tbl2.rows[r_i + 2])
        vals = [str(r_i + split_idx + 1), st['city'], st['addr'], st['contact'], st['email'], st['mob']]
        for c_i, val in enumerate(vals):
            c = row_cells[c_i]
            c.text = val
            c.width = widths[c_i]
            st_border = 'A0A0A0' if a else '000000'
            set_cell_border(c, bottom={'color': st_border, 'sz': 4}, top={'color': st_border, 'sz': 4}, left={'color': st_border, 'sz': 4}, right={'color': st_border, 'sz': 4})
            for p_elem in c.paragraphs:
                p_elem.paragraph_format.line_spacing = 1.15
                p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if c_i in (0, 5) else WD_ALIGN_PARAGRAPH.LEFT
                for r in p_elem.runs:
                    r.font.name = font_name
                    r.font.size = Pt(8.5) if is_landscape else (Pt(11) if a else Pt(10.5))
                    if c_i in (0, 1):
                        r.bold = True
                    if c_i == 4 and a:
                        r.font.color.rgb = RGBColor(0x00, 0x00, 0xFF)
                    elif c_i == 4 and not a:
                        r.font.color.rgb = RGBColor(0x05, 0x63, 0xC1)

    fix_table_grid(tbl1, widths)
    fix_table_grid(tbl2, widths)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_19(doc, p, d, a):
    """Doc 19: Undertaking (Regarding Experience and Turnover Exemption)"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    add_heading(doc, "UNDERTAKING", a, subtitle="(Regarding Experience and Turnover Exemption)", doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, None, p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    add_body_paragraph(doc, p['salutation'], a, bold=True)
    udyam = d.get('udyamNo', p.get('udyam_no', 'UDYAM-MH-19-0016285'))
    add_body_paragraph(doc, f"We {p['short_name']} hereby submit this undertaking in reference to the tender for the supply of {d.get('productDescription', 'Equipment / Goods')}. We wish to bring to your attention that our Company is duly registered under the Micro, Small and Medium Enterprises Development (MSME) Act, and possesses a valid Udyog Adhar registration with UAM No. {udyam} for the specified products.", a)
    add_body_paragraph(doc, "As per the Public Procurement Policy for Micro and Small Enterprises (MSEs) Order, 2012, issued by the Ministry of Micro, Small and Medium Enterprises, and its subsequent Orders/Notifications, MSEs are entitled to an exemption from the Experience and Turnover Criteria. Therefore, we hereby request your esteemed organization to kindly consider and grant us exemption from submitting Experience and Turnover Criteria for the tender.", a)
    add_body_paragraph(doc, "In accordance with the policy, we have uploaded the necessary supporting documents to prove our eligibility for exemption. These documents include our Udyog Adhar certificate and any other required documentation.", a)
    add_body_paragraph(doc, "We assure you that our company is fully committed to meeting all other technical and quality requirements outlined in the tender document.", a)
    add_body_paragraph(doc, "Thank you for considering our request. We look forward to the opportunity to participate in the tender process and contribute to the success of the project.", a)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

def build_doc_20(doc, p, d, a):
    """Doc 20: Undertaking (Regarding EMD Exemption)"""
    is_landscape = (d.get('orientation', 'portrait').lower() == 'landscape')
    add_heading(doc, "UNDERTAKING", a, subtitle="(Regarding Earnest Money Deposit (EMD) Exemption)", doc_date=d.get('date'))
    add_address_block(doc, d.get('authorityName'), d.get('authorityDept'), d.get('authorityAddress'), a)
    add_subject_ref(doc, None, p['ref_label'], d.get('bidNumber'), d.get('bidDate'), a)
    udyam = d.get('udyamNo', p.get('udyam_no', 'UDYAM-MH-19-0016285'))
    add_body_paragraph(doc, f"We, {p['short_name']} a Micro and Small Enterprise (MSEM) & Udyam Registration Number {udyam}, am submitting this undertaking in connection with our participation in the tender for the \"{d.get('productDescription', 'Equipment / Goods')}\"", a)
    add_body_paragraph(doc, "As per the Public Procurement Policy for Micro and Small Enterprises (MSEs) Order, 2012, dated 23.03.2012, issued by the Ministry of Micro, Small and Medium Enterprises, and its subsequent Orders/Notifications, MSEs are granted exemption from the Experience and Turnover Criteria.", a)
    add_body_paragraph(doc, "We hereby request your kind consideration for the exemption from the submission of Experience, Turnover, and Earnest Money Deposit (EMD) Criteria for the aforementioned tender. As an MSE, we fall under the ambit of the exemption policies outlined in the orders.", a)
    add_body_paragraph(doc, "To support our request, we have uploaded the necessary documents proving our eligibility for exemption from the Experience and Turnover Criteria. We believe that our MSE status qualifies us for this exemption, in accordance with the established procurement policies.", a)
    add_body_paragraph(doc, "By providing this undertaking, we affirm that the information provided is true and accurate. We understand the importance of compliance with the applicable policies and assure you of our commitment to fulfilling all other requirements and obligations outlined in the tender documents.", a)
    add_body_paragraph(doc, "Thank you for your understanding and cooperation. We look forward to the opportunity to contribute to and collaborate on this project.", a)
    add_body_paragraph(doc, "Thanking you and assuring you of our best services at all the times.", a)
    add_signatory_block(doc, p, a, d['root_dir'], d.get('place', p['place']), d.get('date'), is_landscape=is_landscape)

# ---------------------------------------------------------------------------
# Technical Specification Compliance Sheet Generator (Always Landscape)
# ---------------------------------------------------------------------------

def generate_technical_specification_docx(template_path, output_path, p, d, a, specs):
    """Generate technical specification sheet matching sample docx format in LANDSCAPE mode always."""
    doc = docx.Document(template_path)
    if doc.paragraphs:
        p0 = doc.paragraphs[0]._element
        p0.getparent().remove(p0)

    sec = doc.sections[0]
    sec.orientation = WD_ORIENT.LANDSCAPE
    sec.page_width = Inches(11.69)
    sec.page_height = Inches(8.27)

    # Set comfortable margins
    if a:
        sec.top_margin = Pt(80)
        sec.bottom_margin = Pt(28) # Clearance for 12pt footer bar
        sec.left_margin = Pt(36)
        sec.right_margin = Pt(36)
    else:
        sec.top_margin = Pt(65)
        sec.bottom_margin = Pt(115) # Prevents table rows from overlapping 110pt footer bar
        sec.left_margin = Pt(36)
        sec.right_margin = Pt(36)

    font_name = 'Cambria' # Matching sample document typography
    hdr_color = 'FBE2D5' if a else '4F81BD'
    hdr_text_color = RGBColor(0x00, 0x00, 0x00) if a else RGBColor(0xFF, 0xFF, 0xFF)

    # 1. Document Title
    p_title = doc.add_paragraph()
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_title.paragraph_format.space_before = Pt(0)
    p_title.paragraph_format.space_after = Pt(8)
    r_t = p_title.add_run("TECHNICAL SPECIFICATION COMPLIANCE DATA SHEET")
    r_t.bold = True
    r_t.font.name = font_name
    r_t.font.size = Pt(13.5)

    # 2. Buyer "To," Block
    p_to = doc.add_paragraph()
    p_to.paragraph_format.space_before = Pt(0)
    p_to.paragraph_format.space_after = Pt(6)
    p_to.paragraph_format.line_spacing = 1.2
    r_to_lbl = p_to.add_run("To,\n")
    r_to_lbl.bold = True
    r_to_lbl.font.name = font_name
    r_to_lbl.font.size = Pt(10)

    auth_name = d.get('authorityName') or d.get('authority') or d.get('buyerName') or 'The Competent Authority'
    auth_dept = d.get('authorityDept') or d.get('department') or ''
    auth_addr = d.get('authorityAddress') or d.get('location') or ''

    auth_lines = []
    if auth_name:
        for line in str(auth_name).split('\n'):
            if line.strip(): auth_lines.append(line.strip())
    if auth_dept and auth_dept.strip():
        auth_lines.append(auth_dept.strip())
    if auth_addr and auth_addr.strip():
        auth_lines.append(auth_addr.strip())

    for idx, l in enumerate(auth_lines):
        r_l = p_to.add_run(l + ("\n" if idx < len(auth_lines) - 1 else ""))
        if idx == 0:
            r_l.bold = True
        r_l.font.name = font_name
        r_l.font.size = Pt(10)

    # 3. Subject and Reference
    prod_desc = d.get('productDescription') or d.get('productName') or d.get('title') or 'Specified Goods / Equipment'
    bid_num = d.get('bidNumber') or d.get('ref_no') or d.get('refNo') or '-'
    bid_date = d.get('bidDate') or d.get('date') or datetime.now().strftime('%d-%m-%Y')

    p_sub = doc.add_paragraph()
    p_sub.paragraph_format.space_before = Pt(2)
    p_sub.paragraph_format.space_after = Pt(6)
    p_sub.paragraph_format.line_spacing = 1.25

    r_s1 = p_sub.add_run("Subject: ")
    r_s1.bold = True
    r_s1.font.name = font_name
    r_s1.font.size = Pt(10)
    r_s2 = p_sub.add_run(f"Technical Specification Compliance Data Sheet of {prod_desc}.\n")
    r_s2.font.name = font_name
    r_s2.font.size = Pt(10)

    r_r1 = p_sub.add_run("Reference No: Bid No.: ")
    r_r1.bold = True
    r_r1.font.name = font_name
    r_r1.font.size = Pt(10)
    r_r2 = p_sub.add_run(f"{bid_num} Dated : {bid_date}")
    r_r2.font.name = font_name
    r_r2.font.size = Pt(10)

    # 4. Product Details
    qty = str(d.get('qty') or d.get('bid_qty') or d.get('quantity') or d.get('requiredQuantity') or '-')
    make = d.get('offeredMake') or d.get('brand') or 'MarkEn'
    model = d.get('offeredModel') or d.get('model') or '-'

    p_meta = doc.add_paragraph()
    p_meta.paragraph_format.space_before = Pt(2)
    p_meta.paragraph_format.space_after = Pt(6)
    p_meta.paragraph_format.line_spacing = 1.25

    meta_items = [
        ("Product Name", f": {prod_desc}"),
        ("Required Quantity", f": {qty}"),
        ("Make", f": {make}"),
        ("Model", f": {model}")
    ]
    for idx, (label, val) in enumerate(meta_items):
        r_lbl = p_meta.add_run(f"{label}\t")
        r_lbl.bold = True
        r_lbl.font.name = font_name
        r_lbl.font.size = Pt(10)
        r_v = p_meta.add_run(val + ("\n" if idx < len(meta_items) - 1 else ""))
        r_v.bold = True
        r_v.font.name = font_name
        r_v.font.size = Pt(10)

    # 5. Build Specification Table(s)
    all_specs = specs if (specs and len(specs) > 0) else []
    if not all_specs:
        t_id = d.get('tenderId') or d.get('id') or bid_num
        if t_id and t_id != '-':
            try:
                from extract_tender_specs import extract_tender_data_and_specs
                ext = extract_tender_data_and_specs(t_id)
                if ext.get('success') and ext.get('specs'):
                    all_specs = ext['specs']
            except Exception:
                pass

    if not all_specs:
        all_specs = [{
            'sr': 1,
            'parameter': prod_desc,
            'value': f"As per Bid Document / Tender Requirement" + (f" (Qty: {qty})" if qty != '-' else ""),
            'compliance': 'Yes',
            'offered': f"Fully compliant with all technical specifications and tender requirements for {prod_desc}",
            'deviation': 'No Deviation',
            'isAtc': False
        }]

    gem_specs = [s for s in all_specs if not s.get('isAtc')]
    atc_specs = [s for s in all_specs if s.get('isAtc')]

    # Column widths for 11.0 inch landscape table
    widths = [Inches(0.6), Inches(2.3), Inches(3.2), Inches(1.2), Inches(2.5), Inches(1.2)]
    headers_gem = ["Sr no", "GeM Specification", "Tender specification", "Compliance Yes / No", "Offered Specification", "Any Deviation"]
    headers_atc = ["Sr no", "ATC Specification", "Tender specification", "Compliance Yes / No", "Offered Specification", "Any Deviation"]

    def build_table_section(items, header_labels):
        tbl = doc.add_table(rows=len(items) + 1, cols=6)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        tbl.autofit = False
        set_repeat_header(tbl.rows[0])
        set_row_cant_split(tbl.rows[0])

        for idx, c in enumerate(tbl.rows[0].cells):
            c.text = header_labels[idx]
            c.width = widths[idx]
            set_cell_shading(c, hdr_color)
            set_cell_margins(c, top=35, bottom=35, left=45, right=45)
            set_cell_border(c, top={'color': '000000', 'sz': 4}, bottom={'color': '000000', 'sz': 4}, left={'color': '000000', 'sz': 4}, right={'color': '000000', 'sz': 4})
            for p_elem in c.paragraphs:
                p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if idx in (0, 3, 5) else WD_ALIGN_PARAGRAPH.LEFT
                for r in p_elem.runs:
                    r.bold = True
                    r.font.name = font_name
                    r.font.size = Pt(9.5)
                    r.font.color.rgb = hdr_text_color

        for r_i, s in enumerate(items):
            row_cells = tbl.rows[r_i + 1].cells
            set_row_cant_split(tbl.rows[r_i + 1])
            vals = [
                str(s.get('sr', r_i + 1)),
                s.get('parameter', ''),
                s.get('value', s.get('requirement', 'As per Bid')),
                s.get('compliance', 'Yes'),
                s.get('offered', s.get('value', 'Complied')),
                s.get('deviation', 'No Deviation')
            ]
            for c_i, val in enumerate(vals):
                c = row_cells[c_i]
                c.text = val
                c.width = widths[c_i]
                set_cell_margins(c, top=35, bottom=35, left=45, right=45)
                set_cell_border(c, bottom={'color': '000000', 'sz': 4}, top={'color': '000000', 'sz': 4}, left={'color': '000000', 'sz': 4}, right={'color': '000000', 'sz': 4})
                for p_elem in c.paragraphs:
                    p_elem.paragraph_format.line_spacing = 1.15
                    p_elem.alignment = WD_ALIGN_PARAGRAPH.CENTER if c_i in (0, 3, 5) else WD_ALIGN_PARAGRAPH.LEFT
                    for r in p_elem.runs:
                        r.font.name = font_name
                        r.font.size = Pt(9)
                        if c_i == 1:
                            r.bold = True
                        elif c_i == 3:
                            r.bold = True

    # Build GeM specs table
    build_table_section(gem_specs if gem_specs else all_specs, headers_gem)

    # Build ATC specs table if present
    if atc_specs:
        p_atc_hdr = doc.add_paragraph()
        p_atc_hdr.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_atc_hdr.paragraph_format.space_before = Pt(4)
        p_atc_hdr.paragraph_format.space_after = Pt(3)
        p_atc_hdr.paragraph_format.keep_with_next = True
        r_atc = p_atc_hdr.add_run("ADDITIONAL SPECIFICATION")
        r_atc.bold = True
        r_atc.italic = True
        r_atc.font.name = font_name
        r_atc.font.size = Pt(11.5)

        build_table_section(atc_specs, headers_atc)

    # 6. Authentic Closing Section matching sample document
    p_thank = doc.add_paragraph()
    p_thank.paragraph_format.space_before = Pt(2)
    p_thank.paragraph_format.space_after = Pt(1)
    p_thank.paragraph_format.keep_with_next = True
    r_th = p_thank.add_run("Thanking you and assuring you of our best services at all the times.")
    r_th.bold = True
    r_th.italic = True
    r_th.font.name = font_name
    r_th.font.size = Pt(9.5)

    p_faith = doc.add_paragraph()
    p_faith.paragraph_format.space_before = Pt(1)
    p_faith.paragraph_format.space_after = Pt(1)
    p_faith.paragraph_format.keep_with_next = True
    r_f = p_faith.add_run("Yours faithfully,")
    r_f.bold = True
    r_f.font.name = font_name
    r_f.font.size = Pt(9.5)

    # Combined stamp and signature image
    stamp_sig_path = resolve_path([
        os.path.join(d['root_dir'], 'public', 'images', 'me_stamp_sig.png' if a else 'healthtech_stamp_sig.png'),
        os.path.join(d['root_dir'], 'frontend', 'public', 'images', 'me_stamp_sig.png' if a else 'healthtech_stamp_sig.png')
    ])
    if not stamp_sig_path or not os.path.exists(stamp_sig_path):
        stamp_sig_path = p.get('sig_path')

    if stamp_sig_path and os.path.exists(stamp_sig_path):
        p_img = doc.add_paragraph()
        p_img.paragraph_format.space_before = Pt(0)
        p_img.paragraph_format.space_after = Pt(0)
        p_img.paragraph_format.keep_with_next = True
        r_img = p_img.add_run()
        r_img.add_picture(stamp_sig_path, width=Inches(1.2))

    # Signatory details
    p_sig = doc.add_paragraph()
    p_sig.paragraph_format.space_before = Pt(1)
    p_sig.paragraph_format.space_after = Pt(0)
    p_sig.paragraph_format.line_spacing = 1.1

    company_line = f"On behalf of {p.get('short_name', 'M/s Mark Enterprises')} (Manufacturer)" if a else f"For and on behalf of {p.get('legal_name', 'Marken Healthtech Limited')}"
    place_line = f"Place : {p.get('full_address', p.get('place', 'Nashik'))}"
    mail_line = f"Mail id : info@markenworld.com"
    doc_date = d.get('date', '26-09-2026' if a else '10-01-2026')

    sig_lines = [
        (company_line, False),
        ("Authorized Signatory", False),
        (f"Dated : {doc_date}", False),
        (place_line, False),
        (mail_line, False)
    ]
    for idx, (txt, is_b) in enumerate(sig_lines):
        r_s = p_sig.add_run(txt + ("\n" if idx < len(sig_lines) - 1 else ""))
        r_s.bold = is_b
        r_s.font.name = font_name
        r_s.font.size = Pt(9)

    doc.save(output_path)
    print(f"Technical Specification Sheet saved to: {output_path}")

# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate Word documents for Tender Bids")
    parser.add_argument("--input", required=True, help="Path to input JSON file")
    parser.add_argument("--output-bid", required=True, help="Path to output bid documents docx")
    parser.add_argument("--output-spec", help="Path to output technical specifications docx")
    parser.add_argument("--orientation", choices=['portrait', 'landscape'], default=None, help="Page orientation")
    args = parser.parse_args()

    with open(args.input, 'r', encoding='utf-8') as f:
        data = json.load(f)

    root_dir = get_root_dir()
    data['root_dir'] = root_dir

    orientation = (args.orientation or data.get('orientation', 'portrait')).lower()
    is_landscape = (orientation == 'landscape')
    data['orientation'] = orientation

    company_key = data.get('companyKey', 'me').lower()
    if 'healthtech' in data.get('companyName', '').lower():
        company_key = 'healthtech'

    is_theme_a = (company_key == 'me')

    # Find letterhead templates
    me_landscape_template = resolve_path([
        os.path.join(root_dir, 'public', 'letterheads', 'ME_Landscape.docx'),
        os.path.join(root_dir, 'frontend', 'public', 'letterheads', 'ME_Landscape.docx')
    ])
    ht_landscape_template = resolve_path([
        os.path.join(root_dir, 'public', 'letterheads', 'Healthtech_Landscape.docx'),
        os.path.join(root_dir, 'frontend', 'public', 'letterheads', 'Healthtech_Landscape.docx')
    ])
    me_portrait_template = resolve_path([
        os.path.join(root_dir, 'public', 'letterheads', 'ME_Portrait.docx'),
        os.path.join(root_dir, 'frontend', 'public', 'letterheads', 'ME_Portrait.docx')
    ])
    ht_portrait_template = resolve_path([
        os.path.join(root_dir, 'public', 'letterheads', 'Healthtech_Portrait.docx'),
        os.path.join(root_dir, 'frontend', 'public', 'letterheads', 'Healthtech_Portrait.docx')
    ])

    if is_landscape:
        template_path = me_landscape_template if is_theme_a else ht_landscape_template
    else:
        template_path = me_portrait_template if is_theme_a else ht_portrait_template

    # Technical specifications MUST ALWAYS use the landscape template!
    spec_template_path = me_landscape_template if is_theme_a else ht_landscape_template

    if not template_path or not os.path.exists(template_path):
        print(f"Error: Letterhead template not found: {template_path}", file=sys.stderr)
        sys.exit(1)

    # Company Profile Definitions
    if is_theme_a:
        profile = {
            'short_name': 'M/s. Mark Enterprises',
            'legal_name': 'MARK ENTERPRISES',
            'salutation': 'Respected Sir/Madam,',
            'ref_label': 'Reference',
            'full_address': 'Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India',
            'manufacturer_name': 'M/s. Mark Enterprises',
            'manufacturer_address': 'Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra',
            'signatory_name': data.get('signatoryName', 'Shreedhar Shingare'),
            'signatory_designation': data.get('signatoryDesignation', 'Authorized Signatory – Tender manager'),
            'signatory_address': 'Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India',
            'phones': ['09175559646', '090111 04332'],
            'witness_details': 'Mr. Korra Praveen Naik',
            'place': 'Nashik, Maharashtra.',
            'udyam_no': 'MH23B0040110/UDYAM-MH-19-0016285',
            'localContentPct': '100%',
            'sig_path': resolve_path([
                os.path.join(root_dir, 'public', 'assets', 'brand', 'mark-enterprises', 'signature.png'),
                os.path.join(root_dir, 'frontend', 'public', 'assets', 'brand', 'mark-enterprises', 'signature.png'),
                os.path.join(root_dir, 'public', 'images', 'signature.png')
            ]),
            'stamp_path': resolve_path([
                os.path.join(root_dir, 'public', 'assets', 'brand', 'mark-enterprises', 'stamp.png'),
                os.path.join(root_dir, 'frontend', 'public', 'assets', 'brand', 'mark-enterprises', 'stamp.png'),
                os.path.join(root_dir, 'public', 'images', 'stamp.png')
            ])
        }
    else:
        profile = {
            'short_name': 'Marken Healthtech Limited',
            'legal_name': 'MARKEN HEALTHTECH LIMITED',
            'salutation': 'Dear Sir/Madam,',
            'ref_label': 'Reference',
            'full_address': '93/1 Street No.17, MIDC, Satpur, Nashik- 422007. MH. India',
            'manufacturer_name': 'Marken Healthtech Ltd',
            'manufacturer_address': 'Shed No.1, Plot No.93/1, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra.',
            'signatory_name': data.get('signatoryName', 'Korra Praveen Naik'),
            'signatory_designation': data.get('signatoryDesignation', 'Authorized Signatory'),
            'signatory_address': '1-1-51/46, Kapra, ECIL post, S.T.Colony, VTC: Ranga Reddy, Hyderabad - 500062',
            'phones': ['+91 91 3030 5959'],
            'witness_details': 'Mr. Shreedhar Shingare (Cell No.: 09011104332)',
            'place': 'Nashik',
            'udyam_no': 'UDYAM-MH-19-0016285',
            'localContentPct': '100%',
            'sig_path': resolve_path([
                os.path.join(root_dir, 'public', 'assets', 'brand', 'marken-healthtech', 'signature.png'),
                os.path.join(root_dir, 'frontend', 'public', 'assets', 'brand', 'marken-healthtech', 'signature.png'),
                os.path.join(root_dir, 'public', 'images', 'healthtech_sig.png')
            ]),
            'stamp_path': resolve_path([
                os.path.join(root_dir, 'public', 'assets', 'brand', 'marken-healthtech', 'stamp.png'),
                os.path.join(root_dir, 'frontend', 'public', 'assets', 'brand', 'marken-healthtech', 'stamp.png'),
                os.path.join(root_dir, 'public', 'images', 'healthtech_stamp.png')
            ])
        }

    # Load authentic Word letterhead template
    doc = docx.Document(template_path)
    if doc.paragraphs:
        p0 = doc.paragraphs[0]._element
        p0.getparent().remove(p0)

    sec = doc.sections[0]
    if is_landscape:
        sec.orientation = WD_ORIENT.LANDSCAPE
        sec.page_width = Inches(11.69)
        sec.page_height = Inches(8.27)
        if is_theme_a:
            sec.top_margin = Pt(92)
            sec.bottom_margin = Pt(26)
            sec.left_margin = Pt(36)
            sec.right_margin = Pt(36)
        else:
            sec.top_margin = Pt(65)
            sec.bottom_margin = Pt(115) # Prevents body text from overlapping 110pt footer bar
            sec.left_margin = Pt(36)
            sec.right_margin = Pt(36)
    else:
        sec.orientation = WD_ORIENT.PORTRAIT
        sec.page_width = Inches(8.27)
        sec.page_height = Inches(11.69)
        if is_theme_a:
            sec.top_margin = Pt(92)
            sec.bottom_margin = Pt(26) # ~9mm: body ends just above the 5.5mm footer bar
            sec.left_margin = Pt(28.3)
            sec.right_margin = Pt(28.3)
        else:
            sec.top_margin = Pt(58) # logo artwork ends at ~53pt
            sec.bottom_margin = Pt(88) # Footer graphic is 89.6pt and its top ~8pt is blank, so text keeps a clear gap
            sec.left_margin = Pt(49.6) # 17.5mm matching sample PDF
            sec.right_margin = Pt(42.5) # 15.0mm matching sample PDF

    # The Healthtech letterhead footer artwork is anchored with "wrap square", which makes Word reserve the
    # whole footer band and stop body text ~40pt above the artwork. Render it without text wrapping so
    # the body uses the page down to the bottom margin (artwork position and size are unchanged).
    for section in doc.sections:
        for wrap in list(section.footer._element.iter(qn('wp:wrapSquare'))):
            wrap.getparent().replace(wrap, OxmlElement('wp:wrapNone'))

    # Set document default font
    style = doc.styles['Normal']
    font = style.font
    body_pt = (11 if is_theme_a else 9.5) if is_landscape else BID_BODY_PT
    font.name = BID_FONT
    font.size = Pt(body_pt)

    # 1. Build documents sequentially with page breaks
    if is_theme_a:
        builders = [
            build_doc_1,
            build_doc_2,
            build_doc_3,
            build_doc_4,
            build_doc_5,
            build_doc_6,
            build_doc_7,
            build_doc_8,
            build_doc_9,
            build_doc_10,
            build_doc_11,
            build_doc_12,
            build_doc_13,
            build_doc_14,
            build_doc_15,
            build_doc_16,
            build_doc_17_18, # Contains Doc 17 and Doc 18
            build_doc_19,
            build_doc_20
        ]
    else:
        # Theme B (Marken Healthtech): Exact 14 documents (16 pages) matching MHL reference
        builders = [
            build_doc_4,        # 1. Bid Form
            build_doc_5,        # 2. Bid Security Declaration Form
            build_doc_1,        # 3. Bidder Information
            build_doc_14,       # 4. Declaration Certificate for Local Content (Page 1)
            build_doc_15,       # 5. Declaration Certificate for Local Content (Page 2)
            build_doc_10,       # 6. Declaration for Demonstration
            build_doc_13,       # 7. Declaration for Certificate of Country of Origin
            build_doc_11,       # 8. Declaration on Non-Blacklisting / Debarring
            build_doc_8a,       # 9. Undertaking for Warranty (General Scope)
            build_doc_6,        # 10. Acceptance of Tender Terms and Conditions
            build_doc_9,        # 11. Price Declaration
            build_doc_12,       # 12. Undertaking for Financial Standing
            build_doc_8b,       # 13. Undertaking for Warranty (Product-Specific Scope)
            build_doc_17_18,    # 14 & 15. Details of After Sales Service Station (Page 1 & 2)
            build_doc_16        # 16. Escalation Matrix for Service Support
        ]

    body = doc.element.body
    for idx, builder in enumerate(builders):
        marker = body[-2] if len(body) >= 2 else None  # last content element before sectPr
        builder(doc, profile, data, is_theme_a)
        if idx > 0:
            first_p = first_paragraph_after(body, marker)
            if first_p is not None:
                set_page_break_before(first_p)
            else:
                doc.add_page_break()

    apply_bid_typography(doc, body_pt=body_pt, heading_min_pt=(13 if is_landscape else BID_HEADING_MIN_PT))

    os.makedirs(os.path.dirname(os.path.abspath(args.output_bid)), exist_ok=True)
    doc.save(args.output_bid)
    print(f"Bid Documents successfully generated: {args.output_bid}")

    # 2. Build Technical Specification Sheet if requested (Always Landscape)
    if args.output_spec:
        os.makedirs(os.path.dirname(os.path.abspath(args.output_spec)), exist_ok=True)
        specs = data.get('specs', [])
        generate_technical_specification_docx(spec_template_path, args.output_spec, profile, data, is_theme_a, specs)

if __name__ == '__main__':
    main()
