
const $ = (selector) => document.querySelector(selector);

const canvas = $("#canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const canvasArea = $("#canvasArea");

let originalImage = null;
let currentImage = null;
let originalFileName = "image";
let cropMode = false;
let cropStart = null;
let cropRect = null;
let previewBefore = false;
let history = [];
let selectedFilter = "none";
let busy = false;

const MAX_DIMENSION = 30000;

function setStatus(message) {
  $("#status").textContent = message;
}

function setBusy(value, message) {
  busy = value;
  [
    "#removeBgBtn", "#downloadBtn", "#resizeBtn",
    "#applyAdjustmentsBtn", "#applyFilterBtn",
    "#batchResizeBtn", "#batchConvertBtn"
  ].forEach((id) => {
    $(id).disabled = value;
  });
  if (message) setStatus(message);
}

function ensureImage() {
  if (!currentImage) {
    alert("Please open an image first.");
    return false;
  }
  return true;
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected file could not be read as an image."));
    };
    image.src = url;
  });
}

function imageToCanvas(image) {
  const out = document.createElement("canvas");
  out.width = image.naturalWidth || image.width;
  out.height = image.naturalHeight || image.height;
  out.getContext("2d").drawImage(image, 0, 0);
  return out;
}

function snapshot() {
  if (!currentImage) return;

  // Save the edited image, never whichever preview happens to be visible.
  history.push(imageToCanvas(currentImage).toDataURL("image/png"));
  if (history.length > 15) history.shift();
}

async function restoreSnapshot(dataUrl) {
  const response = await fetch(dataUrl);
  const img = await loadImageFromBlob(await response.blob());
  currentImage = img;
  previewBefore = false;
  drawImage(currentImage);
  updateDetails();
}

function drawImage(image) {
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  canvas.hidden = false;
  $("#emptyState").hidden = true;
  updateDetails();
}

function updateDetails() {
  if (!currentImage) return;

  $("#imageDetails").textContent =
    `${canvas.width.toLocaleString()} × ${canvas.height.toLocaleString()} px`;

  $("#dimensions").textContent =
    `${canvas.width.toLocaleString()} × ${canvas.height.toLocaleString()} px`;

  $("#widthInput").value = canvas.width;
  $("#heightInput").value = canvas.height;
}

async function openFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    alert("Please choose a valid image file.");
    return;
  }

  try {
    const image = await loadImageFromBlob(file);

    if (image.width > MAX_DIMENSION || image.height > MAX_DIMENSION) {
      throw new Error("Image dimensions exceed the 30,000 pixel safety limit.");
    }

    originalImage = image;
    currentImage = image;
    originalFileName = file.name.replace(/\.[^.]+$/, "") || "image";
    history = [];
    previewBefore = false;
    cancelCrop();
    drawImage(currentImage);
    setStatus(`Loaded ${file.name}`);
  } catch (error) {
    alert(error.message || "Unable to open image.");
  }
}

$("#fileInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (file) await openFile(file);
  event.target.value = "";
});

// Drag and drop
canvasArea.addEventListener("dragover", (event) => {
  event.preventDefault();
  canvasArea.style.outline = "2px solid #6d8cff";
});

canvasArea.addEventListener("dragleave", () => {
  canvasArea.style.outline = "";
});

canvasArea.addEventListener("drop", async (event) => {
  event.preventDefault();
  canvasArea.style.outline = "";

  const file = [...(event.dataTransfer?.files || [])]
    .find((item) => item.type.startsWith("image/"));

  if (file) await openFile(file);
});

function applyFilterToCanvas(source, filterName) {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const outCtx = out.getContext("2d");

  const filters = {
    none: "none",
    grayscale: "grayscale(100%)",
    sepia: "sepia(100%)",
    vintage: "sepia(55%) contrast(90%) saturate(80%)",
    blur: "blur(2px)",
    invert: "invert(100%)"
  };

  outCtx.filter = filters[filterName] || "none";
  outCtx.drawImage(source, 0, 0);
  outCtx.filter = "none";
  return out;
}

