import { supabase } from './supabase-client.js';

export const AUTH_ERROR = Object.freeze({
  INVALID_CREDENTIALS: 'invalid_credentials',
  EMAIL_CONFIRMATION_REQUIRED: 'email_confirmation_required',
  ACCOUNT_ALREADY_EXISTS: 'account_already_exists',
  ACCOUNT_DISABLED: 'account_disabled',
  SUBSCRIPTION_EXPIRED: 'subscription_expired',
  PROFILE_INITIALIZATION_FAILED: 'profile_initialization_failed',
  NETWORK: 'network_error',
  UNKNOWN: 'unknown_error',
});

const PROFILE_RETRY_DELAYS = [0, 350, 700];
const PROFILE_AUTH_FIELDS =
  'id,name,email,phone,is_verified,is_active,is_trial,subscription_type,subscription_start,subscription_end,created_at,last_login';

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function isTrue(value) {
  return value === true || value === 1 || value === '1';
}

export function normalizeAuthError(error) {
  const code = String(error?.code ?? '').toLowerCase();
  const message = String(error?.message ?? '').toLowerCase();

  if (
    code === 'email_not_confirmed' ||
    message.includes('email not confirmed') ||
    message.includes('email_not_confirmed')
  ) {
    return AUTH_ERROR.EMAIL_CONFIRMATION_REQUIRED;
  }

  if (
    code === 'invalid_credentials' ||
    message.includes('invalid login credentials')
  ) {
    return AUTH_ERROR.INVALID_CREDENTIALS;
  }

  if (
    code === 'user_already_exists' ||
    message.includes('already registered') ||
    message.includes('already exists')
  ) {
    return AUTH_ERROR.ACCOUNT_ALREADY_EXISTS;
  }

  if (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('load failed')
  ) {
    return AUTH_ERROR.NETWORK;
  }

  return error?.message || AUTH_ERROR.UNKNOWN;
}

export function checkProfileAccess(profile) {
  if (!isTrue(profile?.is_verified)) {
    return AUTH_ERROR.EMAIL_CONFIRMATION_REQUIRED;
  }

  if (!isTrue(profile?.is_active)) {
    return AUTH_ERROR.ACCOUNT_DISABLED;
  }

  if (profile?.subscription_end) {
    const endDate = new Date(profile.subscription_end);
    if (!Number.isNaN(endDate.getTime()) && Date.now() > endDate.getTime()) {
      return AUTH_ERROR.SUBSCRIPTION_EXPIRED;
    }
  }

  return null;
}

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function loadOrRepairProfile(user, email = '') {
  const firstRead = await supabase
    .from('profile')
    .select(PROFILE_AUTH_FIELDS)
    .eq('id', user.id)
    .maybeSingle();

  if (firstRead.error) throw firstRead.error;
  if (firstRead.data) return firstRead.data;

  const metadataName = String(user.user_metadata?.name ?? '').trim();
  const effectiveEmail = String(user.email || email).trim();
  const { error: rpcError } = await supabase.rpc('ensure_profile', {
    p_user_id: user.id,
    p_email: effectiveEmail,
    p_name: metadataName,
  });

  if (rpcError) throw rpcError;

  for (const delay of PROFILE_RETRY_DELAYS) {
    if (delay) await wait(delay);

    const result = await supabase
      .from('profile')
      .select(PROFILE_AUTH_FIELDS)
      .eq('id', user.id)
      .maybeSingle();

    if (result.error) throw result.error;
    if (result.data) return result.data;
  }

  return null;
}

async function ensureDefaultLoft(user, profile) {
  const existing = await supabase
    .from('loft')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const now = new Date().toISOString();
  const browserLanguage = String(navigator.language || 'fr')
    .slice(0, 2)
    .toLowerCase();
  const supportedLanguage = ['fr', 'en', 'nl', 'it', 'de', 'es'].includes(
    browserLanguage,
  )
    ? browserLanguage
    : 'fr';

  const defaultLoft = {
    id: crypto.randomUUID(),
    nameloft: String(profile?.name || '').trim(),
    addressloft: '',
    phone: '',
    email: String(profile?.email || user.email || '').trim(),
    latitude: null,
    longitude: null,
    logo: '',
    social: '',
    lang: supportedLanguage,
    user_id: user.id,
    confirmed: true,
    website: '',
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('loft')
    .insert(defaultLoft)
    .select('id')
    .single();

  if (error) throw error;
  return data;
}

export async function initializeConfirmedAccount(user, email = '') {
  const profile = await loadOrRepairProfile(user, email);
  if (!profile) {
    throw new Error(AUTH_ERROR.PROFILE_INITIALIZATION_FAILED);
  }

  try {
    await ensureDefaultLoft(user, profile);
  } catch {
    // L'absence temporaire du loft ne doit pas bloquer l'accès au compte.
  }

  return profile;
}

export async function registerWithPassword({
  fullName,
  email,
  password,
  emailRedirectTo,
}) {
  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo,
        data: { name: String(fullName).trim() },
      },
    });

    if (error) throw error;

    if (data.user?.identities && data.user.identities.length === 0) {
      return { success: false, error: AUTH_ERROR.ACCOUNT_ALREADY_EXISTS };
    }

    if (data.session && data.user) {
      const profile = await initializeConfirmedAccount(
        data.user,
        normalizedEmail,
      );
      return {
        success: true,
        confirmationRequired: false,
        session: data.session,
        user: data.user,
        profile,
      };
    }

    return {
      success: true,
      confirmationRequired: true,
      user: data.user,
    };
  } catch (error) {
    return { success: false, error: normalizeAuthError(error) };
  }
}

export async function loginWithPassword(email, password) {
  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) throw error;
    if (!data.user || !data.session) {
      return { success: false, error: AUTH_ERROR.INVALID_CREDENTIALS };
    }

    const profile = await initializeConfirmedAccount(
      data.user,
      normalizedEmail,
    );
    const accessError = checkProfileAccess(profile);

    if (accessError) {
      await supabase.auth.signOut({ scope: 'local' });
      return { success: false, error: accessError };
    }

    const { error: updateError } = await supabase
      .from('profile')
      .update({ last_login: new Date().toISOString() })
      .eq('id', data.user.id);

    if (updateError) {
      console.warn('[MICOLPE AUTH] La date de connexion n’a pas été actualisée.');
    }

    return {
      success: true,
      session: data.session,
      user: data.user,
      profile,
    };
  } catch (error) {
    return { success: false, error: normalizeAuthError(error) };
  }
}

export async function completeEmailConfirmation() {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;

      params.delete('code');
      const cleanQuery = params.toString();
      window.history.replaceState(
        {},
        document.title,
        `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`,
      );
    }

    let session = await getCurrentSession();
    for (let attempt = 0; !session && attempt < 8; attempt += 1) {
      await wait(250);
      session = await getCurrentSession();
    }

    if (!session?.user) {
      return {
        success: false,
        error: AUTH_ERROR.EMAIL_CONFIRMATION_REQUIRED,
      };
    }

    const profile = await initializeConfirmedAccount(
      session.user,
      session.user.email || params.get('email') || '',
    );
    const accessError = checkProfileAccess(profile);

    if (accessError) {
      return { success: false, error: accessError };
    }

    return { success: true, session, user: session.user, profile };
  } catch (error) {
    return { success: false, error: normalizeAuthError(error) };
  }
}

export async function resendConfirmationEmail(email, emailRedirectTo) {
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: String(email).trim().toLowerCase(),
      options: { emailRedirectTo },
    });
    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: normalizeAuthError(error) };
  }
}

export async function logoutCurrentBrowser() {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}
