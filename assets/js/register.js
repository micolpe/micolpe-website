import {
  AUTH_ERROR,
  getCurrentSession,
  registerWithPassword,
} from './auth.js';

const form = document.querySelector('#register-form');
const fullNameInput = document.querySelector('#full-name');
const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const confirmationInput = document.querySelector('#password-confirmation');
const submitButton = document.querySelector('#register-submit');
const statusBox = document.querySelector('#register-status');
const isEnglish = document.documentElement.lang === 'en';
const tr = (fr, en) => (isEnglish ? en : fr);

const messages = {
  [AUTH_ERROR.ACCOUNT_ALREADY_EXISTS]:
    tr('Un compte existe déjà avec cette adresse e-mail. Utilisez la page de connexion.', 'An account already exists with this email address. Use the sign-in page.'),
  [AUTH_ERROR.NETWORK]:
    tr('Inscription impossible sans connexion internet. Vérifiez votre réseau.', 'Registration requires an internet connection. Check your network.'),
  [AUTH_ERROR.UNKNOWN]:
    tr('L’inscription est momentanément indisponible. Réessayez dans quelques instants.', 'Registration is temporarily unavailable. Please try again shortly.'),
};

function confirmationUrl() {
  return new URL(isEnglish ? '/en/confirm-email.html' : '/confirm-email.html', window.location.origin).toString();
}

function setLoading(loading) {
  submitButton.disabled = loading;
  [...form.elements].forEach((element) => {
    if (element !== submitButton) element.disabled = loading;
  });
  submitButton.querySelector('.button-label').textContent = loading
    ? tr('Création en cours…', 'Creating account…')
    : tr('Créer mon compte', 'Create my account');
}

function showStatus(message, type = 'info') {
  statusBox.textContent = message;
  statusBox.className = `auth-status ${type}`;
  statusBox.hidden = false;
}

function togglePassword(inputId, button) {
  const input = document.querySelector(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(isHidden));
  button.textContent = isHidden ? tr('Masquer', 'Hide') : tr('Afficher', 'Show');
}

document.querySelector('#toggle-password').addEventListener('click', (event) => {
  togglePassword('#password', event.currentTarget);
});

document
  .querySelector('#toggle-password-confirmation')
  .addEventListener('click', (event) => {
    togglePassword('#password-confirmation', event.currentTarget);
  });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusBox.hidden = true;

  const fullName = fullNameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const passwordConfirmation = confirmationInput.value;

  if (!fullName || !email || !password || !passwordConfirmation) {
    showStatus(tr('Tous les champs sont obligatoires.', 'All fields are required.'), 'error');
    return;
  }

  if (!emailInput.validity.valid) {
    showStatus(tr('Saisissez une adresse e-mail valide.', 'Enter a valid email address.'), 'error');
    emailInput.focus();
    return;
  }

  if (password.length < 6) {
    showStatus(
      tr('Le mot de passe doit contenir au moins 6 caractères.', 'The password must contain at least 6 characters.'),
      'error',
    );
    passwordInput.focus();
    return;
  }

  if (password !== passwordConfirmation) {
    showStatus(tr('Les deux mots de passe ne correspondent pas.', 'The passwords do not match.'), 'error');
    confirmationInput.focus();
    return;
  }

  setLoading(true);
  showStatus(tr('Création de votre compte Micolpe…', 'Creating your Micolpe account…'), 'info');

  const result = await registerWithPassword({
    fullName,
    email,
    password,
    emailRedirectTo: confirmationUrl(),
  });

  if (!result.success) {
    showStatus(
      messages[result.error] ||
        String(result.error || messages[AUTH_ERROR.UNKNOWN]),
      'error',
    );
    setLoading(false);
    return;
  }

  if (!result.confirmationRequired) {
    window.location.replace(isEnglish ? '/en/dashboard.html' : '/dashboard.html');
    return;
  }

  window.sessionStorage.setItem(
    'micolpe-pending-confirmation-email',
    email.toLowerCase(),
  );
  window.location.replace(
    `${isEnglish ? '/en/confirm-email.html' : '/confirm-email.html'}?email=${encodeURIComponent(email.toLowerCase())}`,
  );
});

getCurrentSession()
  .then((session) => {
    if (session) window.location.replace(isEnglish ? '/en/dashboard.html' : '/dashboard.html');
  })
  .catch(() => {
    showStatus(messages[AUTH_ERROR.NETWORK], 'error');
  });
