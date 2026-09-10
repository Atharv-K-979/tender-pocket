import os
from PIL import Image

dir_path = 'scratch/extracted_images'
for filename in sorted(os.listdir(dir_path)):
    if filename.endswith('.png'):
        filepath = os.path.join(dir_path, filename)
        with Image.open(filepath) as img:
            print(f"{filename}: format={img.format}, size={img.size}, mode={img.mode}")
