import {
  FONT_FAMILIES,
  NODE_COUNT,
  adaptiveFirstGenerationHeights,
  branchIndexes,
  clearBranch,
  createPedigree,
  genderFor,
  hasFilledDescendants,
  intermediateMissingIndexes,
  parseRing,
  proportionalGenerationHeight,
  restoreTemporaryState,
  serializeTemporaryState,
  visibleGeneration,
} from "./fast-pedigree-core.js?v=20260814-14";
import {
  exportPreviewImage,
  exportPreviewPdf,
  renderPreview,
  sharePreview,
} from "./fast-pedigree-renderer.js?v=20260814-14";
import { FastPedigreeScanner } from "./fast-pedigree-scan.js?v=20260814-14";

const root = document.querySelector("#fast-pedigree-app");
const lang = root.dataset.lang === "en" ? "en" : "fr";
const authenticated = root.dataset.mode === "user";
const tr = (fr, en) => (lang === "en" ? en : fr);
const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const state = {
  lang,
  authenticated,
  nodes: createPedigree(),
  selected: 1,
  editorGenerations: 5,
  editorZoom: 1,
  previewZoom: 1,
  adapter: null,
  objectUrls: new Set(),
  scanMissing: new Set(),
  preview: {
    generations: "auto",
    font: "roboto",
    title: "Pigeon Pedigree",
    colorTitle: "#606060",
    colorLine: "#17253f",
    colorRing: "#c91e2e",
    colorName: "#111111",
    colorFancier: "#174ca0",
    colorColor: "#8b4513",
    radius: 8,
    withShadow: true,
    withSeparator: true,
    withDate: true,
    withPhoto: true,
    withBarcode: false,
    logoUrl: "",
    photoUrl: "",
    qrUrl: "",
    identityName: "",
    identityEmail: "",
    identityPhone: "",
    identityAddress: "",
    identityWebsite: "",
    identitySocial: "",
  },
};

const el = Object.fromEntries(
  [
    "editor-tree",
    "editor-generations",
    "editor-zoom-out",
    "editor-zoom-in",
    "editor-zoom-value",
    "root-gender",
    "selected-frame-color",
    "scan-selected",
    "clear-branch",
    "status",
    "paper",
    "paper-stage",
    "preview-zoom-out",
    "preview-zoom-in",
    "preview-zoom-value",
    "preview-controls",
    "pigeon-select",
    "user-loading",
  ].map((id) => [id, document.querySelector(`#fp-${id}`)]),
);

function status(message, type = "info") {
  el.status.textContent = message;
  el.status.dataset.type = type;
  el.status.hidden = false;
  clearTimeout(status.timer);
  status.timer = setTimeout(() => {
    el.status.hidden = true;
  }, type === "error" ? 8000 : 4500);
}

function busy(value) {
  root.classList.toggle("is-busy", value);
  root.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = value;
  });
}

function relation(index) {
  if (index === 1) return tr("Pigeon central", "Central pigeon");
  const path = [];
  while (index > 1) {
    path.unshift(index % 2 === 0 ? tr("Père", "Father") : tr("Mère", "Mother"));
    index = Math.floor(index / 2);
  }
  return path.join(" › ");
}

const symbol = (gender) => (gender === "M" ? "♂" : gender === "F" ? "♀" : "•");

function saveDraft() {
  if (authenticated) return;
  sessionStorage.setItem(
    "micolpe-fp-draft",
    JSON.stringify({
      nodes: serializeTemporaryState(state.nodes),
      preview: {
        ...state.preview,
        logoUrl: "",
        photoUrl: "",
        withBarcode: false,
        qrUrl: "",
      },
      selected: state.selected,
      editorGenerations: state.editorGenerations,
      editorZoom: state.editorZoom,
      previewZoom: state.previewZoom,
    }),
  );
}

function loadDraft() {
  if (authenticated) return;
  try {
    const draft = JSON.parse(sessionStorage.getItem("micolpe-fp-draft") || "null");
    if (!draft) return;
    state.nodes = restoreTemporaryState(draft.nodes, draft.nodes?.[1]?.gender);
    const restoredPreview = { ...draft.preview };
    if (restoredPreview.title === "Pedigree") restoredPreview.title = "Pigeon Pedigree";
    state.preview = {
      ...state.preview,
      ...restoredPreview,
      withBarcode: false,
      qrUrl: "",
    };
    state.selected = draft.selected || 1;
    state.editorGenerations = draft.editorGenerations || 5;
    state.editorZoom = Number(draft.editorZoom) || 1;
    state.previewZoom = Number(draft.previewZoom) || 1;
  } catch {}
}

