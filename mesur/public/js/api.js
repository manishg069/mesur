// Thin fetch wrapper. Errors are surfaced to the UI as-is: there is no
// fallback to mock data when a request fails.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || (status === 0 ? 'Could not reach the server. Check your connection and try again.' : `Request failed (${status}).`));
    this.status = status;
    this.fields = body?.fields ?? null;
    this.code = body?.code ?? null;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, null);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'auth_required') window.dispatchEvent(new CustomEvent('mesur:unauthorised'));
    throw new ApiError(res.status, data);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body = {}) => request('PUT', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),
  del: (path, body = {}) => request('DELETE', path, body),
};
