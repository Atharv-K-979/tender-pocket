import pypdf
from pypdf import PdfReader

reader = PdfReader('template.pdf')
page = reader.pages[0]

contents = page.get_contents()
print("Contents type:", type(contents))
if isinstance(contents, list):
    print("Contents length:", len(contents))
    for i, c in enumerate(contents):
        print(f"  Stream {i}: size={len(c.get_data())} bytes")
else:
    print("  Stream: size=", len(contents.get_data()) if contents else 0)

# Let's inspect the first 200 operations
from pypdf.generic import ContentStream
stream = ContentStream(contents, page.pdf)
print("Total operations:", len(stream.operations))
for idx, (operands, operator) in enumerate(stream.operations):
    if operator in (b'Do', b'cm', b'q', b'Q'):
        print(f"Op {idx}: {operator} with operands {operands}")
