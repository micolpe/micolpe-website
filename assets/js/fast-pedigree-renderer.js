import {
  FONT_FAMILIES,
  adaptiveFirstGenerationHeights,
  adaptivePreviewPixelHeights,
  formatDateDmy,
  genderFor,
  measuredPreviewPixelHeights,
  visibleGeneration,
} from "./fast-pedigree-core.js?v=20260814-15";

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function nodeHtml(node, index, settings) {
  const gender = genderFor(index, node?.gender);
  const empty = !node?.ring;
  return `<article class="fp-paper-node${empty ? " is-empty" : ""}${settings.withSeparator ? " has-separator" : ""}"
    style="--fp-node-fill:${esc(node?.frameColor || "#fff")}">
    <span class="fp-paper-gender is-${gender === "M" ? "male" : gender === "F" ? "female" : "unknown"}">${gender === "M" ? "♂" : gender === "F" ? "♀" : "•"}</span>
    <strong class="fp-paper-ring">${esc(node?.ring || "—")}</strong>
    <span class="fp-paper-name">${esc(node?.name)}</span>
    <span class="fp-paper-fancier">${esc(node?.fancier)}</span>
    <span class="fp-paper-color">${esc(node?.color)}</span>
    <p class="fp-paper-details">${esc(node?.details)}</p>
  </article>`;
}

function setNodePixelHeight(node, height) {
  if (!node) return;
  const value = `${height}px`;
  node.style.height = value;
  node.style.flexBasis = value;
}

function outerHeight(element) {
  const style = window.getComputedStyle(element);
  return element.offsetHeight
    + (Number.parseFloat(style.marginTop) || 0)
    + (Number.parseFloat(style.marginBottom) || 0);
}

function fitPreviewNodeContent(target) {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return;
  target.querySelectorAll(".fp-paper-node").forEach((node) => {
    if (typeof node.querySelector !== "function") return;
    const nodeStyle = window.getComputedStyle(node);
    const availableHeight = node.clientHeight
      - (Number.parseFloat(nodeStyle.paddingTop) || 0)
      - (Number.parseFloat(nodeStyle.paddingBottom) || 0);
    const ring = node.querySelector(".fp-paper-ring");
    const orderedDetails = [
      node.querySelector(".fp-paper-name"),
      node.querySelector(".fp-paper-fancier"),
      node.querySelector(".fp-paper-color"),
    ];
    const details = node.querySelector(".fp-paper-details");
    let usedHeight = ring ? outerHeight(ring) : 0;
    let canShowNext = true;

    for (const element of orderedDetails) {
      if (!element) continue;
      element.hidden = !element.textContent.trim();
      if (element.hidden || !canShowNext) {
        element.hidden = true;
        continue;
      }
      const height = outerHeight(element);
      if (usedHeight + height <= availableHeight) usedHeight += height;
      else {
        element.hidden = true;
        canShowNext = false;
      }
    }

    if (!details) return;
    details.style.height = "";
    details.style.maxHeight = "";
    details.hidden = !details.textContent.trim();
    if (details.hidden || !canShowNext) {
      details.hidden = true;
      return;
    }
    const detailsStyle = window.getComputedStyle(details);
    const lineHeight = Number.parseFloat(detailsStyle.lineHeight) || 8;
    const marginTop = Number.parseFloat(detailsStyle.marginTop) || 0;
    const supportedLines = Math.floor(Math.max(0, availableHeight - usedHeight - marginTop) / lineHeight);
    if (supportedLines < 1) {
      details.hidden = true;
      return;
    }
    const supportedHeight = supportedLines * lineHeight;
    details.style.height = `${supportedHeight}px`;
    details.style.maxHeight = `${supportedHeight}px`;
  });
}

function applyAdaptiveNodePixels(target, heights, renderVersion) {
  if (target.dataset.renderVersion !== renderVersion) return false;
  const generations = target.querySelector?.(".fp-paper-generations");
  const totalHeight = generations?.clientHeight || 0;
  if (!totalHeight) return false;
  const rootNode = target.querySelector('.fp-paper-generation[data-generation="1"] .fp-paper-node');
  const parentNodes = Array.from(target.querySelectorAll('.fp-paper-generation[data-generation="2"] .fp-paper-node'));
  const basePixels = adaptivePreviewPixelHeights(totalHeight, { root: 1, parents: 1, base: 1 }, 3);

  // Reset first so scrollHeight represents the content that really overflows a
  // grandparent-sized box, rather than a height inherited from a previous render.
  setNodePixelHeight(rootNode, basePixels.base);
  parentNodes.forEach((node) => setNodePixelHeight(node, basePixels.base));

  const measured = measuredPreviewPixelHeights(
    totalHeight,
    rootNode?.scrollHeight,
    parentNodes.map((node) => node.scrollHeight),
    3,
  );
  setNodePixelHeight(rootNode, measured.root);
  parentNodes.forEach((node) => setNodePixelHeight(node, measured.parents));
  fitPreviewNodeContent(target);
  return true;
}

