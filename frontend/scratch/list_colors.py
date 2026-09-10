import pypdf
from pypdf import PdfReader
from pypdf.generic import ContentStream

reader = PdfReader('template.pdf')
distinct_colors = set()

for idx, page in enumerate(reader.pages):
    contents = page.get_contents()
    if not contents:
        continue
    stream = ContentStream(contents, page.pdf)
    for operands, operator in stream.operations:
        if operator == b'rg':
            color = tuple(round(float(x), 3) for x in operands)
            distinct_colors.add(color)
        elif operator == b'g':
            color = (round(float(operands[0]), 3),)
            distinct_colors.add(color)

print("Distinct fill colors in template.pdf:")
for color in distinct_colors:
    if len(color) == 3:
        hex_color = '#{:02x}{:02x}{:02x}'.format(int(color[0]*255), int(color[1]*255), int(color[2]*255))
        print(f"  RGB: {color} -> Hex: {hex_color}")
    else:
        print(f"  Grayscale: {color}")
