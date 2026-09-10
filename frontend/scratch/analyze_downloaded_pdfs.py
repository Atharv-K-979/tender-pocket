import os
import pypdf
from pypdf import PdfReader

def analyze_pdf(name, path):
    print(f"\n===== {name} =====")
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return
    print(f"Path: {path}")
    print(f"Size: {os.path.getsize(path)} bytes")
    reader = PdfReader(path)
    print(f"Total Pages: {len(reader.pages)}")
    
    # Inspect first page
    page = reader.pages[0]
    print(f"Page 1 MediaBox: {page.mediabox}")
    resources = page['/Resources']
    if '/XObject' in resources:
        xobjs = resources['/XObject']
        print(f"Page 1 XObjects count: {len(xobjs)}")
        for xname in xobjs:
            xobj = xobjs[xname]
            print(f"  Name: {xname}, Subtype: {xobj.get('/Subtype')}, Width: {xobj.get('/Width')}, Height: {xobj.get('/Height')}")
    else:
        print("Page 1 has no XObjects.")

analyze_pdf("Expected Sample Doc", "/Users/anuthibhansali/Downloads/Sample Doc.pdf")
analyze_pdf("Generated Bid Documents", "/Users/anuthibhansali/Downloads/Bid_Documents_9449992.pdf")
