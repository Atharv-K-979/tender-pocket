import pypdf
import sys

def inspect_fonts(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    print(f"Reading {pdf_path} (Pages: {len(reader.pages)})")
    
    # We will inspect pages of interest: Page 3 (bidder particulars), Page 15 (service stations), Page 17 (escalation matrix)
    pages_to_inspect = [2, 14, 16] # 0-indexed: Page 3, Page 15, Page 17
    
    for page_num in pages_to_inspect:
        if page_num >= len(reader.pages):
            continue
        print(f"\n================ PAGE {page_num + 1} ==================")
        page = reader.pages[page_num]
        
        fonts_used = set()
        text_with_fonts = []
        
        def visitor(text, cm, tm, font_dict, font_size):
            if not text.strip():
                return
            font_name = "Unknown"
            if font_dict:
                # Extract font name from dict, often under /BaseFont
                font_name = font_dict.get('/BaseFont', 'Unknown')
                if isinstance(font_name, pypdf.generic.NameObject):
                    font_name = str(font_name)
            
            fonts_used.add((font_name, font_size))
            text_with_fonts.append((text, font_name, font_size))
            
        page.extract_text(visitor_text=visitor)
        
        print("Unique fonts and sizes found:")
        for font, size in sorted(fonts_used):
            print(f"  - Font: {font} | Size: {size:.2f}pt")
            
        print("\nAll text elements with their fonts:")
        for text, font, size in text_with_fonts:
            print(f"  [{font} @ {size:.1f}pt]: {text.strip()}")

if __name__ == "__main__":
    pdf_path = "template.pdf"
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
    inspect_fonts(pdf_path)
