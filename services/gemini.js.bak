require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const axios = require("axios");

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSyBSkwwLLH-1MN8aoke8E2lxMsJfHMIOoEE");

// Helper function to get image buffer from path or URL
async function getImageBuffer(imagePathOrUrl) {
  // Check if it's a URL (Cloudinary)
  if (imagePathOrUrl.startsWith('http://') || imagePathOrUrl.startsWith('https://')) {
    console.log("Fetching image from URL:", imagePathOrUrl);
    const response = await axios.get(imagePathOrUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  }
  
  // Local file path
  console.log("Reading image from local file:", imagePathOrUrl);
  return fs.readFileSync(imagePathOrUrl);
}

// ==================== GEMINI VISION (PRIMARY) ====================

async function analyzeReceiptWithGemini(imagePath, retryCount = 0) {
  const maxRetries = 3;
  
  try {
    console.log("Using Gemini Vision API for receipt analysis...");
    
    // Read image from URL or local path
    const imageBuffer = await getImageBuffer(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Determine mime type from buffer or URL
    let mimeType = 'image/jpeg';
    if (imagePath.includes('.png') || imagePath.endsWith('.png')) {
      mimeType = 'image/png';
    }
    
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const prompt = `
You are an intelligent receipt and payment transaction parser. Analyze this image and extract the following information:

EXTRACT THESE FIELDS:
- shopName (merchant/store name)
- tinNumber (tax ID if visible, null if not found)
- amountDue (the transaction amount - CRITICAL)
- address (location/address if visible)
- date (transaction date in format: Month Day, Year)

IMPORTANT:
1. For ONLINE PAYMENT SCREENSHOTS: The amount is usually the LARGEST number displayed (e.g., "56 AUD", "48.25 AUD")
2. For TRADITIONAL RECEIPTS: Look for TOTAL, AMOUNT DUE, or the final payment amount
3. Extract merchant/store name from the top of the image
4. For online payments, the location might say things like "ERINA, Australia" or "Chatswood, Australia"
5. Date formats: "Thursday, September 25, 4:38 PM" → September 25, 2025

RETURN ONLY JSON (no markdown, no backticks):
{
  "shopName": "",
  "tinNumber": "",
  "amountDue": "",
  "address": "",
  "date": ""
}
`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Image,
          mimeType: mimeType
        }
      }
    ]);
    
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error("No JSON found in Gemini response");
    }
    
    const extracted = JSON.parse(jsonMatch[0]);
    console.log("Gemini Vision extracted:", extracted);
    return extracted;
  } catch (error) {
    console.error("Gemini Vision error:", error.message);
    
    // Check if it's a quota exceeded error (daily limit, not per-minute rate limit)
    const isQuotaExceeded = 
      error.message?.includes('quota') ||
      error.message?.includes('QUOTA') ||
      error.message?.includes('exceeded your current quota');
    
    // Check if it's a rate limit error (per-minute limit, can be retried)
    const isRateLimitError = 
      error.message?.includes('429') || 
      error.message?.includes('rate_limit_exceeded') ||
      error.message?.includes('RESOURCE_EXHAUSTED');
    
    // Don't retry if quota is exceeded (daily limit) - fail immediately to fallback to OCR
    if (isQuotaExceeded) {
      console.log("Daily quota exceeded. Throwing error to trigger fallback to OCR.");
      throw error;
    }
    
    // Only retry for per-minute rate limits
    if (isRateLimitError && retryCount < maxRetries) {
      // Exponential backoff: wait 5, 10, 15 seconds
      const waitTime = 5000 * (retryCount + 1);
      console.log(`Rate limit hit. Retrying in ${waitTime/1000} seconds... (Attempt ${retryCount + 1}/${maxRetries})`);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return analyzeReceiptWithGemini(imagePath, retryCount + 1);
    }
    
    throw error;
  }
}

