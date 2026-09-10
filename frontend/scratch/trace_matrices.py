import pypdf
from pypdf import PdfReader
from pypdf.generic import ContentStream

reader = PdfReader('template.pdf')
page = reader.pages[0]

# Standard A4 size is 595.35 x 841.95. Let's verify media box
print("MediaBox:", page.mediabox)

contents = page.get_contents()
stream = ContentStream(contents, page.pdf)

# Graphics state stack
matrix_stack = []
current_matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]

def multiply_matrices(m1, m2):
    # m1 and m2 are [a, b, c, d, e, f] representing:
    # [ a  b  0 ]
    # [ c  d  0 ]
    # [ e  f  1 ]
    # returns m1 * m2
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

for idx, (operands, operator) in enumerate(stream.operations):
    if operator == b'q':
        matrix_stack.append(current_matrix.copy())
    elif operator == b'Q':
        if matrix_stack:
            current_matrix = matrix_stack.pop()
    elif operator == b'cm':
        m = [float(x) for x in operands]
        current_matrix = multiply_matrices(current_matrix, m)
    elif operator == b'Do':
        xobj_name = operands[0]
        # In PDF, a unit square [0,0,1,1] is mapped by the current transformation matrix
        # to the position and size of the image.
        # Thus, the width of the image is hypot(a, b), height is hypot(c, d), and placement is (e, f)
        a, b, c, d, e, f = current_matrix
        print(f"XObject: {xobj_name}")
        print(f"  Matrix: {current_matrix}")
        print(f"  Position: x={e:.2f}, y={f:.2f}")
        print(f"  Scale: width={a:.2f}, height={d:.2f}")
