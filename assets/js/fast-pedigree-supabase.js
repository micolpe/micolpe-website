import { requireActiveSession } from "./auth-guard.js";
import { supabase } from "./supabase-client.js";
import { createPedigree, formatPigeonRing, genderFor, genderSymbolForStorage, intermediateMissingIndexes, normalizeGender, parseRing, pedigreePersistencePlan, pigeonRingParts } from "./fast-pedigree-core.js?v=20260820-1";

const PF = "id,ring,ring_number,ring_year,ring_suffix,country,fancier,gender,name_pigeon,color,father_id,mother_id,core_id_loose,profile_id,updated_at";
const LF = "id,pigeon_id,loft_id,is_owner,is_creator,is_deleted,custom_name,custom_fancier,custom_color,achievements,frame_color,photo,state,updated_at";
const iso = () => new Date().toISOString(); const uuid = () => crypto.randomUUID();
const norm = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

function toNode(pigeon, membership, index, rootGender, userId) {
  const parts = pigeonRingParts(pigeon);
  return { index, id: pigeon.id, loftPigeonId: membership?.id || null, ring: parts?.ring || formatPigeonRing(pigeon), ring_number: parts?.ring_number ?? pigeon.ring_number ?? "", ring_year: parts?.ring_year ?? pigeon.ring_year,
    ring_suffix: parts?.ring_suffix ?? pigeon.ring_suffix ?? "", country: parts?.country ?? pigeon.country ?? "", gender: index === 1 ? normalizeGender(pigeon.gender || rootGender) : genderFor(index, rootGender),
    name: membership?.custom_name || pigeon.name_pigeon || "", fancier: membership?.custom_fancier || pigeon.fancier || "", color: membership?.custom_color || pigeon.color || "",
    details: membership?.achievements || "", frameColor: membership?.frame_color || "#fff", photo: membership?.photo || "", isOwner: membership?.is_owner ?? index === 1,
    isCreator: membership?.is_creator ?? pigeon.profile_id === userId, originalState: membership?.state || null,
    originalFatherId: pigeon.father_id || null, originalMotherId: pigeon.mother_id || null,
    relationsDirty: false, dirty: false, invalid: false };
}
function stateFor(node, loftName) {
  if (node.originalState && !["actif", "pedigree"].includes(node.originalState)) return node.originalState;
  return node.index === 1 || (norm(node.fancier) && norm(node.fancier) === norm(loftName)) ? "actif" : "pedigree";
}

