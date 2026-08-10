import {
  AUTH_ERROR,
  checkProfileAccess,
  getCurrentSession,
  isSubscriptionExpired,
  logoutCurrentBrowser,
} from './auth.js';
import { supabase } from './supabase-client.js';

function currentReturnPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function redirectToLogin(reason = '') {
  const query = new URLSearchParams({ next: currentReturnPath() });
  if (reason) query.set('reason', reason);
  const loginPath = window.location.pathname.startsWith('/en/')
    ? '/en/login.html'
    : '/login.html';
  window.location.replace(`${loginPath}?${query.toString()}`);
}

export async function requireActiveSession() {
  const session = await getCurrentSession();
  if (!session?.user) {
    redirectToLogin('session_required');
    return null;
  }

  const { data: profile, error } = await supabase
    .from('profile')
    .select(
      'id,name,email,phone,is_verified,is_active,is_trial,subscription_type,subscription_start,subscription_end,pending_deletion_at,created_at,last_login',
    )
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) throw error;

  if (!profile) {
    await logoutCurrentBrowser();
    redirectToLogin(AUTH_ERROR.PROFILE_INITIALIZATION_FAILED);
    return null;
  }

  const renewalOnly = isSubscriptionExpired(profile);
  const accessError = checkProfileAccess(profile, { allowExpired: true });
  if (accessError) {
    await logoutCurrentBrowser();
    redirectToLogin(accessError);
    return null;
  }

  return {
    session,
    profile,
    accessMode: renewalOnly ? 'renewal' : 'full',
  };
}
