import {
  AUTH_ERROR,
  completeEmailConfirmation,
  resendConfirmationEmail,
} from './auth.js';

const statusBox = document.querySelector('#confirmation-status');
const emailForm = document.querySelector('#resend-form');
const emailInput = document.querySelector('#confirmation-email');
const resendButton = document.querySelector('#resend-submit');
const checkButton = document.querySelector('#check-confirmation');
const isEnglish = document.documentElement.lang === 'en';
const tr = (fr, en) => (isEnglish ? en : fr);

const messages = {
  [AUTH_ERROR.EMAIL_CONFIRMATION_REQUIRED]:
    tr('Cliquez sur le lien reçu par e-mail. Cette page terminera ensuite automatiquement votre inscription.', 'Click the link received by email. This page will then complete your registration automatically.'),
  [AUTH_ERROR.ACCOUNT_DISABLED]:
    tr('Ce compte Micolpe est désactivé. Contactez le support.', 'This Micolpe account is disabled. Contact support.'),
  [AUTH_ERROR.SUBSCRIPTION_EXPIRED]:
    tr('Votre période d’accès Micolpe est expirée.', 'Your Micolpe access period has expired.'),
  [AUTH_ERROR.NETWORK]:
    tr('Connexion impossible. Vérifiez votre accès internet puis réessayez.', 'Unable to connect. Check your internet connection and try again.'),
  [AUTH_ERROR.PROFILE_INITIALIZATION_FAILED]:
    tr('Votre e-mail est confirmé, mais le profil Micolpe n’a pas encore pu être préparé.', 'Your email is confirmed, but your Micolpe profile could not be prepared yet.'),
};

function confirmationUrl() {
  return new URL(isEnglish ? '/en/confirm-email.html' : '/confirm-email.html', window.location.origin).toString();
}

function showStatus(message, type = 'info') {
  statusBox.textContent = message;
  statusBox.className = `auth-status ${type}`;
  statusBox.hidden = false;
}

function setChecking(checking) {
  checkButton.disabled = checking;
  checkButton.textContent = checking
    ? tr('Vérification en cours…', 'Checking…')
    : tr('Vérifier maintenant', 'Check now');
}

async function checkConfirmation() {
  setChecking(true);
  showStatus(tr('Vérification de votre confirmation…', 'Checking your confirmation…'), 'info');

  const result = await completeEmailConfirmation();
  if (result.success) {
    window.sessionStorage.removeItem('micolpe-pending-confirmation-email');
    showStatus(tr('Compte confirmé. Ouverture de votre espace Micolpe…', 'Account confirmed. Opening your Micolpe account…'), 'success');
    window.location.replace(isEnglish ? '/en/dashboard.html' : '/dashboard.html');
    return;
  }

  showStatus(
    messages[result.error] ||
      String(result.error || tr('Confirmation impossible pour le moment.', 'Confirmation is unavailable at the moment.')),
    result.error === AUTH_ERROR.EMAIL_CONFIRMATION_REQUIRED ? 'info' : 'error',
  );
  setChecking(false);
}

emailForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();

  if (!email || !emailInput.validity.valid) {
    showStatus(tr('Saisissez une adresse e-mail valide.', 'Enter a valid email address.'), 'error');
    emailInput.focus();
    return;
  }

  resendButton.disabled = true;
  resendButton.textContent = tr('Envoi en cours…', 'Sending…');

  const result = await resendConfirmationEmail(email, confirmationUrl());
  if (result.success) {
    showStatus(
      tr('Un nouveau lien de confirmation vient d’être envoyé. Pensez à vérifier les courriers indésirables.', 'A new confirmation link has been sent. Remember to check your spam folder.'),
      'success',
    );
  } else {
    showStatus(
      messages[result.error] ||
      String(result.error || tr('Le lien n’a pas pu être renvoyé.', 'The link could not be resent.')),
      'error',
    );
  }

  resendButton.disabled = false;
  resendButton.textContent = tr('Renvoyer le lien', 'Resend link');
});

checkButton.addEventListener('click', checkConfirmation);

const params = new URLSearchParams(window.location.search);
emailInput.value =
  params.get('email') ||
  window.sessionStorage.getItem('micolpe-pending-confirmation-email') ||
  '';

const callbackError =
  params.get('error_description') ||
  new URLSearchParams(window.location.hash.replace(/^#/, '')).get(
    'error_description',
  );

if (callbackError) {
  showStatus(callbackError, 'error');
} else {
  checkConfirmation();
}