function editorNodeHtml(node, index) {
  const gender = genderFor(index, state.nodes[1].gender);
  const invalid = node.invalid || (node.ring && !parseRing(node.ring));
  const placeholders = lang === "en"
    ? ["Ring", "Pigeon name", "Fancier", "Color", "Details / achievements"]
    : ["Bague", "Nom du pigeon", "Éleveur", "Couleurs", "Détails / performances"];
  const field = (number, name, value, maxLength) =>
    `<label class="fp-node-line"><span>${number}.</span><input data-field="${name}"${name === "ring" ? ` data-preserved-ring="${esc(value)}"` : ""} value="${esc(value)}" maxlength="${maxLength}" placeholder="${placeholders[number - 1]}" aria-label="${placeholders[number - 1]}"></label>`;

  return `<article class="fp-editor-node${index === state.selected ? " is-selected" : ""}${!node.ring ? " is-empty" : ""}${invalid ? " is-invalid" : ""}${state.scanMissing.has(index) && !node.ring ? " is-scan-missing" : ""}"
    data-index="${index}" style="--fp-editor-node-fill:${esc(node.frameColor || "#ffffff")}" aria-label="${esc(relation(index))}">
    <div class="fp-editor-node-meta"><span class="fp-node-index">${index}</span><strong>${esc(relation(index))}</strong><span class="fp-node-gender">${symbol(gender)}</span></div>
    ${field(1, "ring", node.ring, 50)}
    ${field(2, "name", node.name, 100)}
    ${field(3, "fancier", node.fancier, 100)}
    ${field(4, "color", node.color, 50)}
    <label class="fp-node-line fp-node-details"><span>5.</span><textarea data-field="details" placeholder="${placeholders[4]}" aria-label="${placeholders[4]}">${esc(node.details)}</textarea></label>
  </article>`;
}

function layoutEditorTree(level) {
  const leafHeight = 88;
  const gap = 6;
  const referenceLevel = 5;
  const rows = 2 ** (referenceLevel - 1);
  const grandparentHeight = proportionalGenerationHeight(3, { referenceLevel, leafHeight, gap });
  const heights = adaptiveFirstGenerationHeights(state.nodes, {
    baseHeight: grandparentHeight,
    lineHeight: 14,
    charsPerLine: 27,
    minimumExpansion: 44,
  });
  el["editor-tree"].style.height = `${rows * leafHeight + (rows - 1) * gap + 28}px`;
  el["editor-tree"].style.zoom = String(state.editorZoom);

  el["editor-tree"].querySelectorAll(".fp-editor-node").forEach((nodeElement) => {
    const index = Number(nodeElement.dataset.index);
    const generation = Math.floor(Math.log2(index)) + 1;
    const ordinal = index - 2 ** (generation - 1);
    const span = 2 ** (referenceLevel - generation);
    const centerRow = ordinal * span + (span - 1) / 2;
    const naturalHeight = proportionalGenerationHeight(generation, { referenceLevel, leafHeight, gap });
    const height = generation === 1 ? heights.root : generation === 2 ? heights.parents : naturalHeight;
    const center = centerRow * (leafHeight + gap) + leafHeight / 2 + 14;
    nodeElement.style.height = `${height}px`;
    nodeElement.style.top = `${center - height / 2}px`;
  });
}

function renderTree() {
  const level = visibleGeneration(state.editorGenerations, state.nodes);
  el["editor-tree"].replaceChildren();
  for (let generation = 1; generation <= level; generation += 1) {
    const column = document.createElement("section");
    column.className = "fp-editor-generation";
    column.dataset.generation = generation;
    for (let index = 2 ** (generation - 1); index <= Math.min(NODE_COUNT, 2 ** generation - 1); index += 1) {
      column.insertAdjacentHTML("beforeend", editorNodeHtml(state.nodes[index], index));
    }
    el["editor-tree"].append(column);
  }
  layoutEditorTree(level);
}

function renderBottomControls() {
  el["root-gender"].value = state.nodes[1].gender || "?";
  el["selected-frame-color"].value = state.nodes[state.selected].frameColor || "#ffffff";
  el["scan-selected"].textContent = tr("Scanner un pedigree", "Scan a pedigree");
  el["clear-branch"].title = tr(`Vider la branche de la case ${state.selected}`, `Clear the branch of box ${state.selected}`);
}

