// Account settings blocks shared by customer and merchant settings pages.
import { api } from '../api.js';
import { $, esc, submitHandler, field, toast, modal } from '../ui.js';

export function accountSections({ user, allowDelete = true, deleteWarning }) {
  return `
    <div class="card pad-lg"><form class="stack" id="account-form" novalidate>
      <h2 class="h3">Account</h2>
      <p class="notice bad hide" data-form-error role="alert"></p>
      <div class="grid cols-2">
        ${field('Name', `<input class="input" name="name" autocomplete="name" value="${esc(user.name)}" required>`)}
        ${field('Email', `<input class="input" name="email" type="email" autocomplete="email" value="${esc(user.email)}" required>`)}
      </div>
      <div><button class="btn btn-primary" type="submit">Save account</button></div>
    </form></div>

    <div class="card pad-lg"><form class="stack" id="password-form" novalidate>
      <h2 class="h3">Password</h2>
      <p class="notice bad hide" data-form-error role="alert"></p>
      <div class="grid cols-2">
        ${field('Current password', '<input class="input" name="currentPassword" type="password" autocomplete="current-password" required>')}
        ${field('New password', '<input class="input" name="newPassword" type="password" autocomplete="new-password" minlength="8" required>', { hint: 'At least 8 characters. Other devices are signed out.' })}
      </div>
      <div><button class="btn" type="submit">Change password</button></div>
    </form></div>

    <div class="card pad-lg stack">
      <h2 class="h3">Session</h2>
      <div class="row wrap-row between"><p class="muted small">Signed in as ${esc(user.email)}.</p><button class="btn" data-logout>Log out</button></div>
    </div>

    ${allowDelete ? `<div class="card pad-lg stack" style="border-color:#cf8a8a44">
      <h2 class="h3">Delete account</h2>
      <p class="muted small">${esc(deleteWarning)}</p>
      <div><button class="btn btn-danger" id="delete-account">Delete my account</button></div>
    </div>` : ''}`;
}

export function bindAccount(el, { refresh, navigate, deleteWarning }) {
  submitHandler($('#account-form', el), async (v) => {
    await api.patch('/api/account', { name: v.name, email: v.email });
    await refresh();
    toast('Account saved');
    navigate(location.pathname, { replace: true, force: true });
  });
  const pw = $('#password-form', el);
  submitHandler(pw, async (v) => {
    await api.post('/api/account/password', v);
    pw.reset();
    toast('Password changed');
  });
  $('#delete-account', el)?.addEventListener('click', () => {
    const m = modal({
      title: 'Delete account',
      body: `<form class="stack" id="delete-form" novalidate>
        <p class="muted">${esc(deleteWarning)} This cannot be undone.</p>
        <p class="notice bad hide" data-form-error role="alert"></p>
        ${field('Confirm with your password', '<input class="input" name="password" type="password" autocomplete="current-password" required>')}
      </form>`,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-danger" type="submit" form="delete-form">Delete permanently</button>',
    });
    submitHandler($('#delete-form', m.el), async (v) => {
      await api.del('/api/account', { password: v.password });
      m.close();
      await refresh();
      toast('Your account has been deleted');
      navigate('/', { replace: true, force: true });
    });
  });
}
