import { AUTH_EVENTS, AuthError, MissingIdentityError, acceptInvite, getSettings, getUser, handleAuthCallback, login, logout, oauthLogin, onAuthChange, refreshSession, requestPasswordRecovery, signup, updateUser } from '@netlify/identity';
import { siteName, siteDescription } from './site.js';

const element = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const regions = { EU: 'Europe', ME: 'MENA', IN: 'India', BR: 'Brazil', ALL: 'All servers' };
const rooms = [['global', 'Global lounge', 'Say hi to everyone'], ['lfg', 'Looking to play', 'Find your next squad'], ['ranked', 'Ranked grind', 'Rank pushes and tips'], ['guilds', 'Guild recruiting', 'Find or promote a guild'], ['styles', 'Nicks & bios', 'Share your favorite styles'], ['help', 'Help & tips', 'Sensitivity, HUD and questions']];
const state = { user: null, profile: null, mode: 'social', destination: 'ranks', view: 'home', period: 'all', metric: 'points', players: [], total: 0, hasMore: false, room: 'global', gameMode: 'Ranked', avatar: null, inviteToken: null, authBusy: false, settings: null };
let leaderboardController;
let chatController;
let sessionVersion = 0;
let searchTimer;
let membersVersion = 0;
let initializing = true;

element('meta[property="og:site_name"]').content = siteName;
element('meta[property="og:description"]').content = siteDescription;

function status(selector, message = '', error = false) {
  const target = element(selector);
  target.textContent = message;
  target.classList.toggle('error', error);
}

function clearPrivate() {
  sessionVersion++;
  membersVersion++;
  state.user = null;
  state.profile = null;
  state.players = [];
  state.avatar = null;
  state.inviteToken = null;
  state.destination = 'ranks';
  leaderboardController?.abort();
  chatController?.abort();
  ['#lbpod', '#lbl', '#lbst', '#pfcard', '#cml', '#reg'].forEach(selector => { element(selector).replaceChildren(); });
  element('#profile-form').reset();
  element('#pfph').replaceChildren();
  element('#cin').value = '';
  element('#auth-password').value = '';
  element('#auth-email').value = '';
  element('#player-form').reset();
  status('#player-status');
  element('#jb').textContent = 'Join';
  setAuthMode('social');
}

async function api(action, options = {}, parameters = {}) {
  const currentUser = await getUser();
  if (!currentUser) {
    clearPrivate();
    window.go('auth');
    status('#auth-status', 'Your session has ended. Sign in again.', true);
    throw new Error('Your session has ended. Sign in again.');
  }
  const query = new URLSearchParams({ action, ...parameters });
  const timeout = AbortSignal.timeout(20000);
  const settings = { ...options, credentials: 'same-origin', cache: 'no-store', signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout };
  let response = await fetch(`/.netlify/functions/community?${query}`, settings);
  if (response.status === 401 && await refreshSession()) response = await fetch(`/.netlify/functions/community?${query}`, settings);
  if (response.status === 401) {
    clearPrivate();
    window.go('auth');
    status('#auth-status', 'Your session has ended. Sign in again.', true);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'The service is unavailable. Please try again.');
  if (!data) throw new Error('The service returned an unexpected response. Please try again.');
  return data;
}

function authMessage(error) {
  if (error instanceof MissingIdentityError) return 'Account service is not available yet. Please try again after deployment.';
  if (error instanceof AuthError && error.status === 401) return 'Unable to sign in. Check your email and password, and confirm your email first.';
  if (error instanceof AuthError && error.status === 403) return 'Registration is currently unavailable. Please contact FireVerso support.';
  if (error instanceof AuthError && error.status === 429) return 'Too many attempts. Please wait a moment before trying again.';
  return error.message || 'Something went wrong. Please try again.';
}

