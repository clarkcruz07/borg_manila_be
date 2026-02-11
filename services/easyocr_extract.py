import sys
import easyocr
import json
import warnings
import os
import cv2

# Suppress warnings and progress messages
warnings.filterwarnings('ignore')

def extract_text(image_path):
    try:
        # Validate file exists
        if not os.path.exists(image_path):
            raise Exception(f"File not found: {image_path}")
        
        # Validate file is readable and not empty
        file_size = os.path.getsize(image_path)
        if file_size == 0:
            raise Exception(f"File is empty: {image_path}")
        
        # Try to read image with OpenCV to validate it's a valid image
        img = cv2.imread(image_path)
        if img is None:
            raise Exception(f"Cannot read image file (corrupted or invalid format): {image_path}")
        
        # Check image dimensions
        if img.shape[0] == 0 or img.shape[1] == 0:
            raise Exception(f"Image has zero dimensions: {img.shape}")
        
        # Resize large images to prevent OpenCV resize errors
        # EasyOCR can have issues with very large images
        max_dimension = 3000
        height, width = img.shape[:2]
        if height > max_dimension or width > max_dimension:
            scale = max_dimension / max(height, width)
            new_width = int(width * scale)
            new_height = int(height * scale)
            img = cv2.resize(img, (new_width, new_height), interpolation=cv2.INTER_AREA)
        
        # Initialize EasyOCR reader (English only for faster loading)
        # Set verbose=False to suppress progress messages
        reader = easyocr.Reader(['en'], gpu=False, verbose=False)
        
        # Try different rotations and pick the one with the most text
        rotations = [
            (0, img, "original"),
            (cv2.ROTATE_90_CLOCKWISE, cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE), "90° CW"),
            (cv2.ROTATE_180, cv2.rotate(img, cv2.ROTATE_180), "180°"),
            (cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE), "90° CCW")
        ]
        
        best_text = ""
        best_score = 0
        
        # Common words that should appear in receipts
        common_words = ['total', 'tax', 'subtotal', 'receipt', 'date', 'store', 'invoice', 
                       'paid', 'change', 'cash', 'card', 'amount', 'qty', 'price']
        
        for _, rotated_img, rotation_name in rotations:
            # Save rotated image temporarily
            temp_path = image_path + f'_rot_{rotation_name.replace("°", "d").replace(" ", "")}.jpg'
            cv2.imwrite(temp_path, rotated_img)
            
            try:
                # Read text from rotated image
                results = reader.readtext(temp_path)
                text = ' '.join([result[1] for result in results])
                
                # Score based on length AND presence of common words
                text_lower = text.lower()
                word_count = sum(1 for word in common_words if word in text_lower)
                
                # Score = length + (word_count * 100) to heavily favor readable text
                score = len(text) + (word_count * 100)
                
                # Check if this rotation gives better score
                if score > best_score:
                    best_text = text
                    best_score = score
            except Exception as e:
                # Skip this rotation if it fails
                pass
            finally:
                # Clean up temporary file
                try:
                    os.remove(temp_path)
                except:
                    pass
        
        # Combine all detected text
        text = best_text
        
        # Return as JSON to stdout only
        sys.stdout.write(json.dumps({
            'success': True,
            'text': text
        }))
        sys.stdout.flush()
    except Exception as e:
        sys.stdout.write(json.dumps({
            'success': False,
            'error': str(e)
        }))
        sys.stdout.flush()

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.stdout.write(json.dumps({
            'success': False,
            'error': 'No image path provided'
        }))
        sys.exit(1)
    
    image_path = sys.argv[1]
    extract_text(image_path)
