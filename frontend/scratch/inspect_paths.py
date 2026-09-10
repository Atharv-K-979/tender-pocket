import pypdf
from pypdf import PdfReader
from pypdf.generic import ContentStream

reader = PdfReader('template.pdf')
page = reader.pages[0]

contents = page.get_contents()
stream = ContentStream(contents, page.pdf)

print("Vector Path Operations on Page 1:")
op_counts = {}
for operands, operator in stream.operations:
    op_counts[operator] = op_counts.get(operator, 0) + 1

for op, count in sorted(op_counts.items(), key=lambda x: x[1], reverse=True):
    print(f"  Operator: {op.decode('ascii', errors='ignore')}, Count: {count}")

# Print out operations that set color or draw paths
print("\nColor and Path Drawing Operations:")
for idx, (operands, operator) in enumerate(stream.operations):
    if operator in (b'rg', b'RG', b're', b'f', b'f*', b'S', b's', b'w', b'm', b'l'):
        print(f"Op {idx}: {operator} with operands {operands}")