function applyZoom() {
  const editorPercent = Math.round(state.editorZoom * 100);
  const previewPercent = Math.round(state.previewZoom * 100);
  el["editor-zoom-value"].textContent = `${editorPercent}%`;
  el["preview-zoom-value"].textContent = `${previewPercent}%`;
  el["editor-tree"].style.zoom = String(state.editorZoom);
  el["paper-stage"].style.width = `${previewPercent}%`;
  el["paper-stage"].style.minWidth = `${540 * state.previewZoom}px`;
  el.paper.style.width = `${100 / state.previewZoom}%`;
  el.paper.style.minWidth = "540px";
  el.paper.style.transform = `scale(${state.previewZoom})`;
  el.paper.dataset.displayZoom = String(state.previewZoom);
}

function changeZoom(kind, delta) {
  const key = kind === "editor" ? "editorZoom" : "previewZoom";
  const minimum = kind === "editor" ? 0.6 : 0.5;
  const maximum = kind === "editor" ? 1.6 : 1.5;
  state[key] = Math.min(maximum, Math.max(minimum, Math.round((state[key] + delta) * 10) / 10));
  applyZoom();
  saveDraft();
}

function select(index) {
  state.selected = Number(index);
  el["editor-tree"].querySelectorAll(".fp-editor-node.is-selected").forEach((item) => item.classList.remove("is-selected"));
  el["editor-tree"].querySelector(`.fp-editor-node[data-index="${state.selected}"]`)?.classList.add("is-selected");
  renderBottomControls();
  saveDraft();
}

function refreshNodeState(index) {
  const node = state.nodes[index];
  const nodeElement = el["editor-tree"].querySelector(`.fp-editor-node[data-index="${index}"]`);
  if (!nodeElement) return;
  nodeElement.classList.toggle("is-empty", !node.ring);
  nodeElement.classList.toggle("is-invalid", Boolean(node.ring) && !parseRing(node.ring));
  nodeElement.classList.toggle("is-scan-missing", state.scanMissing.has(index) && !node.ring);
}

function markParentRelationDirty(index) {
  const parentIndex = Math.floor(Number(index) / 2);
  if (parentIndex >= 1 && state.nodes[parentIndex]) state.nodes[parentIndex].relationsDirty = true;
}

function updateInlineNode(event) {
  const input = event.target.closest("[data-field]");
  if (!input) return;
  const nodeElement = input.closest(".fp-editor-node");
  const index = Number(nodeElement.dataset.index);
  const node = state.nodes[index];
  const field = input.dataset.field;
  const previousValue = node[field];
  select(index);
  if (field === "ring" && !input.value.trim() && input.dataset.preservedRing && hasFilledDescendants(state.nodes, index)) {
    node.ring = input.dataset.preservedRing;
    node.invalid = false;
    input.value = input.dataset.preservedRing;
    refreshNodeState(index);
    status(tr(
      "Impossible de vider cette bague : des pigeons sont renseignés dans sa branche. Utilisez « Vider la branche » pour les supprimer ensemble.",
      "This ring cannot be cleared because its branch contains pigeons. Use “Clear branch” to remove them together.",
    ), "error");
    return;
  }
  node[field] = input.value;
  node.dirty = true;
  if (field === "ring" && input.value !== previousValue) markParentRelationDirty(index);

  if (field === "ring") {
    const parsed = parseRing(input.value);
    node.invalid = Boolean(input.value) && !parsed;
    if (input.value.trim()) state.scanMissing.delete(index);
    if (event.type === "change" && parsed) {
      Object.assign(node, parsed, { invalid: false });
      input.value = node.ring;
      input.dataset.preservedRing = node.ring;
    }
  }

  refreshNodeState(index);
  layoutEditorTree(visibleGeneration(state.editorGenerations, state.nodes));
  renderPaper();
  saveDraft();
}

function updateRootGender() {
  state.nodes[1].gender = el["root-gender"].value;
  state.nodes[1].dirty = true;
  for (let index = 2; index <= NODE_COUNT; index += 1) {
    state.nodes[index].gender = genderFor(index, state.nodes[1].gender);
  }
  renderTree();
  renderBottomControls();
  renderPaper();
  saveDraft();
}

