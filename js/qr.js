// Camera-based 3-digit number recognition using Tesseract.js OCR.
// Numbers are read from the cropped center region (matching the on-screen scan-box).
let numberScanning = false;
let cameraStream = null;
let scanCallback = null;
let tesseractWorker = null;
let autoScanTimer = null;
let scanInFlight = false;

function loadQRLibrary() {
    return new Promise((resolve) => {
        if (typeof Tesseract !== 'undefined') {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script.onload = () => resolve();
        script.onerror = () => {
            console.error('Failed to load Tesseract.js (offline or CDN unreachable) - manual entry still works');
            resolve();
        };
        document.head.appendChild(script);
    });
}

async function getOcrWorker() {
    if (tesseractWorker) return tesseractWorker;
    if (typeof Tesseract === 'undefined') return null;

    tesseractWorker = await Tesseract.createWorker('eng');
    await tesseractWorker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '7' // treat image as a single line of text
    });
    return tesseractWorker;
}

async function startQRScanning(callback) {
    scanCallback = callback;
    numberScanning = true;
    setScanStatus('');

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
        await video.play();

        // Warm up the OCR engine in the background so the first capture isn't slow
        getOcrWorker().catch((err) => console.error('OCR init failed:', err));

        // Passive auto-scan every 2.5s (in addition to the manual Capture button)
        autoScanTimer = setInterval(() => {
            if (numberScanning && !scanInFlight) {
                attemptScan(video, false);
            }
        }, 2500);
    } catch (error) {
        console.error('Camera access denied:', error);
        setScanStatus('');
        if (scanCallback) {
            scanCallback(null, 'Camera access denied. Use manual entry below.');
        }
    }
}

async function captureAndScan() {
    const video = document.getElementById('cameraFeed');
    if (!video || !numberScanning || scanInFlight) return;
    await attemptScan(video, true);
}

async function attemptScan(video, isManualCapture) {
    if (!video.videoWidth) return;

    const worker = await getOcrWorker();
    if (!worker) {
        setScanStatus('Scanner unavailable offline — use manual entry below');
        return;
    }

    scanInFlight = true;
    if (isManualCapture) setScanStatus('Analyzing…');

    try {
        // Crop to the center region matching the .scan-box overlay so
        // background clutter doesn't confuse the OCR engine.
        const cropWRatio = 0.55;
        const cropHRatio = 0.30;
        const sx = video.videoWidth * (1 - cropWRatio) / 2;
        const sy = video.videoHeight * (1 - cropHRatio) / 2;
        const sw = video.videoWidth * cropWRatio;
        const sh = video.videoHeight * cropHRatio;

        const canvas = document.createElement('canvas');
        // Upscale small crops - OCR does much better with more pixels
        const scale = sw < 400 ? 3 : 1.5;
        canvas.width = sw * scale;
        canvas.height = sh * scale;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

        const { data } = await worker.recognize(canvas);
        const digitsOnly = (data.text || '').replace(/[^0-9]/g, '');

        if (digitsOnly.length >= 1 && digitsOnly.length <= 3 && data.confidence >= 45) {
            const number = digitsOnly.padStart(3, '0');
            numberScanning = false;
            if (autoScanTimer) {
                clearInterval(autoScanTimer);
                autoScanTimer = null;
            }
            setScanStatus('');
            if (scanCallback) scanCallback(number);
        } else if (isManualCapture) {
            setScanStatus(digitsOnly
                ? `Not sure — read "${digitsOnly}". Try again or enter manually.`
                : 'No number recognized. Try steadier framing or enter manually.');
        }
    } catch (err) {
        console.error('OCR scan error:', err);
        if (isManualCapture) setScanStatus('Scan failed — use manual entry below.');
    } finally {
        scanInFlight = false;
    }
}

function setScanStatus(text) {
    const el = document.getElementById('scanStatus');
    if (el) el.textContent = text;
}

function stopQRScanning() {
    numberScanning = false;
    scanCallback = null;
    scanInFlight = false;

    if (autoScanTimer) {
        clearInterval(autoScanTimer);
        autoScanTimer = null;
    }

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    const video = document.getElementById('cameraFeed');
    if (video) {
        video.srcObject = null;
    }

    setScanStatus('');
}
