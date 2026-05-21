'use strict';

// ── Tab switching ──────────────────────────────────────────────────────────
let currentTab = 'pose';
let cameraRunning = false;

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
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.querySelector('.sidebar');

sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  sidebarToggle.classList.toggle('open');
});

// ── POSE UI state helpers ──────────────────────────────────────────────────
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

// ── POSE controls ──────────────────────────────────────────────────────────
let poseComplexity = 1;
let detConf = 0.5;
let trackConf = 0.5;

// Complexity toggle — use setOptions only, never reinit WASM
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
const detConfVal = document.getElementById('det-conf-val');
detConfSlider.addEventListener('input', () => {
  detConf = parseFloat(detConfSlider.value);
  detConfVal.textContent = detConf.toFixed(2);
  PoseModule.updateOptions(detConf, trackConf);
});

// Tracking confidence
const trackConfSlider = document.getElementById('track-conf');
const trackConfVal = document.getElementById('track-conf-val');
trackConfSlider.addEventListener('input', () => {
  trackConf = parseFloat(trackConfSlider.value);
  trackConfVal.textContent = trackConf.toFixed(2);
  PoseModule.updateOptions(detConf, trackConf);
});

// Show landmarks toggle
document.getElementById('show-landmarks').addEventListener('change', e => {
  PoseModule.setShowLandmarks(e.target.checked);
});

// Show connections toggle
document.getElementById('show-connections').addEventListener('change', e => {
  PoseModule.setShowConnections(e.target.checked);
});

// Color picker
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    PoseModule.setColor(btn.dataset.color);
  });
});

// Start camera button
document.getElementById('start-camera-btn').addEventListener('click', async () => {
  showPoseActions();
  await PoseModule.initPose(poseComplexity, detConf, trackConf);
  cameraRunning = true;
});

// Switch back to camera from pose-actions
document.getElementById('pose-camera-btn').addEventListener('click', async () => {
  await PoseModule.initPose(poseComplexity, detConf, trackConf);
  cameraRunning = true;
});

// Photo from start overlay
document.getElementById('pose-file-input').addEventListener('change', e => {
  if (e.target.files[0]) handlePoseFile(e.target.files[0]);
});

// Photo from pose-actions bar
document.getElementById('pose-file-input-2').addEventListener('change', e => {
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

// Save pose canvas
document.getElementById('pose-save-btn').addEventListener('click', () => {
  const canvas = document.getElementById('pose-canvas');
  const link = document.createElement('a');
  link.download = `pose-result-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ── DETECT controls ────────────────────────────────────────────────────────
let confThresh = 0.25;
let iouThresh = 0.45;

const confSlider = document.getElementById('conf-thresh');
const confVal = document.getElementById('conf-thresh-val');
confSlider.addEventListener('input', () => {
  confThresh = parseFloat(confSlider.value);
  confVal.textContent = confThresh.toFixed(2);
  rerunDetection();
});

const iouSlider = document.getElementById('iou-thresh');
const iouVal = document.getElementById('iou-thresh-val');
iouSlider.addEventListener('input', () => {
  iouThresh = parseFloat(iouSlider.value);
  iouVal.textContent = iouThresh.toFixed(2);
  rerunDetection();
});

async function rerunDetection() {
  const img = YoloModule.getCurrentImage();
  if (!img) return;
  const { detections, inferMs } = await YoloModule.detect(img, confThresh, iouThresh);
  YoloModule.renderDetections(img, detections);
  YoloModule.updateStats(detections, inferMs);
}

// File input / drag-drop
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('detect-drop');
const detectActions = document.getElementById('detect-actions');

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleDetectFile(e.target.files[0]);
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleDetectFile(file);
});

async function handleDetectFile(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = async () => {
    URL.revokeObjectURL(url);
    YoloModule.setCurrentImage(img);
    dropZone.classList.add('hidden');
    detectActions.classList.remove('hidden');

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

// New photo button
document.getElementById('new-photo-btn').addEventListener('click', () => {
  YoloModule.setCurrentImage(null);
  dropZone.classList.remove('hidden');
  detectActions.classList.add('hidden');
  document.getElementById('detect-canvas').getContext('2d').clearRect(
    0, 0,
    document.getElementById('detect-canvas').width,
    document.getElementById('detect-canvas').height
  );
  document.getElementById('infer-val').textContent = '—';
  document.getElementById('obj-count-val').textContent = '—';
  document.getElementById('top-detections').innerHTML = '';
  fileInput.value = '';
});

// Save detect button
document.getElementById('save-btn').addEventListener('click', () => {
  const canvas = document.getElementById('detect-canvas');
  const link = document.createElement('a');
  link.download = `yolo-result-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ── Resize handler ─────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  const img = YoloModule.getCurrentImage();
  if (img && currentTab === 'detect') {
    YoloModule.renderDetections(img, YoloModule.getLastDetections());
  }
});

// ── Init ───────────────────────────────────────────────────────────────────
YoloModule.initChips();
