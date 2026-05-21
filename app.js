'use strict';

// ── Tab switching ──────────────────────────────────────────────────────────
let currentTab = 'pose';
let cameraRunning = false;
let detectLiveRunning = false;

const tabBtns = document.querySelectorAll('.tab-btn');
const poseSidebar = document.getElementById('pose-sidebar');
const detectSidebar = document.getElementById('detect-sidebar');
const poseView = document.getElementById('pose-view');
const detectView = document.getElementById('detect-view');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === currentTab) return;
    currentTab = tab;

    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (tab === 'pose') {
      poseView.classList.add('active');
      detectView.classList.remove('active');
      poseSidebar.classList.add('active');
      detectSidebar.classList.remove('active');

      if (detectLiveRunning) stopDetectLive();
    } else {
      detectView.classList.add('active');
      poseView.classList.remove('active');
      detectSidebar.classList.add('active');
      poseSidebar.classList.remove('active');

      if (cameraRunning) {
        PoseModule.stop();
        cameraRunning = false;
        showPoseStart();
      }
    }
  });
});

// ── Mobile sidebar toggle ──────────────────────────────────────────────────
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  const sidebar = document.querySelector('.sidebar');
  sidebar.classList.toggle('open');
  document.getElementById('sidebar-toggle').classList.toggle('open');
});

// ── POSE UI helpers ────────────────────────────────────────────────────────
const poseStart   = document.getElementById('pose-start');
const poseActions = document.getElementById('pose-actions');

function showPoseStart() {
  poseStart.style.display = '';
  poseActions.classList.add('hidden');
}

function showPoseActions() {
  poseStart.style.display = 'none';
  poseActions.classList.remove('hidden');
}

// ── Hidden file inputs (reliable cross-mobile pattern) ────────────────────
const poseFileInput   = document.getElementById('pose-file-input');
const detectFileInput = document.getElementById('detect-file-input');

// POSE — start overlay photo button
document.getElementById('pose-photo-btn').addEventListener('click', () => {
  poseFileInput.click();
});

// POSE — actions bar photo button
document.getElementById('pose-photo-btn-2').addEventListener('click', () => {
  poseFileInput.click();
});

poseFileInput.addEventListener('change', e => {
  if (e.target.files[0]) handlePoseFile(e.target.files[0]);
  e.target.value = '';
});

async function handlePoseFile(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = async () => {
    URL.revokeObjectURL(url);
    cameraRunning = false;
    showPoseActions();
    await PoseModule.analyzeImage(img);
  };
  img.src = url;
}

// ── POSE controls ──────────────────────────────────────────────────────────
let poseComplexity = 0;
let detConf = 0.5;
let trackConf = 0.5;

// Complexity toggle
document.querySelectorAll('.complexity-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = parseInt(btn.dataset.val);
    if (val === poseComplexity) return;
    poseComplexity = val;
    document.querySelectorAll('.complexity-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    PoseModule.updateComplexity(val);
  });
});

// Detection confidence
const detConfSlider = document.getElementById('det-conf');
const detConfVal    = document.getElementById('det-conf-val');
detConfSlider.addEventListener('input', () => {
  detConf = parseFloat(detConfSlider.value);
  detConfVal.textContent = detConf.toFixed(2);
  PoseModule.updateOptions(detConf, trackConf);
});

// Tracking confidence
const trackConfSlider = document.getElementById('track-conf');
const trackConfVal    = document.getElementById('track-conf-val');
trackConfSlider.addEventListener('input', () => {
  trackConf = parseFloat(trackConfSlider.value);
  trackConfVal.textContent = trackConf.toFixed(2);
  PoseModule.updateOptions(detConf, trackConf);
});

document.getElementById('show-landmarks').addEventListener('change', e => {
  PoseModule.setShowLandmarks(e.target.checked);
});

document.getElementById('show-connections').addEventListener('change', e => {
  PoseModule.setShowConnections(e.target.checked);
});

document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    PoseModule.setColor(btn.dataset.color);
  });
});

// Start camera (from start overlay)
document.getElementById('start-camera-btn').addEventListener('click', async () => {
  showPoseActions();
  try {
    await PoseModule.initPose(poseComplexity, detConf, trackConf);
    cameraRunning = true;
  } catch (err) {
    showPoseStart();
    alert('Не вдалося запустити камеру: ' + err.message);
  }
});

// Switch to camera (from actions bar)
document.getElementById('pose-camera-btn').addEventListener('click', async () => {
  try {
    await PoseModule.initPose(poseComplexity, detConf, trackConf);
    cameraRunning = true;
  } catch (err) {
    alert('Не вдалося запустити камеру: ' + err.message);
  }
});

