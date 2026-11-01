---
title: Sign in to WordPress with Odudu
description: Let people sign in to a WordPress site with their Odudu account, using the OpenID Connect Generic Client plugin and one small add-on.
sidebar_position: 10
---

# Sign in to WordPress with Odudu

WordPress has no OpenID Connect built in, so a plugin does it. This page uses the free OpenID Connect Generic Client plugin. People click a button on the WordPress login page, sign in to Odudu, and arrive in the dashboard as their WordPress user.

Hand-tested on 2026-10-23 with WordPress 7.1.3 and plugin version 3.11.3. The plugin has no PKCE, which Odudu requires, so step 3 adds a small file that supplies it.

You need the stack from the [quick start](../quick-start/index.mdx), with its `demo` tenant, and a WordPress site you can administer. The WordPress server and every person's browser must reach Odudu at the same public address. Run the commands in the folder that holds `compose.yaml`, in bash or zsh, with `curl` installed.

## 1. Point the commands at your servers

`ODUDU_BASE` is Odudu's address. `WP_SITE` is your WordPress address, with no slash at the end.

```sh {run}
export ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}" && export TENANT="$ODUDU_BASE/tenants/demo" && export WP_SITE="${WP_SITE:-https://blog.example.com}"
```

## 2. Register WordPress in Odudu

First make a person to sign in. WordPress needs an email address for every user, so this one has one, marked verified for the check in step 6.

```sh {run expect="userSubjectId"}
docker compose exec odudu odudu seed user --tenant demo --username wendy --email wendy@example.com --email-verified --password 'a long and unremarkable passphrase'
```

WordPress keeps a secret on its server, so it is a confidential client. Make a secret and keep it for step 4.

```sh {run}
CLIENT_SECRET=$(openssl rand -hex 24)
```

The plugin sends its secret in the body of the token request, so the client uses `client_secret_post`. The redirect address is the plugin's own callback. Odudu matches it character for character. The post-logout address is where Odudu sends people after WordPress signs them out. WordPress adds the language to it, so use your site's language code in place of `en_US`.

```sh {run expect="clientDbId"}
docker compose exec odudu odudu seed client --tenant demo --client-id wordpress --client-secret "$CLIENT_SECRET" --token-endpoint-auth-method client_secret_post --grant-type authorization_code --grant-type refresh_token --redirect-uri "$WP_SITE/wp-admin/admin-ajax.php?action=openid-connect-authorize" --post-logout-redirect-uri "$WP_SITE/wp-login.php?loggedout=true&wp_lang=en_US"
```

Check that Odudu accepts the secret. A made-up code is refused as `invalid_grant`. A wrong secret would say `invalid_client`.

```sh {run expect="invalid_grant"}
curl -sS --data-urlencode grant_type=authorization_code --data-urlencode code=not-a-real-code --data-urlencode client_id=wordpress --data-urlencode "client_secret=$CLIENT_SECRET" --data-urlencode "redirect_uri=$WP_SITE/wp-admin/admin-ajax.php?action=openid-connect-authorize" --data-urlencode code_verifier=x "$TENANT/protocol/openid-connect/token"
```

## 3. Install the plugin and the PKCE file

In WordPress, open **Plugins**, **Add Plugin**, search for _OpenID Connect Generic Client_ and choose **Install Now**, then **Activate**. From a shell on the server, `wp plugin install daggerhart-openid-connect-generic --activate` does the same.

Odudu refuses a sign-in that carries no PKCE challenge. The plugin sends none, so every attempt would come back to the login page with _An unknown error occurred_. This command shows the refusal Odudu gives.

```sh {run expect="error=invalid_request"}
curl -sS -o /dev/null -D - "$TENANT/protocol/openid-connect/auth?response_type=code&client_id=wordpress&redirect_uri=$WP_SITE/wp-admin/admin-ajax.php%3Faction%3Dopenid-connect-authorize&scope=openid&state=abc" | sed -n 's/^[Ll]ocation: //p'
```

Save this as `wp-content/mu-plugins/odudu-pkce.php`, creating the folder if it is not there. WordPress loads every file in it, with nothing to activate. The file makes the challenge for each sign-in and shows the matching verifier when the plugin trades the code.

