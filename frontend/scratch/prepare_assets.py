import os
from PIL import Image

def crop_and_save(src_path, dest_path, box=None):
    with Image.open(src_path) as img:
        if box:
            img = img.crop(box)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        img.save(dest_path, "PNG")
        print(f"Saved cropped image to {dest_path} (size={img.size})")

# Bounding boxes from previous analysis:
# Im0 (logo): L=468, T=472, R=2175, B=2167
logo_box = (468, 472, 2175, 2167)
crop_and_save('scratch/extracted_images/page_1_img_1_Im0.jpg.png', 'public/images/logo.png', logo_box)

# Im1 (partner logos): L=148, T=859, R=2429, B=1466
partner_box = (148, 859, 2429, 1466)
crop_and_save('scratch/extracted_images/page_1_img_2_Im1.png.png', 'public/images/partner.png', partner_box)

# Im2 (signature from Page 2): L=0, T=0, R=width, B=height (no crop needed, it's already tight)
crop_and_save('scratch/extracted_images/page_2_img_3_Im2.png.png', 'public/images/signature.png')

# Im3 (stamp): L=0, T=0, R=width, B=height (already tight)
crop_and_save('scratch/extracted_images/page_1_img_4_Im3.png.png', 'public/images/stamp.png')
