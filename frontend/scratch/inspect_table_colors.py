import pypdf
from pypdf import PdfReader
from pypdf.generic import ContentStream

reader = PdfReader('template.pdf')

def analyze_page_colors(page_num):
    page = reader.pages[page_num - 1]
    contents = page.get_contents()
    stream = ContentStream(contents, page.pdf)
    
    print(f"\n--- Page {page_num} Colors ---")
    current_stroke = None
    current_fill = None
    for operands, operator in stream.operations:
        if operator == b'RG':
            current_stroke = [float(x) for x in operands]
        elif operator == b'G':
            current_stroke = [float(operands[0])]
        elif operator == b'rg':
            current_fill = [float(x) for x in operands]
        elif operator == b'g':
            current_fill = [float(operands[0])]
        elif operator in (b'S', b's', b'f', b'f*', b'B', b'B*', b'b', b'b*'):
            print(f"Op {operator.decode('ascii')}: Stroke={current_stroke}, Fill={current_fill}")

analyze_page_colors(4)
analyze_page_colors(15)
