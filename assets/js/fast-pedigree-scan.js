import { branchIndexes, generationOf, parsePigeonText } from "./fast-pedigree-core.js?v=20260814-15";

const LIMIT = 2;
const usage = () => { try { const data = JSON.parse(localStorage.getItem("micolpe-fp-ocr") || "{}"); return data.day === new Date().toISOString().slice(0, 10) ? Number(data.count || 0) : 0; } catch { return 0; } };
const increment = () => localStorage.setItem("micolpe-fp-ocr", JSON.stringify({ day: new Date().toISOString().slice(0, 10), count: usage() + 1 }));
const rectOf = (box) => Object.fromEntries(["x", "y", "w", "h"].map((key) => [key, Number(box.dataset[key])]));
function setRect(box, rect) {
  const next = { x: Math.max(0, Math.min(98, rect.x)), y: Math.max(0, Math.min(98, rect.y)), w: Math.max(2, rect.w), h: Math.max(2, rect.h) };
  next.w = Math.min(next.w, 100 - next.x); next.h = Math.min(next.h, 100 - next.y);
  for (const [key, value] of Object.entries(next)) box.dataset[key] = String(value);
  Object.assign(box.style, { left: `${next.x}%`, top: `${next.y}%`, width: `${next.w}%`, height: `${next.h}%` });
}
function defaultRects(indexes, start) {
  const first = generationOf(start), last = Math.max(...indexes.map(generationOf)), columns = last - first + 1, result = new Map();
  for (let gen = first; gen <= last; gen += 1) {
    const list = indexes.filter((index) => generationOf(index) === gen), gap = Math.min(1, 12 / list.length), height = (94 - gap * (list.length - 1)) / list.length;
    list.forEach((index, position) => result.set(index, { x: 3 + (gen - first) * 94 / columns, y: 3 + position * (height + gap), w: 94 / columns - 1, h: height }));
  }
  return result;
}
async function loadImage(file) {
  const url = URL.createObjectURL(file); const image = new Image(); image.src = url; await image.decode(); URL.revokeObjectURL(url); return image;
}

