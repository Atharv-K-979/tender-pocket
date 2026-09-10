import pypdf
from pypdf import PdfReader
from pypdf.generic import ContentStream

reader = PdfReader("/Users/anuthibhansali/.gemini/antigravity/scratch/tender-pocket/template.pdf")
print("=== Bold Texts in template.pdf ===")
print("Number of pages:", len(reader.pages))

for page_num in range(len(reader.pages)):
    page = reader.pages[page_num]
    local_fonts = {}
    resources = page.get("/Resources", {})
    if "/Font" in resources:
        for fkey, fobj in resources["/Font"].items():
            # Resolve indirect object
            fobj_resolved = fobj.get_object() if hasattr(fobj, "get_object") else fobj
            bf = fobj_resolved.get("/BaseFont", "")
            local_fonts[fkey] = str(bf)
    print(f"Page {page_num+1} local_fonts keys count: {len(local_fonts)}")
            
    contents = page.get_contents()
    if contents is None:
        continue
    stream = ContentStream(contents, page.pdf)
    
    active_font = None
    bold_runs = []
    
    for operands, operator in stream.operations:
        if operator == b"Tf":
            active_font = operands[0]
        elif operator in (b"Tj", b"TJ"):
            text_data = operands[0]
            if operator == b"TJ":
                parts = []
                for x in text_data:
                    if isinstance(x, str):
                        parts.append(x)
                    elif isinstance(x, bytes):
                        parts.append(x.decode("utf-8", errors="ignore"))
                text = "".join(parts)
            else:
                text = text_data.decode("utf-8", errors="ignore") if isinstance(text_data, bytes) else str(text_data)
            
            if text.strip():
                bf = local_fonts.get(active_font, "")
                if not bf and active_font:
                    # try casting active_font to string or name
                    bf = local_fonts.get(str(active_font), "")
                if "bold" in bf.lower():
                    # Clean up text
                    cleaned = text.strip()
                    if cleaned:
                        bold_runs.append(cleaned)
                if page_num == 0 and len(bold_runs) < 5:
                    print(f"DEBUG: text='{text.strip()}' active_font='{active_font}' resolved_bf='{bf}'")
                        
    if bold_runs:
        print(f"Page {page_num+1} bold texts:")
        # Combine consecutive runs to make it readable
        print("  ", " | ".join(bold_runs[:30]))