function updateSelectedFrameColor() {
  const node = state.nodes[state.selected];
  node.frameColor = el["selected-frame-color"].value;
  node.dirty = true;
  const nodeElement = el["editor-tree"].querySelector(`.fp-editor-node[data-index="${state.selected}"]`);
  nodeElement?.style.setProperty("--fp-editor-node-fill", node.frameColor);
  renderPaper();
  saveDraft();
}

function renderPaper() {
  renderPreview(el.paper, state);
}

function syncControls() {
  for (const input of el["preview-controls"].querySelectorAll("[name]")) {
    const value = state.preview[input.name];
    input.type === "checkbox" ? (input.checked = Boolean(value)) : (input.value = value ?? "");
  }
  document.querySelector("#fp-preview-radius-value").textContent = `${state.preview.radius}px`;
}

function updatePreview(event) {
  const input = event.target.closest("[name]");
  if (!input) return;
  state.preview[input.name] = input.type === "checkbox" ? input.checked : input.value;
  renderPaper();
  saveDraft();
}

function setImage(key, file) {
  if (!file || file.size > 5 * 1024 * 1024) return status(tr("Image trop volumineuse.", "Image too large."), "error");
  if (state.preview[key]?.startsWith("blob:")) URL.revokeObjectURL(state.preview[key]);
  const url = URL.createObjectURL(file);
  state.objectUrls.add(url);
  state.preview[key] = url;
  renderPaper();
}

function renderAll() {
  el["editor-generations"].value = state.editorGenerations;
  renderTree();
  renderBottomControls();
  syncControls();
  renderPaper();
  applyZoom();
}

function newPedigree() {
  if (!confirm(tr("Effacer le brouillon et créer un nouveau pedigree ?", "Clear the draft and create a new pedigree?"))) return;
  state.nodes = createPedigree();
  state.scanMissing.clear();
  state.selected = 1;
  renderAll();
  saveDraft();
}

function eraseBranch() {
  const count = branchIndexes(state.selected).length;
  if (!confirm(tr(
    `Vider la branche sélectionnée (${count} case(s)) ?`,
    `Clear the selected branch (${count} box(es))?`,
  ))) return;
  state.nodes = clearBranch(state.nodes, state.selected);
  for (const index of branchIndexes(state.selected)) state.scanMissing.delete(index);
  markParentRelationDirty(state.selected);
  renderAll();
  saveDraft();
}

function applyScan(parsed, scanResult = {}) {
  for (const [rawIndex, scanned] of Object.entries(parsed)) {
    const index = Number(rawIndex);
    const existing = state.nodes[index];
    if (scanned.ring) {
      if (scanned.ring !== existing.ring) markParentRelationDirty(index);
      state.nodes[index] = {
        ...existing,
        ...scanned,
        id: existing.id,
        loftPigeonId: existing.loftPigeonId,
        isCreator: existing.isCreator,
        originalState: existing.originalState,
        frameColor: existing.frameColor,
      };
    }
  }
  state.scanMissing = new Set(
    (scanResult.missingIndexes || []).filter((index) => !state.nodes[index]?.ring),
  );
  renderAll();
  saveDraft();
}

async function exportFile(type) {
  busy(true);
  try {
    type === "pdf" ? await exportPreviewPdf(el.paper, state.nodes) : await exportPreviewImage(el.paper, state.nodes, type);
    status(tr("Export A4 créé.", "A4 export created."), "success");
  } catch (error) {
    status(error.message, "error");
  } finally {
    busy(false);
  }
}

function databasePreview(settings, loft, profile) {
  const key = Object.keys(FONT_FAMILIES).find((item) => item === settings?.font || FONT_FAMILIES[item].label.toLowerCase() === String(settings?.font || "").toLowerCase()) || "roboto";
  const storedTitle = String(settings?.header || "").trim();
  return {
    ...state.preview,
    generations: settings?.level_gen || "auto",
    font: key,
    title: !storedTitle || storedTitle === "Pedigree" ? "Pigeon Pedigree" : storedTitle,
    colorTitle: settings?.color_title || "#606060",
    colorLine: settings?.color_line || "#17253f",
    colorRing: settings?.color_ring || "#c91e2e",
    colorName: settings?.color_name || "#111",
    colorFancier: settings?.color_fancier || "#174ca0",
    colorColor: settings?.color_color || "#8b4513",
    radius: settings?.radius ?? 8,
    withShadow: settings?.with_shadow ?? true,
    withSeparator: settings?.with_separator ?? true,
    withDate: settings?.with_date ?? true,
    withPhoto: settings?.with_photo ?? true,
    withBarcode: settings?.with_barcode ?? false,
    logoUrl: settings?.with_logo ? loft.logo || "" : "",
    identityName: settings?.with_loftname === false ? "" : loft.nameloft || profile.name || "",
    identityEmail: settings?.with_email === false ? "" : loft.email || profile.email || "",
    identityPhone: settings?.with_phone === false ? "" : loft.phone || "",
    identityAddress: settings?.with_address === false ? "" : loft.addressloft || "",
    identityWebsite: settings?.with_website === false ? "" : loft.website || "",
  };
}

