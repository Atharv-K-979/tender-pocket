import filecmp
import os

dir_path = 'scratch/extracted_images'
img1 = os.path.join(dir_path, 'page_1_img_2_Im1.png.png')
img2 = os.path.join(dir_path, 'page_2_img_2_Im1.png.png')
img3 = os.path.join(dir_path, 'page_3_img_2_Im1.png.png')

print("Comparing page 1 and page 2 Im1:", filecmp.cmp(img1, img2, shallow=False))
print("Comparing page 2 and page 3 Im1:", filecmp.cmp(img2, img3, shallow=False))

print("Page 1 Im1 size:", os.path.getsize(img1))
print("Page 2 Im1 size:", os.path.getsize(img2))
print("Page 3 Im1 size:", os.path.getsize(img3))
