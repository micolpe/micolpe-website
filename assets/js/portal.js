import { logoutCurrentBrowser } from "./auth.js";
import { requireActiveSession } from "./auth-guard.js";
import { supabase } from "./supabase-client.js";

const PAGE_SIZE = 50;
const isEnglish = document.documentElement.lang === "en";
const tr = (fr, en) => (isEnglish ? en : fr);
const PENDING_PAYMENT_STORAGE_KEY = "micolpe_lemonsqueezy_pending_payment";
const PENDING_PAYMENT_MAX_AGE_MS = 60 * 60 * 1000;
const portalState = {
  session: null,
  profile: null,
  loft: null,
  devices: [],
  pigeons: [],
  pedigreeSettings: null,
  pigeonCount: 0,
  page: 0,
  plans: [],
  posterOffers: [],
  posterBalance: 0,
  paymentCatalogError: null,
  checkoutAllowed: false,
  checkoutTestMode: true,
  checkoutAccessError: null,
  paymentInProgress: false,
  confirmationInProgress: false,
  pendingPayment: null,
  accessMode: "full",
};

const subscriptionLabels = {
  trial: tr("Essai", "Trial"),
  "1year": tr("1 an", "1 year"),
  "3years": tr("3 ans", "3 years"),
  "5years": tr("5 ans", "5 years"),
  annual: tr("1 an", "1 year"),
};

const stateLabels = {
  actif: tr("Actif", "Active"),
  breeder: tr("Reproducteur", "Breeder"),
  lost: tr("Perdu", "Lost"),
  sold: tr("Vendu", "Sold"),
  lent: tr("Prêté", "Lent"),
  dead: tr("Décédé", "Deceased"),
  pedigree: "Pedigree",
};

const languageLabels = {
  fr: "Français",
  en: "English",
  nl: "Nederlands",
  it: "Italiano",
  de: "Deutsch",
  es: "Español",
};

function valueOrFallback(
  value,
  fallback = tr("Non renseigné", "Not provided"),
) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function setText(id, value, fallback) {
  const element = document.querySelector(`#${id}`);
  if (element) element.textContent = valueOrFallback(value, fallback);
}

function formatDate(value, dateOnly = false) {
  if (!value) return tr("Non renseigné", "Not provided");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return tr("Non renseigné", "Not provided");

  return new Intl.DateTimeFormat(isEnglish ? "en-GB" : "fr-FR", {
    dateStyle: "medium",
    ...(dateOnly ? {} : { timeStyle: "short" }),
  }).format(date);
}

function formatSubscription(profile) {
  const rawType = String(profile?.subscription_type || "")
    .trim()
    .toLowerCase();
  return subscriptionLabels[rawType] || valueOrFallback(rawType, "Standard");
}

