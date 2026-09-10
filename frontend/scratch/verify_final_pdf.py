import pypdf
from pypdf import PdfReader

pdf_path = 'public/documents/100204425/Bid_Documents_100204425.pdf'
reader = PdfReader(pdf_path)
print("Total pages:", len(reader.pages))

for page_num in range(1, len(reader.pages) + 1):
    page = reader.pages[page_num - 1]
    resources = page['/Resources']
    num_xobjs = len(resources['/XObject']) if '/XObject' in resources else 0
    
    # Check if signature/stamp is present (i.e. images with width 280 or 272)
    has_sig_stamp = False
    if num_xobjs > 0:
        xobjects = resources['/XObject']
        for name in xobjects:
            xobj = xobjects[name]
            w = xobj.get('/Width')
            if w in (280, 272): # stamp or signature width
                has_sig_stamp = True
                
    print(f"Page {page_num:02d}: Images={num_xobjs} | HasSignatureAndStamp={has_sig_stamp}")
