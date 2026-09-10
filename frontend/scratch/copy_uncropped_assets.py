import shutil
import os

shutil.copy('scratch/extracted_images/page_1_img_1_Im0.jpg.png', 'public/images/logo.png')
shutil.copy('scratch/extracted_images/page_1_img_2_Im1.png.png', 'public/images/partner.png')

print("Copied uncropped logo.png and partner.png successfully!")
print("logo.png size:", os.path.getsize('public/images/logo.png'))
print("partner.png size:", os.path.getsize('public/images/partner.png'))
