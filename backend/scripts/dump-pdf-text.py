import pypdf

def dump_pdf_to_md(pdf_path, output_path):
    reader = pypdf.PdfReader(pdf_path)
    print(f"Reading {pdf_path} (Pages: {len(reader.pages)})")
    
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(f"# Extracted Content of {pdf_path}\n\n")
        for i, page in enumerate(reader.pages):
            f.write(f"## Page {i + 1}\n\n")
            f.write(page.extract_text() or "(No text found on this page)")
            f.write("\n\n---\n\n")
            
    print(f"Successfully dumped text to {output_path}")

if __name__ == "__main__":
    dump_pdf_to_md("template.pdf", "template_extracted.md")