function populate(pigeons) {
  el["pigeon-select"].replaceChildren(new Option(tr("Nouveau pedigree", "New pedigree"), ""));
  for (const pigeon of pigeons) {
    el["pigeon-select"].add(new Option([pigeon.ring, pigeon.membership?.custom_name || pigeon.name_pigeon].filter(Boolean).join(" — "), pigeon.id));
  }
}

async function loadPigeon(id) {
  if (!id) {
    state.nodes = createPedigree();
    state.scanMissing.clear();
    state.preview.qrUrl = "";
    return renderAll();
  }
  busy(true);
  try {
    state.nodes = await state.adapter.loadPedigree(id);
    state.scanMissing.clear();
    state.selected = 1;
    state.preview.photoUrl = state.nodes[1].photo || "";
    state.preview.qrUrl = await state.adapter.verificationUrl(id);
    renderAll();
    status(tr("Pedigree chargé depuis le serveur.", "Pedigree loaded from server."), "success");
  } catch (error) {
    status(error.message, "error");
  } finally {
    busy(false);
  }
}

async function duplicate(node, choices) {
  const candidate = choices[0];
  return confirm(tr(`Le pigeon ${candidate.ring} existe déjà. Le réutiliser ?`, `Pigeon ${candidate.ring} already exists. Reuse it?`)) ? candidate : null;
}

async function save() {
  const missing = intermediateMissingIndexes(state.nodes);
  const invalid = Object.values(state.nodes).filter((node) => node.ring && !parseRing(node.ring));
  Object.values(state.nodes).forEach((node) => { node.invalid = false; });
  missing.forEach((index) => { state.nodes[index].invalid = true; });
  if (missing.length || invalid.length || !state.nodes[1].ring) {
    renderTree();
    select(missing[0] || invalid[0]?.index || 1);
    el["editor-tree"].querySelector(`.fp-editor-node[data-index="${state.selected}"]`)?.scrollIntoView({ block: "center", inline: "center" });
    const reasons = [];
    if (!state.nodes[1].ring) reasons.push(tr("renseignez la bague du pigeon central", "enter the central pigeon ring"));
    if (missing.length) reasons.push(tr(`complétez les cases intermédiaires ${missing.join(", ")}`, `complete intermediary boxes ${missing.join(", ")}`));
    if (invalid.length) reasons.push(tr("corrigez les bagues invalides", "fix invalid rings"));
    return status(`${tr("Sauvegarde impossible", "Save blocked")} : ${reasons.join(" • ")}.`, "error");
  }
  busy(true);
  try {
    const result = await state.adapter.savePedigree(state.nodes, duplicate);
    state.nodes = result.nodes;
    state.preview.qrUrl = await state.adapter.verificationUrl(state.nodes[1].id);
    populate(state.adapter.pigeons.map((pigeon) => ({ ...pigeon, membership: state.adapter.membershipByPigeon.get(pigeon.id) })));
    el["pigeon-select"].value = state.nodes[1].id;
    renderAll();
    status(tr(`Sauvegarde terminée : ${result.created} créé(s), ${result.updated} mis à jour, ${result.reused} réutilisé(s).`, `Save complete: ${result.created} created, ${result.updated} updated, ${result.reused} reused.`), "success");
  } catch (error) {
    status(error.message, "error");
  } finally {
    busy(false);
  }
}

