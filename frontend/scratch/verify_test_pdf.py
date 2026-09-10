import pypdf
from pypdf import PdfReader
from pypdf.generic import ContentStream

reader = PdfReader('public/test-bid-documents.pdf')
page = reader.pages[0]

contents = page.get_contents()
stream = ContentStream(contents, page.pdf)

print("Color operators in test-bid-documents.pdf:")
op_counts = {}
for operands, operator in stream.operations:
    if operator in (b'rg', b'RG', b'g', b'G', b'sc', b'scn', b'SC', b'SCN'):
        op_name = operator.decode('ascii')
        print(f"  Op {op_name} with operands {operands}")
