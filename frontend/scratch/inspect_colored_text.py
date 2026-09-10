import pypdf
from pypdf import PdfReader
from pypdf.generic import ContentStream

reader = PdfReader('template.pdf')
page = reader.pages[0]

contents = page.get_contents()
stream = ContentStream(contents, page.pdf)

current_fill_color = [0, 0, 0] # default black
current_stroke_color = [0, 0, 0]

print("Text and Color Operations:")
for idx, (operands, operator) in enumerate(stream.operations):
    if operator == b'rg':
        current_fill_color = [float(x) for x in operands]
    elif operator == b'RG':
        current_stroke_color = [float(x) for x in operands]
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
            is_colored = any(c > 0.05 for c in current_fill_color)
            print(f"Text: '{text.strip()}' | Color: {current_fill_color} | IsColored: {is_colored}")
