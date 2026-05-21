# CV Demo — ІПСА · КПІ

Інтерактивний стенд комп'ютерного зору для ярмарку кар'єри. Одна HTML-сторінка без бекенду — запускається прямо з браузера.

**Live demo:** _https://YOUR-USERNAME.github.io/IASAdemo_

## Два режими

- **POSE** — MediaPipe Pose: відкриває камеру та малює скелет людини в реальному часі з регульованими порогами виявлення та трекінгу
- **DETECT** — YOLOv8n ONNX: завантажте фото, модель знайде об'єкти з bounding boxes; регулюйте confidence threshold та IoU

## Запуск

```bash
git clone https://github.com/YOUR-USERNAME/IASAdemo
cd IASAdemo
```

Завантажте модель YOLOv8n (~6 MB) у папку `models/`:

```bash
# Linux/macOS
curl -L https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx -o models/yolov8n.onnx

# або вручну з https://github.com/ultralytics/assets/releases
```

Потім відкрийте через локальний HTTP-сервер (потрібен для ONNX WASM):

```bash
# Python
python -m http.server 8080

# Node
npx serve .
```

## Стек

- Чистий HTML + CSS + JS (без фреймворків)
- [MediaPipe Pose](https://google.github.io/mediapipe/solutions/pose) через CDN
- [YOLOv8n](https://docs.ultralytics.com/) у форматі ONNX через [onnxruntime-web](https://onnxruntime.ai/)
