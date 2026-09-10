import os
import pypdf

reader = pypdf.PdfReader('template.pdf')
os.makedirs('scratch/extracted_images', exist_ok=True)

print("Extracting images from template.pdf...")
for idx, page in enumerate(reader.pages):
    print(f"Page {idx+1}:")
    for img_idx, img in enumerate(page.images):
        name = f"page_{idx+1}_img_{img_idx+1}_{img.name.replace('/', '_')}.png"
        path = os.path.join('scratch/extracted_images', name)
        with open(path, 'wb') as f:
            f.write(img.data)
        print(f"  Saved {path}")
