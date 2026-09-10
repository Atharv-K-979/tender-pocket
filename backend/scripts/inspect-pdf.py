import pypdf
import sys

def inspect_pdf(pdf_path):
    print(f"Reading PDF: {pdf_path}")
    reader = pypdf.PdfReader(pdf_path)
    num_pages = len(reader.pages)
    print(f"Total Pages: {num_pages}")
    
    # Check if there are form fields (AcroForm)
    fields = reader.get_fields()
    if fields:
        print("\n--- Interactive Form Fields Found ---")
        for field_name, field_val in fields.items():
            print(f"Field: {field_name} | Value: {field_val.get('/V')}")
    else:
        print("\nNo interactive PDF form fields found. Searching for placeholder text / highlighted text.")

    # Extract text from the first few pages to understand what it is
    print("\n--- Extracting Page Texts (First 5 Pages) ---")
    for i in range(min(5, num_pages)):
        text = reader.pages[i].extract_text()
        print(f"\n--- PAGE {i+1} ---")
        print(text[:1500]) # print first 1500 chars

if __name__ == "__main__":
    pdf_path = "template.pdf"
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
    inspect_pdf(pdf_path)
