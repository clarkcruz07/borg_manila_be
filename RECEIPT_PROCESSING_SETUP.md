# Receipt Processing System - Multi-Provider Setup

## Overview
Your system now uses **Gemini Vision as primary** with **Mistral Vision as backup**, plus **OCR as final fallback**.

## Processing Flow

### Tier 1: Gemini Vision (Primary - FREE)
- **Speed**: 1-3 seconds
- **Cost**: FREE (1,500 requests/day)
- **Best for**: Blurred images, rotated images, online payment screenshots
- **Model**: gemini-1.5-flash

### Tier 2: Mistral Vision (Backup)
- **Speed**: 1-3 seconds  
- **Cost**: ~$0.001-0.002 per request
- **Triggers**: If Gemini quota exceeded or fails
- **Model**: pixtral-12b-2409

### Tier 3: OCR (Final Fallback)
- **Speed**: 3-8 seconds
- **Cost**: FREE
- **Triggers**: If both Vision APIs fail
- **Method**: EasyOCR → Tesseract with preprocessing

## Configuration

### Environment Variables (.env)
```
USE_GEMINI=true                                    # Enable Gemini (set to false to use Mistral only)
GEMINI_API_KEY=AIzaSyBSkwwLLH-1MN8aoke8E2lxMsJfHMIOoEE
MISTRAL_API_KEY=tsrmmG7C0AOSo8qE5pFQRjI0tdBtN4lg
```

### Switching Providers

**Use Gemini (Default):**
```
USE_GEMINI=true
```

**Use Mistral Only:**
```
USE_GEMINI=false
```

**Disable Vision (OCR only):**
Comment out the Vision API calls in `routes/receipts.js`

## Benefits

✅ **2-5x Faster** - Vision APIs skip slow OCR preprocessing
✅ **Better Accuracy** - Handles blur, rotation, online screenshots better
✅ **Cost Efficient** - 1,500 free requests/day with Gemini
✅ **Redundancy** - 3 layers of fallback ensure uptime
✅ **Easy Switching** - Change providers via environment variable

## Files Modified

1. **backend/.env** - Added API keys and USE_GEMINI flag
2. **backend/services/gemini.js** - Added Gemini functions, kept Mistral
3. **backend/routes/receipts.js** - Updated to use Vision-first with OCR fallback

## Monitoring

Check backend logs for:
- "Using Gemini Vision API..." = Using Gemini (free)
- "Gemini failed, falling back to Mistral..." = Using Mistral (paid)
- "Vision API failed, falling back to OCR..." = Using OCR (slow but free)

## Next Steps (Optional)

- Monitor Gemini quota usage in Google AI Studio
- Set up alerts if approaching 1,500/day limit
- Consider Gemini Pro for higher limits if needed
