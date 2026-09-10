import pypdf
from pypdf import PdfReader

reader = PdfReader('template.pdf')
page = reader.pages[0]

print("Page MediaBox:", page.mediabox)

def extract_image_placements(page):
    # pypdf ContentStream can parse the page contents
    from pypdf.generic import ContentStream
    content = page.get_contents()
    if not content:
        return
    
    stream = ContentStream(content, page.pdf)
    
    current_matrix = [1, 0, 0, 1, 0, 0]
    matrices = []
    
    for operands, operator in stream.operations:
        if operator == b'cm':
            current_matrix = [float(x) for x in operands]
        elif operator == b'q':
            matrices.append(current_matrix.copy())
        elif operator == b'Q':
            if matrices:
                current_matrix = matrices.pop()
        elif operator == b'Do':
            xobj_name = operands[0]
            print(f"XObject drawn: {xobj_name} with matrix: {current_matrix}")

extract_image_placements(page)
