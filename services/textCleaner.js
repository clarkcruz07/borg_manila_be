/**
 * Clean and normalize OCR text to fix common misreads
 */

// Common business name corrections
const KNOWN_BUSINESSES = {
  "mcdonald": "McDonald's",
  "mcdonalds": "McDonald's",
  "mcdonaids": "McDonald's",
  "mcdona": "McDonald's",
  "jollibee": "Jollibee",
  "chowking": "Chowking",
  "starbucks": "Starbucks",
  "7-eleven": "7-Eleven",
  "7eleven": "7-Eleven",
  "711": "7-Eleven",
  "ministop": "Ministop",
  "family mart": "FamilyMart",
  "familymart": "FamilyMart",
  "lawson": "Lawson",
  "puregold": "Puregold",
  "sm supermarket": "SM Supermarket",
  "sm": "SM",
  "ayala": "Ayala",
  "robinson": "Robinson's",
  "robinsons": "Robinson's",
};

/**
 * Fix common OCR character misreads
 */
function fixCommonMisreads(text) {
  if (!text) return text;
  
  let cleaned = text;
  
  // Fix common character substitutions in words
  // But be careful not to break actual numbers
  
  // Replace ] with l in words (not at word boundaries)
  cleaned = cleaned.replace(/([a-z])\]([a-z])/gi, '$1l$2');
  cleaned = cleaned.replace(/\]([a-z]{2,})/gi, 'l$1');
  
  // Fix "Iriternat iona]" type patterns
  cleaned = cleaned.replace(/iona\]/gi, 'ional');
  cleaned = cleaned.replace(/Iriter/gi, 'Inter');
  
  // Fix common word patterns
  cleaned = cleaned.replace(/\bIds\b/g, "ld's");
  cleaned = cleaned.replace(/\bIDs\b/g, "ld's");
  
  // Fix spacing issues
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  cleaned = cleaned.replace(/\s+([,.])/g, '$1');
  
  return cleaned.trim();
}

/**
 * Clean shop/business name
 */
function cleanShopName(shopName) {
  if (!shopName) return null;
  
  // First apply common misread fixes
  let cleaned = fixCommonMisreads(shopName);
  
  // Normalize to lowercase for comparison
  const normalized = cleaned.toLowerCase().trim();
  
  // Check against known businesses
  for (const [key, value] of Object.entries(KNOWN_BUSINESSES)) {
    if (normalized.includes(key)) {
      // If we find a match, use the correct name
      // But keep any additional text (like "McDonald's International")
      const regex = new RegExp(key, 'gi');
      cleaned = cleaned.replace(regex, value);
      break;
    }
  }
  
  // Clean up extra spaces and special characters
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  
  return cleaned;
}

/**
 * Clean address text
 */
function cleanAddress(address) {
  if (!address) return null;
  
  let cleaned = fixCommonMisreads(address);
  
  // Fix common location misreads
  cleaned = cleaned.replace(/\bCIty\b/gi, 'City');
  cleaned = cleaned.replace(/\bPhilippines\b/gi, 'Philippines');
  
  return cleaned.trim();
}

/**
 * Clean TIN number
 */
function cleanTIN(tin) {
  if (!tin) return null;
  
  // Remove spaces and keep only digits and dashes
  let cleaned = tin.replace(/\s/g, '');
  
  // Fix common OCR mistakes in numbers
  cleaned = cleaned.replace(/[Oo]/g, '0');
  cleaned = cleaned.replace(/[lI]/g, '1');
  cleaned = cleaned.replace(/[S]/g, '5');
  
  return cleaned;
}

/**
 * Clean amount string
 */
function cleanAmount(amount) {
  if (!amount) return null;
  
  // Remove currency symbols and spaces
  let cleaned = amount.replace(/[₱$,\s]/g, '');
  
  // Fix common OCR mistakes in numbers
  cleaned = cleaned.replace(/[Oo]/g, '0');
  cleaned = cleaned.replace(/[lI]/g, '1');
  cleaned = cleaned.replace(/[S]/g, '5');
  
  // Ensure valid decimal format
  if (!/^\d+\.?\d*$/.test(cleaned)) {
    return null;
  }
  
  return cleaned;
}

/**
 * Clean all extracted receipt data
 */
function cleanExtractedData(extracted) {
  if (!extracted) return extracted;
  
  return {
    shopName: cleanShopName(extracted.shopName),
    tinNumber: cleanTIN(extracted.tinNumber),
    amountDue: cleanAmount(extracted.amountDue),
    address: cleanAddress(extracted.address),
    date: extracted.date, // Date parsing is handled by Gemini, keep as-is
  };
}

module.exports = {
  fixCommonMisreads,
  cleanShopName,
  cleanAddress,
  cleanTIN,
  cleanAmount,
  cleanExtractedData,
};
