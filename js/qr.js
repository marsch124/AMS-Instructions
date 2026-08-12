let numberScanning = false;
let cameraStream = null;
let scanCallback = null;

async function startQRScanning(callback) {
    scanCallback = callback;
    numberScanning = true;

    const video = document.getElementById('cameraFeed');

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        video.srcObject = cameraStream;
        video.play();

        // Camera is ready, now user can either:
        // 1. Enter number manually in the input field below
        // 2. Point at a physical number card for simple detection

        setTimeout(() => scanForNumbers(video), 500);
    } catch (error) {
        console.error('Camera access denied:', error);
        if (scanCallback) {
            scanCallback(null, 'Camera access denied. Use manual entry below.');
        }
    }
}

async function scanForNumbers(video) {
    if (!numberScanning) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(video, 0, 0);

    // Simple digit detection: look for contrasting regions in center of frame
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const detectedNumber = detectNumberFromImage(imageData);

    if (detectedNumber) {
        numberScanning = false;
        if (scanCallback) {
            scanCallback(detectedNumber);
        }
    } else if (numberScanning) {
        requestAnimationFrame(() => scanForNumbers(video));
    }
}

function detectNumberFromImage(imageData) {
    // Simple heuristic: look for high-contrast regions that might be numbers
    // This is a basic approach - focuses on contrast patterns

    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    // Center region (where numbers would typically be)
    const centerX = Math.floor(width * 0.5);
    const centerY = Math.floor(height * 0.5);
    const scanRadius = Math.floor(Math.min(width, height) * 0.3);

    let contrastScore = 0;
    let pixelCount = 0;

    for (let y = Math.max(0, centerY - scanRadius); y < Math.min(height, centerY + scanRadius); y++) {
        for (let x = Math.max(0, centerX - scanRadius); x < Math.min(width, centerX + scanRadius); x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            // Convert to grayscale
            const gray = (r + g + b) / 3;

            // Look for high contrast (very bright or very dark)
            if (gray < 50 || gray > 200) {
                contrastScore++;
            }
            pixelCount++;
        }
    }

    const contrastRatio = contrastScore / pixelCount;

    // If we detect sufficient contrast (likely a card with numbers),
    // return a signal that could be used for further processing
    // For now, we'll just indicate high contrast areas
    // In a real implementation, you'd use OCR here

    // Placeholder: return null - manual entry is the primary method
    return null;
}

function stopQRScanning() {
    numberScanning = false;
    scanCallback = null;

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    const video = document.getElementById('cameraFeed');
    if (video) {
        video.srcObject = null;
    }
}

// Compatibility function (no library needed)
function loadQRLibrary() {
    return new Promise((resolve) => {
        // No external library needed for simple digit detection
        resolve();
    });
}
