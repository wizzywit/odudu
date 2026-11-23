"""An API that trusts an access token only after checking it itself.

Run it with `uvicorn app:app --port 8087`. The verifier reads the tenant's published keys, and
checks the signature, the issuer, the audience, the token type (which keeps an ID token out)
and the expiry. For the example the issuer is on plain http, which a production API never
allows.
"""

import os

from fastapi import Depends, FastAPI
from odudu.verify import AsyncVerifier, VerifiedToken
from odudu.verify.fastapi import require_token

BASE = os.environ.get("ODUDU_BASE", "http://localhost:3000")
ISSUER = f"{BASE}/tenants/{os.environ.get('TENANT', 'demo')}"

# Odudu always puts the tenant's address in a token's audience, beside any audience the client
# is registered for. An API that trusts the tenant's address trusts every token of the tenant:
# register an audience on the client and pass it here.
verifier = AsyncVerifier(
    [ISSUER], os.environ.get("API_AUDIENCE", ISSUER), allow_insecure_issuers=True
)

app = FastAPI()


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": "example API"}


# A valid token without the scope is a 403, because the caller is known and not allowed; a 401
# means the token itself is not trusted.
@app.get("/reports")
async def reports(
    token: VerifiedToken = Depends(require_token(verifier, scope="reports:read")),  # noqa: B008
) -> dict[str, object]:
    return {"caller": token.client_id or token.sub, "reports": ["q1", "q2"]}
