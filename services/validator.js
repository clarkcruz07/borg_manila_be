function validateReceipt(text) {
  let reasons = [];

  // Normalize text
  const normalized = text.toLowerCase();

  // 1️⃣ Check TOTAL / AMOUNT
  if (!normalized.match(/total|amount due|amt due/)) {
    reasons.push("Missing total amount");
  }

  // 2️⃣ Check DATE (accept multiple formats)
  const datePatterns = [
    /\d{4}[-\/]\d{2}[-\/]\d{2}/,     // YYYY-MM-DD
    /\d{2}[-\/]\d{2}[-\/]\d{4}/,     // MM/DD/YYYY
    /\d{2}\/\d{2}\/\d{4}/             // MM/DD/YYYY
  ];

  const hasDate = datePatterns.some(p => p.test(normalized));
  if (!hasDate) {
    reasons.push("Missing or invalid date");
  }

  // 3️⃣ Currency logic (PHP assumed if PH receipt)
  const hasCurrency =
    normalized.match(/php|₱|usd|eur/) ||
    normalized.match(/vat|tin|naia|pasay|city/);

  if (!hasCurrency) {
    reasons.push("Currency not detected");
  }

  // 4️⃣ Merchant check
  if (!normalized.match(/cafe|restaurant|inc|corp|foods|store/)) {
    reasons.push("Merchant name unclear");
  }

  return {
    status: reasons.length === 0 ? "APPROVED" : "FLAGGED",
    reasons
  };
}

module.exports = { validateReceipt };
