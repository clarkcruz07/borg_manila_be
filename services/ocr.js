const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Use EasyOCR (Python-based, more accurate)
async function extractTextWithEasyOCR(imagePath, abortSignal = null) {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, 'easyocr_extract.py');
    const python = spawn('python', [pythonScript, imagePath]);

    let output = '';
    let errorOutput = '';
    let isAborted = false;

    // Handle abort signal
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        isAborted = true;
        python.kill('SIGTERM');
        console.log('EasyOCR process killed due to request abortion');
        reject(new Error('Request aborted'));
      });
    }

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (isAborted) {
        return; // Already handled by abort
      }

      if (code !== 0) {
        console.error('EasyOCR error:', errorOutput);
        reject(new Error(`EasyOCR failed with code ${code}: ${errorOutput}`));
        return;
      }

      try {
        const result = JSON.parse(output);
        if (result.success) {
          console.log('EasyOCR extracted text successfully');
          resolve(result.text);
        } else {
          reject(new Error(result.error));
        }
      } catch (err) {
        reject(new Error(`Failed to parse EasyOCR output: ${err.message}`));
      }
    });
  });
}

// Fallback: Use Tesseract OCR
async function extractTextWithTesseract(imagePath) {
  const tempDir = path.join(path.dirname(imagePath), "temp");

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    const preprocessedPath = path.join(tempDir, `preprocessed_${Date.now()}.png`);
    
    // Preprocess image: increase contrast, sharpen, and enlarge for better OCR
    await sharp(imagePath)
      .resize({ width: 2000 }) // Enlarge to help Tesseract read large text
      .greyscale() // Convert to grayscale
      .normalize() // Normalize contrast
      .sharpen() // Sharpen text
      .toFile(preprocessedPath);

    console.log("Preprocessed image for Tesseract OCR");
    
    // Try to recognize text with different rotations
    const rotations = [0, 90, 180, 270];
    let bestResult = null;
    let highestConfidence = 0;

    for (const rotation of rotations) {
      const tempImagePath = path.join(tempDir, `rotated_${rotation}_${Date.now()}.png`);
      
      // Rotate the preprocessed image
      if (rotation !== 0) {
        await sharp(preprocessedPath)
          .rotate(rotation)
          .toFile(tempImagePath);
      } else {
        fs.copyFileSync(preprocessedPath, tempImagePath);
      }

      // Run OCR on rotated image with PSM 6 (uniform block of text)
      const result = await Tesseract.recognize(tempImagePath, "eng", {
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      });
      
      const confidence = result.data.confidence;
      const text = result.data.text.trim();
      
      // Keep the result with highest confidence and actual text content
      if (text.length > 0 && confidence > highestConfidence) {
        highestConfidence = confidence;
        bestResult = text;
      }

      // Clean up temp file
      fs.unlinkSync(tempImagePath);
    }

    // Clean up preprocessed file
    fs.unlinkSync(preprocessedPath);

    // Clean up temp directory if empty
    if (fs.readdirSync(tempDir).length === 0) {
      fs.rmdirSync(tempDir);
    }

    console.log("Tesseract OCR confidence:", highestConfidence);
    return bestResult || "";
  } catch (error) {
    console.error("Error during Tesseract OCR:", error);
    // Fallback to simple recognition without preprocessing
    try {
      const result = await Tesseract.recognize(imagePath, "eng");
      return result.data.text || "";
    } catch (fallbackError) {
      console.error("Fallback Tesseract OCR also failed:", fallbackError);
      return "";
    }
  }
}

async function extractText(imagePath, abortSignal = null) {
  try {
    // Try EasyOCR first (more accurate)
    console.log("Using EasyOCR for text extraction...");
    const text = await extractTextWithEasyOCR(imagePath, abortSignal);
    return text;
  } catch (error) {
    // Don't fallback if request was aborted
    if (error.message === 'Request aborted') {
      throw error;
    }
    console.error("EasyOCR failed, falling back to Tesseract:", error.message);
    // Fallback to Tesseract if EasyOCR fails
    return await extractTextWithTesseract(imagePath);
  }
}

module.exports = { extractText };
