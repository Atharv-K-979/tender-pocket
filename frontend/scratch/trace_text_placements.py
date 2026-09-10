import pypdf
from pypdf import PdfReader
from pypdf.generic import ContentStream

import sys
pdf_path = sys.argv[1] if len(sys.argv) > 1 else '/Users/anuthibhansali/Downloads/Sample Doc.pdf'
reader = PdfReader(pdf_path)
page = reader.pages[0]
contents = page.get_contents()
stream = ContentStream(contents, page.pdf)

ctm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
ctm_stack = []
tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
tlm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]

def multiply_matrices(m1, m2):
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return [
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2
    ]

active_font = None
active_size = None
count = 0

print("Absolute text placements (First 50):")
for operands, operator in stream.operations:
    if operator == b'q':
        ctm_stack.append(ctm.copy())
    elif operator == b'Q':
        if ctm_stack:
            ctm = ctm_stack.pop()
    elif operator == b'cm':
        m = [float(x) for x in operands]
        ctm = multiply_matrices(ctm, m)
    elif operator == b'BT':
        tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        tlm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    elif operator == b'Tf':
        active_font = operands[0]
        active_size = float(operands[1])
    elif operator == b'Tm':
        tm = [float(x) for x in operands]
        tlm = tm.copy()
    elif operator == b'Td':
        tx, ty = float(operands[0]), float(operands[1])
        tlm[4] += tx * tlm[0] + ty * tlm[2]
        tlm[5] += tx * tlm[1] + ty * tlm[3]
        tm = tlm.copy()
    elif operator == b'TD':
        tx, ty = float(operands[0]), float(operands[1])
        tlm[4] += tx * tlm[0] + ty * tlm[2]
        tlm[5] += tx * tlm[1] + ty * tlm[3]
        tm = tlm.copy()
    elif operator in (b'Tj', b'TJ'):
        text_data = operands[0]
        if operator == b'TJ':
            text_parts = []
            for x in text_data:
                if isinstance(x, str):
                    text_parts.append(x)
                elif isinstance(x, bytes):
                    text_parts.append(x.decode('utf-8', errors='ignore'))
            text = "".join(text_parts)
        else:
            if isinstance(text_data, bytes):
                text = text_data.decode('utf-8', errors='ignore')
            else:
                text = str(text_data)
        
        if text.strip():
            comb = multiply_matrices(tm, ctm)
            x_abs, y_abs = comb[4], comb[5]
            print(f"  x={x_abs:.2f}, y={y_abs:.2f} | Font: {active_font} | Size: {active_size * comb[0]:.1f} | Text: '{text.strip()}'")
            count += 1
            if count >= 50:
                break
