import zipfile
import xml.etree.ElementTree as ET

docx_path = "/Users/anuthibhansali/Downloads/Compliance sheet (2).docx"
namespaces = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

with zipfile.ZipFile(docx_path) as docx:
    xml_content = docx.read('word/document.xml')
    root = ET.fromstring(xml_content)
    
    # Let's extract all paragraphs and tables in order of appearance
    # XML tags of interest: w:p (paragraph), w:tbl (table)
    body = root.find('w:body', namespaces)
    
    element_index = 0
    for child in body:
        tag_local = child.tag.split('}')[-1]
        
        if tag_local == 'p':
            # Extract text from paragraph
            text_elems = child.findall('.//w:t', namespaces)
            text = "".join([t.text for t in text_elems if t.text])
            if text.strip():
                print(f"P[{element_index}]: {text.strip()}")
                element_index += 1
                
        elif tag_local == 'tbl':
            print(f"\n--- TABLE[{element_index}] ---")
            rows = child.findall('.//w:tr', namespaces)
            for r_idx, row in enumerate(rows):
                cells = row.findall('.//w:tc', namespaces)
                cell_texts = []
                for cell in cells:
                    t_elems = cell.findall('.//w:t', namespaces)
                    txt = "".join([t.text for t in t_elems if t.text])
                    cell_texts.append(txt.strip())
                print(f"  Row {r_idx+1}: {cell_texts}")
            print("----------------------\n")
            element_index += 1
