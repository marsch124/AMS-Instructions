let qrScanning = false;
let cameraStream = null;
let qrCallback = null;

async function startQRScanning(callback) {
    qrCallback = callback;
    qrScanning = true;

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

        setTimeout(() => scanQRCode(video), 500);
    } catch (error) {
        console.error('Camera access denied:', error);
        if (qrCallback) {
            qrCallback(null, 'Camera access denied');
        }
    }
}

async function scanQRCode(video) {
    if (!qrScanning) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(video, 0, 0);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, canvas.width, canvas.height);

    if (code && code.data) {
        qrScanning = false;
        if (qrCallback) {
            // Extract number from QR data (assume it's a 3-digit number)
            const number = code.data.trim().padStart(3, '0');
            qrCallback(number);
        }
    } else if (qrScanning) {
        requestAnimationFrame(() => scanQRCode(video));
    }
}

function stopQRScanning() {
    qrScanning = false;
    qrCallback = null;

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    const video = document.getElementById('cameraFeed');
    if (video) {
        video.srcObject = null;
    }
}

// Load jsQR library
function loadQRLibrary() {
    return new Promise((resolve) => {
        if (typeof jsQR !== 'undefined') {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
        script.onload = () => resolve();
        script.onerror = () => {
            console.error('Failed to load jsQR library');
            resolve();
        };
        document.head.appendChild(script);
    });
}
