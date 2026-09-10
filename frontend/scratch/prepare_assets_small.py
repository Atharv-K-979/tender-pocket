from PIL import Image
import os

def analyze_and_crop(src_path, dest_path):
    with Image.open(src_path) as img:
        img = img.convert('RGBA')
        width, height = img.size
        left, top, right, bottom = width, height, 0, 0
        non_white_count = 0
        for y in range(height):
            for x in range(width):
                r, g, b, a = img.getpixel((x, y))
                if a > 10 and (r < 250 or g < 250 or b < 250):
                    non_white_count += 1
                    if x < left: left = x
                    if x > right: right = x
                    if y < top: top = y
                    if y > bottom: bottom = y
        if non_white_count > 0:
            cropped = img.crop((left, top, right, bottom))
            cropped.save(dest_path, "PNG")
            print(f"Cropped {src_path} -> {dest_path} (size={cropped.size})")
        else:
            img.save(dest_path, "PNG")
            print(f"Saved uncropped {src_path} -> {dest_path} (size={img.size})")

analyze_and_crop('scratch/extracted_images/page_15_img_1_Im0.jpg.png', 'public/images/logo_small.png')
analyze_and_crop('scratch/extracted_images/page_15_img_2_Im1.png.png', 'public/images/partner_small.png')
