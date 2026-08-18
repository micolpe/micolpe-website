import { branchIndexes, generationOf, parsePigeonText } from "./fast-pedigree-core.js?v=20260819-2";

const LIMIT = 2;
const usage = () => { try { const data = JSON.parse(localStorage.getItem("micolpe-fp-ocr") || "{}"); return data.day === new Date().toISOString().slice(0, 10) ? Number(data.count || 0) : 0; } catch { return 0; } };
const increment = () => localStorage.setItem("micolpe-fp-ocr", JSON.stringify({ day: new Date().toISOString().slice(0, 10), count: usage() + 1 }));
const rectOf = (box) => Object.fromEntries(["x", "y", "w", "h"].map((key) => [key, Number(box.dataset[key])]));
const retryableError = (message, retryable = true) => Object.assign(new Error(message), { retryable });

export function explainOcrFailure(status, payload = {}, lang = "fr", authenticated = false) {
  const tr = (fr, en) => lang === "en" ? en : fr;
  const raw = String(payload?.error || payload?.message || payload?.details || "").toLowerCase();
  if (status === 401 || status === 403) {
    return {
      retryable: false,
      message: authenticated
        ? tr("Votre session n’est plus valide. Reconnectez-vous, revenez au scanner, puis relancez le scan.", "Your session is no longer valid. Sign in again, return to the scanner, then start the scan again.")
        : tr("L’accès au service OCR a été refusé. Rechargez la page puis réessayez. Si le problème continue, contactez le support Micolpe.", "Access to the OCR service was denied. Reload the page and try again. If the issue continues, contact Micolpe support."),
    };
  }
  if (status === 413 || /too large|payload|size limit/.test(raw)) {
    return {
      retryable: true,
      message: tr("Le document envoyé est trop volumineux pour le service OCR. Réduisez le nombre de générations ou scannez une branche plus courte, puis cliquez sur « Réessayer le scan ».", "The uploaded document is too large for the OCR service. Reduce the number of generations or scan a shorter branch, then click “Retry scan”."),
    };
  }
  if (status === 429 || /rate|quota|too many/.test(raw)) {
    return {
      retryable: true,
      message: tr("Le service OCR a reçu trop de demandes. Patientez une minute sans fermer ce document, puis cliquez sur « Réessayer le scan ».", "The OCR service received too many requests. Wait one minute without closing this document, then click “Retry scan”."),
    };
  }
  if ([400, 415, 422].includes(status) || /no text|empty|invalid image|decode|unreadable/.test(raw)) {
    return {
      retryable: true,
      message: tr("Une ou plusieurs zones n’ont pas pu être lues : cadre hors du texte, zone trop petite ou image insuffisamment nette. Replacez les cadres rouges sur les cases puis cliquez sur « Réessayer le scan ».", "One or more areas could not be read: a box may be outside the text, too small, or the image may be unclear. Reposition the red boxes over the pedigree boxes, then click “Retry scan”."),
    };
  }
  return {
    retryable: true,
    message: tr("Le service OCR a rencontré une erreur temporaire pendant le traitement. Votre document est toujours ouvert : vérifiez les cadres rouges puis cliquez sur « Réessayer le scan ».", "The OCR service encountered a temporary processing error. Your document is still open: check the red boxes, then click “Retry scan”."),
  };
}
function setRect(box, rect) {
  const next = { x: Math.max(0, Math.min(98, rect.x)), y: Math.max(0, Math.min(98, rect.y)), w: Math.max(2, rect.w), h: Math.max(2, rect.h) };
  next.w = Math.min(next.w, 100 - next.x); next.h = Math.min(next.h, 100 - next.y);
  for (const [key, value] of Object.entries(next)) box.dataset[key] = String(value);
  Object.assign(box.style, { left: `${next.x}%`, top: `${next.y}%`, width: `${next.w}%`, height: `${next.h}%` });
}
export function defaultRects(indexes, start) {
  const first = generationOf(start), last = Math.max(...indexes.map(generationOf)), columns = last - first + 1, result = new Map();
  for (let gen = first; gen <= last; gen += 1) {
    const list = indexes.filter((index) => generationOf(index) === gen);
    const rowCount = gen === first ? 2 : list.length;
    const gap = Math.min(1, 12 / rowCount);
    const height = (94 - gap * (rowCount - 1)) / rowCount;
    list.forEach((index, position) => result.set(index, {
      x: 3 + (gen - first) * 94 / columns,
      y: gen === first ? 50 - height / 2 : 3 + position * (height + gap),
      w: 94 / columns - 1,
      h: height,
    }));
  }
  return result;
}
async function loadImage(file) {
  const url = URL.createObjectURL(file); const image = new Image(); image.src = url; await image.decode(); URL.revokeObjectURL(url); return image;
}

