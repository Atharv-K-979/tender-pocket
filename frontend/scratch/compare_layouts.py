import pypdf
from pypdf import PdfReader
from pypdf.generic import ContentStream

def analyze_pdf_structure(pdf_path):
    print(f"\n===== Analyzing {pdf_path} =====")
    reader = PdfReader(pdf_path)
    page = reader.pages[0]
    print("MediaBox:", page.mediabox)
    
    resources = page['/Resources']
    if '/XObject' in resources:
        xobjects = resources['/XObject']
        print(f"XObjects present ({len(xobjects)}):")
        for name in xobjects:
            xobj = xobjects[name]
            print(f"  Name: {name}, Subtype: {xobj.get('/Subtype')}, Width: {xobj.get('/Width')}, Height: {xobj.get('/Height')}")
            
    # Print out text runs, their positions, and fonts
    contents = page.get_contents()
    stream = ContentStream(contents, page.pdf)
    
    current_font = None
    current_size = None
    text_runs = []
    
    for operands, operator in stream.operations:
        if operator == b'Tf':
            current_font = operands[0]
            current_size = float(operands[1])
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
                text_runs.append((text.strip(), current_font, current_size))
                
    print(f"First 10 text runs:")
    for text, font, size in text_runs[:15]:
        print(f"  Text: '{text}' | Font: {font} | Size: {size}")

analyze_pdf_structure('template.pdf')
analyze_pdf_structure('public/test-bid-documents.pdf')
