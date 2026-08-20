export const MAX_GENERATIONS = 5;
export const NODE_COUNT = 31;

export const FONT_FAMILIES = {
  roboto: { label: "Roboto Mono", normal: "FP-Roboto-Mono", mono: "FP-Roboto-Mono" },
  fira: { label: "Fira Code", normal: "FP-Fira", mono: "FP-Fira" },
  ibm_plex: { label: "IBM Plex Mono", normal: "FP-IBM-Plex-Mono", mono: "FP-IBM-Plex-Mono" },
  noto: { label: "Noto Sans Mono", normal: "FP-Noto-Mono", mono: "FP-Noto-Mono" },
  source_sans: { label: "Source Code Pro", normal: "FP-Source-Mono", mono: "FP-Source-Mono" },
  source_serif: { label: "Fira Mono", normal: "FP-Fira-Mono", mono: "FP-Fira-Mono" },
  space: { label: "Space Mono", normal: "FP-Space-Mono", mono: "FP-Space-Mono" },
  share_tech: { label: "Share Tech Mono", normal: "FP-Share-Tech-Mono", mono: "FP-Share-Tech-Mono" },
  ubuntu: { label: "Ubuntu Mono", normal: "FP-Ubuntu-Mono", mono: "FP-Ubuntu-Mono" },
  ubuntu_sans: { label: "Ubuntu Sans Mono", normal: "FP-Ubuntu-Sans-Mono", mono: "FP-Ubuntu-Sans-Mono" },
};

export const generationOf = (index) => Math.floor(Math.log2(Number(index))) + 1;
export const normalizeGender = (value) => {
  const gender = String(value || "").trim().toUpperCase();
  if (["M", "MALE", "MÂLE", "♂"].includes(gender)) return "M";
  if (["F", "FEMALE", "FEMELLE", "♀"].includes(gender)) return "F";
  return "?";
};
export const genderSymbolForStorage = (value) => {
  const gender = normalizeGender(value);
  return gender === "M" ? "♂" : gender === "F" ? "♀" : null;
};
export const genderFor = (index, rootGender = "?") => Number(index) === 1
  ? normalizeGender(rootGender)
  : Number(index) % 2 === 0 ? "M" : "F";

export function pedigreePersistencePlan(node, isNew = !node?.id) {
  const contentChanged = Boolean(node?.dirty);
  const relationsChanged = Boolean(node?.relationsDirty);
  return {
    pigeon: (isNew || contentChanged || relationsChanged) && (isNew || node?.isCreator !== false),
    membership: isNew || contentChanged,
  };
}

export function branchIndexes(startIndex, maxGenerations = MAX_GENERATIONS) {
  const result = [];
  const limit = 2 ** maxGenerations - 1;
  function visit(index) {
    if (index > limit) return;
    result.push(index);
    visit(index * 2);
    visit(index * 2 + 1);
  }
  visit(Number(startIndex));
  return result;
}

export function emptyNode(index, rootGender = "?") {
  return { index, id: null, loftPigeonId: null, ring: "", ring_number: "", ring_year: null,
    ring_suffix: "", country: "", gender: genderFor(index, rootGender), name: "", fancier: "",
    color: "", details: "", frameColor: "#ffffff", photo: "", isOwner: index === 1,
    isCreator: true, originalState: null, originalFatherId: null, originalMotherId: null,
    relationsDirty: false, dirty: false, invalid: false };
}

export function createPedigree(rootGender = "?") {
  return Object.fromEntries(Array.from({ length: NODE_COUNT }, (_, offset) => {
    const index = offset + 1;
    return [index, emptyNode(index, rootGender)];
  }));
}
export const clonePedigree = (nodes) => Object.fromEntries(Object.entries(nodes).map(([i, n]) => [i, { ...n }]));
export function deepestFilledGeneration(nodes) {
  return Object.values(nodes).reduce((deepest, node) => node.ring ? Math.max(deepest, generationOf(node.index)) : deepest, 1);
}
export function visibleGeneration(setting, nodes) {
  return setting === "auto" ? deepestFilledGeneration(nodes) : Math.min(5, Math.max(1, Number(setting) || 5));
}
export function intermediateMissingIndexes(nodes) {
  const invalid = [];
  for (let index = 1; index <= NODE_COUNT; index += 1) {
    if (!nodes[index]?.ring && hasFilledDescendants(nodes, index)) invalid.push(index);
  }
  return invalid;
}
export function hasFilledDescendants(nodes, index) {
  return branchIndexes(index).slice(1).some((child) => Boolean(nodes[child]?.ring));
}
export function clearBranch(nodes, index) {
  const next = clonePedigree(nodes);
  for (const child of branchIndexes(index)) next[child] = emptyNode(child, next[1]?.gender);
  return next;
}