export function renderPreview(target, state) {
  const { nodes, preview } = state;
  const level = visibleGeneration(preview.generations, nodes);
  const font = FONT_FAMILIES[preview.font] || FONT_FAMILIES.roboto;
  const renderVersion = String((Number(target.dataset.renderVersion) || 0) + 1);
  target.dataset.renderVersion = renderVersion;
  const heights = adaptiveFirstGenerationHeights(nodes, {
    baseHeight: 100,
    lineHeight: 12,
    charsPerLine: 34,
    minimumExpansion: 28,
  });
  const basePercent = 23.5;
  const parentPercent = Math.min(48, basePercent * heights.parents / heights.base);
  const rootPercent = Math.min(96, parentPercent * 2, basePercent * heights.root / heights.base);

  target.dataset.level = String(level);
  target.classList.toggle("has-node-shadow", Boolean(preview.withShadow));
  for (const [name, value] of Object.entries({
    "--fp-paper-font": font.mono,
    "--fp-paper-mono": font.mono,
    "--fp-title-color": preview.colorTitle,
    "--fp-line-color": preview.colorLine,
    "--fp-ring-color": preview.colorRing,
    "--fp-name-color": preview.colorName,
    "--fp-fancier-color": preview.colorFancier,
    "--fp-pigeon-color": preview.colorColor,
    "--fp-ring-align": "center",
    "--fp-node-radius": `${preview.radius}px`,
    "--fp-root-node-height": `${rootPercent}%`,
    "--fp-parent-node-height": `${parentPercent}%`,
  })) {
    target.style.setProperty(name, value);
  }

  const columns = [];
  for (let generation = 1; generation <= level; generation += 1) {
    const items = [];
    for (let index = 2 ** (generation - 1); index < 2 ** generation; index += 1) {
      items.push(nodeHtml(nodes[index], index, preview));
    }
    columns.push(`<section class="fp-paper-generation" data-generation="${generation}">${items.join("")}</section>`);
  }

  const identity = [
    preview.identityEmail,
    preview.identityPhone,
    preview.identityAddress,
    preview.identityWebsite,
  ].filter(Boolean).join(" • ");
  const date = formatDateDmy(state.now || new Date());
  const showVerificationQr = Boolean(state.authenticated && preview.withBarcode && preview.qrUrl);

  target.innerHTML = `<header class="fp-paper-header">
      <div class="fp-paper-identity">${preview.logoUrl ? `<img class="fp-paper-logo" src="${esc(preview.logoUrl)}" alt="">` : ""}<div><strong>${esc(preview.identityName || "Micolpe")}</strong><span>${esc(identity)}</span></div></div>
      <div class="fp-paper-title"><span>${esc(preview.title)}</span><strong>${esc(nodes[1]?.ring || "")}</strong></div>
    </header>
    <div class="fp-paper-body">${preview.withPhoto && preview.photoUrl ? `<figure class="fp-paper-photo"><img src="${esc(preview.photoUrl)}" alt=""></figure>` : ""}<div class="fp-paper-generations">${columns.join("")}</div></div>
    <footer class="fp-paper-footer"><span>${preview.withDate ? esc(date) : ""}</span><strong>Micolpe • Fast Pedigree</strong><div id="fp-preview-qr" class="fp-paper-qr" ${showVerificationQr ? "" : "hidden"}></div></footer>`;

  if (!applyAdaptiveNodePixels(target, heights, renderVersion) && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => applyAdaptiveNodePixels(target, heights, renderVersion));
  }

  if (showVerificationQr && window.QRCode) {
    new window.QRCode(target.querySelector("#fp-preview-qr"), {
      text: preview.qrUrl,
      width: 56,
      height: 56,
    });
  }
}

const filename = (nodes, ext) =>
  `pedigree-${String(nodes[1]?.ring || "micolpe").replace(/[^a-z0-9_-]+/gi, "-")}.${ext}`;

async function canvasOf(element) {
  await document.fonts?.ready;
  const displayTransform = element.style.transform;
  element.style.transform = "none";
  try {
    return await window.html2canvas(element, {
      scale: 2,
      backgroundColor: "#fff",
      useCORS: true,
      logging: false,
    });
  } finally {
    element.style.transform = displayTransform;
  }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export async function exportPreviewImage(element, nodes, type = "png") {
  const canvas = await canvasOf(element);
  const mime = type === "jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.94));
  const ext = type === "jpeg" ? "jpg" : "png";
  download(blob, filename(nodes, ext));
}

export async function exportPreviewPdf(element, nodes) {
  const canvas = await canvasOf(element);
  const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true });
  const ratio = Math.min(202 / canvas.width, 289 / canvas.height);
  const width = canvas.width * ratio;
  const height = canvas.height * ratio;
  pdf.addImage(
    canvas.toDataURL("image/jpeg", 0.94),
    "JPEG",
    (210 - width) / 2,
    (297 - height) / 2,
    width,
    height,
    undefined,
    "FAST",
  );
  pdf.save(filename(nodes, "pdf"));
}

export async function sharePreview(element, nodes, lang) {
  const canvas = await canvasOf(element);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const file = new File([blob], filename(nodes, "png"), { type: "image/png" });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({
      title: lang === "en" ? "Pigeon pedigree" : "Pedigree du pigeon",
      files: [file],
    });
    return true;
  }
  download(blob, file.name);
  return false;
}