```php
<?php
/**
 * Plugin Name: Odudu PKCE
 * Description: Adds PKCE to the OpenID Connect Generic Client's sign-in.
 */

function odudu_pkce_b64url(string $bytes): string {
	return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

add_filter('openid-connect-generic-auth-url', function (string $url): string {
	parse_str((string) wp_parse_url($url, PHP_URL_QUERY), $query);
	if (empty($query['state'])) {
		return $url;
	}
	$verifier = odudu_pkce_b64url(random_bytes(32));
	set_transient('odudu_pkce_' . $query['state'], $verifier, 600);
	$challenge = odudu_pkce_b64url(hash('sha256', $verifier, true));
	return $url . '&code_challenge=' . $challenge . '&code_challenge_method=S256';
});

add_filter('openid-connect-generic-alter-request', function ($request, $operation) {
	if ($operation !== 'get-authentication-token' || empty($_GET['state'])) {
		return $request;
	}
	$key = 'odudu_pkce_' . sanitize_text_field(wp_unslash($_GET['state']));
	$verifier = get_transient($key);
	if ($verifier !== false) {
		$request['body']['code_verifier'] = $verifier;
		delete_transient($key);
	}
	return $request;
}, 10, 2);
```

## 4. Fill in the plugin's settings

The settings are under **Settings**, **OpenID Connect Client**. The addresses come from the tenant's discovery document.

```sh {run expect="end_session_endpoint"}
curl -fsS "$TENANT/.well-known/openid-configuration" | sed -E 's/,"/,\n"/g' | grep -E '"(issuer|authorization_endpoint|token_endpoint|userinfo_endpoint|end_session_endpoint|jwks_uri)"'
```

| Setting                       | Value                                                   |
| ----------------------------- | ------------------------------------------------------- |
| Login Type                    | OpenID Connect button on login form                     |
| Client ID                     | `wordpress`                                             |
| Client Secret Key             | the secret from step 2                                  |
| OpenID Scope                  | `openid email profile`                                  |
| Login Endpoint URL            | `authorization_endpoint`                                |
| Userinfo Endpoint URL         | `userinfo_endpoint`                                     |
| Token Validation Endpoint URL | `token_endpoint`                                        |
| End Session Endpoint URL      | `end_session_endpoint`                                  |
| JWKS URI                      | `jwks_uri`                                              |
| Issuer                        | `issuer`, such as `https://id.example.com/tenants/demo` |
| Identity Key                  | `preferred_username`                                    |
| Nickname Key                  | `preferred_username`                                    |
| Email Formatting              | `{email}`                                               |
| Display Name Formatting       | `{name}`                                                |
| Link Existing Users           | off, until you have read step 6                         |
| Create user if does not exist | on                                                      |

Fill in **JWKS URI**. Without it the plugin does not check the ID token's signature. Fill in **Issuer** too. The plugin otherwise guesses the address without `/tenants/demo`, and every sign-in fails. If your Odudu server has a private address, also turn on **Allow Internal IDP**.

The page shows its **Redirect URI** under **Notes**. It must be the address you registered in step 2. If your host blocks `admin-ajax.php`, turn on **Alternate Redirect URI**, save the **Permalinks** page once, and register `$WP_SITE/openid-connect-authorize` instead. Both work.

## 5. Sign in

Open `/wp-login.php`. Under the form is a link, _Login with OpenID Connect_. Choose it, sign in to Odudu as `wendy`, and you land in the dashboard.

- A person with no WordPress account gets one. The user name is their `preferred_username`, the role is the site's default role, and the email and name come from the tenant.
- A person who already has one is signed in to it only when **Link Existing Users** is on and the email is the same. The plugin remembers the Odudu `sub` after that.

## 6. Link people by email only when the email is verified

The plugin never looks at `email_verified`. With **Link Existing Users** on, anyone whose Odudu account carries an administrator's email address signs in as that administrator, verified or not. We tried it.

Turn the setting on only when every person in the tenant either was created by you with their address checked, or had to verify it. In the console, a person's **Profile** has an **Email verified** switch, and **Verify email addresses** under **Registration and recovery** makes registration require it. On the command line, `odudu seed user --email-verified` creates a person with a verified address, and `odudu seed profile --email-verified` marks an existing one.