function applyEnhancements(source) {
  const brightness = Number($("#brightness").value) / 100;
  const contrast = Number($("#contrast").value) / 100;
  const saturation = Number($("#saturation").value) / 100;
  const sharpness = Number($("#sharpness").value);

  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;

  const outCtx = out.getContext("2d", { willReadFrequently: true });
  outCtx.filter =
    `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
  outCtx.drawImage(source, 0, 0);
  outCtx.filter = "none";

  if (sharpness > 0 && out.width > 2 && out.height > 2) {
    const imageData = outCtx.getImageData(0, 0, out.width, out.height);
    const src = imageData.data;
    const copy = new Uint8ClampedArray(src);
    const amount = Math.min(sharpness * 0.12, 0.6);
    const w = out.width;
    const h = out.height;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        const neighbours = [i - 4, i + 4, i - w * 4, i + w * 4];

        for (let c = 0; c < 3; c++) {
          const sum = neighbours.reduce((total, j) => total + copy[j + c], 0);
          src[i + c] = Math.max(0, Math.min(255,
            copy[i + c] * (1 + 4 * amount) - sum * amount
          ));
        }
      }
    }

    outCtx.putImageData(imageData, 0, 0);
  }

  return out;
}

function commitCanvas(out, label) {
  snapshot();

  const image = new Image();
  image.onload = () => {
    currentImage = image;
    previewBefore = false;
    drawImage(currentImage);
    setStatus(label);
  };
  image.onerror = () => setStatus("Could not apply this edit.");
  image.src = out.toDataURL("image/png");
}

function syncSliderLabels() {
  ["brightness", "contrast", "saturation"].forEach((name) => {
    $(`#${name}Value`).textContent = `${$(`#${name}`).value}%`;
  });
  $("#sharpnessValue").textContent = $("#sharpness").value;
}

["brightness", "contrast", "saturation", "sharpness"].forEach((id) => {
  $(`#${id}`).addEventListener("input", syncSliderLabels);
});

$("#applyAdjustmentsBtn").addEventListener("click", () => {
  if (!ensureImage()) return;

  try {
    const out = applyEnhancements(imageToCanvas(currentImage));
    commitCanvas(out, "Adjustments applied");
  } catch (error) {
    alert(`Could not apply adjustments: ${error.message}`);
  }
});

$("#resetAdjustmentsBtn").addEventListener("click", () => {
  $("#brightness").value = 100;
  $("#contrast").value = 100;
  $("#saturation").value = 100;
  $("#sharpness").value = 0;
  syncSliderLabels();
  setStatus("Adjustment sliders reset");
});

// Filters
document.querySelectorAll(".filter-option").forEach((button) => {
  button.addEventListener("click", () => {
    selectedFilter = button.dataset.filter;

    document.querySelectorAll(".filter-option").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
  });
});

$("#applyFilterBtn").addEventListener("click", () => {
  if (!ensureImage()) return;

  const out = applyFilterToCanvas(
    imageToCanvas(currentImage),
    selectedFilter
  );

  commitCanvas(out, `${selectedFilter} filter applied`);
});

// Resize
function getResizeDimensions() {
  let width = Number($("#widthInput").value);
  let height = Number($("#heightInput").value);

  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 ||
      width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error("Enter valid dimensions between 1 and 30,000 pixels.");
  }

  if ($("#keepRatio").checked) {
    const ratio = currentImage.width / currentImage.height;

    if (width / height > ratio) width = Math.round(height * ratio);
    else height = Math.round(width / ratio);
  }

  return { width, height };
}

$("#resizeBtn").addEventListener("click", () => {
  if (!ensureImage()) return;

  try {
    const { width, height } = getResizeDimensions();
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;

    out.getContext("2d").drawImage(currentImage, 0, 0, width, height);
    commitCanvas(out, `Resized to ${width} × ${height}`);
  } catch (error) {
    alert(error.message);
  }
});

document.querySelectorAll(".preset-grid button").forEach((button) => {
  button.addEventListener("click", () => {
    $("#widthInput").value = button.dataset.w;
    $("#heightInput").value = button.dataset.h;
  });
});

// Interactive cropping
function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: Math.max(0, Math.min(
      canvas.width, (event.clientX - rect.left) * canvas.width / rect.width
    )),
    y: Math.max(0, Math.min(
      canvas.height, (event.clientY - rect.top) * canvas.height / rect.height
    ))
  };
}

$("#cropBtn").addEventListener("click", () => {
  if (!ensureImage()) return;

  previewBefore = false;
  drawImage(currentImage);
  cropMode = true;
  cropStart = null;
  cropRect = null;
  canvas.style.cursor = "crosshair";
  $("#cropTip").hidden = false;
  setStatus("Drag over the image to select a crop");
});

canvas.addEventListener("pointerdown", (event) => {
  if (!cropMode) return;

  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  cropStart = canvasPoint(event);
  cropRect = { x: cropStart.x, y: cropStart.y, w: 0, h: 0 };
});

