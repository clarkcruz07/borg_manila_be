const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const axios = require("axios");
const os = require("os");

// Helper function to download image from URL to temp file
async function downloadImageToTemp(imageUrl) {
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data);
  
  // Create temp file
  const tempPath = path.join(os.tmpdir(), `receipt_${Date.now()}.jpg`);
  fs.writeFileSync(tempPath, buffer);
  
  return tempPath;
}

// Use EasyOCR (Python-based, more accurate)
async function extractTextWithEasyOCR(imagePath, abortSignal = null) {
  let tempFile = null;
  let isUrl = false;
  
  // Check if imagePath is a URL
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    isUrl = true;
    console.log("Downloading image from URL for OCR:", imagePath);
    tempFile = await downloadImageToTemp(imagePath);
    imagePath = tempFile;
  }
  
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
        
        // Clean up temp file
        if (tempFile && fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        
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
      // Clean up temp file
      if (tempFile && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      
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
  let tempFile = null;
  let isUrl = false;
  
  // Check if imagePath is a URL
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    isUrl = true;
    console.log("Downloading image from URL for Tesseract:", imagePath);
    tempFile = await downloadImageToTemp(imagePath);
    imagePath = tempFile;
  }
  
  const tempDir = path.join(path.dirname(imagePath), "temp");

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Verify input file exists
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Input file is missing: ${imagePath}`);
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
    const tempFiles = []; // Track temp files for cleanup

    for (const rotation of rotations) {
      const tempImagePath = path.join(tempDir, `rotated_${rotation}_${Date.now()}.png`);
      tempFiles.push(tempImagePath);
      
      try {
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
      } catch (rotationError) {
        console.error(`Error processing rotation ${rotation}:`, rotationError.message);
        // Continue with next rotation
      }
    }

    // Clean up all temp files
    tempFiles.forEach(file => {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (e) {
        console.error(`Failed to delete temp file ${file}:`, e.message);
      }
    });

    // Clean up preprocessed file
    if (fs.existsSync(preprocessedPath)) {
      fs.unlinkSync(preprocessedPath);
    }

    // Clean up temp directory if empty
    try {
      if (fs.existsSync(tempDir) && fs.readdirSync(tempDir).length === 0) {
        fs.rmdirSync(tempDir);
      }
    } catch (e) {
      console.error(`Failed to remove temp directory:`, e.message);
    }
    
    // Clean up downloaded temp file if exists
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

    console.log("Tesseract OCR confidence:", highestConfidence);
    return bestResult || "";
  } catch (error) {
    console.error("Error during Tesseract OCR:", error.message);
    
    // Clean up temp directory and files on error
    try {
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        files.forEach(file => {
          try {
            fs.unlinkSync(path.join(tempDir, file));
          } catch (e) {
            // Ignore cleanup errors
          }
        });
        if (fs.readdirSync(tempDir).length === 0) {
          fs.rmdirSync(tempDir);
        }
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    // Clean up downloaded temp file if exists
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    
    // Fallback to simple recognition without preprocessing (only if file exists)
    if (fs.existsSync(imagePath)) {
      try {
        console.log("Trying simple Tesseract recognition without preprocessing...");
        const result = await Tesseract.recognize(imagePath, "eng");
        return result.data.text || "";
      } catch (fallbackError) {
        console.error("Fallback Tesseract OCR also failed:", fallbackError.message);
        return "";
      }
    } else {
      console.error("Cannot perform fallback OCR: file does not exist");
      return "";
    }
  }
}

async function extractText(imagePath, abortSignal = null) {
  try {
    // Use EasyOCR - it has built-in rotation detection
    console.log("Using EasyOCR for text extraction (with auto-rotation)...");
    const text = await extractTextWithEasyOCR(imagePath, abortSignal);
    
    if (!text || text.trim().length === 0) {
      console.warn("EasyOCR returned empty text");
      return "";
    }
    
    console.log(`✓ EasyOCR extracted ${text.length} characters`);
    return text;
  } catch (error) {
    // Don't fallback if request was aborted
    if (error.message === 'Request aborted') {
      throw error;
    }
    console.error("EasyOCR failed:", error.message);
    // Return empty string to trigger pattern parser fallback
    return "";
  }
}

module.exports = { extractText };