export function groupPdfTextLines(items) {
  const ordered = [...items]
    .filter((item) => String(item?.text || "").trim())
    .sort((a, b) => {
      const verticalTolerance = Math.max(3, Math.min(Number(a.h) || 0, Number(b.h) || 0) * 0.6);
      return Math.abs((a.y || 0) - (b.y || 0)) > verticalTolerance ? (a.y || 0) - (b.y || 0) : (a.x || 0) - (b.x || 0);
    });
  const lines = [];
  for (const item of ordered) {
    const center = (Number(item.y) || 0) + (Number(item.h) || 0) / 2;
    const previous = lines.at(-1);
    const tolerance = Math.max(3, Math.min(Number(item.h) || 0, previous?.height || 0) * 0.6);
    if (previous && Math.abs(center - previous.center) <= tolerance) {
      previous.items.push(item);
      previous.center = (previous.center * (previous.items.length - 1) + center) / previous.items.length;
      previous.height = Math.max(previous.height, Number(item.h) || 0);
    } else {
      lines.push({ center, height: Number(item.h) || 0, items: [item] });
    }
  }
  return lines.map((line) => line.items
    .sort((a, b) => (a.x || 0) - (b.x || 0))
    .map((item) => String(item.text || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim());
}

export class FastPedigreeScanner {
  constructor({ modal, lang, authenticated, rootGender, onApply, onStatus }) {
    Object.assign(this, { modal, lang, authenticated, rootGender, onApply, onStatus });
    this.canvas = modal.querySelector("#fp-scan-canvas"); this.stage = modal.querySelector("#fp-scan-stage"); this.overlay = modal.querySelector("#fp-scan-overlay");
    this.fileInput = modal.querySelector("#fp-scan-file"); this.progress = modal.querySelector("#fp-scan-progress");
    this.zoomValue = modal.querySelector("#fp-scan-zoom-value"); this.boxes = new Map(); this.selected = new Set(); this.textItems = []; this.source = "image"; this.start = 1; this.maxGeneration = 5; this.scanZoom = 1;
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
  scanIndexes() {
    return branchIndexes(this.start, this.maxGeneration);
  }
  open(index, chooseFile = false, maxGeneration = 5) {
    this.start = Number(index);
    this.maxGeneration = Math.min(5, Math.max(generationOf(this.start), Number(maxGeneration) || 5));
    const indexes = this.scanIndexes();
    this.modal.hidden = false; document.body.classList.add("fp-modal-open"); this.fileInput.value = "";
    this.scanZoom = 1; this.updateZoomValue(); this.setProgress(this.tr("Choisissez un document pour commencer le scan.", "Choose a document to start scanning."));
    this.modal.querySelector("#fp-scan-branch-count").textContent = this.tr(`${indexes.length} cases selon les générations affichées`, `${indexes.length} boxes based on the displayed generations`);
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
    this.syncOverlay(); this.overlay.replaceChildren(); this.boxes.clear(); this.selected.clear(); const indexes = this.scanIndexes(), rects = defaultRects(indexes, this.start);
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
    const items = this.textItems.filter((item) => item.x + item.w / 2 >= pixel.x && item.x + item.w / 2 <= pixel.x + pixel.w && item.y + item.h / 2 >= pixel.y && item.y + item.h / 2 <= pixel.y + pixel.h);
    return groupPdfTextLines(items).join("\n");
  }
  crop(box) {
    const r = rectOf(box), x = r.x / 100 * this.canvas.width, y = r.y / 100 * this.canvas.height, w = r.w / 100 * this.canvas.width, h = r.h / 100 * this.canvas.height;
    const crop = document.createElement("canvas"); crop.width = Math.max(8, w); crop.height = Math.max(8, h); crop.getContext("2d").drawImage(this.canvas, x, y, w, h, 0, 0, crop.width, crop.height); return crop.toDataURL("image/jpeg", .9).split(",")[1];
  }
  async ocr(crops) {
    if (!this.authenticated && usage() >= LIMIT) throw retryableError(this.tr("Limite gratuite de 2 documents OCR atteinte. Les PDF texte restent illimités.", "Free limit of 2 OCR documents reached. Text PDFs remain unlimited."), false);
    const config = window.MICOLPE_CONFIG; let token = config.supabaseAnonKey;
    if (this.authenticated) { const { supabase } = await import("./supabase-client.js"); token = (await supabase.auth.getSession()).data.session?.access_token || token; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    let response;
    try {
      response = await fetch(`${config.supabaseUrl}/functions/v1/fast-pedigree-ocr`, { method: "POST", headers: { "Content-Type": "application/json", apikey: config.supabaseAnonKey, Authorization: `Bearer ${token}` }, body: JSON.stringify({ crops }), signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") throw retryableError(this.tr("Le traitement OCR a dépassé 90 secondes. Le document reste ouvert : cliquez sur « Réessayer le scan ».", "OCR processing exceeded 90 seconds. The document remains open: click “Retry scan”."));
      throw retryableError(this.tr("La connexion au service OCR a été interrompue. Vérifiez votre connexion Internet puis cliquez sur « Réessayer le scan ».", "The connection to the OCR service was interrupted. Check your Internet connection, then click “Retry scan”."));
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn("Fast Pedigree OCR request failed", { status: response.status, error: payload?.error || payload?.message || "unknown" });
      const explained = explainOcrFailure(response.status, payload, this.lang, this.authenticated);
      throw retryableError(explained.message, explained.retryable);
    }
    if (!this.authenticated) increment(); return payload.results || [];
  }
  async run() {
    const button = this.modal.querySelector("#fp-scan-run"); const idleLabel = button.textContent; button.disabled = true; button.textContent = this.tr("Scan en cours…", "Scanning…");
    let failure = null;
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
      failure = error;
      const message = error?.message || this.tr("Le scan n’a pas pu être terminé. Corrigez le cadrage puis réessayez.", "The scan could not be completed. Adjust the boxes and try again.");
      this.setProgress(message, "error");
      this.onStatus(message, "error");
    } finally {
      button.disabled = false;
      button.textContent = failure?.retryable === false ? idleLabel : failure ? this.tr("Réessayer le scan", "Retry scan") : idleLabel;
      if (failure?.retryable !== false) requestAnimationFrame(() => button.focus({ preventScroll: true }));
    }
  }
}
