import pypdf
import sys

def inspect_images_and_drawings(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    page = reader.pages[0]
    
    print("\n--- Resources ---")
    if "/Resources" in page:
        res = page["/Resources"]
        if "/XObject" in res:
            xobjects = res["/XObject"]
            print(f"XObjects found: {len(xobjects)}")
            for name in xobjects:
                obj = xobjects[name]
                print(f"  {name}: Subtype={obj.get('/Subtype')}, Width={obj.get('/Width')}, Height={obj.get('/Height')}")
        else:
            print("No XObjects found (no inline images).")
            
        if "/ColorSpace" in res:
            print(f"ColorSpaces: {res['/ColorSpace'].keys()}")
            
    # Let's inspect the text contents of the first page to see if we can find any font colors
    # Text colors are usually defined in PDF page content streams (operators like 'rg' or 'RG')
    print("\n--- Content Stream Operators (subset) ---")
    contents = page.get_contents()
    if contents:
        # Just print the first 1000 characters of the raw content stream
        data = contents.get_data()
        print(data[:1500].decode('latin1', errors='ignore'))

if __name__ == "__main__":
    pdf_path = "/Users/anuthibhansali/Downloads/Sample Doc.pdf"
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
    inspect_images_and_drawings(pdf_path)
