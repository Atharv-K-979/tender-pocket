import pypdf
from pypdf import PdfReader
from pypdf.generic import ContentStream

reader = PdfReader('template.pdf')
page = reader.pages[0]

contents = page.get_contents()
stream = ContentStream(contents, page.pdf)

current_matrix = [1, 0, 0, 1, 0, 0]
matrices = []

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

print("Graphics Operations at the top/bottom of Page 1:")
for idx, (operands, operator) in enumerate(stream.operations):
    if operator == b'q':
        matrices.append(current_matrix.copy())
    elif operator == b'Q':
        if matrices:
            current_matrix = matrices.pop()
    elif operator == b'cm':
        m = [float(x) for x in operands]
        current_matrix = multiply_matrices(current_matrix, m)
    elif operator in (b'm', b'l', b're', b'S', b'f', b'f*'):
        # Get coordinates in absolute page space
        # For simplicity, we just print operations if their translation e, f is near top/bottom
        tx, ty = current_matrix[4], current_matrix[5]
        if ty < 100 or ty > 700:
            print(f"Op {idx}: {operator} with translation x={tx:.2f}, y={ty:.2f}, operands={operands}")
