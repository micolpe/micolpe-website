import {
  AUTH_ERROR,
  getCurrentSession,
  loginWithPassword,
} from './auth.js';

const form = document.querySelector('#login-form');
const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const submitButton = document.querySelector('#login-submit');
const statusBox = document.querySelector('#login-status');
const passwordToggle = document.querySelector('#toggle-password');
const isEnglish = document.documentElement.lang === 'en';
const tr = (fr, en) => (isEnglish ? en : fr);

const messages = {
  [AUTH_ERROR.INVALID_CREDENTIALS]:
    tr('Adresse e-mail ou mot de passe incorrect.', 'Incorrect email address or password.'),
  [AUTH_ERROR.EMAIL_CONFIRMATION_REQUIRED]:
    tr('Votre adresse e-mail n’est pas encore confirmée. Ouvrez le message envoyé par Micolpe, puis réessayez.', 'Your email address has not been confirmed yet. Open the message sent by Micolpe, then try again.'),
  [AUTH_ERROR.ACCOUNT_DISABLED]:
    tr('Ce compte Micolpe est désactivé. Contactez le support.', 'This Micolpe account is disabled. Contact support.'),
  [AUTH_ERROR.SUBSCRIPTION_EXPIRED]:
    tr('Votre abonnement ou votre période d’essai est expiré.', 'Your subscription or trial period has expired.'),
  [AUTH_ERROR.PROFILE_INITIALIZATION_FAILED]:
    tr('Votre compte est confirmé, mais le profil Micolpe n’a pas pu être initialisé. Réessayez dans quelques instants.', 'Your account is confirmed, but the Micolpe profile could not be prepared. Please try again shortly.'),
  [AUTH_ERROR.NETWORK]:
    tr('Connexion au service impossible. Vérifiez votre accès internet.', 'Unable to reach the service. Check your internet connection.'),
  [AUTH_ERROR.UNKNOWN]: tr('Connexion impossible pour le moment.', 'Unable to sign in at the moment.'),
  session_required: tr('Connectez-vous pour accéder à votre espace Micolpe.', 'Sign in to access your Micolpe account.'),
};

function setLoading(loading) {
  submitButton.disabled = loading;
  emailInput.disabled = loading;
  passwordInput.disabled = loading;
  submitButton.classList.toggle('is-loading', loading);
  submitButton.querySelector('.button-label').textContent = loading
    ? tr('Connexion en cours…', 'Signing in…')
    : tr('Se connecter', 'Sign in');
}

function showStatus(message, type = 'info') {
  statusBox.textContent = message;
  statusBox.className = `auth-status ${type}`;
  statusBox.hidden = false;
}

function hideStatus() {
  statusBox.hidden = true;
  statusBox.textContent = '';
}

function safeNextDestination({ renewalOnly = false } = {}) {
  const next = new URLSearchParams(window.location.search).get('next');
  const defaultDashboard = isEnglish ? '/en/dashboard.html' : '/dashboard.html';
  if (!next) return `${defaultDashboard}${renewalOnly ? '#payments' : ''}`;

  try {
    const destination = new URL(next, window.location.origin);
    if (destination.origin !== window.location.origin) {
      return `${defaultDashboard}${renewalOnly ? '#payments' : ''}`;
    }
    const allowedDashboards = ['/dashboard.html', '/en/dashboard.html'];
    if (!allowedDashboards.includes(destination.pathname)) {
      return `${defaultDashboard}${renewalOnly ? '#payments' : ''}`;
    }
    return `${destination.pathname}${destination.search}${renewalOnly ? '#payments' : destination.hash}`;
  } catch {
    return `${defaultDashboard}${renewalOnly ? '#payments' : ''}`;
  }
}

async function initializeLogin() {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get('reason');
  if (reason && messages[reason]) showStatus(messages[reason], 'info');

  try {
    const session = await getCurrentSession();
    if (session) {
      showStatus(
        tr('Session Micolpe détectée. Ouverture de votre espace…', 'Micolpe session found. Opening your account…'),
        'success',
      );
      window.location.replace(safeNextDestination());
      return;
    }
  } catch {
    showStatus(messages[AUTH_ERROR.NETWORK], 'error');
  }

  emailInput.focus();
}

passwordToggle.addEventListener('click', () => {
  const isHidden = passwordInput.type === 'password';
  passwordInput.type = isHidden ? 'text' : 'password';
  passwordToggle.setAttribute('aria-pressed', String(isHidden));
  passwordToggle.textContent = isHidden ? tr('Masquer', 'Hide') : tr('Afficher', 'Show');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideStatus();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showStatus(
      tr('Saisissez votre adresse e-mail et votre mot de passe.', 'Enter your email address and password.'),
      'error',
    );
    return;
  }

  if (!emailInput.validity.valid) {
    showStatus(tr('Saisissez une adresse e-mail valide.', 'Enter a valid email address.'), 'error');
    emailInput.focus();
    return;
  }

  setLoading(true);
  showStatus(tr('Vérification de votre compte Micolpe…', 'Checking your Micolpe account…'), 'info');

  const result = await loginWithPassword(email, password);

  if (!result.success) {
    const message =
      messages[result.error] ||
      String(result.error || messages[AUTH_ERROR.UNKNOWN]);
    showStatus(message, 'error');
    setLoading(false);
    return;
  }

  const displayName = String(
    result.profile?.name || result.user?.email || tr('utilisateur', 'member'),
  ).trim();
  const renewalOnly = result.accessMode === 'renewal';
  showStatus(
    renewalOnly
      ? tr(
          `Bienvenue ${displayName}. Renouvelez votre accès pour rouvrir votre espace Micolpe.`,
          `Welcome ${displayName}. Renew your access to reopen your Micolpe account.`,
        )
      : tr(
          `Bienvenue ${displayName}. Connexion réussie.`,
          `Welcome ${displayName}. You are signed in.`,
        ),
    'success',
  );
  window.location.replace(safeNextDestination({ renewalOnly }));
});

initializeLogin();
