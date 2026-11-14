import { api } from '../api.js';
import { $, esc, on, submitHandler, field, seg, toast } from '../ui.js';

const homeFor = (role) => (role === 'admin' ? '/admin' : role === 'merchant' ? '/merchant' : '/app');

function safeNext(query, role) {
  const next = query.get('next');
  return next && next.startsWith(homeFor(role)) && !next.startsWith('//') ? next : homeFor(role);
}

const shell = (inner) => `<div class="auth"><div class="auth-card stack" style="--gap:26px">${inner}</div></div>`;
const banner = '<p class="notice bad hide" data-form-error role="alert"></p>';

export async function login({ el, query, navigate, state, refresh }) {
  el.innerHTML = shell(`
    <div class="stack" style="--gap:10px"><span class="label">Welcome back</span><h1 class="h1" style="font-size:40px">Log in</h1></div>
    <form class="stack" id="login" novalidate>
      ${banner}
      ${field('Email', '<input class="input" name="email" type="email" autocomplete="email" required>')}
      ${field('Password', '<input class="input" name="password" type="password" autocomplete="current-password" required>')}
      <button class="btn btn-primary btn-lg btn-block" type="submit">Log in</button>
      <div class="row between small"><a class="link" href="/forgot-password">Forgot password?</a><a class="link" href="/signup">Create an account</a></div>
    </form>
    ${state.mode === 'demo' && state.demoAccounts.length ? `
      <div class="demo-logins"><div class="label" style="margin-bottom:8px">Demo accounts — click to fill</div>
        ${state.demoAccounts.map((a) => `<button type="button" data-demo="${esc(a.email)}" data-pw="${esc(a.password)}"><span style="text-transform:capitalize">${esc(a.role)}</span><span class="muted mono">${esc(a.email)}</span></button>`).join('')}
      </div>` : ''}`);
  const form = $('#login', el);
  on(el, 'click', '[data-demo]', (e, btn) => {
    form.elements.email.value = btn.dataset.demo;
    form.elements.password.value = btn.dataset.pw;
    form.requestSubmit();
  });
  submitHandler(form, async (v) => {
    const res = await api.post('/api/auth/login', { email: v.email, password: v.password });
    await refresh();
    navigate(safeNext(query, res.user.role), { replace: true, force: true });
  });
}

export async function signup({ el, query, navigate, state, refresh }) {
  let type = query.get('type') === 'merchant' && state.allowMerchantSignup ? 'merchant' : 'customer';
  const draw = () => {
    const keep = Object.fromEntries([...(el.querySelectorAll('input') ?? [])].filter((i) => i.type !== 'password').map((i) => [i.name, i.value]));
    el.innerHTML = shell(`
      <div class="stack" style="--gap:10px">
        <span class="label">${type === 'merchant' ? 'For fashion brands' : 'Get started'}</span>
        <h1 class="h1" style="font-size:40px">${type === 'merchant' ? 'Create your brand account' : 'Create your size profile'}</h1>
        <p class="muted">${type === 'merchant' ? 'Upload size charts, add products and install the widget.' : 'Enter your measurements once. Get personalised size recommendations across brands.'}</p>
      </div>
      ${state.allowMerchantSignup ? seg('type', [['customer', 'I shop'], ['merchant', 'I sell']], type) : ''}
      <form class="stack" id="signup" novalidate>
        ${banner}
        ${field('Your name', `<input class="input" name="name" autocomplete="name" required value="${esc(keep.name ?? '')}">`)}
        ${type === 'merchant' ? field('Brand name', `<input class="input" name="companyName" autocomplete="organization" required value="${esc(keep.companyName ?? '')}">`) : ''}
        ${type === 'merchant' ? field('Store website', `<input class="input" name="website" inputmode="url" placeholder="shop.example.com" value="${esc(keep.website ?? '')}">`, { optional: true }) : ''}
        ${field(type === 'merchant' ? 'Work email' : 'Email', `<input class="input" name="email" type="email" autocomplete="email" required value="${esc(keep.email ?? '')}">`)}
        ${field('Password', '<input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required>', { hint: 'At least 8 characters.' })}
        <button class="btn btn-primary btn-lg btn-block" type="submit">${type === 'merchant' ? 'Create brand account' : 'Create account'}</button>
        <p class="small muted" style="text-align:center">Already registered? <a class="link" href="/login">Log in</a></p>
      </form>`);
    submitHandler($('#signup', el), async (v) => {
      const res = await api.post('/api/auth/signup', { ...v, role: type });
      await refresh();
      toast(type === 'merchant' ? 'Brand account created' : 'Account created');
      navigate(res.user.role === 'merchant' ? '/merchant' : '/app/profile', { replace: true, force: true });
    });
  };
  draw();
  on(el, 'seg', '[data-seg=type]', (e) => { type = e.detail.value; draw(); });
}

export async function forgot({ el, state }) {
  el.innerHTML = shell(`
    <div class="stack" style="--gap:10px"><span class="label">Account</span><h1 class="h1" style="font-size:40px">Reset your password</h1>
      <p class="muted">Enter your email and we will send a link to choose a new password.</p></div>
    <form class="stack" id="forgot" novalidate>
      ${banner}
      ${field('Email', '<input class="input" name="email" type="email" autocomplete="email" required>')}
      <button class="btn btn-primary btn-lg btn-block" type="submit">Send reset link</button>
      <p class="small" style="text-align:center"><a class="link" href="/login">Back to log in</a></p>
    </form>
    <div id="sent"></div>`);
  submitHandler($('#forgot', el), async (v) => {
    const res = await api.post('/api/auth/forgot', { email: v.email });
    $('#sent', el).innerHTML = `
      <div class="notice" role="status">${esc(res.message)}</div>
      ${res.demoResetUrl ? `<div class="notice warn" style="margin-top:10px">Demonstration mode has no email provider, so the link is shown here instead: <a class="link" href="${esc(new URL(res.demoResetUrl).pathname + new URL(res.demoResetUrl).search)}">Open reset link</a></div>`
        : state.mode === 'demo' ? '<div class="notice" style="margin-top:10px">No account uses that email, so no link was created.</div>' : ''}`;
  });
}

export async function reset({ el, query, navigate }) {
  const token = query.get('token') ?? '';
  el.innerHTML = shell(`
    <div class="stack" style="--gap:10px"><span class="label">Account</span><h1 class="h1" style="font-size:40px">Choose a new password</h1></div>
    ${token ? `
    <form class="stack" id="reset" novalidate>
      ${banner}
      ${field('New password', '<input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required>', { hint: 'At least 8 characters.' })}
      <button class="btn btn-primary btn-lg btn-block" type="submit">Save password</button>
    </form>` : '<p class="notice bad">This reset link is missing its token. <a class="link" href="/forgot-password">Request a new one</a>.</p>'}`);
  if (!token) return;
  submitHandler($('#reset', el), async (v) => {
    await api.post('/api/auth/reset', { token, password: v.password });
    toast('Password updated. Log in with your new password.');
    navigate('/login', { replace: true });
  });
}