export function wrappedLineCount(value, charsPerLine = 28) {
  const text = String(value || "");
  if (!text) return 1;
  return text.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

export function adaptiveFirstGenerationHeights(nodes, options = {}) {
  const baseHeight = Math.max(1, Number(options.baseHeight) || 132);
  const lineHeight = Math.max(1, Number(options.lineHeight) || 14);
  const charsPerLine = Math.max(8, Number(options.charsPerLine) || 28);
  const minimumExpansion = options.minimumExpansion === undefined
    ? lineHeight * 2
    : Math.max(0, Number(options.minimumExpansion) || 0);
  const isComplete = (node) => ["ring", "name", "fancier", "color", "details"].every((key) => String(node?.[key] || "").trim());
  const extraHeight = (node) => isComplete(node)
    ? minimumExpansion + Math.max(0, wrappedLineCount(node.details, charsPerLine) - 1) * lineHeight
    : 0;
  const parents = Math.min(
    baseHeight * 2,
    baseHeight + Math.max(extraHeight(nodes?.[2]), extraHeight(nodes?.[3])),
  );
  const root = Math.min(parents * 2, baseHeight + extraHeight(nodes?.[1]));
  return { root, parents, base: baseHeight };
}

export function proportionalGenerationHeight(generation, options = {}) {
  const referenceLevel = Math.max(3, Math.min(5, Number(options.referenceLevel) || 5));
  const leafHeight = Math.max(1, Number(options.leafHeight) || 88);
  const gap = Math.max(0, Number(options.gap) || 6);
  const normalizedGeneration = Math.max(1, Math.min(referenceLevel, Number(generation) || 1));
  const span = 2 ** (referenceLevel - normalizedGeneration);
  return span * leafHeight + (span - 1) * gap;
}

export function adaptivePreviewPixelHeights(totalHeight, adaptiveHeights, gap = 3) {
  const total = Math.max(1, Number(totalHeight) || 1);
  const safeGap = Math.max(0, Number(gap) || 0);
  const base = Math.max(1, (total - safeGap * 3) / 4);
  const ratioParents = adaptiveHeights.parents / adaptiveHeights.base;
  const ratioRoot = adaptiveHeights.root / adaptiveHeights.base;
  const parents = Math.min((total - safeGap) / 2, base * ratioParents);
  const root = Math.min(total, parents * 2, base * ratioRoot);
  return { root, parents, base };
}

export function measuredPreviewPixelHeights(totalHeight, rootContentHeight, parentContentHeights = [], gap = 3) {
  const total = Math.max(1, Number(totalHeight) || 1);
  const safeGap = Math.max(0, Number(gap) || 0);
  const base = Math.max(1, (total - safeGap * 3) / 4);
  const measuredParents = parentContentHeights.map((height) => Math.max(base, Number(height) || base));
  const parents = Math.min(
    (total - safeGap) / 2,
    Math.max(base, ...measuredParents),
  );
  const root = Math.min(
    total,
    parents * 2,
    Math.max(base, Number(rootContentHeight) || base),
  );
  return { root, parents, base };
}

export function formatDateDmy(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export const normalizeRing = (value) => String(value || "").toUpperCase().trim().replace(/[—–_]/g, "-").replace(/\s+/g, " ");

const COUNTRY_PREFIX_PATTERN = "([A-Z](?:[^0-9\\r\\n]{0,6}[A-Z])?)?";

export function formatRingParts(parts = {}) {
  const country = normalizeRing(parts.country || "");
  const suffix = String(parts.ring_suffix ?? "").trim();
  const number = String(parts.ring_number ?? "").trim();
  const yearDigits = String(parts.ring_year ?? "").replace(/\D/g, "");
  if (!number || !yearDigits) return "";
  const shortYear = yearDigits.slice(-2).padStart(2, "0");
  const numericPart = suffix
    ? `${suffix}-${shortYear}-${number}`
    : `${number}-${shortYear}`;
  return `${country ? `${country} ` : ""}${numericPart}`;
}

function parsedRingResult({ country = "", number, yearText, suffix = "", extra = "", now }) {
  const short = Number(String(yearText).slice(-2));
  const threshold = Number(String(now.getFullYear()).slice(-2)) + 1;
  const ringYear = String(yearText).length === 4 ? Number(yearText) : (short > threshold ? 1900 : 2000) + short;
  const ring = formatRingParts({ country, ring_number: number, ring_year: ringYear, ring_suffix: suffix });
  return {
    ring,
    country,
    ring_number: number,
    ring_year: ringYear,
    ring_suffix: suffix,
    extra: String(extra || "").trim(),
    core_id_loose: `${ringYear}-${String(number).padStart(7, "0")}${suffix ? `-${suffix}` : ""}`,
  };
}

export function parseRing(value, now = new Date()) {
  const raw = normalizeRing(value);
  if (!raw) return null;
  const patterns = [
    // Flutter: DV 8210-17-0325 -> suffix-year-number.
    [2, new RegExp(`^${COUNTRY_PREFIX_PATTERN}\\s*[-]?[/]?\\s*(\\d{3,7})[-/\\s]+(\\d{2})[-/]+(\\d{3,7})(?:\\s+)?(.*)?$`, "i")],
    // Recover drafts/rows produced by the former web order: suffix-number-year.
    [5, new RegExp(`^${COUNTRY_PREFIX_PATTERN}\\s*[-]?[/]?\\s*(\\d{3,7})[-/\\s]+(\\d{3,7})[-/]+(\\d{2})(?:\\s+)?(.*)?$`, "i")],
    [4, new RegExp(`^${COUNTRY_PREFIX_PATTERN}\\s*[-]?[/]?\\s*(\\d{4})[-/\\s]+(\\d{3,7})(?:\\s+)?(.*)?$`, "i")],
    [1, new RegExp(`^${COUNTRY_PREFIX_PATTERN}\\s*[-]?[/]?\\s*(\\d{3,7})[-/\\s]+(\\d{2})(?:\\s+)?(.*)?$`, "i")],
    [3, new RegExp(`^${COUNTRY_PREFIX_PATTERN}\\s*[-]?[/]?\\s*(\\d{2})[-/\\s]+(\\d{3,7})(?:\\s+)?(.*)?$`, "i")],
  ];
  for (const [kind, pattern] of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const country = (match[1] || "").trim();
    let number, yearText, suffix = "", extra = "";
    if (kind === 4) { yearText = match[2]; number = match[3]; extra = match[4] || ""; }
    else if (kind === 2) { suffix = match[2]; yearText = match[3]; number = match[4]; extra = match[5] || ""; }
    else if (kind === 5) { suffix = match[2]; number = match[3]; yearText = match[4]; extra = match[5] || ""; }
    else if (kind === 1) { number = match[2]; yearText = match[3]; extra = match[4] || ""; }
    else { yearText = match[2]; number = match[3]; extra = match[4] || ""; }
    return parsedRingResult({ country, number, yearText, suffix, extra, now });
  }
  return null;
}

export function pigeonRingParts(pigeon, now = new Date()) {
  const fromRing = parseRing(pigeon?.ring, now);
  if (fromRing) return fromRing;
  const structured = formatRingParts(pigeon);
  return structured ? parseRing(structured, now) : null;
}

export function formatPigeonRing(pigeon, fallback = "") {
  return pigeonRingParts(pigeon)?.ring || normalizeRing(pigeon?.ring) || fallback;
}

const performanceResult = (line) => String(line || "").match(/^(\d{1,4})\s*[\/|]\s*(\d{1,6})$/);
const normalizedPerformanceResult = (line) => {
  const match = performanceResult(line);
  return match ? `${match[1]}/${match[2]}` : String(line || "").trim();
};
const isPerformanceLabel = (line) => {
  const value = String(line || "").trim();
  return value.length <= 64
    && /[A-Za-zÀ-ÿ]/.test(value)
    && !performanceResult(value)
    && !parseRing(value)
    && !/[:=]\s*$/.test(value)
    && !/^[=—–-]/.test(value);
};

export function reconstructOcrLines(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);

  // Some OCR engines read a two-column result block as every race name first,
  // followed by every rank/participant value. Zip those equally sized groups.
  let cursor = 0;
  while (cursor < lines.length) {
    if (!performanceResult(lines[cursor])) {
      cursor += 1;
      continue;
    }
    let end = cursor;
    while (end < lines.length && performanceResult(lines[end])) end += 1;
    const count = end - cursor;
    const labelStart = cursor - count;
    if (count >= 2 && labelStart >= 0) {
      const labels = lines.slice(labelStart, cursor);
      if (labels.every(isPerformanceLabel)) {
        const results = lines.slice(cursor, end);
        const pairs = labels.map((label, offset) => `${label} ${normalizedPerformanceResult(results[offset])}`);
        lines.splice(labelStart, count * 2, ...pairs);
        cursor = labelStart + pairs.length;
        continue;
      }
    }
    cursor = end;
  }

  // The usual OCR order alternates the race name and its result on two lines.
  const rebuilt = [];
  for (let index = 0; index < lines.length; index += 1) {
    const next = lines[index + 1];
    if (next && isPerformanceLabel(lines[index]) && performanceResult(next)) {
      rebuilt.push(`${lines[index]} ${normalizedPerformanceResult(next)}`);
      index += 1;
    } else {
      rebuilt.push(performanceResult(lines[index]) ? normalizedPerformanceResult(lines[index]) : lines[index]);
    }
  }
  return rebuilt;
}

export function parsePigeonText(text, index, rootGender = "?") {
  const lines = reconstructOcrLines(text);
  const result = emptyNode(index, rootGender);
  if (!lines.length) return result;

  const parseOcrRing = (line) => {
    const normalized = normalizeRing(line).replaceAll("|", "1");
    const digitCorrected = normalized.replaceAll("O", "0").replaceAll("Q", "0");
    return parseRing(digitCorrected) || parseRing(normalized);
  };
  const countryPrefixOnly = (line) => {
    let normalized = normalizeRing(line);
    if (/\d/.test(normalized)) return null;
    normalized = normalized.replace(/^[^A-Z]+/, "").replace(/[^A-Z]+$/, "");
    if (!normalized || !new RegExp(`^${COUNTRY_PREFIX_PATTERN}$`, "i").test(normalized)) return null;
    if (/^[A-Z]+$/.test(normalized) && normalized.length > 4) return null;
    return normalized;
  };

  let ringStartIndex = -1;
  let ringEndIndex = -1;
  let parts = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const current = parseOcrRing(lines[lineIndex]);
    if (current?.country) {
      ringStartIndex = lineIndex;
      ringEndIndex = lineIndex;
      parts = current;
      break;
    }

    const prefix = countryPrefixOnly(lines[lineIndex]);
    if (prefix && lineIndex + 1 < lines.length) {
      const merged = parseOcrRing(`${prefix} ${lines[lineIndex + 1]}`);
      if (merged?.country) {
        ringStartIndex = lineIndex;
        ringEndIndex = lineIndex + 1;
        parts = merged;
        break;
      }
    }

    if (current && lineIndex > 0) {
      const previousPrefix = countryPrefixOnly(lines[lineIndex - 1]);
      if (previousPrefix) {
        const merged = parseOcrRing(`${previousPrefix} ${lines[lineIndex]}`);
        if (merged?.country) {
          ringStartIndex = lineIndex - 1;
          ringEndIndex = lineIndex;
          parts = merged;
          break;
        }
      }
    }

    if (current) {
      ringStartIndex = lineIndex;
      ringEndIndex = lineIndex;
      parts = current;
      break;
    }
  }

  if (ringStartIndex < 0 || !parts) return result;
  const others = lines.slice(ringEndIndex + 1);
  return { ...result, ...parts, gender: genderFor(index, rootGender), name: others[0] || "",
    fancier: others[1] || "", color: others[2] || "", details: others.slice(3).join("\n"), dirty: true };
}

export const serializeTemporaryState = (nodes) => Object.fromEntries(Object.entries(nodes)
  .filter(([, node]) => node.ring || node.name || node.fancier || node.color || node.details)
  .map(([index, node]) => [index, { ring: node.ring, ring_number: node.ring_number, ring_year: node.ring_year,
    ring_suffix: node.ring_suffix, country: node.country, gender: node.gender, name: node.name,
    fancier: node.fancier, color: node.color, details: node.details, frameColor: node.frameColor }]));
export function restoreTemporaryState(value, rootGender = "?") {
  const nodes = createPedigree(rootGender);
  for (const [rawIndex, partial] of Object.entries(value || {})) {
    const index = Number(rawIndex);
    if (index >= 1 && index <= 31) {
      const restored = { ...nodes[index], ...partial, index };
      const parts = pigeonRingParts(restored);
      nodes[index] = parts ? { ...restored, ...parts, invalid: false } : restored;
    }
  }
  return nodes;
}