canvas.addEventListener("pointermove", (event) => {
  if (!cropMode || !cropStart) return;

  const point = canvasPoint(event);
  cropRect = {
    x: Math.min(cropStart.x, point.x),
    y: Math.min(cropStart.y, point.y),
    w: Math.abs(point.x - cropStart.x),
    h: Math.abs(point.y - cropStart.y)
  };

  drawImage(currentImage);

  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;

  ctx.save();
  ctx.strokeStyle = "#50d8ff";
  ctx.lineWidth = Math.max(1, 2 * scale);
  ctx.setLineDash([8 * scale, 5 * scale]);
  ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);

  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillRect(0, 0, canvas.width, cropRect.y);
  ctx.fillRect(0, cropRect.y + cropRect.h, canvas.width,
    canvas.height - cropRect.y - cropRect.h);
  ctx.fillRect(0, cropRect.y, cropRect.x, cropRect.h);
  ctx.fillRect(cropRect.x + cropRect.w, cropRect.y,
    canvas.width - cropRect.x - cropRect.w, cropRect.h);
  ctx.restore();
});

canvas.addEventListener("pointerup", () => {
  if (cropMode && cropRect) setStatus("Crop selected. Click Apply crop.");
});

function cancelCrop() {
  cropMode = false;
  cropStart = null;
  cropRect = null;
  $("#cropTip").hidden = true;
  canvas.style.cursor = "default";

  if (currentImage) drawImage(currentImage);
}

$("#cancelCropBtn").addEventListener("click", cancelCrop);

$("#applyCropBtn").addEventListener("click", () => {
  if (!ensureImage()) return;

  if (!cropMode || !cropRect || cropRect.w < 2 || cropRect.h < 2) {
    alert("Start interactive crop and drag a selection first.");
    return;
  }

  const x = Math.max(0, Math.floor(cropRect.x));
  const y = Math.max(0, Math.floor(cropRect.y));
  const w = Math.min(canvas.width - x, Math.floor(cropRect.w));
  const h = Math.min(canvas.height - y, Math.floor(cropRect.h));

  if (w < 1 || h < 1) return;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;

  out.getContext("2d").drawImage(
    currentImage, x, y, w, h, 0, 0, w, h
  );

  cropMode = false;
  cropRect = null;
  $("#cropTip").hidden = true;
  canvas.style.cursor = "default";
  commitCanvas(out, "Crop applied");
});

// Before / After comparison
$("#beforeAfterBtn").addEventListener("click", () => {
  if (!ensureImage() || !originalImage) return;

  previewBefore = !previewBefore;
  drawImage(previewBefore ? originalImage : currentImage);

  setStatus(previewBefore
    ? "Showing original image"
    : "Showing edited image");
});

// Undo last edit
$("#undoBtn").addEventListener("click", async () => {
  if (!history.length) {
    setStatus("No edits to undo");
    return;
  }

  try {
    await restoreSnapshot(history.pop());
    cancelCrop();
    setStatus("Last edit undone");
  } catch (error) {
    alert(`Undo failed: ${error.message}`);
  }
});

// Reset all edits
$("#resetAllBtn").addEventListener("click", () => {
  if (!originalImage) {
    alert("Please open an image first.");
    return;
  }

  if (!confirm("Discard all edits and return to the original image?")) return;

  currentImage = originalImage;
  history = [];
  selectedFilter = "none";

  document.querySelectorAll(".filter-option").forEach((item) => {
    item.classList.toggle("active", item.dataset.filter === "none");
  });

  $("#brightness").value = 100;
  $("#contrast").value = 100;
  $("#saturation").value = 100;
  $("#sharpness").value = 0;

  syncSliderLabels();
  cancelCrop();
  previewBefore = false;
  drawImage(currentImage);
  setStatus("All edits reset");
});

// Export dialog
const exportDialog = $("#exportDialog");

$("#downloadBtn").addEventListener("click", () => {
  if (!ensureImage()) return;

  previewBefore = false;
  drawImage(currentImage);
  $("#exportName").value = `${originalFileName}-edited`;
  exportDialog.showModal();
});

$("#exportFormat").addEventListener("change", () => {
  $("#qualityLabel").style.display =
    $("#exportFormat").value === "image/png" ? "none" : "grid";
});

$("#exportForm").addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;

  event.preventDefault();
  if (!ensureImage()) return;

  const mime = $("#exportFormat").value;
  const quality = Number($("#exportQuality").value) / 100;

  const name = ($("#exportName").value.trim() || "edited-image")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");

  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp"
  }[mime];

  try {
    const exportCanvas = imageToCanvas(currentImage);

    if (mime === "image/jpeg") {
      const jpegCanvas = document.createElement("canvas");
      jpegCanvas.width = exportCanvas.width;
      jpegCanvas.height = exportCanvas.height;

      const jpegCtx = jpegCanvas.getContext("2d");
      jpegCtx.fillStyle = "#ffffff";
      jpegCtx.fillRect(0, 0, jpegCanvas.width, jpegCanvas.height);
      jpegCtx.drawImage(exportCanvas, 0, 0);

      await downloadCanvas(jpegCanvas, mime, quality, name, extension);
    } else {
      await downloadCanvas(exportCanvas, mime, quality, name, extension);
    }

    exportDialog.close();
  } catch (error) {
    alert(`Export failed: ${error.message}`);
  }
});