export class FastPedigreeSupabase {
  constructor(lang = "fr") { this.lang = lang; this.membershipByPigeon = new Map(); this.pigeons = []; }
  async initialize() {
    this.auth = await requireActiveSession(); if (!this.auth) return null;
    if (this.auth.accessMode !== "full") { location.replace(this.lang === "en" ? "/en/dashboard.html#payments" : "/dashboard.html#payments"); return null; }
    this.profile = this.auth.profile; const userId = this.profile.id;
    const [loft, settings, pigeons] = await Promise.all([
      supabase.from("loft").select("id,nameloft,addressloft,phone,email,logo,social,website,user_id,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("pedigree").select("*").eq("profile_id", userId).limit(1).maybeSingle(),
      supabase.from("pigeon").select(PF).eq("profile_id", userId).order("ring_year", { ascending: false }).limit(2000),
    ]);
    for (const result of [loft, settings, pigeons]) if (result.error) throw result.error;
    if (!loft.data) throw new Error(this.lang === "en" ? "No loft is linked to this account." : "Aucun loft n’est associé à ce compte.");
    this.loft = loft.data; this.settings = settings.data || null; this.pigeons = (pigeons.data || []).map((pigeon) => {
      const parts = pigeonRingParts(pigeon);
      return parts ? { ...pigeon, ...parts } : pigeon;
    });
    const memberships = await supabase.from("loft_pigeon").select(LF).eq("loft_id", this.loft.id).eq("is_deleted", false).limit(3000);
    if (memberships.error) throw memberships.error; this.memberships = memberships.data || []; this.membershipByPigeon = new Map(this.memberships.map((row) => [row.pigeon_id, row]));
    return { profile: this.profile, loft: this.loft, settings: this.settings, pigeons: this.pigeons.map((p) => ({ ...p, membership: this.membershipByPigeon.get(p.id) || null })) };
  }
  async loadPedigree(rootId) {
    const rootGender = normalizeGender(this.pigeons.find((p) => p.id === rootId)?.gender);
    const nodes = createPedigree(rootGender);
    Object.assign(nodes, await this.loadPedigreeBranch(rootId, 1, rootGender));
    return nodes;
  }
  async loadPedigreeBranch(rootId, startIndex, rootGender) {
    const normalizedStart = Number(startIndex);
    const byIndex = new Map([[normalizedStart, rootId]]), byId = new Map();
    const startGeneration = Math.floor(Math.log2(normalizedStart)) + 1;
    for (let gen = startGeneration; gen <= 5; gen += 1) {
      const entries = [...byIndex].filter(([index]) => Math.floor(Math.log2(index)) + 1 === gen), missing = [...new Set(entries.map(([, id]) => id).filter((id) => id && !byId.has(id)))];
      if (missing.length) { const result = await supabase.from("pigeon").select(PF).in("id", missing); if (result.error) throw result.error; for (const p of result.data || []) byId.set(p.id, p); }
      for (const [index, id] of entries) { const p = byId.get(id); if (!p) continue; if (index * 2 <= 31 && p.father_id) byIndex.set(index * 2, p.father_id); if (index * 2 + 1 <= 31 && p.mother_id) byIndex.set(index * 2 + 1, p.mother_id); }
    }
    if (byId.size) { const result = await supabase.from("loft_pigeon").select(LF).eq("loft_id", this.loft.id).in("pigeon_id", [...byId.keys()]).eq("is_deleted", false); if (result.error) throw result.error; for (const m of result.data || []) this.membershipByPigeon.set(m.pigeon_id, m); }
    const nodes = {};
    for (const [index, id] of byIndex) if (byId.get(id)) nodes[index] = toNode(byId.get(id), this.membershipByPigeon.get(id), index, rootGender, this.profile.id);
    return nodes;
  }
  async duplicates(node) {
    const parts = parseRing(node.ring), gender = genderFor(node.index, node.gender); if (!parts) return [];
    let query = supabase.from("pigeon").select(PF).eq("profile_id", this.profile.id).eq("core_id_loose", parts.core_id_loose);
    if (gender === "M") query = query.in("gender", ["M", "♂"]);
    if (gender === "F") query = query.in("gender", ["F", "♀"]);
    let result = await query.order("updated_at", { ascending: false }).limit(10);
    if (result.error) throw result.error;

    // Compatibility with rows created by the former web order
    // (suffix-number-year) before the Flutter-compatible correction.
    if (!(result.data || []).length && parts.ring_suffix) {
      const shortYear = String(parts.ring_year).slice(-2);
      const legacyRing = `${parts.country ? `${parts.country} ` : ""}${parts.ring_suffix}-${parts.ring_number}-${shortYear}`;
      let fallback = supabase.from("pigeon").select(PF).eq("profile_id", this.profile.id).in("ring", [parts.ring, legacyRing]);
      if (gender === "M") fallback = fallback.in("gender", ["M", "♂"]);
      if (gender === "F") fallback = fallback.in("gender", ["F", "♀"]);
      result = await fallback.order("updated_at", { ascending: false }).limit(10);
      if (result.error) throw result.error;
    }

    return (result.data || [])
      .filter((pigeon) => pigeon.id !== node.id)
      .map((pigeon) => {
        const normalized = pigeonRingParts(pigeon);
        return { ...pigeon, ...(normalized || {}), membership: this.membershipByPigeon.get(pigeon.id) };
      });
  }
  async findExistingPigeon(node) {
    const choices = await this.duplicates(node);
    if (!choices.length) return null;
    const identity = parseRing(node.ring)?.core_id_loose;
    return choices.find((candidate) => pigeonRingParts(candidate)?.core_id_loose === identity) || choices[0];
  }
  async savePedigree(nodes, resolveDuplicate) {
    const missing = intermediateMissingIndexes(nodes);
    if (!nodes[1]?.ring || missing.length) {
      const indexes = missing.length ? missing.join(", ") : "1";
      throw new Error(this.lang === "en"
        ? `Save blocked: intermediary box(es) ${indexes} must be completed.`
        : `Sauvegarde impossible : les cases intermédiaires ${indexes} doivent être complétées.`);
    }
    const working = Object.fromEntries(Object.entries(nodes).map(([i, n]) => [i, { ...n }]));
    let created = 0, updated = 0, reused = 0;
    const now = iso();
    for (let gen = 5; gen >= 1; gen -= 1) {
      for (let index = 2 ** (gen - 1); index <= Math.min(31, 2 ** gen - 1); index += 1) {
        const node = working[index];
        if (!node.ring) continue;
        const parts = parseRing(node.ring);
        if (!parts) throw new Error(`${this.lang === "en" ? "Invalid ring" : "Bague invalide"}: ${node.ring}`);
        Object.assign(node, parts, { invalid: false });

        if (!node.id) {
          const choices = await this.duplicates(node);
          if (choices.length) {
            const selected = await resolveDuplicate(node, choices);
            if (selected) {
              node.id = selected.id;
              node.loftPigeonId = selected.membership?.id || null;
              node.isCreator = selected.profile_id === this.profile.id || selected.membership?.is_creator === true;
              node.originalState = selected.membership?.state;
              node.originalFatherId = selected.father_id || null;
              node.originalMotherId = selected.mother_id || null;
              reused += 1;
            }
          }
        }

        const isNew = !node.id;
        if (isNew) node.id = uuid();
        const applyRelations = isNew || node.relationsDirty;
        const father = applyRelations
          ? (working[index * 2]?.ring ? working[index * 2].id : null)
          : (node.originalFatherId || null);
        const mother = applyRelations
          ? (working[index * 2 + 1]?.ring ? working[index * 2 + 1].id : null)
          : (node.originalMotherId || null);
        const plan = pedigreePersistencePlan(node, isNew);
        let pigeonWritten = false;
        let membershipWritten = false;

        if (plan.pigeon) {
          const payload = {
            id: node.id,
            ring: parts.ring,
            ring_number: parts.ring_number,
            ring_year: parts.ring_year,
            ring_suffix: parts.ring_suffix || "",
            country: parts.country || "",
            core_id_loose: parts.core_id_loose,
            gender: genderSymbolForStorage(genderFor(index, working[1].gender)),
            name_pigeon: node.name || null,
            fancier: node.fancier || null,
            color: node.color || null,
            profile_id: this.profile.id,
            updated_at: now,
          };
          if (applyRelations) {
            payload.father_id = father;
            payload.mother_id = mother;
          }
          const result = isNew
            ? await supabase.from("pigeon").insert(payload).select(PF).single()
            : await supabase.from("pigeon").update(payload).eq("id", node.id).select(PF).single();
          if (result.error) throw result.error;
          Object.assign(node, result.data, {
            gender: normalizeGender(result.data.gender || node.gender),
            name: node.name,
            originalFatherId: result.data.father_id || null,
            originalMotherId: result.data.mother_id || null,
            relationsDirty: false,
          });
          pigeonWritten = true;
        }

        if (plan.membership) {
          if (!node.loftPigeonId) {
            const existing = await supabase.from("loft_pigeon").select("id").eq("loft_id", this.loft.id).eq("pigeon_id", node.id).eq("is_deleted", false).limit(1).maybeSingle();
            if (existing.error) throw existing.error;
            node.loftPigeonId = existing.data?.id || uuid();
          }
          const membership = {
            id: node.loftPigeonId,
            loft_id: this.loft.id,
            pigeon_id: node.id,
            is_owner: node.isOwner ?? index === 1,
            is_creator: node.isCreator ?? isNew,
            is_deleted: false,
            custom_name: node.name || null,
            custom_fancier: node.fancier || null,
            custom_color: node.color || null,
            achievements: node.details || null,
            frame_color: node.frameColor || "#fff",
            state: stateFor(node, this.loft.nameloft),
            updated_at: now,
          };
          const saved = await supabase.from("loft_pigeon").upsert(membership, { onConflict: "id" }).select(LF).single();
          if (saved.error) throw saved.error;
          node.originalState = saved.data.state;
          node.dirty = false;
          this.membershipByPigeon.set(node.id, saved.data);
          membershipWritten = true;
        }

        if (pigeonWritten || membershipWritten) isNew ? created += 1 : updated += 1;
      }
    }
    const existingById = new Map(this.pigeons.map((pigeon) => [pigeon.id, pigeon]));
    const changedRows = Object.values(working).filter((node) => node.id).map((node) => ({
      ...(existingById.get(node.id) || {}),
      id: node.id,
      ring: node.ring,
      name_pigeon: node.name,
      gender: genderSymbolForStorage(node.gender),
      father_id: node.originalFatherId || null,
      mother_id: node.originalMotherId || null,
    }));
    this.pigeons = [...new Map([...this.pigeons, ...changedRows].map((pigeon) => [pigeon.id, pigeon])).values()];
    return { nodes: working, created, updated, reused };
  }
  async saveSettings(p) {
    const payload = { profile_id: this.profile.id, level_gen: p.generations === "auto" ? null : Number(p.generations), with_shadow: p.withShadow, with_photo: p.withPhoto, with_logo: Boolean(p.logoUrl), with_email: Boolean(p.identityEmail), with_phone: Boolean(p.identityPhone), with_address: Boolean(p.identityAddress), with_website: Boolean(p.identityWebsite), with_social: Boolean(p.identitySocial), with_date: p.withDate, with_barcode: p.withBarcode, with_loftname: Boolean(p.identityName), show_empty: true, with_separator: p.withSeparator, color_name: p.colorName, color_ring: p.colorRing, color_fancier: p.colorFancier, color_color: p.colorColor, color_title: p.colorTitle, color_line: p.colorLine, radius: Number(p.radius), font: p.font, header: p.title, updated_at: iso() };
    const result = await supabase.from("pedigree").upsert(payload, { onConflict: "profile_id" }).select("*").single(); if (result.error) throw result.error; this.settings = result.data; return result.data;
  }
  async verificationUrl(pigeonId) { const result = await supabase.from("pigeon_verification").select("verification_token").eq("pigeon_id", pigeonId).limit(1).maybeSingle(); return result.data?.verification_token ? `${location.origin}/verify-pigeon.html?token=${encodeURIComponent(result.data.verification_token)}` : ""; }
}
