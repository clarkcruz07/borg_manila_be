const express = require("express");
const axios = require("axios");

const router = express.Router();

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

router.get("/health", (req, res) => {
  res.json({ ok: true, route: "sample", provider: "groq" });
});

router.post("/analyze-image", async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Missing GROQ_API_KEY in backend/.env",
      });
    }

    const { imageUrl, prompt, model } = req.body || {};
    if (!imageUrl) {
      return res.status(400).json({ error: "imageUrl is required" });
    }

    const finalPrompt =
      prompt ||
      [
        "Extract these fields from the receipt image and return JSON only:",
        "shopName, tinNumber, amountDue, address(CITY Only), date(converted to mm/dd/yyyy)",
        "If a field is missing, return not found.",
      ].join(" ");

    const payload = {
      model: model || DEFAULT_MODEL,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: finalPrompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    };

    const response = await axios.post(GROQ_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    });

    const content = response?.data?.choices?.[0]?.message?.content || "";

    let parsed = null;
    const jsonMatch = typeof content === "string" ? content.match(/\{[\s\S]*\}/) : null;
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = null;
      }
    }

    res.json({
      model: payload.model,
      raw: content,
      parsed,
    });
  } catch (error) {
    const status = error?.response?.status || 500;
    const details = error?.response?.data || { message: error.message };
    res.status(status).json({
      error: "Groq request failed",
      details,
    });
  }
});

module.exports = router;
