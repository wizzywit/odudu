// The person at a browser, scripted: opens an authorization URL, signs in and
// answers the consent page, and returns the address the server redirected to.
// Plain Node, no dependencies. Each call has a cookie jar of its own.

function cookieJar() {
  const jar = new Map();
  return {
    header: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
    remember(response) {
      for (const line of response.headers.getSetCookie()) {
        const [pair, ...attributes] = line.split(';');
        const at = pair.indexOf('=');
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        const cleared = value === '' || attributes.some((a) => /^\s*max-age=0\s*$/iu.test(a));
        if (cleared) jar.delete(name);
        else jar.set(name, value);
      }
    },
  };
}

function hiddenField(html, name) {
  return new RegExp(`name="${name}" value="([^"]*)"`, 'u').exec(html)?.[1];
}

// `ticked` are the optional scopes the person ticks on the consent page.
export async function signIn(authorizeUrl, username, password, ticked) {
  const jar = cookieJar();
  const { origin, pathname } = new URL(authorizeUrl);
  const tenantPath = pathname.split('/protocol/')[0];

  async function send(target, form) {
    const response = await fetch(target, {
      method: form ? 'POST' : 'GET',
      redirect: 'manual',
      headers: {
        cookie: jar.header(),
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form?.toString(),
    });
    jar.remember(response);
    return response;
  }

  let page = await send(authorizeUrl);
  if (page.status !== 200) throw new Error(`the authorization endpoint answered ${page.status}`);
  let html = await page.text();
  const signInSession = hiddenField(html, 'auth_session_id');
  if (signInSession === undefined) throw new Error('the sign-in page carried no auth_session_id');

  page = await send(
    `${origin}${tenantPath}/login-actions/authenticate`,
    new URLSearchParams({ auth_session_id: signInSession, username, password }),
  );
  if (page.status !== 200)
    throw new Error(`the sign-in answered ${page.status}, not the consent page`);
  html = await page.text();
  const consentSession = hiddenField(html, 'auth_session_id');
  if (consentSession === undefined || !html.includes('login-actions/consent')) {
    throw new Error('the sign-in did not end on the consent page');
  }
  const offered = [...html.matchAll(/name="scope" value="([^"]*)"/gu)].map((m) => m[1]);
  const missing = ticked.filter((scope) => !offered.includes(scope));
  if (missing.length > 0) {
    throw new Error(
      `the consent page did not offer ${missing.join(', ')} (offered: ${offered.join(', ')})`,
    );
  }

  const form = new URLSearchParams({ auth_session_id: consentSession, decision: 'allow' });
  for (const scope of ticked) form.append('scope', scope);
  page = await send(`${origin}${tenantPath}/login-actions/consent`, form);
  const location = page.headers.get('location');
  if (page.status !== 302 || location === null) {
    throw new Error(`the consent answered ${page.status} with no redirect`);
  }
  return location;
}