function isTrialProfile(profile = portalState.profile) {
  const subscriptionType = String(profile?.subscription_type || "")
    .trim()
    .toLowerCase();
  if (subscriptionType) return subscriptionType === "trial";
  return profile?.is_trial === true || profile?.is_trial === 1;
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatRing(pigeon) {
  if (String(pigeon?.ring || "").trim()) return String(pigeon.ring).trim();

  return (
    [
      pigeon?.country,
      pigeon?.ring_year,
      pigeon?.ring_number,
      pigeon?.ring_suffix,
    ]
      .filter((value) => value !== null && value !== undefined && value !== "")
      .join("-") || tr("Bague non renseignée", "Ring not provided")
  );
}

function formatGender(value) {
  const gender = String(value || "")
    .trim()
    .toUpperCase();
  if (gender === "M" || gender === "MALE" || gender === "♂") return "♂";
  if (gender === "F" || gender === "FEMALE" || gender === "♀") return "♀";
  return tr("Non renseigné", "Not provided");
}

function genderSymbol(value) {
  const gender = String(value || "")
    .trim()
    .toUpperCase();
  if (gender === "M" || gender === "MALE" || gender === "♂") return "♂";
  if (gender === "F" || gender === "FEMALE" || gender === "♀") return "♀";
  return "";
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function loadPortalData(session, profile) {
  const userId = session.user.id;
  const [loftResult, devicesResult, pigeonsResult, pedigreeResult] =
    await Promise.all([
      supabase
        .from("loft")
        .select(
          "id,nameloft,addressloft,phone,email,latitude,longitude,logo,social,lang,confirmed,website,updated_at",
        )
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("user_devices")
        .select(
          "id,device_type,device_name,last_seen,is_revoked,revoked_at,revoke_reason",
        )
        .eq("user_id", userId)
        .order("last_seen", { ascending: false }),
      supabase
        .from("pigeon")
        .select(
          "id,ring,ring_number,ring_year,ring_suffix,country,fancier,strain,gender,name_pigeon,color,dna_certified,father_id,mother_id,updated_at",
          { count: "exact" },
        )
        .eq("profile_id", userId)
        .order("ring_year", { ascending: false, nullsFirst: false })
        .order("ring", { ascending: false })
        .limit(1000),
      supabase
        .from("pedigree")
        .select(
          "level_gen,with_shadow,with_separator,show_empty,color_name,color_ring,color_fancier,color_color,color_title,color_line,radius,font,header,with_logo,with_loftname,with_email,with_phone,with_address,with_website,with_social,with_date,with_barcode",
        )
        .eq("profile_id", userId)
        .limit(1)
        .maybeSingle(),
    ]);

  if (loftResult.error) throw loftResult.error;
  if (devicesResult.error) throw devicesResult.error;
  if (pigeonsResult.error) throw pigeonsResult.error;
  if (pedigreeResult.error) throw pedigreeResult.error;

  let memberships = [];
  if (loftResult.data?.id) {
    const membershipsResult = await supabase
      .from("loft_pigeon")
      .select(
        "pigeon_id,custom_name,state,is_owner,is_creator,is_deleted,chipid,custom_fancier,custom_color,achievements,poster_details,frame_color,updated_at",
      )
      .eq("loft_id", loftResult.data.id);

    if (!membershipsResult.error) {
      memberships = membershipsResult.data || [];
    }
  }

  const membershipByPigeon = new Map();
  for (const membership of memberships) {
    if (membership.is_deleted === true) continue;
    if (!membershipByPigeon.has(membership.pigeon_id)) {
      membershipByPigeon.set(membership.pigeon_id, membership);
    }
  }

  return {
    profile,
    loft: loftResult.data,
    devices: devicesResult.data || [],
    pigeons: (pigeonsResult.data || []).map((pigeon) => ({
      ...pigeon,
      membership: membershipByPigeon.get(pigeon.id) || null,
    })),
    pedigreeSettings: pedigreeResult.data || null,
    pigeonCount: pigeonsResult.count ?? (pigeonsResult.data || []).length,
  };
}

async function loadPaymentData(userId) {
  const [plansResult, posterOffersResult, walletResult] = await Promise.all([
    supabase
      .from("plan")
      .select("id,name,duration_days,price,active")
      .eq("active", true)
      .order("price", { ascending: true }),
    supabase
      .from("poster_offers")
      .select("id,name,credits_count,price,currency,is_active,sort_order")
      .eq("is_active", true)
      .neq("price", 0)
      .order("sort_order", { ascending: true }),
    supabase
      .from("poster_wallets")
      .select("balance")
      .eq("profile_id", userId)
      .maybeSingle(),
  ]);

  if (plansResult.error) throw plansResult.error;
  if (posterOffersResult.error) throw posterOffersResult.error;
  if (walletResult.error) throw walletResult.error;

  return {
    plans: (plansResult.data || []).filter((offer) =>
      [366, 1096, 1827].includes(Number(offer.duration_days)),
    ),
    posterOffers: (posterOffersResult.data || []).filter((offer) =>
      [10, 50, 100].includes(Number(offer.credits_count)),
    ),
    posterBalance: Number(walletResult.data?.balance) || 0,
    paymentCatalogError: null,
  };
}

async function loadCheckoutAccess() {
  const { data, error } = await supabase.functions.invoke(
    "create_payment_session",
    {
      body: { action: "checkout_access" },
    },
  );

  if (error) throw error;

  const provider = String(data?.provider || "")
    .trim()
    .toLowerCase();

  if (
    data?.success !== true ||
    provider !== "lemonsqueezy" ||
    typeof data?.test_mode !== "boolean" ||
    typeof data?.checkout_allowed !== "boolean"
  ) {
    throw new Error("Invalid checkout access response");
  }

  return {
    checkoutAllowed: data.checkout_allowed,
    checkoutTestMode: data.test_mode,
    checkoutAccessError: null,
  };
}

function isRenewalOnly() {
  return portalState.accessMode === "renewal";
}

function renderMember(profile) {
  const name = valueOrFallback(
    profile.name,
    tr("Membre Micolpe", "Micolpe member"),
  );
  setText("sidebar-member-name", name);
  setText("sidebar-member-email", profile.email);
  setText("portal-greeting", tr(`Bienvenue, ${name}`, `Welcome, ${name}`));
}

function renderSummary() {
  const { profile, loft, devices, pigeonCount, pigeons } = portalState;
  const activeDevices = devices.filter((device) => !device.is_revoked).length;
  const revokedDevices = devices.length - activeDevices;

  setText("summary-subscription", formatSubscription(profile));
  setText(
    "summary-subscription-detail",
    profile.subscription_end
      ? tr(
          `Jusqu’au ${formatDate(profile.subscription_end, true)}`,
          `Until ${formatDate(profile.subscription_end, true)}`,
        )
      : tr("Durée non renseignée", "Duration not provided"),
  );

  setText(
    "summary-loft",
    loft ? tr("Configuré", "Configured") : tr("À compléter", "To complete"),
  );
  setText(
    "summary-loft-detail",
    loft
      ? valueOrFallback(loft.nameloft, "Micolpe loft")
      : tr("Aucun loft trouvé", "No loft found"),
  );

  setText("summary-devices", String(activeDevices), "0");
  setText(
    "summary-devices-detail",
    revokedDevices
      ? tr(
          `${revokedDevices} appareil${revokedDevices > 1 ? "s" : ""} révoqué${revokedDevices > 1 ? "s" : ""}`,
          `${revokedDevices} revoked device${revokedDevices > 1 ? "s" : ""}`,
        )
      : tr("Aucun appareil révoqué", "No revoked devices"),
  );

  setText("summary-pigeons", String(pigeonCount), "0");
  setText(
    "summary-pigeons-detail",
    pigeonCount > pigeons.length
      ? tr(
          `${pigeons.length} derniers chargés`,
          `${pigeons.length} latest loaded`,
        )
      : tr("Synchronisés dans le Cloud", "Synchronized"),
  );
}

function renderProfile() {
  const profile = portalState.profile;
  const accountStatus =
    profile.is_verified && profile.is_active
      ? tr("Actif et vérifié", "Active and verified")
      : tr("Vérification nécessaire", "Verification required");

  setText("overview-name", profile.name);
  setText("overview-email", profile.email);
  setText("overview-status", accountStatus);
  setText("overview-last-login", formatDate(profile.last_login));

  setText("profile-name", profile.name);
  setText("profile-email", profile.email);
  setText("profile-phone", profile.phone);
  setText("profile-subscription-type", formatSubscription(profile));
  setText(
    "profile-subscription-start",
    formatDate(profile.subscription_start, true),
  );
  setText(
    "profile-subscription-end",
    formatDate(profile.subscription_end, true),
  );
  setText("profile-created-at", formatDate(profile.created_at));
  setText("profile-last-login", formatDate(profile.last_login));
}

function planDisplayName(offer) {
  const days = Number(offer?.duration_days);
  if (days >= 1800) return tr("5 ans", "5 years");
  if (days >= 1000) return tr("3 ans", "3 years");
  if (days >= 300) return tr("1 an", "1 year");
  return valueOrFallback(offer?.name, tr("Abonnement", "Subscription"));
}

function offerPriceLabel(offer) {
  const price = String(offer?.price ?? "").trim();
  const currency = String(offer?.currency || "EUR")
    .trim()
    .toUpperCase();
  if (!price) return tr("Prix indisponible", "Price unavailable");
  return currency === "EUR" ? `${price} €` : `${price} ${currency}`;
}

function setPaymentFeedback(kind, message) {
  const feedback = document.querySelector("#payment-feedback");
  if (!feedback) return;

  if (!message) {
    feedback.hidden = true;
    feedback.textContent = "";
    feedback.className = "payment-feedback";
    return;
  }

  feedback.hidden = false;
  feedback.className = `payment-feedback ${kind}`;
  feedback.textContent = message;
}

function createPaymentOfferCard(offer, paymentType) {
  const isSubscription = paymentType === "subscription";
  const isTrial = isTrialProfile();
  const article = document.createElement("article");
  article.className = "payment-offer-card";

  const title = document.createElement("h4");
  title.textContent = isSubscription
    ? planDisplayName(offer)
    : tr(
        `${Number(offer.credits_count) || 0} crédits`,
        `${Number(offer.credits_count) || 0} credits`,
      );

  const price = document.createElement("strong");
  price.className = "payment-offer-price";
  price.textContent = offerPriceLabel(offer);

  const priceNote = document.createElement("small");
  priceNote.className = "payment-offer-price-note";
  priceNote.textContent = tr(
    "Total final et taxes confirmés dans le checkout",
    "Final total and taxes confirmed at checkout",
  );

  const description = document.createElement("p");
  description.textContent = isSubscription
    ? tr(
        `Accès complet à Micolpe pendant ${planDisplayName(offer)}.`,
        `Full Micolpe access for ${planDisplayName(offer)}.`,
      )
    : tr(
        "Ajoutés automatiquement au portefeuille après confirmation du paiement.",
        "Automatically added to the wallet after payment confirmation.",
      );

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn primary payment-offer-button";
  button.textContent = isSubscription
    ? isTrial
      ? tr("Activer Micolpe", "Activate Micolpe")
      : tr("Prolonger mon abonnement", "Extend my subscription")
    : tr("Acheter ce pack", "Buy this pack");
  button.disabled =
    portalState.paymentInProgress ||
    !portalState.checkoutAllowed ||
    (!isSubscription && (isTrial || isRenewalOnly()));

  if (!portalState.checkoutAllowed) {
    button.title = tr(
      "Le checkout n’est pas encore disponible pour ce compte.",
      "Checkout is not available for this account yet.",
    );
  } else if (!isSubscription && isRenewalOnly()) {
    button.title = tr(
      "Renouvelez d’abord votre accès Micolpe.",
      "Renew your Micolpe access first.",
    );
  }

  button.addEventListener("click", () => startPayment(paymentType, offer));

  article.append(title, price, priceNote, description, button);
  return article;
}

function renderPaymentOfferList(containerId, offers, paymentType) {
  const container = document.querySelector(`#${containerId}`);
  if (!container) return;
  container.replaceChildren();

  if (!offers.length) {
    const empty = document.createElement("div");
    empty.className = "payment-catalog-empty";
    empty.textContent = tr(
      "Aucune offre Lemon Squeezy active n’est disponible.",
      "No active Lemon Squeezy offer is available.",
    );
    container.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const offer of offers) {
    fragment.append(createPaymentOfferCard(offer, paymentType));
  }
  container.append(fragment);
}

function renderPayments() {
  if (!document.querySelector("#section-payments")) return;

  setText(
    "payment-current-subscription",
    formatSubscription(portalState.profile),
  );
  setText(
    "payment-current-subscription-detail",
    portalState.profile?.subscription_end
      ? tr(
          `Valable jusqu’au ${formatDate(portalState.profile.subscription_end, true)}`,
          `Valid until ${formatDate(portalState.profile.subscription_end, true)}`,
        )
      : tr("Aucune date de fin renseignée", "No end date available"),
  );
  setText("payment-poster-balance", String(portalState.posterBalance), "0");

  const trialNote = document.querySelector("#poster-payment-trial-note");
  if (trialNote) trialNote.hidden = !isTrialProfile();

  renderPaymentOfferList(
    "subscription-offers",
    portalState.plans,
    "subscription",
  );
  renderPaymentOfferList(
    "poster-offers",
    portalState.posterOffers,
    "poster_recharge",
  );

  if (portalState.paymentCatalogError) {
    setPaymentFeedback(
      "error",
      tr(
        "Les offres de paiement ne peuvent pas être chargées pour le moment. Réessayez dans quelques instants.",
        "Payment offers cannot be loaded at the moment. Please try again shortly.",
      ),
    );
  } else if (portalState.checkoutAccessError) {
    setPaymentFeedback(
      "error",
      tr(
        "L’accès au checkout ne peut pas être vérifié pour le moment. Aucun paiement ne peut être lancé.",
        "Checkout access cannot be verified at the moment. No payment can be started.",
      ),
    );
  } else if (portalState.checkoutTestMode && !portalState.checkoutAllowed) {
    setPaymentFeedback(
      "notice",
      tr(
        "Le paiement en ligne est en cours d’activation. Le checkout test est temporairement réservé au compte Micolpe autorisé.",
        "Online payment is being activated. Test checkout is temporarily limited to the authorized Micolpe account.",
      ),
    );
  } else if (portalState.checkoutTestMode) {
    setPaymentFeedback(
      "info",
      tr(
        "Mode test Lemon Squeezy : ce checkout est réservé à votre compte et aucun débit réel ne sera effectué.",
        "Lemon Squeezy test mode: this checkout is limited to your account and no real charge will be made.",
      ),
    );
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

function readSecureCheckoutUrl(value) {
  let url;

  try {
    url = new URL(String(value || "").trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const allowedHost =
    host === "lemonsqueezy.com" ||
    host.endsWith(".lemonsqueezy.com") ||
    host === "checkout.micolpe.com" ||
    host === "store.micolpe.com";

  return url.protocol === "https:" && allowedHost ? url : null;
}

function clearStoredPendingPayment() {
  try {
    window.localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in a restricted browser context.
  }
}

function storePendingPayment(pendingPayment) {
  try {
    window.localStorage.setItem(
      PENDING_PAYMENT_STORAGE_KEY,
      JSON.stringify(pendingPayment),
    );
  } catch {
    // The in-memory state still lets the current page confirm the payment.
  }
}

function restorePendingPayment(userId) {
  let candidate;

  try {
    candidate = JSON.parse(
      window.localStorage.getItem(PENDING_PAYMENT_STORAGE_KEY) || "null",
    );
  } catch {
    clearStoredPendingPayment();
    return null;
  }

  const checkoutUrl = readSecureCheckoutUrl(candidate?.checkoutUrl);
  const createdAt = Number(candidate?.createdAt);
  const paymentType = String(candidate?.paymentType || "");
  const valid =
    candidate &&
    candidate.userId === userId &&
    isUuid(candidate.paymentId) &&
    isUuid(candidate.checkoutId) &&
    checkoutUrl &&
    (paymentType === "subscription" || paymentType === "poster_recharge") &&
    Number.isFinite(createdAt) &&
    Date.now() - createdAt >= 0 &&
    Date.now() - createdAt <= PENDING_PAYMENT_MAX_AGE_MS;

  if (!valid) {
    clearStoredPendingPayment();
    return null;
  }

  return {
    ...candidate,
    checkoutUrl: checkoutUrl.toString(),
  };
}

function openCheckout(checkoutUrl, preparedWindow = null) {
  const url = readSecureCheckoutUrl(checkoutUrl);

  if (!url) {
    throw new Error(
      tr(
        "L’URL du checkout Lemon Squeezy est invalide.",
        "The Lemon Squeezy checkout URL is invalid.",
      ),
    );
  }

  if (preparedWindow && !preparedWindow.closed) {
    preparedWindow.opener = null;
    preparedWindow.location.replace(url.toString());
    return;
  }

  const opened = window.open(url.toString(), "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url.toString());
}

async function readFunctionError(error) {
  const context = error?.context;
  if (context && typeof context.clone === "function") {
    try {
      const payload = await context.clone().json();
      const serverMessage = String(payload?.error || "").trim();
      if (serverMessage === "TEST_CHECKOUT_RESTRICTED") {
        return tr(
          "Le checkout test est réservé au compte Micolpe autorisé jusqu’à l’activation du store.",
          "Test checkout is limited to the authorized Micolpe account until the store is activated.",
        );
      }
      if (serverMessage) return serverMessage;
    } catch {
      // The response did not contain a JSON body.
    }
  }

  return (
    String(error?.message || error || "").trim() ||
    tr("Impossible de préparer le paiement.", "Unable to prepare the payment.")
  );
}

async function startPayment(paymentType, offer) {
  if (portalState.paymentInProgress || !portalState.session?.user?.id) return;

  if (!portalState.checkoutAllowed) {
    setPaymentFeedback(
      portalState.checkoutAccessError ? "error" : "notice",
      portalState.checkoutAccessError
        ? tr(
            "L’accès au checkout ne peut pas être vérifié pour le moment.",
            "Checkout access cannot be verified at the moment.",
          )
        : tr(
            "Le checkout test est réservé au compte Micolpe autorisé jusqu’à l’activation du store.",
            "Test checkout is limited to the authorized Micolpe account until the store is activated.",
          ),
    );
    return;
  }

  if (paymentType === "poster_recharge" && isRenewalOnly()) {
    setPaymentFeedback(
      "notice",
      tr(
        "Renouvelez d’abord votre accès Micolpe avant d’acheter des crédits posters.",
        "Renew your Micolpe access before buying poster credits.",
      ),
    );
    return;
  }

  if (paymentType === "poster_recharge" && isTrialProfile()) {
    setPaymentFeedback(
      "notice",
      tr(
        "Activez d’abord votre abonnement Micolpe pour acheter des crédits posters.",
        "Activate your Micolpe subscription before buying poster credits.",
      ),
    );
    return;
  }

  if (portalState.pendingPayment) {
    setPaymentFeedback(
      "notice",
      tr(
        "Un checkout est déjà en cours. Finalisez-le avant de créer un autre paiement.",
        "A checkout is already in progress. Complete it before creating another payment.",
      ),
    );
    openCheckout(portalState.pendingPayment.checkoutUrl);
    void confirmPendingPayment();
    return;
  }

  // Open a blank tab synchronously from the click event to avoid popup
  // blocking after the asynchronous Edge Function request.
  const preparedWindow = window.open("about:blank", "_blank");

  try {
    portalState.paymentInProgress = true;
    renderPayments();
    setPaymentFeedback(
      "info",
      tr("Préparation du paiement sécurisé…", "Preparing secure payment…"),
    );

    const { data, error } = await supabase.functions.invoke(
      "create_payment_session",
      {
        body: {
          user_id: portalState.session.user.id,
          payment_type: paymentType,
          offer_id: offer.id,
          locale: isEnglish ? "en" : "fr",
        },
      },
    );

    if (error) throw new Error(await readFunctionError(error));
    if (data?.success !== true) {
      throw new Error(
        String(data?.error || "").trim() ||
          tr(
            "La session de paiement n’a pas pu être créée.",
            "The payment session could not be created.",
          ),
      );
    }

    const provider = String(data.provider || "")
      .trim()
      .toLowerCase();
    const checkoutId = String(data.checkout_id || "").trim();
    const paymentId = String(data.payment_id || "").trim();
    const checkoutUrl = readSecureCheckoutUrl(data.checkout_url);

    if (
      provider !== "lemonsqueezy" ||
      !isUuid(checkoutId) ||
      !isUuid(paymentId) ||
      !checkoutUrl
    ) {
      throw new Error(
        tr(
          "La session Lemon Squeezy reçue est invalide.",
          "The Lemon Squeezy session is invalid.",
        ),
      );
    }

    portalState.pendingPayment = {
      userId: portalState.session.user.id,
      paymentId,
      checkoutId,
      checkoutUrl: checkoutUrl.toString(),
      paymentType,
      createdAt: Date.now(),
      previousSubscriptionEnd: String(
        portalState.profile?.subscription_end || "",
      ),
      previousPosterBalance: Number(portalState.posterBalance) || 0,
    };

    storePendingPayment(portalState.pendingPayment);
    portalState.paymentInProgress = false;
    renderPayments();
    setPaymentFeedback(
      "info",
      tr(
        "Le checkout sécurisé Lemon Squeezy est ouvert. Cette page vérifiera automatiquement l’activation à votre retour.",
        "The secure Lemon Squeezy checkout is open. This page will automatically verify activation when you return.",
      ),
    );
    openCheckout(checkoutUrl.toString(), preparedWindow);
    void confirmPendingPayment();
  } catch (error) {
    if (preparedWindow && !preparedWindow.closed) preparedWindow.close();
    portalState.paymentInProgress = false;
    portalState.confirmationInProgress = false;
    portalState.pendingPayment = null;
    renderPayments();
    setPaymentFeedback("error", await readFunctionError(error));
  }
}

async function refreshPaymentState(pendingPayment) {
  const userId = portalState.session.user.id;
  const [profileResult, walletResult, paymentResult] = await Promise.all([
    supabase
      .from("profile")
      .select(
        "id,name,email,phone,is_verified,is_active,is_trial,subscription_type,subscription_start,subscription_end,created_at,last_login",
      )
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("poster_wallets")
      .select("balance")
      .eq("profile_id", userId)
      .maybeSingle(),
    supabase
      .from("payment")
      .select("id,status,applied_at")
      .eq("id", pendingPayment.paymentId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!profileResult.error && profileResult.data) {
    portalState.profile = profileResult.data;
  }
  if (!walletResult.error) {
    portalState.posterBalance = Number(walletResult.data?.balance) || 0;
  }

  const paymentApplied =
    !paymentResult.error &&
    paymentResult.data?.status === "paid" &&
    Boolean(paymentResult.data?.applied_at);
  const subscriptionChanged =
    pendingPayment.paymentType === "subscription" &&
    String(portalState.profile?.subscription_end || "") !==
      pendingPayment.previousSubscriptionEnd;
  const posterBalanceChanged =
    pendingPayment.paymentType === "poster_recharge" &&
    Number(portalState.posterBalance) > pendingPayment.previousPosterBalance;

  return {
    applied: paymentApplied || subscriptionChanged || posterBalanceChanged,
    status: String(paymentResult.data?.status || "").toLowerCase(),
  };
}

async function confirmPendingPayment() {
  const pendingPayment = portalState.pendingPayment;
  if (!pendingPayment || portalState.confirmationInProgress) return;

  portalState.confirmationInProgress = true;
  setPaymentFeedback(
    "info",
    tr(
      "Vérification de la confirmation Lemon Squeezy en cours…",
      "Checking Lemon Squeezy confirmation…",
    ),
  );

  let applied = false;
  let paymentStatus = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const result = await refreshPaymentState(pendingPayment);
      applied = result.applied;
      paymentStatus = result.status;
      if (applied) break;
    } catch {
      // A later attempt may succeed while the webhook finishes processing.
    }
    if (attempt < 9) await delay(1500);
  }

  portalState.paymentInProgress = false;
  portalState.confirmationInProgress = false;
  if (!isRenewalOnly()) {
    renderSummary();
    renderProfile();
  }

  if (applied) {
    portalState.pendingPayment = null;
    clearStoredPendingPayment();
    renderPayments();
    setPaymentFeedback(
      "success",
      pendingPayment.paymentType === "subscription"
        ? tr(
            `Abonnement confirmé. Votre accès est valable jusqu’au ${formatDate(portalState.profile.subscription_end, true)}.`,
            `Subscription confirmed. Your access is valid until ${formatDate(portalState.profile.subscription_end, true)}.`,
          )
        : tr(
            `Recharge confirmée. Votre solde est maintenant de ${portalState.posterBalance} crédits.`,
            `Recharge confirmed. Your balance is now ${portalState.posterBalance} credits.`,
          ),
    );

    if (isRenewalOnly() && pendingPayment.paymentType === "subscription") {
      const dashboardPath = isEnglish
        ? "/en/dashboard.html"
        : "/dashboard.html";
      window.setTimeout(() => {
        window.location.replace(`${dashboardPath}#overview`);
      }, 1800);
    }
  } else if (
    ["failed", "refunded", "cancelled", "canceled"].includes(paymentStatus)
  ) {
    portalState.pendingPayment = null;
    clearStoredPendingPayment();
    renderPayments();
    setPaymentFeedback(
      "error",
      tr(
        "Ce paiement n’a pas été finalisé. Vous pouvez recommencer avec un nouveau checkout.",
        "This payment was not completed. You can start again with a new checkout.",
      ),
    );
  } else {
    renderPayments();
    setPaymentFeedback(
      "notice",
      tr(
        "Aucun paiement confirmé pour le moment. Finalisez le checkout Lemon Squeezy ; la vérification reprendra automatiquement à votre retour.",
        "No payment has been confirmed yet. Complete the Lemon Squeezy checkout; verification will resume automatically when you return.",
      ),
    );
  }
}

async function initializePaymentExperience() {
  renderPayments();
  if (
    portalState.paymentCatalogError ||
    portalState.checkoutAccessError ||
    !portalState.checkoutAllowed
  ) {
    clearStoredPendingPayment();
    return;
  }

  portalState.pendingPayment = restorePendingPayment(
    portalState.session.user.id,
  );

  if (portalState.pendingPayment) {
    setPaymentFeedback(
      "info",
      tr(
        "Vérification du dernier checkout Lemon Squeezy…",
        "Checking the latest Lemon Squeezy checkout…",
      ),
    );
    await confirmPendingPayment();
  }
}

function renderLoft() {
  const loft = portalState.loft;
  if (!loft) {
    [
      "loft-name",
      "loft-address",
      "loft-phone",
      "loft-email",
      "loft-website",
      "loft-social",
      "loft-location",
      "loft-language",
    ].forEach((id) => setText(id, tr("Non renseigné", "Not provided")));
    return;
  }

  setText("loft-name", loft.nameloft);
  setText("loft-address", loft.addressloft);
  setText("loft-phone", loft.phone);
  setText("loft-email", loft.email);
  setText("loft-website", loft.website);
  setText("loft-social", loft.social);

  const latitude = Number(loft.latitude);
  const longitude = Number(loft.longitude);
  const location =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
      : tr("Non renseigné", "Not provided");
  setText("loft-location", location);
  setText(
    "loft-language",
    languageLabels[String(loft.lang || "").toLowerCase()] || loft.lang,
  );
}

function createTextCell(primary, secondary = "") {
  const cell = document.createElement("td");
  const primaryElement = document.createElement("div");
  primaryElement.className = "table-primary";
  primaryElement.textContent = valueOrFallback(primary);
  cell.append(primaryElement);

  if (secondary) {
    const secondaryElement = document.createElement("div");
    secondaryElement.className = "table-secondary";
    secondaryElement.textContent = secondary;
    cell.append(secondaryElement);
  }

  return cell;
}

function createStatusPill(label, className) {
  const pill = document.createElement("span");
  pill.className = `status-pill ${className}`;
  pill.textContent = label;
  return pill;
}

function pigeonById(id) {
  if (!id) return null;
  return portalState.pigeons.find((pigeon) => pigeon.id === id) || null;
}

function pigeonDisplayName(pigeon) {
  if (!pigeon) return "";
  return pigeon.membership?.custom_name || pigeon.name_pigeon || "";
}

function pedigreeValue(value, fallback) {
  const clean = String(value || "").trim();
  return clean || fallback;
}

function pedigreeEnabled(value, fallback = true) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return fallback;
}

function buildPedigreeGenerations(root, level) {
  const generations = [[root]];
  for (let generation = 1; generation < level; generation += 1) {
    const current = [];
    for (const pigeon of generations[generation - 1]) {
      current.push(
        pigeonById(pigeon?.father_id),
        pigeonById(pigeon?.mother_id),
      );
    }
    generations.push(current);
  }
  return generations;
}

function renderPedigreeNode(pigeon, generationIndex, nodeIndex, settings) {
  if (!pigeon && settings.show_empty === false) return null;

  const membership = pigeon?.membership || {};
  const node = document.createElement("article");
  node.className = `pedigree-node${pigeon ? "" : " empty"}`;
  node.style.setProperty(
    "--pedigree-node-radius",
    `${Number(settings.radius) || 0}px`,
  );
  node.style.setProperty(
    "--pedigree-line",
    pedigreeValue(settings.color_line, "#000000"),
  );
  node.style.setProperty(
    "--pedigree-ring",
    pedigreeValue(settings.color_ring, "#c91e2e"),
  );
  node.style.setProperty(
    "--pedigree-name",
    pedigreeValue(settings.color_name, "#111111"),
  );
  node.style.setProperty(
    "--pedigree-fancier",
    pedigreeValue(settings.color_fancier, "#174ca0"),
  );
  node.style.setProperty(
    "--pedigree-color",
    pedigreeValue(settings.color_color, "#8b4513"),
  );
  node.style.setProperty(
    "--pedigree-fill",
    pedigreeValue(membership.frame_color, "#ffffff"),
  );
  if (pedigreeEnabled(settings.with_shadow)) node.classList.add("with-shadow");
  if (pedigreeEnabled(settings.with_separator))
    node.classList.add("with-separator");

  const rawGender = String(pigeon?.gender || "")
    .trim()
    .toUpperCase();
  const gender = document.createElement("span");
  gender.className = `pedigree-gender ${rawGender === "M" || rawGender === "♂" ? "male" : rawGender === "F" || rawGender === "♀" ? "female" : "unknown"}`;
  gender.textContent =
    rawGender === "M" || rawGender === "♂"
      ? "♂"
      : rawGender === "F" || rawGender === "♀"
        ? "♀"
        : rawGender;
  gender.hidden = !gender.textContent;

  const ring = document.createElement("strong");
  ring.className = "pedigree-ring";
  ring.textContent = pigeon ? formatRing(pigeon) : "";

  const name = document.createElement("span");
  name.className = "pedigree-name";
  name.textContent = pigeonDisplayName(pigeon);
  name.hidden = !name.textContent;

  const fancier = document.createElement("span");
  fancier.className = "pedigree-fancier";
  fancier.textContent = membership.custom_fancier || pigeon?.fancier || "";
  fancier.hidden = !fancier.textContent;

  const color = document.createElement("span");
  color.className = "pedigree-color";
  color.textContent = membership.custom_color || pigeon?.color || "";
  color.hidden = !color.textContent;

  const achievements = document.createElement("span");
  achievements.className = "pedigree-achievements";
  achievements.textContent =
    membership.achievements || membership.poster_details || "";
  achievements.hidden = !achievements.textContent;

  node.append(gender, ring, name, fancier, color, achievements);
  return node;
}

function outerHeight(element) {
  const style = window.getComputedStyle(element);
  return (
    element.offsetHeight +
    (Number.parseFloat(style.marginTop) || 0) +
    (Number.parseFloat(style.marginBottom) || 0)
  );
}

function fitPedigreeNodeContent() {
  document.querySelectorAll(".pedigree-node").forEach((node) => {
    const nodeStyle = window.getComputedStyle(node);
    const availableHeight =
      node.clientHeight -
      (Number.parseFloat(nodeStyle.paddingTop) || 0) -
      (Number.parseFloat(nodeStyle.paddingBottom) || 0);
    const ring = node.querySelector(".pedigree-ring");
    const details = [
      node.querySelector(".pedigree-name"),
      node.querySelector(".pedigree-fancier"),
      node.querySelector(".pedigree-color"),
    ];
    const achievements = node.querySelector(".pedigree-achievements");
    let usedHeight = ring ? outerHeight(ring) : 0;
    let canShowNextDetail = true;

    for (const detail of details) {
      if (!detail) continue;
      detail.hidden = !detail.textContent.trim();
      if (detail.hidden || !canShowNextDetail) {
        detail.hidden = true;
        continue;
      }

      const detailHeight = outerHeight(detail);
      if (usedHeight + detailHeight <= availableHeight) {
        usedHeight += detailHeight;
      } else {
        detail.hidden = true;
        canShowNextDetail = false;
      }
    }

    if (!achievements) return;
    achievements.style.height = "";
    achievements.style.maxHeight = "";
    achievements.hidden = !achievements.textContent.trim();
    if (achievements.hidden || !canShowNextDetail) {
      achievements.hidden = true;
      return;
    }

    const achievementStyle = window.getComputedStyle(achievements);
    const lineHeight = Number.parseFloat(achievementStyle.lineHeight) || 8;
    const marginTop = Number.parseFloat(achievementStyle.marginTop) || 0;
    const supportedLines = Math.floor(
      Math.max(0, availableHeight - usedHeight - marginTop) / lineHeight,
    );

    if (supportedLines < 1) {
      achievements.hidden = true;
      return;
    }

    const supportedHeight = supportedLines * lineHeight;
    achievements.style.height = `${supportedHeight}px`;
    achievements.style.maxHeight = `${supportedHeight}px`;
  });
}

function closePedigreePreview() {
  document.querySelector("#pedigree-modal").hidden = true;
  document.body.classList.remove("modal-open");
}

async function loadVerificationUrl(pigeonId) {
  const { data, error } = await supabase
    .from("pigeon_verification")
    .select("verification_token")
    .eq("pigeon_id", pigeonId)
    .limit(1)
    .maybeSingle();

  if (error || !data?.verification_token) return "";
  return `https://micolpe.com/verify-pigeon?code=${encodeURIComponent(data.verification_token)}`;
}

function renderVerificationQr(url, settings) {
  const container = document.querySelector("#pedigree-footer-qr");
  container.replaceChildren();
  container.hidden = true;
  if (!url || !pedigreeEnabled(settings.with_barcode) || !window.QRCode) return;

  new window.QRCode(container, {
    text: url,
    width: 54,
    height: 54,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: window.QRCode.CorrectLevel.M,
  });
  container.hidden = false;
}

async function openPedigreePreview(pigeon) {
  const loading = document.querySelector("#pedigree-loading");
  const error = document.querySelector("#pedigree-error");
  const preview = document.querySelector("#pedigree-preview-wrap");
  const generationsElement = document.querySelector("#pedigree-generations");
  const settings = portalState.pedigreeSettings || {};
  const level = Math.min(6, Math.max(1, Number(settings.level_gen) || 5));
  const isOwner = pedigreeEnabled(pigeon.membership?.is_owner, false);

  document.querySelector("#pedigree-modal").hidden = false;
  loading.hidden = false;
  error.hidden = true;
  preview.hidden = true;
  document.body.classList.add("modal-open");

  try {
    document.querySelector("#pedigree-modal-title").textContent = tr(
      `Pedigree — ${formatRing(pigeon)}`,
      `Pedigree — ${formatRing(pigeon)}`,
    );
    document.querySelector("#pedigree-root-ring").textContent =
      formatRing(pigeon);
    document.querySelector("#pedigree-sheet-heading").textContent =
      "Pigeon Pedigree";
    const loftName = document.querySelector("#pedigree-loft-name");
    const loftContact = document.querySelector("#pedigree-loft-contact");
    const visibleLoftName =
      isOwner && pedigreeEnabled(settings.with_loftname)
        ? String(portalState.loft?.nameloft || "").trim()
        : "";
    const loftDetails = isOwner
      ? [
          pedigreeEnabled(settings.with_email) ? portalState.loft?.email : "",
          pedigreeEnabled(settings.with_phone) ? portalState.loft?.phone : "",
          pedigreeEnabled(settings.with_address)
            ? portalState.loft?.addressloft
            : "",
          pedigreeEnabled(settings.with_website)
            ? portalState.loft?.website
            : "",
          pedigreeEnabled(settings.with_social) ? portalState.loft?.social : "",
        ].filter((value) => String(value || "").trim())
      : [];
    loftName.textContent = visibleLoftName;
    loftName.hidden = !visibleLoftName;
    loftContact.textContent = loftDetails.join(" · ");
    loftContact.hidden = !loftDetails.length;

    const loftLogo = document.querySelector("#pedigree-loft-logo");
    const showLogo =
      isOwner &&
      pedigreeEnabled(settings.with_logo) &&
      String(portalState.loft?.logo || "").trim();
    loftLogo.hidden = !showLogo;
    if (showLogo) {
      loftLogo.src = String(portalState.loft.logo).trim();
      loftLogo.alt = `Logo ${pedigreeValue(portalState.loft?.nameloft, "du loft")}`;
      loftLogo.onerror = () => {
        loftLogo.hidden = true;
        loftLogo.removeAttribute("src");
      };
    } else {
      loftLogo.removeAttribute("src");
      loftLogo.alt = "";
    }

    const sheet = document.querySelector("#pedigree-sheet");
    sheet.style.setProperty(
      "--pedigree-font",
      pedigreeValue(settings.font, "Roboto"),
    );
    sheet.style.setProperty(
      "--pedigree-title",
      pedigreeValue(settings.color_title, "#606060"),
    );
    sheet.dataset.level = String(level);
    generationsElement.replaceChildren();

    buildPedigreeGenerations(pigeon, level).forEach(
      (generation, generationIndex) => {
        const column = document.createElement("div");
        column.className = "pedigree-generation";
        column.dataset.generation = String(generationIndex + 1);
        generation.forEach((ancestor, nodeIndex) => {
          const node = renderPedigreeNode(
            ancestor,
            generationIndex,
            nodeIndex,
            settings,
          );
          if (node) column.append(node);
        });
        generationsElement.append(column);
      },
    );

    document.querySelector("#pedigree-footer-brand").textContent =
      isOwner && String(portalState.loft?.nameloft || "").trim()
        ? `Micolpe Web ¤ ${portalState.loft.nameloft}`
        : "Micolpe Web";
    const footerDate = document.querySelector("#pedigree-footer-date");
    footerDate.textContent = pedigreeEnabled(settings.with_date)
      ? new Intl.DateTimeFormat(isEnglish ? "en-GB" : "fr-FR").format(
          new Date(),
        )
      : "";
    footerDate.hidden = !footerDate.textContent;
    renderVerificationQr(await loadVerificationUrl(pigeon.id), settings);

    loading.hidden = true;
    preview.hidden = false;
    window.requestAnimationFrame(fitPedigreeNodeContent);
  } catch (previewError) {
    loading.hidden = true;
    error.hidden = false;
    error.textContent = tr(
      "La prévisualisation du pedigree est momentanément indisponible.",
      "The pedigree preview is temporarily unavailable.",
    );
    console.error(previewError);
  }
}

function renderDevices() {
  const body = document.querySelector("#devices-table-body");
  const empty = document.querySelector("#devices-empty");
  body.replaceChildren();

  if (!portalState.devices.length) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  const fragment = document.createDocumentFragment();

  for (const device of portalState.devices) {
    const row = document.createElement("tr");
    row.append(
      createTextCell(device.device_name),
      createTextCell(device.device_type === "mobile" ? "Mobile" : "Desktop"),
      createTextCell(formatDate(device.last_seen)),
    );

    const statusCell = document.createElement("td");
    statusCell.append(
      device.is_revoked
        ? createStatusPill(tr("Révoqué", "Revoked"), "revoked")
        : createStatusPill(tr("Actif", "Active"), "active"),
    );
    row.append(statusCell);
    fragment.append(row);
  }

  body.append(fragment);
}

function filteredPigeons() {
  const ringSearch = normalizeSearch(
    document.querySelector("#pigeon-ring-search").value,
  );
  const nameSearch = normalizeSearch(
    document.querySelector("#pigeon-name-search").value,
  );
  const fatherSearch = normalizeSearch(
    document.querySelector("#pigeon-father-search").value,
  );
  const motherSearch = normalizeSearch(
    document.querySelector("#pigeon-mother-search").value,
  );
  const state = document.querySelector("#pigeon-state-filter").value;
  const gender = document.querySelector("#pigeon-gender-filter").value;

  return portalState.pigeons.filter((pigeon) => {
    const membership = pigeon.membership || {};
    const matchesRing =
      !ringSearch || normalizeSearch(formatRing(pigeon)).includes(ringSearch);
    const matchesName =
      !nameSearch ||
      normalizeSearch(
        [membership.custom_name, pigeon.name_pigeon].filter(Boolean).join(" "),
      ).includes(nameSearch);
    const matchesFather =
      !fatherSearch ||
      normalizeSearch(formatRing(pigeonById(pigeon.father_id))).includes(
        fatherSearch,
      );
    const matchesMother =
      !motherSearch ||
      normalizeSearch(formatRing(pigeonById(pigeon.mother_id))).includes(
        motherSearch,
      );
    const matchesState = !state || membership.state === state;
    const matchesGender = !gender || genderSymbol(pigeon.gender) === gender;
    return (
      matchesRing &&
      matchesName &&
      matchesFather &&
      matchesMother &&
      matchesState &&
      matchesGender
    );
  });
}

function renderPigeons() {
  const body = document.querySelector("#pigeons-table-body");
  const empty = document.querySelector("#pigeons-empty");
  const previousButton = document.querySelector("#pigeon-previous");
  const nextButton = document.querySelector("#pigeon-next");
  const paginationLabel = document.querySelector("#pigeon-pagination-label");
  const pigeons = filteredPigeons();
  const totalPages = Math.max(1, Math.ceil(pigeons.length / PAGE_SIZE));

  if (portalState.page >= totalPages) portalState.page = totalPages - 1;

  const start = portalState.page * PAGE_SIZE;
  const visiblePigeons = pigeons.slice(start, start + PAGE_SIZE);
  body.replaceChildren();

  if (!visiblePigeons.length) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    const fragment = document.createDocumentFragment();

    for (const pigeon of visiblePigeons) {
      const membership = pigeon.membership || {};
      const row = document.createElement("tr");
      row.append(
        createTextCell(formatRing(pigeon), valueOrFallback(pigeon.country, "")),
        createTextCell(membership.custom_name || pigeon.name_pigeon),
        createTextCell(formatRing(pigeonById(pigeon.father_id))),
        createTextCell(formatRing(pigeonById(pigeon.mother_id))),
      );

      const statusCell = document.createElement("td");
      statusCell.append(
        createStatusPill(
          stateLabels[membership.state] || tr("Non classé", "Unclassified"),
          membership.state === "actif" ? "active" : "neutral",
        ),
      );
      row.append(statusCell);

      const actionCell = document.createElement("td");
      actionCell.className = "pigeon-actions";
      const previewButton = document.createElement("button");
      previewButton.type = "button";
      previewButton.className = "btn secondary small pedigree-preview-button";
      previewButton.textContent = "Pedigree";
      previewButton.setAttribute(
        "aria-label",
        tr(
          `Prévisualiser le pedigree de ${formatRing(pigeon)}`,
          `View pedigree for ${formatRing(pigeon)}`,
        ),
      );
      previewButton.addEventListener("click", () =>
        openPedigreePreview(pigeon),
      );

      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = "btn secondary small future-action";
      actionButton.disabled = true;
      actionButton.title = tr("Disponible prochainement", "Available soon");
      actionButton.textContent = tr("Modifier", "Edit");
      actionCell.append(previewButton, actionButton);
      row.append(actionCell);
      fragment.append(row);
    }

    body.append(fragment);
  }

  const firstVisible = pigeons.length ? start + 1 : 0;
  const lastVisible = Math.min(start + PAGE_SIZE, pigeons.length);
  paginationLabel.textContent = tr(
    `${firstVisible}–${lastVisible} sur ${pigeons.length} pigeon${pigeons.length > 1 ? "s" : ""}`,
    `${firstVisible}–${lastVisible} of ${pigeons.length} pigeon${pigeons.length !== 1 ? "s" : ""}`,
  );
  previousButton.disabled = portalState.page === 0;
  nextButton.disabled = portalState.page >= totalPages - 1;
}

function showSection(sectionName) {
  const allowed = [
    "overview",
    "profile",
    "payments",
    "loft",
    "devices",
    "pigeons",
  ];
  const requested = allowed.includes(sectionName) ? sectionName : "overview";
  const target = isRenewalOnly() ? "payments" : requested;

  document.querySelectorAll("[data-portal-section]").forEach((section) => {
    section.hidden = section.dataset.portalSection !== target;
  });

  document.querySelectorAll("[data-section-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.sectionTarget === target);
  });

  if (window.location.hash !== `#${target}`) {
    window.history.replaceState({}, "", `#${target}`);
  }
}

function configurePortalAccessMode() {
  const renewalOnly = isRenewalOnly();

  document.body.classList.toggle("portal-renewal-only", renewalOnly);

  document.querySelectorAll("[data-section-target]").forEach((button) => {
    const paymentTarget = button.dataset.sectionTarget === "payments";
    button.hidden = renewalOnly && !paymentTarget;
    button.disabled = renewalOnly && !paymentTarget;
  });

  const renewalNotice = document.querySelector("#portal-renewal-notice");
  if (renewalNotice) renewalNotice.hidden = !renewalOnly;

  const portalIntro = document.querySelector("#portal-intro");
  if (portalIntro && renewalOnly) {
    portalIntro.textContent = tr(
      "Votre accès est expiré. Renouvelez-le pour retrouver toutes les sections de votre espace.",
      "Your access has expired. Renew it to reopen every section of your account.",
    );
  }
}

function renderPortal(data) {
  Object.assign(portalState, data, { page: 0 });
  renderMember(portalState.profile);
  configurePortalAccessMode();
  renderPayments();

  if (!isRenewalOnly()) {
    renderSummary();
    renderProfile();
    renderLoft();
    renderDevices();
    renderPigeons();
  }

  document.querySelector("#portal-loading").hidden = true;
  document.querySelector("#portal-error").hidden = true;
  document.querySelector("#portal-sections").hidden = false;
  const returnedFromPayment = new URLSearchParams(window.location.search).has(
    "payment",
  );
  showSection(
    isRenewalOnly() || returnedFromPayment
      ? "payments"
      : window.location.hash.replace("#", "") || "overview",
  );
}

function showPortalError(message) {
  document.querySelector("#portal-loading").hidden = true;
  document.querySelector("#portal-sections").hidden = true;
  document.querySelector("#portal-error").hidden = false;
  setText(
    "portal-error-message",
    message,
    tr(
      "Une erreur temporaire est survenue. Réessayez dans quelques instants.",
      "A temporary error occurred. Please try again shortly.",
    ),
  );
}

function bindInteractions() {
  const verifyPendingPaymentOnReturn = () => {
    if (
      portalState.pendingPayment &&
      !portalState.confirmationInProgress &&
      document.visibilityState === "visible"
    ) {
      void confirmPendingPayment();
    }
  };

  window.addEventListener("focus", verifyPendingPaymentOnReturn);
  document.addEventListener("visibilitychange", verifyPendingPaymentOnReturn);

  document.querySelectorAll("[data-section-target]").forEach((button) => {
    button.addEventListener("click", () => {
      showSection(button.dataset.sectionTarget);
    });
  });

  document.querySelectorAll("[data-open-payments]").forEach((button) => {
    button.addEventListener("click", () => showSection("payments"));
  });

  for (const filterId of [
    "pigeon-ring-search",
    "pigeon-name-search",
    "pigeon-father-search",
    "pigeon-mother-search",
    "pigeon-state-filter",
    "pigeon-gender-filter",
  ]) {
    document.querySelector(`#${filterId}`).addEventListener("input", () => {
      portalState.page = 0;
      renderPigeons();
    });
  }

  document.querySelector("#pigeon-previous").addEventListener("click", () => {
    if (portalState.page > 0) {
      portalState.page -= 1;
      renderPigeons();
    }
  });

  document.querySelector("#pigeon-next").addEventListener("click", () => {
    portalState.page += 1;
    renderPigeons();
  });

  document
    .querySelector("#logout-button")
    .addEventListener("click", async () => {
      const button = document.querySelector("#logout-button");
      button.disabled = true;
      button.textContent = tr("Déconnexion…", "Signing out…");
      try {
        await logoutCurrentBrowser();
        window.location.replace(isEnglish ? "/en/login.html" : "/login.html");
      } catch {
        button.disabled = false;
        button.textContent = tr("Se déconnecter", "Sign out");
        showPortalError(
          tr(
            "La déconnexion a échoué. Réessayez.",
            "Sign-out failed. Please try again.",
          ),
        );
      }
    });

  document.querySelector("#retry-button").addEventListener("click", () => {
    window.location.reload();
  });

  document
    .querySelector("#pedigree-export-pdf")
    .addEventListener("click", () => {
      window.print();
    });

  document.querySelectorAll("[data-close-pedigree]").forEach((button) => {
    button.addEventListener("click", closePedigreePreview);
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !document.querySelector("#pedigree-modal").hidden
    ) {
      closePedigreePreview();
    }
  });
}

async function initializePortal() {
  bindInteractions();

  try {
    const authState = await requireActiveSession();
    if (!authState) return;
    const data =
      authState.accessMode === "renewal"
        ? {
            profile: authState.profile,
            loft: null,
            devices: [],
            pigeons: [],
            pedigreeSettings: null,
            pigeonCount: 0,
          }
        : await loadPortalData(authState.session, authState.profile);
    let paymentData;
    let checkoutAccess;

    try {
      paymentData = await loadPaymentData(authState.session.user.id);
    } catch (paymentError) {
      console.error("Micolpe payment catalog unavailable", paymentError);
      paymentData = {
        plans: [],
        posterOffers: [],
        posterBalance: 0,
        paymentCatalogError: paymentError,
      };
    }

    try {
      checkoutAccess = await loadCheckoutAccess();
    } catch (checkoutAccessError) {
      console.error("Micolpe checkout access unavailable", checkoutAccessError);
      checkoutAccess = {
        checkoutAllowed: false,
        checkoutTestMode: true,
        checkoutAccessError,
      };
    }

    renderPortal({
      ...data,
      ...paymentData,
      ...checkoutAccess,
      session: authState.session,
      accessMode: authState.accessMode,
    });
    await initializePaymentExperience();
  } catch {
    showPortalError(
      tr(
        "Vos données ne peuvent pas être chargées pour le moment. Vérifiez votre connexion puis réessayez.",
        "Your data cannot be loaded at the moment. Check your connection and try again.",
      ),
    );
  }
}

initializePortal();
