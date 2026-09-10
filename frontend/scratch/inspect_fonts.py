import pypdf
from pypdf import PdfReader

reader = PdfReader('/Users/anuthibhansali/Downloads/Sample Doc.pdf')
page = reader.pages[0]
resources = page['/Resources']

if '/Font' in resources:
    fonts = resources['/Font']
    print("Fonts in Sample Doc.pdf:")
    for font_name in fonts:
        font_obj = fonts[font_name]
        print(f"  Name: {font_name} | Type: {font_obj.get('/Subtype')} | BaseFont: {font_obj.get('/BaseFont')}")
else:
    print("No font dictionary found.")