To make WordPress refuse a person whose address is not verified, save this as `wp-content/mu-plugins/odudu-verified.php`.

```php
<?php
/**
 * Plugin Name: Odudu verified email
 * Description: Refuses a sign-in whose email address Odudu has not verified.
 */

add_filter('openid-connect-generic-user-login-test', function (bool $allowed, array $claim): bool {
	return $allowed && ($claim['email_verified'] ?? false) === true;
}, 10, 2);
```

A person turned away sees _Unauthorized access_ on the login page.

## 7. Give people roles from Odudu

The plugin does not map roles. It does pass the claims it receives to a hook, so a short file can. First put the `roles` claim in what WordPress receives. This creates a role, gives it to `wendy`, maps it to the `roles` scope and lets the client ask for that scope.

```sh {run expect="roleId"}
docker compose exec odudu odudu seed role --tenant demo --name wp-editor
```

```sh {run expect="wp-editor"}
docker compose exec odudu odudu seed grant-role --tenant demo --username wendy --role wp-editor
```

```sh {run expect="wp-editor"}
docker compose exec odudu odudu seed map-role --tenant demo --scope roles --role wp-editor
```

```sh {run expect="roles"}
docker compose exec odudu odudu seed assign-scope --tenant demo --client-id wordpress --scope roles --assignment optional
```

In the plugin, change **OpenID Scope** to `openid email profile roles`. The roles arrive from the UserInfo endpoint, which the plugin reads. The ID token does not carry them. [Roles and groups](../concepts/roles-and-groups.mdx) explains why.

Add this to `wp-content/mu-plugins/odudu-verified.php` below the first filter, or save it as its own file. It gives the person the first WordPress role in the list that they hold in Odudu.

```php
const ODUDU_ROLE_MAP = [
	'wp-administrator' => 'administrator',
	'wp-editor' => 'editor',
	'wp-author' => 'author',
];

add_action('openid-connect-generic-update-user-using-current-claim', function (WP_User $user, array $claim): void {
	foreach (ODUDU_ROLE_MAP as $odudu => $wordpress) {
		if (in_array($odudu, $claim['roles'] ?? [], true)) {
			$user->set_role($wordpress);
			return;
		}
	}
}, 10, 2);
```

At the next sign-in `wendy` is an editor, and a person who signs in for the first time gets the role with their new account. A person with none of those roles keeps the role they had, so taking a role away in Odudu does not lower it in WordPress.

## 8. Sign out

Choosing **Log Out** in WordPress ends the WordPress session and sends the browser to Odudu's sign-out address, which asks the person to confirm. Confirming ends the Odudu session too, and Odudu then returns the person to `wp-login.php`, because you registered that address in step 2.

If the post-logout address is not registered exactly, the person is still signed out of both once they confirm. Odudu says _the address given to return to afterward is not one this client has registered_ and stays on its own page.

## What this does not do

- **No sign-out from Odudu.** Signing out in Odudu, in the console or in another app does not sign anyone out of WordPress. The plugin has no front-channel or back-channel logout address, so the person stays signed in to WordPress until its own session ends, two days by default.
- **No role removal.** Roles only go up, as step 7 says.
- **No PKCE of its own.** Step 3's file is the only reason the sign-in works.
- **One tenant per site.** The plugin talks to one tenant.

## If something goes wrong

- **The login page says _An unknown error occurred_.** Odudu refused the request, nearly always for lack of PKCE. Check that `odudu-pkce.php` is in `wp-content/mu-plugins/`.
- **The login page says _User claim incomplete_.** The person has no email address in Odudu. WordPress needs one.
- **Odudu says _Unregistered redirect URI_.** The address in the request is not one the client has. Copy the plugin's **Redirect URI** from its settings page into the client, character for character, scheme and path included.
- **The login page says _Token issuer does not match expected issuer_.** The **Issuer** setting is not exactly the tenant's `issuer`, which includes `/tenants/` and the tenant's name.

## Where to go next

- Learn what the client you registered is allowed to do in [Clients](../concepts/clients.mdx).
- Put a person's roles in tokens with [Roles and groups](../concepts/roles-and-groups.mdx).
- See what an Odudu sign-in looks like from the server's side in [Sign people in to a web app](./web-app.md).
