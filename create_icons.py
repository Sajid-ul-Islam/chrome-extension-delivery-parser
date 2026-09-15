"""Generate crisp PNG icons for the Chrome extension."""
import os
from PIL import Image, ImageDraw, ImageFont

def generate_icon(size, output_path):
    # Create image with RGBA
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw rounded background
    radius = int(size * 0.22)
    bg_color = (15, 23, 42, 255) # Slate 900
    border_color = (59, 130, 246, 255) # Blue 500
    
    # Draw background rectangle with rounded corners
    draw.rounded_rectangle(
        [(1, 1), (size - 2, size - 2)],
        radius=radius,
        fill=bg_color,
        outline=border_color,
        width=max(1, int(size * 0.04))
    )

    # Draw a stylized lightning bolt / delivery box symbol
    # Let's draw a stylish delivery box with lightning accent
    margin = size * 0.25
    center = size / 2

    # Draw a package polygon
    top = size * 0.22
    bottom = size * 0.78
    left = size * 0.22
    right = size * 0.78

    # Accent colors
    accent_color = (96, 165, 250, 255) # Blue 400
    gold_color = (245, 158, 11, 255) # Amber 500

    if size <= 16:
        # Simple letter "D" in 16px
        draw.text((3, 0), "D", fill=(255, 255, 255, 255))
    else:
        # Stylized box outline
        points = [
            (center, top),
            (right, top + (bottom - top) * 0.25),
            (right, bottom - (bottom - top) * 0.25),
            (center, bottom),
            (left, bottom - (bottom - top) * 0.25),
            (left, top + (bottom - top) * 0.25),
        ]
        draw.polygon(points, outline=accent_color, fill=(30, 41, 59, 255), width=max(1, int(size * 0.05)))
        
        # Center split line
        draw.line([(center, top + (bottom - top) * 0.25), (center, bottom)], fill=accent_color, width=max(1, int(size * 0.04)))
        draw.line([(left, top + (bottom - top) * 0.25), (center, top + (bottom - top) * 0.25)], fill=accent_color, width=max(1, int(size * 0.03)))
        draw.line([(right, top + (bottom - top) * 0.25), (center, top + (bottom - top) * 0.25)], fill=accent_color, width=max(1, int(size * 0.03)))

        # Lightning bolt badge in center
        bolt = [
            (center + size * 0.02, center - size * 0.18),
            (center - size * 0.12, center + size * 0.02),
            (center - size * 0.02, center + size * 0.02),
            (center - size * 0.06, center + size * 0.20),
            (center + size * 0.12, center - size * 0.02),
            (center + size * 0.02, center - size * 0.02),
        ]
        draw.polygon(bolt, fill=gold_color)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    img.save(output_path, "PNG")
    print(f"Generated: {output_path} ({size}x{size})")

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(base_dir, "icons")
    for s in [16, 48, 128]:
        generate_icon(s, os.path.join(icons_dir, f"icon{s}.png"))
