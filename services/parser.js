function extractFields(text) {
  const normalized = text.replace(/\n+/g, "\n");

  // 1️⃣ TIN NUMBER
  const tinMatch = normalized.match(
    /TIN[:\s]*([\d-]{9,15})/i
  );

  // 2️⃣ TOTAL AMOUNT (handles TOTAL / AMOUNT DUE)
  const totalMatch = normalized.match(
    /(TOTAL|AMOUNT DUE|AMT DUE)[^\d]*([\d,.]+\.\d{2})/i
  );

  // 3️⃣ SHOP NAME (usually first non-empty lines)
  const lines = normalized
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const shopName = lines.slice(0, 3).join(" ");

  return {
    tinNumber: tinMatch ? tinMatch[1] : null,
    totalAmount: totalMatch ? totalMatch[2] : null,
    shopName
  };
}

module.exports = { extractFields };
