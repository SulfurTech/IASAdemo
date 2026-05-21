'use strict';

const PoseModule = (() => {
  let pose = null;
  let camera = null;
  let currentColor = '#00ff88';
  let showLandmarks = true;
  let showConnections = true;
  let lastFrameTime = 0;
  let frameCount = 0;
  let fps = 0;
  let active = false;
  let photoMode = false;
  let photoOffset = { x: 0, y: 0, w: 0, h: 0 };

  const video = document.getElementById('pose-video');
  const canvas = document.getElementById('pose-canvas');
  const ctx = canvas.getContext('2d');

  function syncCanvasSize() {
    const wrapper = canvas.parentElement;
    canvas.width = wrapper.clientWidth;
    canvas.height = wrapper.clientHeight;
  }

  function onResults(results) {
    if (!active && !photoMode) return;

    syncCanvasSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (results.image) {
      ctx.save();
      if (photoMode) {
        ctx.drawImage(results.image, photoOffset.x, photoOffset.y, photoOffset.w, photoOffset.h);
      } else {
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
    }

    if (!photoMode) {
      const now = performance.now();
      frameCount++;
      if (now - lastFrameTime >= 500) {
        fps = Math.round(frameCount * 1000 / (now - lastFrameTime));
        frameCount = 0;
        lastFrameTime = now;
        document.getElementById('fps-val').textContent = fps;
      }
    }

    if (!results.poseLandmarks) {
      setStatus(false);
      document.getElementById('lm-val').textContent = '0';
      return;
    }

    const lms = results.poseLandmarks;
    const visibleCount = lms.filter(l => l.visibility > 0.5).length;
    document.getElementById('lm-val').textContent = `${visibleCount}/33`;
    setStatus(true);

    const W = photoMode ? photoOffset.w : canvas.width;
    const H = photoMode ? photoOffset.h : canvas.height;
    const ox = photoMode ? photoOffset.x : 0;
    const oy = photoMode ? photoOffset.y : 0;

    if (showConnections) drawConnections(lms, W, H, ox, oy);
    if (showLandmarks) drawLandmarks(lms, W, H, ox, oy);
  }

  const POSE_CONNECTIONS = [
    [11,12],[11,13],[13,15],[12,14],[14,16],
    [11,23],[12,24],[23,24],
    [23,25],[25,27],[27,29],[27,31],[29,31],
    [24,26],[26,28],[28,30],[28,32],[30,32],
    [15,17],[15,19],[15,21],[17,19],
    [16,18],[16,20],[16,22],[18,20],
    [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],
    [9,10]
  ];

  function drawConnections(lms, W, H, ox, oy) {
    ctx.save();
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.85;

    for (const [a, b] of POSE_CONNECTIONS) {
      const lA = lms[a], lB = lms[b];
      if (!lA || !lB) continue;
      if (lA.visibility < 0.3 || lB.visibility < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(lA.x * W + ox, lA.y * H + oy);
      ctx.lineTo(lB.x * W + ox, lB.y * H + oy);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLandmarks(lms, W, H, ox, oy) {
    ctx.save();
    for (const lm of lms) {
      if (lm.visibility < 0.3) continue;
      const x = lm.x * W + ox;
      const y = lm.y * H + oy;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = currentColor;
      ctx.globalAlpha = Math.min(1, lm.visibility);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  function setStatus(found) {
    const badge = document.getElementById('pose-status');
    const text = document.getElementById('pose-status-text');
    if (found) {
      badge.classList.add('found');
      text.textContent = 'Людину знайдено';
    } else {
      badge.classList.remove('found');
      text.textContent = 'Людини не знайдено';
    }
  }

  function createPose(complexity, detConf, trackConf) {
    pose = new Pose({ locateFile: (file) => `vendor/${file}` });
    pose.setOptions({
      modelComplexity: complexity,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: detConf,
      minTrackingConfidence: trackConf,
    });
    pose.onResults(onResults);
  }

  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
    await new Promise(r => video.onloadedmetadata = r);

    camera = new Camera(video, {
      onFrame: async () => {
        if (pose && active) await pose.send({ image: video });
      },
      width: 640,
      height: 480,
    });

    await camera.start();
    active = true;
    lastFrameTime = performance.now();
    frameCount = 0;
    document.getElementById('pose-status-text').textContent = 'Очікування…';
  }

  async function initPose(complexity, detConf, trackConf) {
    const loader = document.getElementById('pose-loader');
    loader.classList.remove('hidden');
    photoMode = false;

    // Stop camera if already running (keep pose instance alive — WASM can't reinit)
    if (camera) { camera.stop(); camera = null; }
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    active = false;

    if (!pose) {
      createPose(complexity, detConf, trackConf);
    } else {
      pose.setOptions({
        modelComplexity: complexity,
        minDetectionConfidence: detConf,
        minTrackingConfidence: trackConf,
      });
    }

    try {
      await startCamera();
    } catch (err) {
      console.error('Camera/pose error:', err);
      alert('Не вдалося отримати доступ до камери: ' + err.message);
    } finally {
      loader.classList.add('hidden');
    }
  }

  function updateComplexity(complexity) {
    if (pose) pose.setOptions({ modelComplexity: complexity });
  }

  function stop() {
    active = false;
    photoMode = false;
    if (camera) { camera.stop(); camera = null; }
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    // Do NOT call pose.close() — MediaPipe WASM cannot be reinstantiated after close
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('fps-val').textContent = '—';
    document.getElementById('lm-val').textContent = '—';
    setStatus(false);
    document.getElementById('pose-status-text').textContent = 'Очікування…';
  }

  async function analyzeImage(img) {
    const loader = document.getElementById('pose-loader');
    loader.classList.remove('hidden');

    // Stop camera if running (keep pose instance)
    if (camera) { camera.stop(); camera = null; }
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    active = false;
    photoMode = true;

    // Compute letterbox offset for this image on the canvas
    syncCanvasSize();
    const W = canvas.width;
    const H = canvas.height;
    const scale = Math.min(W / img.width, H / img.height);
    photoOffset = {
      x: (W - img.width * scale) / 2,
      y: (H - img.height * scale) / 2,
      w: img.width * scale,
      h: img.height * scale,
    };

    if (!pose) {
      createPose(1, 0.5, 0.5);
    }

    loader.classList.add('hidden');

    try {
      await pose.send({ image: img });
    } catch (err) {
      console.error('Pose image analyze error:', err);
      photoMode = false;
    }
  }

  function updateOptions(detC, trackC) {
    if (pose) pose.setOptions({ minDetectionConfidence: detC, minTrackingConfidence: trackC });
  }

  function setColor(c) { currentColor = c; }
  function setShowLandmarks(v) { showLandmarks = v; }
  function setShowConnections(v) { showConnections = v; }
  function isPhotoMode() { return photoMode; }

  return {
    initPose,
    analyzeImage,
    stop,
    updateOptions,
    updateComplexity,
    setColor,
    setShowLandmarks,
    setShowConnections,
    isPhotoMode,
  };
})();
