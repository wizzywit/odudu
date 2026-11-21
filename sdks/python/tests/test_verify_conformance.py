"""Every case of the shared token fixtures gives the same verdict as `@odudu-io/node`.

The cases are the single copy under sdks/node/test/fixtures, read from the checkout. An sdist
does not carry them, so outside a checkout this module is skipped with a reason that names them,
unless ODUDU_REQUIRE_FIXTURES is set, which CI does: then a missing file fails.
"""

from __future__ import annotations

import asyncio
from typing import cast

import pytest
from verify_support import (
    IssuerServer,
    fixtures_present,
    fixtures_required,
    fixtures_skip_reason,
    read_fixture,
)

from odudu.verify import AsyncVerifier, VerificationError, Verifier

_SKIP = fixtures_skip_reason(present=fixtures_present(), required=fixtures_required())
pytestmark = pytest.mark.skipif(_SKIP is not None, reason=_SKIP or "")

Case = dict[str, object]


def _cases() -> list[Case]:
    if _SKIP is not None:
        return []
    return cast("list[Case]", read_fixture("cases.json"))


def _keys() -> list[dict[str, object]]:
    document = cast("dict[str, list[dict[str, object]]]", read_fixture("jwks.json"))
    return document["keys"]


def _arguments(case: Case) -> tuple[list[str], str, str | None]:
    scope = case.get("requiredScope")
    return [str(case["issuer"])], str(case["audience"]), None if scope is None else str(scope)


def _expect(case: Case, run: object) -> None:
    expected = cast("dict[str, object]", case["expected"])
    if expected["ok"]:
        assert cast("tuple[str, ...]", run) == tuple(cast("list[str]", expected["scope"]))
        return
    error = cast("VerificationError", run)
    assert isinstance(error, VerificationError)
    assert (error.status, error.code, error.reason) == (
        expected["status"],
        expected["code"],
        expected["reason"],
    )


def _sync(case: Case) -> object:
    issuers, audience, scope = _arguments(case)
    server = IssuerServer(keys=_keys(), issuer=issuers[0])
    with Verifier(
        issuers,
        audience,
        scope,
        now=lambda: float(cast("int", case["now"])) / 1000,
        http_client=server.client,
    ) as verifier:
        try:
            return verifier.verify(str(case["token"])).scope
        except VerificationError as error:
            return error


async def _async(case: Case) -> object:
    issuers, audience, scope = _arguments(case)
    server = IssuerServer(keys=_keys(), issuer=issuers[0])
    async with AsyncVerifier(
        issuers,
        audience,
        scope,
        now=lambda: float(cast("int", case["now"])) / 1000,
        http_client=server.async_client,
    ) as verifier:
        try:
            return (await verifier.verify(str(case["token"]))).scope
        except VerificationError as error:
            return error


def test_there_are_cases_to_check() -> None:
    assert len(_cases()) >= 31


@pytest.mark.parametrize("case", _cases(), ids=lambda case: str(case["name"]))
def test_the_verifier_gives_the_fixtures_verdict(case: Case) -> None:
    _expect(case, _sync(case))


@pytest.mark.parametrize("case", _cases(), ids=lambda case: str(case["name"]))
def test_the_async_verifier_gives_the_fixtures_verdict(case: Case) -> None:
    _expect(case, asyncio.run(_async(case)))