function setAuthMode(mode) {
  state.mode = mode;
  const passwordOnly = mode === 'reset' || mode === 'invite';
  const emailForm = !['social', 'setup'].includes(mode);
  element('#auth-social').hidden = mode !== 'social';
  element('#auth-form').hidden = !emailForm;
  element('#player-form').hidden = mode !== 'setup';
  element('#auth-email-field').hidden = passwordOnly;
  element('#auth-email').required = emailForm && !passwordOnly;
  element('#auth-password-field').hidden = mode === 'forgot';
  element('#auth-password').required = emailForm && mode !== 'forgot';
  element('#auth-password').minLength = mode === 'login' ? 1 : 8;
  element('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  element('#auth-tabs').hidden = !emailForm || passwordOnly || Boolean(state.settings?.disableSignup);
  element('#auth-tabs').querySelectorAll('button').forEach(button => button.classList.toggle('on', button.dataset.mode === mode));
  element('#auth-title').textContent = { social: 'Your squad starts here.', setup: 'Just your name & ID.', signup: 'Make it yours.', login: 'Welcome back.', forgot: 'Back in the game.', reset: 'A fresh start.', invite: 'You’re invited.' }[mode];
  element('#auth-description').textContent = { social: 'Use a social account, then add just your Free Fire name and ID.', setup: 'You’re signed in. Add these two details to enter the community.', signup: 'Create a FireVerso email account. Your player details come next.', login: 'Sign in with your FireVerso email account.', forgot: 'We’ll email you a link to reset your password.', reset: 'Choose a new password for your FireVerso account.', invite: 'Choose a password to activate your account.' }[mode];
  element('#auth-submit').textContent = { signup: 'Create account', login: 'Sign in', forgot: 'Send reset link', reset: 'Save new password', invite: 'Accept invitation' }[mode];
  element('#auth-forgot').hidden = !emailForm || passwordOnly || mode === 'forgot';
  element('#auth-back').hidden = !emailForm || passwordOnly;
  status('#auth-status');
}

async function loadProviderSettings() {
  element('#provider-retry').hidden = true;
  status('#provider-status', 'Checking sign-in options…');
  document.querySelectorAll('[data-provider]').forEach(button => { button.disabled = true; });
  try {
    state.settings = await getSettings();
    document.querySelectorAll('[data-provider]').forEach(button => {
      const enabled = Boolean(state.settings.providers[button.dataset.provider]);
      button.disabled = !enabled;
      button.querySelector('small').textContent = enabled ? 'No separate password' : 'Not configured yet';
    });
    const enabled = ['google', 'facebook'].some(provider => state.settings.providers[provider]);
    status('#provider-status', enabled ? 'Choose an available provider to continue.' : 'Google and Facebook sign-in need to be enabled by the site owner. Email sign-in is available below.');
    if (state.mode === 'signup' && state.settings.disableSignup) setAuthMode('login');
    else element('#auth-tabs').hidden = ['social', 'setup', 'reset', 'invite'].includes(state.mode) || state.settings.disableSignup;
  } catch {
    document.querySelectorAll('[data-provider] small').forEach(label => { label.textContent = 'Availability unknown'; });
    status('#provider-status', 'Sign-in options could not be loaded. Try again or continue with email.', true);
    element('#provider-retry').hidden = false;
  }
}

element('#provider-retry').onclick = () => { void loadProviderSettings(); };
element('#auth-email-option').onclick = () => setAuthMode('login');
element('#auth-back').onclick = () => setAuthMode('social');
document.querySelectorAll('[data-provider]').forEach(button => {
  button.onclick = () => {
    if (state.authBusy || !state.settings?.providers[button.dataset.provider]) return;
    status('#provider-status', 'Opening secure sign-in…');
    try { oauthLogin(button.dataset.provider); }
    catch (error) {
      if (error.message !== 'Redirecting to OAuth provider') status('#provider-status', authMessage(error), true);
    }
  };
});

async function activate(user, navigate = true) {
  if (!user?.confirmedAt) return false;
  if (state.user && state.user.id !== user.id) clearPrivate();
  const version = ++sessionVersion;
  state.user = user;
  state.profile = null;
  element('#jb').textContent = user.name || 'My profile';
  try {
    const data = await api('profile');
    if (version !== sessionVersion) return false;
    state.profile = data.profile;
    element('#jb').textContent = data.profile.name;
    if (!data.profile.gameId) {
      setAuthMode('setup');
      element('#player-name').value = data.profile.name === 'New player' ? '' : data.profile.name;
      window.go('auth');
      return false;
    }
    setAuthMode('social');
    if (navigate) window.go(state.destination);
    void loadMembers();
    return true;
  } catch (error) {
    if (version !== sessionVersion) return false;
    setAuthMode('setup');
    window.go('auth');
    status('#player-status', `${error.message} Enter your player details to retry.`, true);
    return false;
  }
}

element('#auth-tabs').onclick = event => {
  const button = event.target.closest('[data-mode]');
  if (button && !state.authBusy) setAuthMode(button.dataset.mode);
};
element('#auth-forgot').onclick = () => { if (!state.authBusy) setAuthMode('forgot'); };
element('#auth-form').onsubmit = async event => {
  event.preventDefault();
  if (state.authBusy) return;
  const mode = state.mode;
  const email = element('#auth-email').value.trim();
  const password = element('#auth-password').value;
  state.authBusy = true;
  element('#auth-submit').disabled = true;
  status('#auth-status', 'Connecting securely…');
  try {
    if (mode === 'forgot') {
      await requestPasswordRecovery(email);
      status('#auth-status', 'If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.');
    } else if (mode === 'signup') {
      const selectedRegion = element('#rgsel').value;
      const registered = await signup(email, password, { region: selectedRegion === 'ALL' ? 'EU' : selectedRegion });
      element('#auth-password').value = '';
      if (registered.confirmedAt) await activate(await getUser());
      else status('#auth-status', 'Check your inbox and spam folder. Confirm your email using the link, then sign in to see the leaderboard.');
    } else {
      const user = mode === 'login' ? await login(email, password)
        : mode === 'invite' ? await acceptInvite(state.inviteToken, password)
        : await updateUser({ password });
      state.inviteToken = null;
      element('#auth-password').value = '';
      setAuthMode('social');
      await activate(user);
      if (mode === 'reset') window.toast('Password updated');
    }
  } catch (error) {
    status('#auth-status', authMessage(error), true);
  } finally {
    state.authBusy = false;
    element('#auth-submit').disabled = false;
  }
};

element('#player-form').onsubmit = async event => {
  event.preventDefault();
  if (state.authBusy || !state.user) return;
  const version = sessionVersion;
  state.authBusy = true;
  element('#player-submit').disabled = true;
  element('#player-logout').disabled = true;
  status('#player-status', 'Saving your player details…');
  try {
    const body = { name: element('#player-name').value.trim(), gameId: element('#player-id').value.trim() };
    const saved = await api('profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (version !== sessionVersion) return;
    state.profile = saved.profile;
    element('#jb').textContent = saved.profile.name;
    setAuthMode('social');
    window.go(state.destination);
    void loadMembers();
  } catch (error) { if (version === sessionVersion) status('#player-status', error.message, true); }
  finally { state.authBusy = false; element('#player-submit').disabled = false; element('#player-logout').disabled = false; }
};
element('#player-logout').onclick = async () => {
  if (state.authBusy) return;
  element('#player-logout').disabled = true;
  try { await logout(); clearPrivate(); window.go('auth'); }
  catch { status('#player-status', 'Sign-out failed. Please try again.', true); }
  finally { element('#player-logout').disabled = false; }
};

async function loadProfile(edit = false) {
  if (!state.user) return;
  const version = sessionVersion;
  status('#pfstatus', state.profile ? '' : 'Loading your profile…');
  try {
    const profile = state.profile || (await api('profile')).profile;
    if (version !== sessionVersion || !state.user) return;
    state.profile = profile;
    element('#jb').textContent = profile.name;
    element('#pfform').hidden = !edit;
    element('#pfcard').hidden = edit;
    element('#pn').value = profile.name;
    element('#pid').value = profile.gameId || '';
    element('#pb').value = profile.bio;
    element('#pr').value = profile.region;
    element('#p_ig').value = profile.instagram;
    element('#p_tt').value = profile.tiktok;
    const portrait = profile.photo ? `<img src="${escape(profile.photo)}&v=${Date.now()}" alt="Your profile photo">` : escape([...profile.name][0] || '?');
    element('#pfph').innerHTML = portrait;
    const socialLinks = [['instagram', 'Instagram', 'https://instagram.com/'], ['tiktok', 'TikTok', 'https://tiktok.com/@']].filter(([key]) => profile[key]).map(([key, label, base]) => `<a href="${base}${encodeURIComponent(profile[key])}" target="_blank" rel="noopener noreferrer">${label} @${escape(profile[key])}</a>`).join('');
    element('#pfcard').innerHTML = `<div class="card pc"><div class="cov"></div><div class="pa">${portrait}</div><div class="in"><h3>${escape(profile.name)}</h3><p class="note">${escape(regions[profile.region])} · FireVerso member</p><p class="note">Free Fire ID: ${escape(profile.gameId)} · Self-reported</p><p class="bio">${escape(profile.bio)}</p><div class="soc">${socialLinks}</div><div class="profile-actions"><button class="btn ghost" id="profile-edit">Edit profile</button><button class="btn" id="profile-ranks">My leaderboard</button><button class="btn ghost" id="profile-logout">Sign out</button></div></div></div>`;
    element('#profile-edit').onclick = () => { state.avatar = null; void loadProfile(true); };
    element('#profile-ranks').onclick = () => window.go('ranks');
    element('#profile-logout').onclick = async () => {
      element('#profile-logout').disabled = true;
      try { await logout(); clearPrivate(); window.go('auth'); }
      catch (error) { status('#pfstatus', 'Sign-out failed. Please try again.', true); element('#profile-logout').disabled = false; }
    };
    status('#pfstatus');
  } catch (error) {
    if (version !== sessionVersion) return;
    status('#pfstatus', error.message, true);
    element('#pfcard').innerHTML = '<button class="btn ghost" id="profile-retry">Retry loading profile</button>';
    element('#pfcard').hidden = false;
    element('#pfform').hidden = true;
    element('#profile-retry').onclick = () => { void loadProfile(); };
  }
}

element('#pfph').onclick = () => element('#pfi').click();
element('#pfi').onchange = async event => {
  const version = sessionVersion;
  const file = event.target.files[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5000000) {
    status('#pfstatus', 'Choose a JPEG, PNG or WebP image smaller than 5 MB.', true); return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const size = Math.min(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 256, 256);
    bitmap.close();
    const avatar = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
    if (version !== sessionVersion) return;
    if (!avatar) throw new Error('Image conversion failed.');
    state.avatar = avatar;
    element('#pfph').innerHTML = `<img src="${canvas.toDataURL('image/jpeg', .82)}" alt="New profile photo preview">`;
    status('#pfstatus', 'Photo ready. Save your profile to upload it.');
  } catch { if (version === sessionVersion) status('#pfstatus', 'This image could not be read. Try another image.', true); }
};
element('#profile-form').onsubmit = async event => {
  event.preventDefault();
  const version = sessionVersion;
  element('#pfs').disabled = true;
  status('#pfstatus', 'Saving your profile…');
  try {
    const body = { name: element('#pn').value.trim(), gameId: element('#pid').value.trim(), bio: element('#pb').value.trim(), region: element('#pr').value, instagram: element('#p_ig').value, tiktok: element('#p_tt').value };
    const saved = await api('profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (version !== sessionVersion) return;
    state.profile = saved.profile;
    if (state.avatar) {
      const result = await api('avatar', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: state.avatar });
      if (version !== sessionVersion) return;
      state.profile.photo = result.photo;
      state.avatar = null;
    }
    await loadProfile();
    status('#pfstatus', 'Profile saved. Your changes are available across devices.');
    void loadMembers();
  } catch (error) { if (version === sessionVersion) status('#pfstatus', `${error.message} Your form is still here; you can retry saving.`, true); }
  finally { element('#pfs').disabled = false; }
};

function formatScore(value) {
  return state.metric === 'wins' ? `${Number(value).toFixed(1)}%` : `${Number(value).toLocaleString()} ${state.metric === 'kills' ? 'kills' : 'RP'}`;
}

function renderLeaderboard(data) {
  const players = state.players;
  const top = players[0];
  element('#lbsub').textContent = `${regions[element('#rgsel').value]} · ${{ today: 'Today (UTC)', week: 'This week (UTC)', all: 'All time' }[state.period]} · Equal scores use join order`;
  element('#lbstatus').textContent = `Updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  element('#lbst').innerHTML = `<div><b>${data.total}</b><small>players found</small></div><div><b>${top ? formatScore(top.value) : '—'}</b><small>top result</small></div><div><b>${data.own ? `#${data.own.rank}` : '—'}</b><small>your position in this server</small></div>`;
  const podium = !element('#lbq').value.trim() && players.length >= 3 && Number(top.value) > 0 ? [players[1], players[0], players[2]] : [];
  element('#lbpod').hidden = !podium.length;
  element('#lbpod').innerHTML = podium.map(player => `<div class="pd r${player.rank}"><div class="av">${escape([...player.name][0] || '?')}</div><b>${escape(player.name)}</b><small>${escape(regions[player.region])}</small><div class="sc">${formatScore(player.value)}</div><div class="st">${player.rank}</div></div>`).join('');
  element('#lbl').innerHTML = (podium.length ? players.slice(3) : players).map(player => `<div class="lr ${player.userId === state.user?.id ? 'self' : ''}"><span class="rk">${player.rank}</span><div class="av">${escape([...player.name][0] || '?')}</div><div class="nm"><b>${escape(player.name)}${player.userId === state.user?.id ? ' · You' : ''}</b><small class="note">${escape(regions[player.region])} · ${player.matches ? `${player.matches} verified matches` : 'Awaiting verified game results'}</small></div><div class="rt"><b>${formatScore(player.value)}</b></div></div>`).join('') || '<div class="empty-state"><b>No players found.</b>Try a different name or choose another server.</div>';
  element('#lbmore').hidden = !data.hasMore;
  status('#lberror');
  element('#lbretry').hidden = false;
}

async function loadLeaderboard(append = false, quiet = false) {
  if (!state.user) return;
  leaderboardController?.abort();
  const controller = new AbortController();
  leaderboardController = controller;
  const version = sessionVersion;
  if (!append && !quiet) {
    element('#lbmore').hidden = true;
    element('#lbpod').replaceChildren();
    element('#lbl').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    status('#lberror', 'Loading the leaderboard…');
  }
  element('#lbmore').disabled = true;
  try {
    const data = await api('leaderboard', { signal: controller.signal }, { region: element('#rgsel').value, period: state.period, metric: state.metric, q: element('#lbq').value.trim(), offset: String(append ? state.players.length : 0) });
    if (controller.signal.aborted || version !== sessionVersion) return;
    state.players = append ? [...state.players, ...data.players] : data.players;
    state.total = data.total;
    state.hasMore = data.hasMore;
    renderLeaderboard(data);
  } catch (error) {
    if (controller.signal.aborted || version !== sessionVersion) return;
    if (!quiet && !append) element('#lbl').innerHTML = '<div class="empty-state"><b>Leaderboard unavailable.</b>Your account is safe. Refresh to try again.</div>';
    element('#lbstatus').textContent = 'Not connected';
    status('#lberror', error.message, true);
    element('#lbretry').hidden = false;
  } finally { if (leaderboardController === controller) element('#lbmore').disabled = false; }
}

for (const [selector, key] of [['#lbp', 'period'], ['#lbm', 'metric']]) {
  element(selector).onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    state[key] = button.dataset.v;
    element(selector).querySelectorAll('button').forEach(target => target.classList.toggle('on', target === button));
    void loadLeaderboard();
  };
}
element('#lbq').oninput = () => { leaderboardController?.abort(); clearTimeout(searchTimer); searchTimer = setTimeout(() => { void loadLeaderboard(); }, 250); };
element('#lbmore').onclick = () => { void loadLeaderboard(true); };
element('#lbretry').onclick = () => { void loadLeaderboard(); };

async function loadMembers() {
  if (!window.FireVerso.signedIn) return;
  const version = ++membersVersion;
  try {
    const data = await api('members', {}, { region: element('#rgsel').value });
    if (version !== membersVersion || !state.user) return;
    element('#s1').textContent = `Recently joined · ${regions[element('#rgsel').value]}`;
    element('#reg').innerHTML = data.members.map(member => {
      const photo = member.photo ? `<img src="${escape(member.photo)}&v=${Date.now()}" alt="${escape(member.name)} profile photo" loading="lazy">` : '';
      const socials = [['instagram', 'Instagram', 'https://instagram.com/'], ['tiktok', 'TikTok', 'https://tiktok.com/@']]
        .filter(([key]) => member[key]).map(([key, label, base]) => `<a href="${base}${encodeURIComponent(member[key])}" target="_blank" rel="noopener noreferrer">${label}</a>`).join(' · ');
      return `<div class="member-row"><div class="av">${escape([...member.name][0] || '?')}${photo}</div><div><b>${escape(member.name)}</b><small>${escape(regions[member.region])}</small>${member.bio ? `<p class="member-bio">${escape(member.bio)}</p>` : ''}${socials ? `<div class="member-socials">${socials}</div>` : ''}</div></div>`;
    }).join('') || '<p class="note">No members in this server yet. Choose it in your profile to join.</p>';
    element('#reg').querySelectorAll('img').forEach(image => image.addEventListener('error', () => image.remove(), { once: true }));
  } catch (error) { if (version === membersVersion) element('#reg').innerHTML = `<p class="note">${escape(error.message)}</p>`; }
}

async function loadChat(quiet = false) {
  if (!state.user) return;
  chatController?.abort();
  const controller = new AbortController();
  chatController = controller;
  const version = sessionVersion;
  const room = rooms.find(item => item[0] === state.room);
  element('#crs').innerHTML = rooms.map(([key, name]) => `<button class="chip ${key === state.room ? 'on' : ''}" data-r="${key}">${name}</button>`).join('');
  element('#crt').textContent = room[1];
  element('#crd').textContent = room[2];
  element('#clf').hidden = state.room !== 'lfg';
  if (!quiet) { element('#cml').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>'; element('#cn').textContent = 'Loading this room…'; }
  try {
    const data = await api('chat', { signal: controller.signal }, { room: state.room });
    if (controller.signal.aborted || version !== sessionVersion) return;
    const history = element('#cml');
    const nearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 90;
    const markup = data.messages.map(message => `<div class="mg ${message.userId === state.user?.id ? 'me' : ''}"><div class="pa sm">${escape([...message.name][0] || '?')}</div><div class="bd"><small>${escape(message.name)} · ${new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small><div class="bb">${message.mode ? `<b>Looking to play · ${escape(message.mode)}</b><br>` : ''}${escape(message.body)}</div></div></div>`).join('') || '<div class="empty-state"><b>Your conversation starts here.</b>Be the first to say hi.</div>';
    if (history.innerHTML !== markup) history.innerHTML = markup;
    if (!quiet || nearBottom) history.scrollTop = history.scrollHeight;
    element('#cst').textContent = 'Connected';
    element('#cst').classList.remove('off');
    element('#cn').textContent = 'Shared with members · refreshes every 10 seconds · last 60 messages';
  } catch (error) {
    if (controller.signal.aborted || version !== sessionVersion) return;
    element('#cst').textContent = 'Not connected';
    element('#cst').classList.add('off');
    element('#cn').textContent = `${error.message} Select the room to retry.`;
  }
}

async function sendMessage(looking = false) {
  const input = element('#cin');
  const body = input.value.trim() || (looking ? 'Anyone up for a match?' : '');
  if (!body || element('#csd').disabled) return;
  const version = sessionVersion;
  const room = state.room;
  element('#csd').disabled = true;
  element('#cpl').disabled = true;
  try {
    await api('chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, mode: looking ? state.gameMode : '' }) }, { room });
    if (version !== sessionVersion) return;
    if (state.room === room && input.value.trim() === body) input.value = '';
    await loadChat(true);
  } catch (error) { if (version === sessionVersion) element('#cn').textContent = `${error.message} Your message has not been sent.`; }
  finally { element('#csd').disabled = false; element('#cpl').disabled = false; }
}
element('#crs').onclick = event => { const button = event.target.closest('[data-r]'); if (button) { state.room = button.dataset.r; void loadChat(); } };
element('#clf').onclick = event => { const button = event.target.closest('button'); if (!button) return; if (button.id === 'cpl') { void sendMessage(true); return; } state.gameMode = button.dataset.m; element('#clf').querySelectorAll('[data-m]').forEach(target => target.classList.toggle('on', target === button)); };
element('#csd').onclick = () => { void sendMessage(); };
element('#cin').onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void sendMessage(); } };

document.querySelectorAll('[data-info]').forEach(link => {
  link.onclick = event => {
    event.preventDefault();
    const privacy = link.dataset.info === 'privacy';
    element('#info-title').textContent = privacy ? 'Privacy & cookies' : 'Terms of use';
    element('#info-content').textContent = privacy ? 'FireVerso uses Netlify Identity for social sign-in, optional email accounts and secure sessions. Social providers may share an email address and account information with Identity; these are not displayed in community responses. Authentication uses essential cookies and browser session storage. Your player name and self-reported Free Fire ID are saved in Netlify Database alongside your optional profile details and messages; profile images are saved in Netlify Blobs. Your name, server, bio, socials and chat messages are shared with signed-in members. Your Free Fire ID is shown on your own profile, not the leaderboard or chat. Contact netronvibes@gmail.com to request access to or deletion of your data.' : 'FireVerso is an independent fan community and is not affiliated with Garena. Use an available social provider or a separate FireVerso email account. Never enter your Free Fire password here. Player IDs are self-reported and do not verify ownership of a Garena account. Keep your login secure and do not post private information, abuse or spam. Sensitivity settings are suggestions, not guarantees. Rankings only use verified results recorded by the site; official Garena statistics are not imported. Contact netronvibes@gmail.com for support.';
    window.go('info');
  };
});

window.FireVerso = {
  get signedIn() { return Boolean(state.user && state.profile?.gameId) && !['reset', 'invite'].includes(state.mode); },
  requestAccess(destination) { state.destination = destination; },
  viewChanged(view) { state.view = view; },
  loadLeaderboard() { void loadLeaderboard(); },
  loadProfile() { void loadProfile(); },
  loadChat() { void loadChat(); },
  loadMembers() { void loadMembers(); },
  regionChanged() { if (state.view === 'ranks') void loadLeaderboard(); },
};

onAuthChange((event, user) => {
  if (event === AUTH_EVENTS.LOGOUT) { clearPrivate(); window.go('auth'); }
  if (event === AUTH_EVENTS.LOGIN && !initializing && !state.authBusy && user?.id !== state.user?.id) void activate(user);
});

setInterval(() => {
  if (!window.FireVerso.signedIn || document.hidden) return;
  if (state.view === 'chat') void loadChat(true);
}, 10000);
setInterval(() => {
  if (!window.FireVerso.signedIn || document.hidden) return;
  if (state.view === 'ranks' && state.players.length <= 30) void loadLeaderboard(false, true);
  if (state.view === 'home') void loadMembers();
}, 15000);

async function initialize() {
  setAuthMode('social');
  if (location.pathname === '/account') state.destination = 'profile';
  void loadProviderSettings();
  element('#jb').disabled = true;
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === 'recovery' || callback?.type === 'invite') {
      state.inviteToken = callback.token;
      state.user = callback.user;
      setAuthMode(callback.type === 'recovery' ? 'reset' : 'invite');
      window.go('auth');
      return;
    }
    const user = await getUser();
    if (user?.) {
      if (!await activate(user, false)) return;
      if (callback || location.pathname === '/leaderboard') window.go('ranks');
      else if (location.pathname === '/account') window.go('profile');
      else if (state.view === 'auth') window.go(state.destination);
    } else if (location.pathname !== '/') window.go('auth');
  } catch (error) {
    window.go('auth');
    status('#auth-status', `This sign-in link could not be completed. ${authMessage(error)}`, true);
  } finally { initializing = false; element('#jb').disabled = false; }
}

void initialize();
