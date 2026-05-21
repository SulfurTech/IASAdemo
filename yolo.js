'use strict';

const YoloModule = (() => {
  let session = null;
  let modelLoading = false;
  let currentImage = null;
  let lastDetections = [];
  let liveActive = false;
  let liveRafId = null;
  let liveInferTimer = null;
  let liveVideo = null;

  const COCO_CLASSES = [
    'person','bicycle','car','motorcycle','airplane','bus','train','truck','boat',
    'traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat',
    'dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack',
    'umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball',
    'kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket',
    'bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple',
    'sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair',
    'couch','potted plant','bed','dining table','toilet','tv','laptop','mouse',
    'remote','keyboard','cell phone','microwave','oven','toaster','sink',
    'refrigerator','book','clock','vase','scissors','teddy bear','hair drier',
    'toothbrush'
  ];

  const TOP_CLASSES = [
    'person','car','chair','bottle','cup','dog','cat','bicycle','laptop',
    'book','cell phone','truck','bus','motorcycle','bird','couch','tv',
    'banana','apple','pizza'
  ];

  const CLASS_COLORS = {};
  function getClassColor(cls) {
    if (!CLASS_COLORS[cls]) {
      const hue = (COCO_CLASSES.indexOf(cls) * 47 + 60) % 360;
      CLASS_COLORS[cls] = `hsl(${hue},90%,55%)`;
    }
    return CLASS_COLORS[cls];
  }

  // Works for HTMLImageElement, HTMLVideoElement, HTMLCanvasElement
  function elemW(el) { return el.videoWidth || el.naturalWidth || el.width; }
  function elemH(el) { return el.videoHeight || el.naturalHeight || el.height; }

  const canvas = document.getElementById('detect-canvas');
  const ctx = canvas.getContext('2d');

  let activeClasses = new Set(TOP_CLASSES);

  async function loadModel() {
    if (session) return;
    if (modelLoading) return;
    modelLoading = true;

    const loader = document.getElementById('detect-loader');
    const loaderText = document.getElementById('detect-loader-text');
    loader.classList.remove('hidden');
    loaderText.textContent = 'Завантаження YOLO (~6MB)…';

    try {
      ort.env.wasm.wasmPaths = 'vendor/';
      session = await ort.InferenceSession.create('models/yolov8n.onnx', {
        executionProviders: ['wasm'],
      });
      loaderText.textContent = 'Модель готова';
    } catch (err) {
      loaderText.textContent = 'Помилка завантаження моделі';
      console.error('ONNX load error:', err);
      throw err;
    } finally {
      loader.classList.add('hidden');
      modelLoading = false;
    }
  }

  function letterbox(img, targetW, targetH) {
    const offscreen = document.createElement('canvas');
    offscreen.width = targetW;
    offscreen.height = targetH;
    const c = offscreen.getContext('2d');
    c.fillStyle = '#808080';
    c.fillRect(0, 0, targetW, targetH);

    const iw = elemW(img), ih = elemH(img);
    const scale = Math.min(targetW / iw, targetH / ih);
    const newW = Math.round(iw * scale);
    const newH = Math.round(ih * scale);
    const padX = Math.round((targetW - newW) / 2);
    const padY = Math.round((targetH - newH) / 2);

    c.drawImage(img, padX, padY, newW, newH);
    return { offscreen, scale, padX, padY };
  }

  function imageToTensor(offscreen, w, h) {
    const c = offscreen.getContext('2d');
    const { data } = c.getImageData(0, 0, w, h);
    const tensor = new Float32Array(1 * 3 * w * h);
    for (let i = 0; i < w * h; i++) {
      tensor[i] = data[i * 4] / 255;
      tensor[i + w * h] = data[i * 4 + 1] / 255;
      tensor[i + 2 * w * h] = data[i * 4 + 2] / 255;
    }
    return new ort.Tensor('float32', tensor, [1, 3, h, w]);
  }

  function nms(boxes, threshold) {
    boxes.sort((a, b) => b.score - a.score);
    const keep = [];
    const suppressed = new Uint8Array(boxes.length);
    for (let i = 0; i < boxes.length; i++) {
      if (suppressed[i]) continue;
      keep.push(boxes[i]);
      for (let j = i + 1; j < boxes.length; j++) {
        if (suppressed[j]) continue;
        if (iou(boxes[i], boxes[j]) > threshold) suppressed[j] = 1;
      }
    }
    return keep;
  }

  function iou(a, b) {
    const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
    const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
    const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
    return inter / (areaA + areaB - inter);
  }

  async function detect(img, confThresh, iouThresh) {
    await loadModel();

    const TARGET = 640;
    const { offscreen, scale, padX, padY } = letterbox(img, TARGET, TARGET);
    const tensor = imageToTensor(offscreen, TARGET, TARGET);

    const t0 = performance.now();
    const results = await session.run({ images: tensor });
    const inferMs = Math.round(performance.now() - t0);

    const output = results.output0 || results[Object.keys(results)[0]];
    const data = output.data;
    const numDets = 8400;

    const iw = elemW(img), ih = elemH(img);
    const boxes = [];
    for (let i = 0; i < numDets; i++) {
      let maxScore = 0, classId = 0;
      for (let c = 0; c < 80; c++) {
        const score = data[(4 + c) * numDets + i];
        if (score > maxScore) { maxScore = score; classId = c; }
      }
      if (maxScore < confThresh) continue;

      const cx = data[0 * numDets + i];
      const cy = data[1 * numDets + i];
      const bw = data[2 * numDets + i];
      const bh = data[3 * numDets + i];

      const x1 = ((cx - bw / 2) - padX) / scale;
      const y1 = ((cy - bh / 2) - padY) / scale;
      const x2 = ((cx + bw / 2) - padX) / scale;
      const y2 = ((cy + bh / 2) - padY) / scale;

      boxes.push({
        x1: Math.max(0, x1), y1: Math.max(0, y1),
        x2: Math.min(iw, x2), y2: Math.min(ih, y2),
        score: maxScore, classId, className: COCO_CLASSES[classId]
      });
    }

    const kept = nms(boxes, iouThresh);
    lastDetections = kept;
    return { detections: kept, inferMs };
  }

  function renderDetections(img, detections) {
    const wrapper = canvas.parentElement;
    const W = wrapper.clientWidth;
    const H = wrapper.clientHeight;
    canvas.width = W;
    canvas.height = H;

    const iw = elemW(img), ih = elemH(img);
    const scale = Math.min(W / iw, H / ih);
    const drawW = iw * scale;
    const drawH = ih * scale;
    const offsetX = (W - drawW) / 2;
    const offsetY = (H - drawH) / 2;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

    for (const det of detections) {
      if (!activeClasses.has(det.className)) continue;

      const x = det.x1 * scale + offsetX;
      const y = det.y1 * scale + offsetY;
      const w = (det.x2 - det.x1) * scale;
      const h = (det.y2 - det.y1) * scale;
      const color = getClassColor(det.className);

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();

      const label = `${det.className} ${Math.round(det.score * 100)}%`;
      ctx.font = 'bold 12px Exo 2, sans-serif';
      const tw = ctx.measureText(label).width;
      const labelH = 20;
      const lx = x;
      const ly = y > labelH + 2 ? y - labelH - 2 : y + 2;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(lx, ly, tw + 10, labelH, 3);
      ctx.fill();

      ctx.fillStyle = '#000';
      ctx.fillText(label, lx + 5, ly + 14);
    }
  }

  // ── Live camera detection ─────────────────────────────────────────────────

  async function startLiveCamera(confGetter, iouGetter) {
    liveActive = true;
    liveVideo = document.getElementById('detect-video');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      liveVideo.srcObject = stream;
      await new Promise(r => { liveVideo.onloadedmetadata = r; });
      await liveVideo.play();
    } catch (err) {
      liveActive = false;
      throw err;
    }

    // Ensure model is loaded before starting loops
    await loadModel();

    // rAF render loop: draws video + last detection overlay every frame
    function renderFrame() {
      if (!liveActive) return;
      const wrapper = canvas.parentElement;
      const W = wrapper.clientWidth;
      const H = wrapper.clientHeight;
      canvas.width = W;
      canvas.height = H;

      const vw = liveVideo.videoWidth;
      const vh = liveVideo.videoHeight;
      if (vw > 0 && vh > 0) {
        const scale = Math.min(W / vw, H / vh);
        const drawW = vw * scale;
        const drawH = vh * scale;
        const ox = (W - drawW) / 2;
        const oy = (H - drawH) / 2;

        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(liveVideo, ox, oy, drawW, drawH);

        for (const det of lastDetections) {
          if (!activeClasses.has(det.className)) continue;
          const x = det.x1 * scale + ox;
          const y = det.y1 * scale + oy;
          const w = (det.x2 - det.x1) * scale;
          const h = (det.y2 - det.y1) * scale;
          const color = getClassColor(det.className);

          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.rect(x, y, w, h); ctx.stroke();

          const label = `${det.className} ${Math.round(det.score * 100)}%`;
          ctx.font = 'bold 12px Exo 2, sans-serif';
          const tw = ctx.measureText(label).width;
          const lh = 20;
          const lx = x;
          const ly = y > lh + 2 ? y - lh - 2 : y + 2;
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.roundRect(lx, ly, tw + 10, lh, 3); ctx.fill();
          ctx.fillStyle = '#000';
          ctx.fillText(label, lx + 5, ly + 14);
        }
      }
      liveRafId = requestAnimationFrame(renderFrame);
    }
    renderFrame();

    // Async YOLO inference loop — runs as fast as hardware allows
    async function inferLoop() {
      while (liveActive) {
        if (liveVideo.readyState >= 2 && liveVideo.videoWidth > 0) {
          try {
            // Snapshot current frame into an offscreen canvas
            const snap = document.createElement('canvas');
            snap.width = liveVideo.videoWidth;
            snap.height = liveVideo.videoHeight;
            snap.getContext('2d').drawImage(liveVideo, 0, 0);

            const { detections, inferMs } = await detect(snap, confGetter(), iouGetter());
            if (liveActive) updateStats(detections, inferMs);
          } catch (e) {
            // ignore transient inference errors
          }
        }
        // small yield to not starve the render loop on slow devices
        await new Promise(r => setTimeout(r, 50));
      }
    }
    inferLoop();
  }

  function stopLiveCamera() {
    liveActive = false;
    if (liveRafId) { cancelAnimationFrame(liveRafId); liveRafId = null; }
    if (liveVideo) {
      if (liveVideo.srcObject) {
        liveVideo.srcObject.getTracks().forEach(t => t.stop());
        liveVideo.srcObject = null;
      }
    }
    lastDetections = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function isLiveActive() { return liveActive; }

  function updateStats(detections, inferMs) {
    const filtered = detections.filter(d => activeClasses.has(d.className));
    document.getElementById('infer-val').textContent = inferMs;
    document.getElementById('obj-count-val').textContent = filtered.length;

    const byClass = {};
    for (const d of filtered) {
      if (!byClass[d.className] || d.score > byClass[d.className]) {
        byClass[d.className] = d.score;
      }
    }
    const sorted = Object.entries(byClass).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const container = document.getElementById('top-detections');
    container.innerHTML = '';
    for (const [cls, score] of sorted) {
      const div = document.createElement('div');
      div.className = 'top-det';
      div.innerHTML = `
        <div class="top-det-label">
          <span class="top-det-name">${cls}</span>
          <span class="top-det-score">${Math.round(score * 100)}%</span>
        </div>
        <div class="top-det-bar"><div class="top-det-fill" style="width:${Math.round(score * 100)}%"></div></div>
      `;
      container.appendChild(div);
    }
  }

  function initChips() {
    const container = document.getElementById('class-chips');
    for (const cls of TOP_CLASSES) {
      const chip = document.createElement('button');
      chip.className = 'chip' + (activeClasses.has(cls) ? ' active' : '');
      chip.textContent = cls;
      chip.dataset.cls = cls;
      chip.addEventListener('click', () => {
        if (activeClasses.has(cls)) {
          activeClasses.delete(cls);
          chip.classList.remove('active');
        } else {
          activeClasses.add(cls);
          chip.classList.add('active');
        }
        if (currentImage && lastDetections.length > 0) {
          renderDetections(currentImage, lastDetections);
          updateStats(lastDetections, document.getElementById('infer-val').textContent);
        }
      });
      container.appendChild(chip);
    }
  }

  function setCurrentImage(img) { currentImage = img; }
  function getCurrentImage() { return currentImage; }
  function getLastDetections() { return lastDetections; }

  return {
    detect,
    renderDetections,
    updateStats,
    initChips,
    setCurrentImage,
    getCurrentImage,
    getLastDetections,
    startLiveCamera,
    stopLiveCamera,
    isLiveActive,
    COCO_CLASSES,
    TOP_CLASSES,
  };
})();