function downloadCanvas(source, mime, quality, name, extension) {
  return new Promise((resolve, reject) => {
    source.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode image. Try another format."));
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setStatus(`Exported ${name}.${extension}`);
      resolve();
    }, mime, quality);
  });
}

// AI background removal.
// This loads an external package and model on first use.
$("#removeBgBtn").addEventListener("click", async () => {
  if (!ensureImage() || busy) return;

  setBusy(true, "Loading AI background-removal model…");

  try {
    const { removeBackground } = await import(
      "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm"
    );

    const sourceBlob = await new Promise((resolve, reject) => {
      imageToCanvas(currentImage).toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not prepare image for processing."));
      }, "image/png");
    });

    setStatus("AI is removing the background. Please wait…");

    const resultBlob = await removeBackground(sourceBlob, {
      output: { format: "image/png" }
    });

    const resultImage = await loadImageFromBlob(resultBlob);
    snapshot();
    currentImage = resultImage;
    previewBefore = false;
    drawImage(currentImage);
    setStatus("Background removed. Export as PNG to preserve transparency.");
  } catch (error) {
    console.error(error);

    alert(
      "AI background removal could not start.\n\n" +
      "Check your internet connection and browser console. " +
      "The AI model is downloaded on first use.\n\n" +
      `Details: ${error.message || error}`
    );

    setStatus("Background removal failed");
  } finally {
    setBusy(false);
  }
});

// Batch processing
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function canvasToBlob(source, mime, quality = 0.92) {
  return new Promise((resolve, reject) => {
    source.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode image."));
    }, mime, quality);
  });
}

async function batchProcess(files, mode) {
  if (!files.length) return;

  let width = Number($("#widthInput").value);
  let height = Number($("#heightInput").value);

  if (mode === "resize" &&
      (!Number.isInteger(width) || !Number.isInteger(height) ||
       width < 1 || height < 1 ||
       width > MAX_DIMENSION || height > MAX_DIMENSION)) {
    alert("Enter valid resize dimensions first.");
    return;
  }

  const format = mode === "resize" ? "image/png" : $("#exportFormat").value;
  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp"
  }[format];

  setBusy(true, `Batch processing ${files.length} images…`);

  let completed = 0;
  const errors = [];

  try {
    for (const file of files) {
      try {
        if (!file.type.startsWith("image/")) continue;

        const img = await loadImageFromBlob(file);
        const out = document.createElement("canvas");

        if (mode === "resize") {
          let w = width;
          let h = height;

          if ($("#keepRatio").checked) {
            const ratio = img.width / img.height;
            if (w / h > ratio) w = Math.round(h * ratio);
            else h = Math.round(w / ratio);
          }

          out.width = w;
          out.height = h;
        } else {
          out.width = img.width;
          out.height = img.height;
        }

        const outCtx = out.getContext("2d");

        if (format === "image/jpeg") {
          outCtx.fillStyle = "#ffffff";
          outCtx.fillRect(0, 0, out.width, out.height);
        }

        outCtx.drawImage(img, 0, 0, out.width, out.height);

        const blob = await canvasToBlob(out, format);

        downloadBlob(
          blob,
          `${file.name.replace(/\.[^.]+$/, "")}-${mode}.${extension}`
        );

        completed++;
        setStatus(`Processed ${completed} of ${files.length}`);

        // Allow the browser UI to update between files.
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
      }
    }

    alert(
      `Processed ${completed} of ${files.length} images.\n\n` +
      (errors.length
        ? `Some files failed:\n${errors.slice(0, 5).join("\n")}`
        : "Check your browser's downloads list.")
    );
  } finally {
    setBusy(false);
  }
}

$("#batchResizeBtn").addEventListener("click", () => {
  $("#batchInput").dataset.mode = "resize";
  $("#batchInput").click();
});

$("#batchConvertBtn").addEventListener("click", () => {
  $("#batchInput").dataset.mode = "convert";
  $("#batchInput").click();
});

$("#batchInput").addEventListener("change", async (event) => {
  const files = [...(event.target.files || [])];
  const mode = event.target.dataset.mode || "convert";
  event.target.value = "";
  await batchProcess(files, mode);
});

// Initial state
syncSliderLabels();
$("#qualityLabel").style.display = "none";
setStatus("Ready to edit");
