/**
 * Pure pattern-based receipt parser - NO API calls
 * Extracts fields using regex patterns and heuristics
 * Used as fallback when Gemini API quota is exceeded
 */

function extractShopName(text, lines) {
  // Check for known brand names first (case-insensitive but preserve original)
  // Philippine and international brands
  const brandKeywords = [
    'SM SUPERMARKET', 'SMSUPERMARKET', 'SM',
    'PUREGOLD', 'ROBINSONS', 'METRO MART', 'RUSTANS',
    '7-ELEVEN', 'SEVEN ELEVEN', 'MINISTOP', 'FAMILY MART',
    'JOLLIBEE', 'MCDO', "MCDONALD'S", 'KFC', 'BURGER KING',
    'MAX BRENNER', 'BRENNER', 'COLES', 'WOOLWORTHS', 'STARBUCKS'
  ];
  
  for (const brand of brandKeywords) {
    const regex = new RegExp(`\\b${brand.replace(/'/g, "'?")}\\b`, 'i');
    const match = text.match(regex);
    if (match) {
      // Return the matched text with original casing
      return match[0];
    }
  }

  // Try to find shop name in various formats
  const shopPatterns = [
    // Shop name with common suffixes
    /^([A-Z][A-Za-z\s&',.-]{2,40})(?:\s*(?:Pty|Ltd|Inc|Corp|Co\.|LLC|Pte|Supermarket|Supermarkets|Store|Shop|Market|Restaurant|Cafe|Coffee|Convenience))/im,
    
    // Store/Shop/Merchant label
    /(?:store|shop|merchant)[:\s]+([A-Za-z\s&',.-]+?)(?:\n|store|address|branch)/i,
    
    // All caps brand name (common in receipts)
    /^([A-Z][A-Z\s&',.-]{2,30})$/m,
    
    // Mixed case brand names
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/m,
  ];

  for (const pattern of shopPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Filter out common non-shop words
      if (name.length > 2 && !name.match(/^(receipt|invoice|tax|date|time|address|branch|order|total|sales|invoice|official)/i)) {
        return name;
      }
    }
  }

  // Fallback: Use first 1-3 lines (common for receipts)
  // But filter out obvious non-shop content
  const filteredLines = lines
    .filter(line => {
      const lower = line.toLowerCase();
      const hasShopKeywords = lower.match(/\b(restaurant|cafe|coffee|shop|store|market|brenner|max|coles|woolworths)\b/);
      const isNotMetadata = !lower.match(/^(receipt|invoice|tax|date|time|address|branch|tel|phone|vat|tin|abn|order)/);
      return (hasShopKeywords || isNotMetadata) &&
             line.length > 2 &&
             line.length < 60 &&
             !line.match(/^\d+$/); // Not just numbers
    });

  if (filteredLines.length > 0) {
    // Take first meaningful line
    const firstLine = filteredLines[0];
    // Check if it looks like a brand name (has capital letters)
    if (firstLine.match(/[A-Z]/)) {
      return firstLine;
    }
  }

  // Last resort: first non-empty line
  return lines.find(l => l.length > 2 && l.length < 60) || null;
}

function extractTIN(text) {
  const tinPatterns = [
    // Philippine TIN format: XXX-XXX-XXX-XXX or variations
    /(?:TIN|VAT\s*REG)[:\s#]*([0-9]{3}[-\s]?[0-9]{3}[-\s]?[0-9]{3}[-\s]?[0-9]{3})/i,
    
    // Generic TIN with label
    /TIN[:\s#]*([0-9-]{9,20})/i,
    /Tax\s*ID[:\s#]*([0-9-]{9,20})/i,
    /VAT[:\s#]*([0-9-]{9,20})/i,
    
    // Australian formats
    /ABN[:\s#]*([0-9\s]{9,20})/i,
    /ACN[:\s#]*([0-9\s]{9,20})/i,
    
    // Generic format with spacing/dashes
    /\b(\d{2,3}[-\s]?\d{3,4}[-\s]?\d{3,4}[-\s]?\d{3,4})\b/,
  ];

  for (const pattern of tinPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // Clean up the TIN
      return match[1].replace(/\s+/g, '').trim();
    }
  }

  return null;
}

function extractAmount(text) {
  // Priority: Look for amounts after Total/Balance keywords (highest priority)
  // Handle OCR errors: "Tota1" -> "Total", "S6" -> "$6", ". " -> "."
  // Allow flexible whitespace including newlines between keyword and amount
  const totalPatterns = [
    // Total with flexible spacing and optional currency symbols (handles line breaks too)
    /(?:TOTA[1L]|TOTAL|Total|AMOUNT[\s]*DUE|GRAND[\s]*TOTAL|NET[\s]*TOTAL|Balance|BALANCE)[:\s\n]*[$S₱€£¥₹RM]*[\s\n]*([0-9]+[\s,]*[0-9]*\.?[0-9]{2})/i,
    
    // Handle amounts on next line after Total keyword
    /(?:TOTA[1L]|TOTAL|Total)[\s]*\n[\s]*(?:[$S₱€£¥₹RM]*[\s]*)?([\d,]+\.?\d{0,2})/i,
    
    // Total with colon or space, very flexible
    /(?:Total|TOTAL|total)[:\s]+(?:[$₱])?[\s]*([\d,]+\.?\d{2})/i,
    
    // Handle "Total PHP 82.00" or "Total 82.00" format
    /(?:Total|TOTAL)[:\s]*(?:PHP|Php|php)?[\s]*([\d,]+\.?\d{2})/i,
  ];

  for (const pattern of totalPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // Clean: remove all spaces, commas, keep only digits and dot
      let cleaned = match[1].replace(/[\s,]/g, '');
      
      // Handle cases where decimal point is missing (e.g., "8200" should be "82.00")
      // Only if the number is reasonably large and has no decimal
      if (!cleaned.includes('.') && cleaned.length >= 3) {
        // Check if this makes sense as cents (last 2 digits as decimal)
        const withDecimal = cleaned.slice(0, -2) + '.' + cleaned.slice(-2);
        const numWithDecimal = parseFloat(withDecimal);
        if (!isNaN(numWithDecimal) && numWithDecimal > 0 && numWithDecimal < 100000) {
          cleaned = withDecimal;
        }
      }
      
      const num = parseFloat(cleaned);
      if (!isNaN(num) && num > 0 && num < 1000000) {
        // Ensure 2 decimal places
        return num.toFixed(2);
      }
    }
  }

  // Secondary: Other amount patterns
  const amountPatterns = [
    // Subtotal (lower priority than Total)
    /(?:Subtotal|Sub Total|SUBTOTAL)[:\s$₱]*[\s]*([\d,]+\.?\d{0,2})/i,
    
    // Amount Due or Balance Due
    /(?:Amount Due|AMOUNT DUE|Balance Due)[:\s$₱]*[\s]*([\d,]+\.?\d{2})/i,
    
    // Currency symbols before amount with flexible spacing
    /(?:^|\s)([$₱€£¥₹RM]\s*[\d,]+\.?\d{0,2})(?:\s|$)/m,
    
    // Standalone amounts that look like totals (must have decimal point)
    /\b([\d,]+\.\d{2})\b/g,
  ];

  // Try secondary patterns
  for (let i = 0; i < amountPatterns.length - 1; i++) {
    const match = text.match(amountPatterns[i]);
    if (match && match[1]) {
      const cleaned = match[1].replace(/[$₱€£¥₹RM,\s]/g, '');
      const num = parseFloat(cleaned);
      if (!isNaN(num) && num > 0 && num < 1000000) {
        return num.toFixed(2);
      }
    }
  }

  // Fallback: Find all amounts and return the largest (likely the total)
  const allAmounts = text.match(amountPatterns[amountPatterns.length - 1]);
  if (allAmounts && allAmounts.length > 0) {
    const amounts = allAmounts
      .map(a => a.replace(/[,$₱€£¥₹RM\s]/g, ''))
      .map(a => parseFloat(a))
      .filter(a => !isNaN(a) && a > 0 && a < 1000000); // Reasonable range

    if (amounts.length > 0) {
      // Return the largest amount (most likely the total)
      return Math.max(...amounts).toFixed(2);
    }
  }

  return null;
}

function extractDate(text) {
  // Common date patterns with various formats
  const datePatterns = [
    // With date labels (case insensitive)
    /(?:date|issued|date issued|issued date|transaction date|trans date)[:\s]*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i,
    
    // YYYY-MM-DD or YYYY/MM/DD with label
    /(?:date|issued|date issued)[:\s]*([0-9]{4}[-\/][0-9]{1,2}[-\/][0-9]{1,2})/i,
    
    // Standalone date formats (no label)
    /([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/,
    /([0-9]{4}[-\/][0-9]{1,2}[-\/][0-9]{1,2})/,
    
    // Spelled out month (e.g., "September 14, 2025", "04/02/2025")
    /([A-Za-z]+\s+[0-9]{1,2},?\s+[0-9]{4})/,
    
    // DD/MM/YYYY or MM/DD/YYYY or DD-MM-YYYY
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
    // YYYY-MM-DD
    /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/,
    // "Date: January 15, 2025" or "15 Jan 2025"
    /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i,
    // "January 15, 2025" or "Sept 14, 2025"
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i,
    // After "Date:" label
    /Date[:\s]+([^\n]{8,25})/i,
    // DD.MM.YYYY or DD.MM.YY
    /\b(\d{1,2}\.\d{1,2}\.\d{2,4})\b/,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const dateStr = match[1].trim();
      // Try to parse and validate
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000 && parsed.getFullYear() < 2100) {
        // Return in a standard format
        return dateStr;
      }
    }
  }

  return null;
}

function extractAddress(text) {
  const addressPatterns = [
    // After "Address:" or "Location:" or "Branch:"
    /(?:Address|Location|Branch|Store Address)[:\s]+([^\n]{10,150})/i,
    
    // Philippine format: Building name, street, city
    /\b([A-Z][A-Za-z\s&'.,]+(?:Building|Bldg|Plaza|Mall|Center|Centre)[^\n]{10,100})/i,
    
    // Street patterns (numbers + street name)
    /\b(\d+\s+[A-Za-z\s]{5,50}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr))/i,
    
    // City patterns (Philippine cities)
    /\b((?:City of|Municipality of)?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s*(?:Metro|Metropolitan)?\s*(?:Manila|NCR|Luzon|Visayas|Mindanao))/i,
    
    // With postal/ZIP codes
    /\b([A-Z][a-z\s,]+\d{4,6})\b/,
  ];

  for (const pattern of addressPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // Fallback: Look for lines with common address keywords
  const lines = text.split('\n').map(l => l.trim());
  for (const line of lines) {
    const lower = line.toLowerCase();
    if ((lower.includes('street') || lower.includes('road') || 
         lower.includes('avenue') || lower.match(/\d{4,6}/)) &&
        line.length > 10 && line.length < 100) {
      return line;
    }
  }

  return null;
}

function extractFields(text) {
  if (!text || typeof text !== 'string') {
    return {
      shopName: null,
      tinNumber: null,
      amountDue: null,
      address: null,
      date: null,
      confidence: 'low'
    };
  }

  // Normalize text
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n+/g, "\n");
  const lines = normalized
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  // Extract all fields
  const shopName = extractShopName(normalized, lines);
  const tinNumber = extractTIN(normalized);
  const amountDue = extractAmount(normalized);
  const date = extractDate(normalized);
  const address = extractAddress(normalized);

  // Calculate confidence based on how many fields we found
  let foundCount = 0;
  if (shopName && shopName.length > 2) foundCount++;
  if (tinNumber) foundCount++;
  if (amountDue) foundCount++;
  if (date) foundCount++;
  if (address) foundCount++;

  const confidence = foundCount >= 4 ? 'high' : foundCount >= 3 ? 'medium' : foundCount >= 1 ? 'low' : 'very-low';

  console.log(`  → Pattern parser extracted: ${foundCount}/5 fields (${confidence} confidence)`);
  console.log(`  → Fields: shop="${shopName}", tin="${tinNumber}", amount="${amountDue}", date="${date}", address="${address}"`);

  return {
    shopName: shopName || null,
    tinNumber: tinNumber || null,
    amountDue: amountDue || null,
    address: address || null,
    date: date || null,
    confidence
  };
}

module.exports = { extractFields };
