import pypdf
import sys

def audit_pdf(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    print(f"Auditing {pdf_path} (Pages: {len(reader.pages)})")
    
    for i, page in enumerate(reader.pages):
        print(f"\n--- PAGE {i + 1} ---")
        text_runs = []
        
        def visitor(text, cm, tm, font_dict, font_size):
            if not text.strip():
                return
            font_name = "Unknown"
            if font_dict:
                font_name = font_dict.get('/BaseFont', 'Unknown')
                if isinstance(font_name, pypdf.generic.NameObject):
                    font_name = str(font_name)
            text_runs.append((text.strip(), font_name, font_size))
            
        page.extract_text(visitor_text=visitor)
        
        # Group by font size and name to summarize
        summary = {}
        for text, font, size in text_runs:
            key = (font, round(size, 2))
            if key not in summary:
                summary[key] = []
            summary[key].append(text)
            
        print("Fonts and sizes on page:")
        for (font, size), texts in sorted(summary.items(), key=lambda x: x[0]):
            sample = " | ".join(texts[:5])
            if len(texts) > 5:
                sample += " ... (total {})".format(len(texts))
            print(f"  - {font} @ {size:.2f}pt: {sample}")

if __name__ == "__main__":
    pdf_path = "template.pdf"
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
    audit_pdf(pdf_path)
