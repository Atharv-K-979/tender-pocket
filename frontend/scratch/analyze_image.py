from PIL import Image

def analyze_image(path):
    with Image.open(path) as img:
        img = img.convert('RGBA')
        width, height = img.size
        
        # Find bounding box of non-transparent, non-white pixels
        left, top, right, bottom = width, height, 0, 0
        non_white_count = 0
        
        for y in range(height):
            for x in range(width):
                r, g, b, a = img.getpixel((x, y))
                # Consider non-white/non-transparent if alpha > 10 and (r < 250 or g < 250 or b < 250)
                if a > 10 and (r < 250 or g < 250 or b < 250):
                    non_white_count += 1
                    if x < left: left = x
                    if x > right: right = x
                    if y < top: top = y
                    if y > bottom: bottom = y
                    
        print(f"Image {path}:")
        print(f"  Dimensions: {width} x {height}")
        if non_white_count > 0:
            print(f"  Non-white/transparent bounding box: L={left}, T={top}, R={right}, B={bottom}")
            print(f"  Non-white percentage: {non_white_count / (width * height) * 100:.2f}%")
        else:
            print("  Image is entirely white/transparent.")

analyze_image('scratch/extracted_images/page_1_img_1_Im0.jpg.png')
analyze_image('scratch/extracted_images/page_1_img_2_Im1.png.png')
