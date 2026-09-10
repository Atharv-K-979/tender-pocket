import pypdf
import sys

def extract_links(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    links = []
    for i, page in enumerate(reader.pages):
        if "/Annots" in page:
            annots = page["/Annots"]
            for annot in annots:
                obj = annot.get_object()
                if obj.get("/Subtype") == "/Link":
                    action = obj.get("/A")
                    if action and action.get("/URI"):
                        uri = action["/URI"]
                        links.append((i + 1, uri))
    
    print(f"Total links found: {len(links)}")
    for page_num, uri in links[:20]:
        print(f"Page {page_num}: {uri}")

if __name__ == "__main__":
    pdf_path = "public/documents/9445624/Bid_Document_9445624.pdf"
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
    extract_links(pdf_path)
