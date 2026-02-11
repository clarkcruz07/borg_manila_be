require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const MAX_RETRIES = 3;

function getMimeTypeFromPath(filePathOrUrl) {
  const lower = String(filePathOrUrl || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function getImageUrlForGroq(imagePathOrUrl) {
  if (imagePathOrUrl.startsWith("http://") || imagePathOrUrl.startsWith("https://")) {
    return imagePathOrUrl;
  }

  const mimeType = getMimeTypeFromPath(imagePathOrUrl);
  const imageBuffer = fs.readFileSync(imagePathOrUrl);
  return `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
}

function parseJsonFromModelText(text) {
  const jsonMatch = String(text || "").match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in model response");
  }
  return JSON.parse(jsonMatch[0]);
}

async function callGroq(messages, retryCount = 0) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY");
  }

  try {
    const response = await axios.post(
      GROQ_API_URL,
      {
        model: DEFAULT_MODEL,
        temperature: 0,
        messages,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    return response?.data?.choices?.[0]?.message?.content || "";
  } catch (error) {
    const status = error?.response?.status;
    const isRateLimit = status === 429;

    if (isRateLimit && retryCount < MAX_RETRIES) {
      const waitTime = 2000 * (retryCount + 1);
      console.log(`Groq rate limit hit. Retrying in ${waitTime / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return callGroq(messages, retryCount + 1);
    }

    const detail =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error.message;
    throw new Error(`Groq API error: ${detail}`);
  }
}

async function analyzeReceiptWithGemini(imagePath) {
  console.log("Using Groq Llama-4-Scout Vision API for receipt analysis...");

  const imageUrl = await getImageUrlForGroq(imagePath);
  const prompt = [
    "You are an intelligent receipt and payment transaction parser.",
    "Analyze this image and extract these fields:",
    "shopName, tinNumber, amountDue, address, date.",
    "For online payments, tinNumber is often null.",
    "amountDue must be the final transaction amount.",
    "Date format must be: MM/DD/YYYY.",
    "Address must return city only, if not found, return store,shop or restaurant number and put store number as label before the allocated number",
    "Return JSON only with this shape:",
    '{"shopName":"","tinNumber":"","amountDue":"","address":"","date":""}',
    "If a field is missing, return null.",
  ].join(" ");

  const content = await callGroq([
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ]);

  const extracted = parseJsonFromModelText(content);
  console.log("Groq Vision extracted:", extracted);
  return extracted;
}

async function analyzeReceiptText(ocrText) {
  const prompt = `
You are an intelligent receipt parser.
Extract and return JSON only with these fields:
- shopName
- tinNumber
- amountDue
- address
- date

Rules:
- amountDue is the final paid amount.
- For online payment text, tinNumber is usually null.
- Date format: Month Day, Year.
- If missing, return null.

OCR TEXT:
"""
${ocrText}
"""

JSON FORMAT:
{
  "shopName": "",
  "tinNumber": "",
  "amountDue": "",
  "address": "",
  "date": ""
}
`;

  const content = await callGroq([{ role: "user", content: prompt }]);
  const extracted = parseJsonFromModelText(content);

  if (!extracted.amountDue || extracted.amountDue === "null") {
    const amountPatterns = [
      /(\d+\.?\d*)\s*(?:AUD|aud)/i,
      /(?:AUD|aud)\s*(\d+\.?\d*)/i,
      /\$\s*(\d+\.?\d*)/,
      /(\d+\.?\d*)\s*\$/,
      /PHP\s*(\d+,?\d*\.?\d*)/i,
      /(\d+,?\d*\.?\d*)\s*PHP/i,
      /\b(\d{1,3}(?:,\d{3})*\.\d{2})\b/,
      /\b(\d+\.\d{2})\b/,
    ];

    for (const pattern of amountPatterns) {
      const match = String(ocrText || "").match(pattern);
      if (match && match[1]) {
        extracted.amountDue = match[1].replace(/,/g, "");
        break;
      }
    }
  }

  return extracted;
}

async function analyzeReceiptImage(imagePath) {
  try {
    return await analyzeReceiptWithGemini(imagePath);
  } catch (error) {
    console.error("Groq Vision API failed:", error.message);
    throw error;
  }
}

module.exports = {
  analyzeReceiptText,
  analyzeReceiptImage,
  analyzeReceiptWithGemini,
};
