// List all available models using the API
require("dotenv").config();
const https = require('https');

const apiKey = process.env.GEMINI_API_KEY;

const options = {
  hostname: 'generativelanguage.googleapis.com',
  path: `/v1beta/models?key=${apiKey}`,
  method: 'GET'
};

console.log("Fetching available models from Google AI API...\n");

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      
      if (response.models) {
        console.log("✅ Available models:\n");
        response.models.forEach(model => {
          const supportsVision = model.supportedGenerationMethods?.includes('generateContent');
          const visionIcon = supportsVision ? '👁️' : '📝';
          console.log(`${visionIcon} ${model.name.replace('models/', '')}`);
          console.log(`   Description: ${model.description || 'N/A'}`);
          console.log(`   Methods: ${model.supportedGenerationMethods?.join(', ') || 'N/A'}`);
          console.log('');
        });
      } else {
        console.log("❌ Error:", response);
      }
    } catch (error) {
      console.error("Parse error:", error.message);
      console.log("Raw response:", data);
    }
  });
});

req.on('error', (error) => {
  console.error("Request error:", error.message);
});

req.end();