export class FastPedigreeScanner {
  constructor({ modal, lang, authenticated, rootGender, onApply, onStatus }) {
    Object.assign(this, { modal, lang, authenticated, rootGender, onApply, onStatus });
    this.canvas = modal.querySelector("#fp-scan-canvas"); this.stage = modal.querySelector("#fp-scan-stage"); this.overlay = modal.querySelector("#fp-scan-overlay");
    this.fileInput = modal.querySelector("#fp-scan-file"); this.progress = modal.querySelector("#fp-scan-progress");
    this.zoomValue = modal.querySelector("#fp-scan-zoom-value"); this.boxes = new Map(); this.selected = new Set(); this.textItems = []; this.source = "image"; this.start = 1; this.scanZoom = 1;
    this.bind();
  }
  tr(fr, en) { return this.lang === "en" ? en : fr; }
  setProgress(message = "", type = "info", busy = false) {
    this.progress.textContent = message;
    this.progress.dataset.type = type;
    this.progress.classList.toggle("is-busy", busy);
    this.progress.hidden = !message;
  }
  bind() {
    this.fileInput.addEventListener("change", async () => {
      try {
        if (this.fileInput.files[0]) await this.load(this.fileInput.files[0]);
      } catch (error) {
        this.setProgress(error.message, "error");
        this.onStatus(error.message, "error");
      }
    });
    this.modal.querySelector("#fp-scan-run").addEventListener("click", () => this.run());
    this.modal.querySelector("#fp-scan-reset-boxes").addEventListener("click", () => this.drawBoxes());
    this.modal.querySelector("#fp-scan-zoom-out").addEventListener("click", () => this.changeZoom(-0.25));
    this.modal.querySelector("#fp-scan-zoom-in").addEventListener("click", () => this.changeZoom(0.25));
    this.modal.querySelectorAll("[data-close-scan]").forEach((item) => item.addEventListener("click", () => this.close()));
    window.addEventListener("resize", () => !this.modal.hidden && this.layoutDocument());
  }
  open(index, chooseFile = false) {
    this.start = Number(index); this.modal.hidden = false; document.body.classList.add("fp-modal-open"); this.fileInput.value = "";
    this.scanZoom = 1; this.updateZoomValue(); this.setProgress(this.tr("Choisissez un document pour commencer le scan.", "Choose a document to start scanning."));
    this.modal.querySelector("#fp-scan-branch-count").textContent = this.tr(`${branchIndexes(this.start).length} cases dans la branche`, `${branchIndexes(this.start).length} boxes in the branch`);
    this.modal.querySelector("#fp-scan-empty").hidden = false; this.stage.hidden = true; this.modal.querySelector("#fp-scan-run").disabled = true;
    if (chooseFile) this.fileInput.click();
  }
  close() { this.modal.hidden = true; document.body.classList.remove("fp-modal-open"); }
  async load(file) {
    if (file.size > 15 * 1024 * 1024) throw new Error(this.tr("15 Mo maximum.", "15 MB maximum."));
    this.setProgress(this.tr("Chargement et préparation du document…", "Loading and preparing the document…"), "info", true);
    this.textItems = [];
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) await this.loadPdf(file); else if (file.type.startsWith("image/")) await this.loadRaster(file); else throw new Error(this.tr("Choisissez un PDF ou une image.", "Choose a PDF or image."));
    this.modal.querySelector("#fp-scan-empty").hidden = true; this.stage.hidden = false; this.modal.querySelector("#fp-scan-run").disabled = false;
    this.scanZoom = 1; this.updateZoomValue();
    requestAnimationFrame(() => { this.layoutDocument(); this.drawBoxes(); });
    this.setProgress(this.source === "pdf-text" ? this.tr("Document prêt : le texte sera analysé localement.", "Document ready: text will be analyzed locally.") : this.tr("Document prêt : ajustez les cadres puis lancez le scan.", "Document ready: adjust the boxes, then start scanning."), "success");
    this.onStatus(this.source === "pdf-text" ? this.tr("PDF texte : extraction locale.", "Text PDF: local extraction.") : this.tr("Ajustez les cadres avant le scan.", "Adjust boxes before scanning."), "success");
  }
  async loadRaster(file) {
    const image = await loadImage(file), scale = Math.min(1, 1600 / image.naturalWidth); this.canvas.width = image.naturalWidth * scale; this.canvas.height = image.naturalHeight * scale;
    this.canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0, this.canvas.width, this.canvas.height); this.source = "image";
  }
  async loadPdf(file) {
    this.pdfjs ||= await import("../vendor/pdf.min.mjs"); this.pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;
    const pdf = await this.pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, page = await pdf.getPage(1), base = page.getViewport({ scale: 1 }), scale = Math.min(2.2, 1600 / base.width), viewport = page.getViewport({ scale });
    this.canvas.width = viewport.width; this.canvas.height = viewport.height; await page.render({ canvasContext: this.canvas.getContext("2d", { alpha: false }), viewport }).promise;
    const content = await page.getTextContent(); this.textItems = (content.items || []).map((item) => { const tx = this.pdfjs.Util.transform(viewport.transform, item.transform), h = Math.max(2, Math.hypot(tx[2], tx[3])); return { text: item.str, x: tx[4], y: tx[5] - h, w: Math.max(2, item.width * scale), h }; }).filter((item) => item.text.trim());
    this.source = this.textItems.length >= 3 ? "pdf-text" : "pdf-scan";
  }
  updateZoomValue() {
    this.zoomValue.textContent = `${Math.round(this.scanZoom * 100)}%`;
  }
  changeZoom(delta) {
    this.scanZoom = Math.min(3, Math.max(0.5, Math.round((this.scanZoom + delta) * 100) / 100));
    this.updateZoomValue();
    this.layoutDocument();
  }
  layoutDocument() {
    if (this.stage.hidden || !this.canvas.width) return;
    const availableWidth = Math.max(240, this.stage.clientWidth - 36);
    const fittedWidth = Math.min(this.canvas.width, availableWidth);
    const displayWidth = Math.max(120, fittedWidth * this.scanZoom);
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayWidth * this.canvas.height / this.canvas.width}px`;
    requestAnimationFrame(() => this.syncOverlay());
  }
  syncOverlay() {
    if (this.stage.hidden) return; const canvas = this.canvas.getBoundingClientRect(), stage = this.stage.getBoundingClientRect();
    Object.assign(this.overlay.style, { left: `${canvas.left - stage.left + this.stage.scrollLeft}px`, top: `${canvas.top - stage.top + this.stage.scrollTop}px`, width: `${canvas.width}px`, height: `${canvas.height}px`, transform: "none" });
  }
  drawBoxes() {
    this.syncOverlay(); this.overlay.replaceChildren(); this.boxes.clear(); this.selected.clear(); const indexes = branchIndexes(this.start), rects = defaultRects(indexes, this.start);
    for (const index of indexes) {
      const box = document.createElement("div"); box.className = "fp-scan-box"; box.dataset.index = index; box.innerHTML = `<span>${index}</span><button class="fp-scan-resize" type="button"></button>`; setRect(box, rects.get(index)); this.enable(box); this.overlay.append(box); this.boxes.set(index, box);
    }
  }
  enable(box) {
    box.addEventListener("pointerdown", (event) => {
      event.preventDefault(); const index = Number(box.dataset.index), resize = event.target.classList.contains("fp-scan-resize");
      if (event.shiftKey || event.ctrlKey) this.selected.has(index) ? this.selected.delete(index) : this.selected.add(index); else if (!this.selected.has(index)) { this.selected.clear(); this.selected.add(index); }
      for (const [i, item] of this.boxes) item.classList.toggle("is-selected", this.selected.has(i)); if (!this.selected.size) return;
      const area = this.overlay.getBoundingClientRect(), startX = event.clientX, startY = event.clientY, originals = new Map([...this.selected].map((i) => [i, rectOf(this.boxes.get(i))])); box.setPointerCapture(event.pointerId);
      const move = (e) => { const dx = (e.clientX - startX) / area.width * 100, dy = (e.clientY - startY) / area.height * 100; for (const [i, original] of originals) setRect(this.boxes.get(i), resize ? { ...original, w: original.w + dx, h: original.h + dy } : { ...original, x: original.x + dx, y: original.y + dy }); };
      const up = () => { box.removeEventListener("pointermove", move); box.removeEventListener("pointerup", up); };
      box.addEventListener("pointermove", move); box.addEventListener("pointerup", up);
    });
  }
  textFor(box) {
    const r = rectOf(box), pixel = { x: r.x / 100 * this.canvas.width, y: r.y / 100 * this.canvas.height, w: r.w / 100 * this.canvas.width, h: r.h / 100 * this.canvas.height };
    return this.textItems.filter((item) => item.x + item.w / 2 >= pixel.x && item.x + item.w / 2 <= pixel.x + pixel.w && item.y + item.h / 2 >= pixel.y && item.y + item.h / 2 <= pixel.y + pixel.h).sort((a, b) => Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x).map((item) => item.text).join("\n");
  }
  crop(box) {
    const r = rectOf(box), x = r.x / 100 * this.canvas.width, y = r.y / 100 * this.canvas.height, w = r.w / 100 * this.canvas.width, h = r.h / 100 * this.canvas.height;
    const crop = document.createElement("canvas"); crop.width = Math.max(8, w); crop.height = Math.max(8, h); crop.getContext("2d").drawImage(this.canvas, x, y, w, h, 0, 0, crop.width, crop.height); return crop.toDataURL("image/jpeg", .9).split(",")[1];
  }
  async ocr(crops) {
    if (!this.authenticated && usage() >= LIMIT) throw new Error(this.tr("Limite gratuite de 2 documents OCR atteinte. Les PDF texte restent illimités.", "Free limit of 2 OCR documents reached. Text PDFs remain unlimited."));
    const config = window.MICOLPE_CONFIG; let token = config.supabaseAnonKey;
    if (this.authenticated) { const { supabase } = await import("./supabase-client.js"); token = (await supabase.auth.getSession()).data.session?.access_token || token; }
    const response = await fetch(`${config.supabaseUrl}/functions/v1/fast-pedigree-ocr`, { method: "POST", headers: { "Content-Type": "application/json", apikey: config.supabaseAnonKey, Authorization: `Bearer ${token}` }, body: JSON.stringify({ crops }) });
    const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "OCR unavailable"); if (!this.authenticated) increment(); return payload.results || [];
  }
  async run() {
    const button = this.modal.querySelector("#fp-scan-run"); const idleLabel = button.textContent; button.disabled = true; button.textContent = this.tr("Scan en cours…", "Scanning…");
    try {
      const indexes = [...this.boxes.keys()];
      const texts = new Map(indexes.map((index) => [index, ""]));
      if (this.source === "pdf-text") {
        this.setProgress(this.tr(`Lecture locale de ${indexes.length} case(s)…`, `Reading ${indexes.length} box(es) locally…`), "info", true);
        for (const [i, box] of this.boxes) texts.set(i, this.textFor(box));
      } else {
        this.setProgress(this.tr(`Reconnaissance sécurisée de ${indexes.length} case(s) en cours…`, `Secure recognition of ${indexes.length} box(es) in progress…`), "info", true);
        const results = await this.ocr([...this.boxes].map(([index, box]) => ({ index, image: this.crop(box) })));
        for (const result of results) texts.set(Number(result.index), result.text || "");
      }
      this.setProgress(this.tr("Analyse des bagues détectées…", "Analyzing detected rings…"), "info", true);
      const parsed = {}; let recognized = 0;
      for (const [index, text] of texts) {
        parsed[index] = parsePigeonText(text, index, this.rootGender());
        if (parsed[index].ring) recognized += 1;
      }
      if (!recognized) throw new Error(this.tr("Aucune bague reconnue. Ajustez les cadres puis relancez le scan.", "No ring recognized. Adjust the boxes, then scan again."));
      const missingIndexes = indexes.filter((index) => !parsed[index].ring);
      this.onApply(parsed, { indexes, missingIndexes, recognized, total: indexes.length });
      this.setProgress(this.tr(`Scan terminé : ${recognized}/${indexes.length} case(s) détectée(s).`, `Scan complete: ${recognized}/${indexes.length} box(es) detected.`), "success");
      this.close();
      this.onStatus(
        missingIndexes.length
          ? this.tr(`Scan terminé : ${recognized}/${indexes.length} case(s) détectée(s). Complétez manuellement les cases orange non reconnues.`, `Scan complete: ${recognized}/${indexes.length} box(es) detected. Manually complete the unrecognized orange boxes.`)
          : this.tr(`Scan terminé : les ${recognized} case(s) ont été détectées.`, `Scan complete: all ${recognized} box(es) were detected.`),
        missingIndexes.length ? "info" : "success",
      );
    } catch (error) {
      this.setProgress(error.message, "error");
      this.onStatus(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = idleLabel;
    }
  }
}
