import pypdf
from pypdf import PdfReader
from pypdf.generic import ContentStream

reader = PdfReader('template.pdf')

def print_op_counts(page_num):
    page = reader.pages[page_num - 1]
    contents = page.get_contents()
    stream = ContentStream(contents, page.pdf)
    
    op_counts = {}
    for operands, operator in stream.operations:
        op_counts[operator] = op_counts.get(operator, 0) + 1
        
    print(f"\nPage {page_num} Operator Counts:")
    for op, count in sorted(op_counts.items(), key=lambda x: x[1], reverse=True):
        print(f"  {op.decode('ascii', errors='ignore')}: {count}")

print_op_counts(4)
print_op_counts(15)
