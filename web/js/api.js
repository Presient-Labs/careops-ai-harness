let csrfToken = null;

// background: true is for polls. The server does not count them as activity, and neither does the page's idle timer.
export async function api(path, { method = 'GET', body, background = false } = {}) {
  const verb = method.toUpperCase();
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (verb === 'POST' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (background) headers['X-CareOps-Background'] = '1';
  try {
    const response = await fetch(`/api${path}`, {
      method: verb, headers, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = response.status === 204 ? {} : await response.json().catch(() => null);
    if (response.status === 401) {
      csrfToken = null;
      // Signed out (idle, expired, or the halfway pass ran out): back to sign-in, saying why.
      if (location.pathname !== '/' && location.pathname !== '/index.html') location.replace(`/?reason=${encodeURIComponent(data?.error?.code ?? 'unauthenticated')}`);
    }
    if (!response.ok) {
      return { error: data?.error ?? { code: 'request_failed', message: 'The request could not be completed. Please try again.' } };
    }
    if (data === null) {
      return { error: { code: 'invalid_response', message: 'The server returned an unreadable response. Refresh this page to check the latest data.' } };
    }
    if (typeof data.csrfToken === 'string') csrfToken = data.csrfToken; // every sign-in step issues a new session and token
    if (path === '/auth/logout') csrfToken = null;
    if (!background) window.dispatchEvent(new CustomEvent('careops:activity'));
    return data;
  } catch {
    return { error: { code: 'network_error', message: verb === 'POST'
      ? 'The connection was interrupted. The request may have reached the server. Check the latest data before trying again.'
      : 'Cannot reach CareOps right now. Check your connection and try again.' } };
  }
}

export const newKey = () => crypto.randomUUID();