function bind(scanner) {
  el["editor-tree"].addEventListener("focusin", (event) => {
    const node = event.target.closest(".fp-editor-node");
    if (node) select(node.dataset.index);
  });
  el["editor-tree"].addEventListener("pointerdown", (event) => {
    const node = event.target.closest(".fp-editor-node");
    if (node) select(node.dataset.index);
  });
  el["editor-tree"].addEventListener("input", updateInlineNode);
  el["editor-tree"].addEventListener("change", updateInlineNode);
  el["root-gender"].addEventListener("change", updateRootGender);
  el["selected-frame-color"].addEventListener("input", updateSelectedFrameColor);
  el["preview-controls"].addEventListener("input", updatePreview);
  el["preview-controls"].addEventListener("change", updatePreview);
  el["editor-generations"].addEventListener("change", () => {
    state.editorGenerations = el["editor-generations"].value;
    renderTree();
    renderBottomControls();
    saveDraft();
  });
  el["editor-zoom-out"].addEventListener("click", () => changeZoom("editor", -0.1));
  el["editor-zoom-in"].addEventListener("click", () => changeZoom("editor", 0.1));
  el["preview-zoom-out"].addEventListener("click", () => changeZoom("preview", -0.1));
  el["preview-zoom-in"].addEventListener("click", () => changeZoom("preview", 0.1));
  document.querySelector("#fp-new-pedigree").addEventListener("click", newPedigree);
  el["scan-selected"].addEventListener("click", () => scanner.open(state.selected, true));
  el["clear-branch"].addEventListener("click", eraseBranch);
  document.querySelector("#fp-logo-file").addEventListener("change", (event) => setImage("logoUrl", event.target.files[0]));
  document.querySelector("#fp-photo-file").addEventListener("change", (event) => setImage("photoUrl", event.target.files[0]));
  document.querySelector("#fp-export-pdf").addEventListener("click", () => exportFile("pdf"));
  document.querySelector("#fp-export-png").addEventListener("click", () => exportFile("png"));
  document.querySelector("#fp-export-jpeg").addEventListener("click", () => exportFile("jpeg"));
  document.querySelector("#fp-share").addEventListener("click", async () => {
    try { await sharePreview(el.paper, state.nodes, lang); } catch (error) { status(error.message, "error"); }
  });
  document.querySelector("#fp-save-supabase")?.addEventListener("click", save);
  document.querySelector("#fp-save-settings")?.addEventListener("click", async () => {
    try {
      await state.adapter.saveSettings(state.preview);
      status(tr("Réglages sauvegardés.", "Settings saved."), "success");
    } catch (error) { status(error.message, "error"); }
  });
  el["pigeon-select"]?.addEventListener("change", () => loadPigeon(el["pigeon-select"].value));
  document.querySelectorAll("[data-mobile-panel]").forEach((button) => button.addEventListener("click", () => {
    root.dataset.mobilePanel = button.dataset.mobilePanel;
    document.querySelectorAll("[data-mobile-panel]").forEach((item) => item.classList.toggle("is-active", item === button));
    if (button.dataset.mobilePanel === "preview") {
      requestAnimationFrame(() => requestAnimationFrame(renderPaper));
    }
  }));
}

async function init() {
  loadDraft();
  for (const [key, font] of Object.entries(FONT_FAMILIES)) document.querySelector("#fp-preview-font").add(new Option(font.label, key));
  const scanner = new FastPedigreeScanner({
    modal: document.querySelector("#fp-scan-modal"),
    lang,
    authenticated,
    rootGender: () => state.nodes[1].gender,
    onApply: applyScan,
    onStatus: status,
  });
  bind(scanner);
  renderAll();

  if (!authenticated) return;
  try {
    const { FastPedigreeSupabase } = await import("./fast-pedigree-supabase.js?v=20260814-14");
    state.adapter = new FastPedigreeSupabase(lang);
    const data = await state.adapter.initialize();
    if (!data) return;
    state.preview = databasePreview(data.settings, data.loft, data.profile);
    populate(data.pigeons);
    el["user-loading"].hidden = true;
    const requested = new URLSearchParams(location.search).get("pigeon");
    if (requested && data.pigeons.some((pigeon) => pigeon.id === requested)) {
      el["pigeon-select"].value = requested;
      await loadPigeon(requested);
    } else renderAll();
  } catch (error) {
    if (el["user-loading"]) el["user-loading"].hidden = true;
    status(error.message, "error");
  }
}

window.addEventListener("beforeunload", () => state.objectUrls.forEach((url) => URL.revokeObjectURL(url)));
let previewResizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(previewResizeTimer);
  previewResizeTimer = setTimeout(renderPaper, 120);
});
document.fonts?.ready.then(renderPaper);
init();
