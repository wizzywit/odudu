# Python example

The Python package `odudu` in two small files. `admin.py` is a script that uses the admin client as a service: it makes a client, reads it back and deletes it. `app.py` is a FastAPI API that decides for itself whether to trust an access token, with `odudu.verify`.

## What is in it

- `admin.py` gets a token for the service `example-admin` with a client credentials request through `httpx` (the Python package has no token source of its own), and gives it to `AdminClient`. `client.call(operation, ...)` fills the tenant into the path, and `iterate_pages` walks a list by cursor. A response that is not a success raises `ProblemError`.
- `app.py` builds an `AsyncVerifier` for the tenant and puts `require_token(verifier, scope="reports:read")` on a route. The verifier reads the tenant's published keys and checks the signature, the issuer, the audience, the token type (which keeps an ID token out) and the expiry. A request without a token is a 401 with a `WWW-Authenticate` challenge, and a valid token without the scope is a 403.

## Run it

You need Python 3.10 or later and the quick start stack. Run `../_shared/provision.sh` once: it makes the services `example-admin`, which holds `manage-clients` (`odudu seed client --capability manage-clients`), and `example-m2m`, which may ask for `reports:read`.

In a virtual environment, run `pip install --require-hashes -r requirements.txt` and then `pip install 'odudu[fastapi]>=0.1,<0.2'`; the folder is a set of scripts and is not itself installable. To run it against a checkout of this repository instead, for a change that is not released yet, `../_shared/install-python.sh .` makes the virtual environment in `.venv` from the hashed `requirements.txt`, builds the package from `sdks/python` into a wheel and installs it. Then:

```text
.venv/bin/python admin.py
.venv/bin/uvicorn app:app --port 8087
```

With the API running, ask for a token and call it:

```text
TOKEN=$(curl -s -u example-m2m:example-m2m-secret -d grant_type=client_credentials -d scope=reports:read http://localhost:3000/tenants/demo/protocol/openid-connect/token | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
curl -i -H "Authorization: Bearer $TOKEN" http://localhost:8087/reports
```

`.venv/bin/python -m pytest` runs the script and calls the API through FastAPI's test client with tokens from the stack: refused without a token, let through with the scope, forbidden without it. `.venv/bin/python -m mypy` type-checks the three files.

## What is only for the example

The secrets have published defaults for the local stack. The verifier is told to trust an issuer on plain http, which a production API never does. `requirements.txt` was made from `requirements.in` with `uv pip compile --universal --generate-hashes`.