// Analyze receipt from OCR text (fallback when vision API fails)
async function analyzeReceiptText(ocrText) {
  const prompt = `
You are an intelligent receipt and payment transaction parser. You MUST extract the amount even if other fields are missing.

From the text below (which may be from a TRADITIONAL RECEIPT or an ONLINE PAYMENT/TRANSACTION SCREENSHOT), extract the following fields:
- shopName (merchant name, store name, or payee)
- tinNumber (tax ID if available, null if not found)
- amountDue (the total amount paid or transaction amount - THIS IS CRITICAL)
- address (full address if available, store code, or location)
- date (convert to full month name, day, year format, e.g., September 15, 2025)

CRITICAL AMOUNT EXTRACTION RULES:
1. The amount is usually the LARGEST or MOST PROMINENT number in the text
2. Look for patterns like:
   - "XX.XX AUD" or "AUD XX.XX"
   - "$XX.XX" or "XX.XX $"
   - "PHP X,XXX.XX" or "X,XXX.XX PHP"
   - Any number with 2 decimal places near currency indicators
   - Large standalone numbers (e.g., "48.25", "9.11", "56")
3. For online payment screenshots, the amount is usually displayed at the top in LARGE font
4. Extract ONLY the numeric value (remove currency symbols, spaces, commas)
5. If you see multiple numbers, the TRANSACTION AMOUNT or TOTAL is what we need

For TRADITIONAL RECEIPTS:
- Extract shopName from the store/merchant name at the top
- Find TIN number (usually labeled as TIN, Tax ID, or similar)
- amountDue is the TOTAL or AMOUNT DUE
- Extract full store address

For ONLINE PAYMENTS/TRANSACTION SCREENSHOTS (banking apps, e-wallets):
- shopName is the merchant/payee name (e.g., "Coles Supermarkets", "Bar Coco Pty Ltd", "BWS")
- tinNumber will likely be null
- amountDue is the MAIN TRANSACTION AMOUNT displayed prominently (e.g., "48.25", "9.11", "56")
- address is the transaction location (e.g., "ERINA, Australia", "Chatswood, Australia")
- date from transaction timestamp (convert "Yesterday at 12:00 PM" or "Thursday, September 25, 4:38 PM")

DATE EXTRACTION:
- "Yesterday at XX:XX PM" = calculate yesterday's date
- "Thursday, September 25, 4:38 PM" = September 25, 2025
- "Sunday, September 21, 4:44 PM" = September 21, 2025

If a field is not found, return null.
Respond in JSON ONLY (no markdown, no backticks, no explanation).

OCR TEXT:
"""
${ocrText}
"""

JSON FORMAT:
{
  "shopName": "",
  "tinNumber": "",
  "amountDue": "",
  "address" : "",
  "date": ""
}
`;

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(prompt);
  const text = result.response.text();

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const extracted = JSON.parse(jsonMatch[0]);
  
  // Fallback: If amountDue is not found, try to extract it from OCR text directly
  if (!extracted.amountDue || extracted.amountDue === "null" || extracted.amountDue === null) {
    console.log("Amount not found by AI, trying fallback extraction...");
    
    // Look for common amount patterns in OCR text
    const amountPatterns = [
      /(\d+\.?\d*)\s*(?:AUD|aud)/i,  // "48.25 AUD" or "56 AUD"
      /(?:AUD|aud)\s*(\d+\.?\d*)/i,  // "AUD 48.25"
      /\$\s*(\d+\.?\d*)/,             // "$48.25"
      /(\d+\.?\d*)\s*\$/,             // "48.25$"
      /PHP\s*(\d+,?\d*\.?\d*)/i,     // "PHP 1,234.56"
      /(\d+,?\d*\.?\d*)\s*PHP/i,     // "1,234.56 PHP"
      /\b(\d{1,3}(?:,\d{3})*\.\d{2})\b/, // "1,234.56"
      /\b(\d+\.\d{2})\b/              // "48.25" (2 decimal places)
    ];
    
    for (const pattern of amountPatterns) {
      const match = ocrText.match(pattern);
      if (match && match[1]) {
        extracted.amountDue = match[1].replace(/,/g, ''); // Remove commas
        console.log("Fallback extracted amount:", extracted.amountDue);
        break;
      }
    }
  }
  
  return extracted;
}

// Main function: Analyze receipt image using Gemini Vision API
async function analyzeReceiptImage(imagePath) {
  try {
    return await analyzeReceiptWithGemini(imagePath);
  } catch (error) {
    console.error("Gemini Vision API failed:", error.message);
    throw error;
  }
}

module.exports = { 
  analyzeReceiptText, 
  analyzeReceiptImage,
  analyzeReceiptWithGemini
};
