import sys
import easyocr
import json
import warnings

# Suppress warnings and progress messages
warnings.filterwarnings('ignore')

def extract_text(image_path):
    try:
        # Initialize EasyOCR reader (English only for faster loading)
        # Set verbose=False to suppress progress messages
        reader = easyocr.Reader(['en'], gpu=False, verbose=False)
        
        # Read text from image
        results = reader.readtext(image_path)
        
        # Combine all detected text
        text = ' '.join([result[1] for result in results])
        
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