// Save pose canvas
document.getElementById('pose-save-btn').addEventListener('click', () => {
  const canvas = document.getElementById('pose-canvas');
  const link = document.createElement('a');
  link.download = `pose-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ── DETECT controls ────────────────────────────────────────────────────────
let confThresh = 0.25;
let iouThresh  = 0.45;

const confSlider = document.getElementById('conf-thresh');
const confVal    = document.getElementById('conf-thresh-val');
confSlider.addEventListener('input', () => {
  confThresh = parseFloat(confSlider.value);
  confVal.textContent = confThresh.toFixed(2);
  if (!detectLiveRunning) rerunDetection();
});

const iouSlider = document.getElementById('iou-thresh');
const iouVal    = document.getElementById('iou-thresh-val');
iouSlider.addEventListener('input', () => {
  iouThresh = parseFloat(iouSlider.value);
  iouVal.textContent = iouThresh.toFixed(2);
  if (!detectLiveRunning) rerunDetection();
});

async function rerunDetection() {
  const img = YoloModule.getCurrentImage();
  if (!img) return;
  const { detections, inferMs } = await YoloModule.detect(img, confThresh, iouThresh);
  YoloModule.renderDetections(img, detections);
  YoloModule.updateStats(detections, inferMs);
}

// ── DETECT: photo from gallery ─────────────────────────────────────────────
const detectDrop    = document.getElementById('detect-drop');
const detectActions = document.getElementById('detect-actions');
const stopCameraBtn = document.getElementById('detect-stop-camera-btn');

document.getElementById('detect-gallery-btn').addEventListener('click', () => {
  detectFileInput.click();
});

detectFileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleDetectFile(e.target.files[0]);
  e.target.value = '';
});

detectDrop.addEventListener('dragover', e => { e.preventDefault(); detectDrop.classList.add('drag-over'); });
detectDrop.addEventListener('dragleave', () => detectDrop.classList.remove('drag-over'));
detectDrop.addEventListener('drop', e => {
  e.preventDefault();
  detectDrop.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleDetectFile(file);
});

async function handleDetectFile(file) {
  if (detectLiveRunning) stopDetectLive();

  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = async () => {
    URL.revokeObjectURL(url);
    YoloModule.setCurrentImage(img);
    detectDrop.classList.add('hidden');
    detectActions.classList.remove('hidden');
    stopCameraBtn.classList.add('hidden');

    const loader = document.getElementById('detect-loader');
    loader.classList.remove('hidden');
    document.getElementById('detect-loader-text').textContent = 'Аналіз…';

    try {
      const { detections, inferMs } = await YoloModule.detect(img, confThresh, iouThresh);
      YoloModule.renderDetections(img, detections);
      YoloModule.updateStats(detections, inferMs);
    } finally {
      loader.classList.add('hidden');
    }
  };
  img.src = url;
}

// ── DETECT: live camera ────────────────────────────────────────────────────
document.getElementById('detect-camera-btn').addEventListener('click', async () => {
  if (detectLiveRunning) return;

  detectDrop.classList.add('hidden');
  detectActions.classList.remove('hidden');
  stopCameraBtn.classList.remove('hidden');
  YoloModule.setCurrentImage(null);

  const loader = document.getElementById('detect-loader');
  loader.classList.remove('hidden');
  document.getElementById('detect-loader-text').textContent = 'Запуск камери…';

  try {
    await YoloModule.startLiveCamera(() => confThresh, () => iouThresh);
    detectLiveRunning = true;
  } catch (err) {
    detectDrop.classList.remove('hidden');
    detectActions.classList.add('hidden');
    alert('Не вдалося запустити камеру: ' + err.message);
  } finally {
    loader.classList.add('hidden');
  }
});

document.getElementById('detect-stop-camera-btn').addEventListener('click', () => {
  stopDetectLive();
});

function stopDetectLive() {
  YoloModule.stopLiveCamera();
  detectLiveRunning = false;
  detectDrop.classList.remove('hidden');
  detectActions.classList.add('hidden');
  stopCameraBtn.classList.add('hidden');
  YoloModule.setCurrentImage(null);
  document.getElementById('infer-val').textContent = '—';
  document.getElementById('obj-count-val').textContent = '—';
  document.getElementById('top-detections').innerHTML = '';
}

// New photo / reset detect
document.getElementById('new-photo-btn').addEventListener('click', () => {
  if (detectLiveRunning) { stopDetectLive(); return; }
  YoloModule.setCurrentImage(null);
  detectDrop.classList.remove('hidden');
  detectActions.classList.add('hidden');
  const canvas = document.getElementById('detect-canvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('infer-val').textContent = '—';
  document.getElementById('obj-count-val').textContent = '—';
  document.getElementById('top-detections').innerHTML = '';
});

// Save detect canvas
document.getElementById('save-btn').addEventListener('click', () => {
  const canvas = document.getElementById('detect-canvas');
  const link = document.createElement('a');
  link.download = `yolo-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ── Resize handler ─────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (!detectLiveRunning) {
    const img = YoloModule.getCurrentImage();
    if (img && currentTab === 'detect') {
      YoloModule.renderDetections(img, YoloModule.getLastDetections());
    }
  }
});

// ── Init ───────────────────────────────────────────────────────────────────
YoloModule.initChips();
