"""When the shared token fixtures may be missing: in an sdist, and nowhere else."""

from __future__ import annotations

from verify_support import fixtures_skip_reason


def test_a_missing_fixture_skips_with_the_path_it_looked_for() -> None:
    reason = fixtures_skip_reason(present=False, required=False)
    assert reason is not None
    assert "sdks/node/test/fixtures" in reason
    assert "ODUDU_REQUIRE_FIXTURES" in reason


def test_a_present_fixture_never_skips() -> None:
    assert fixtures_skip_reason(present=True, required=False) is None
    assert fixtures_skip_reason(present=True, required=True) is None


def test_ci_that_requires_the_fixtures_does_not_skip_a_missing_one() -> None:
    assert fixtures_skip_reason(present=False, required=True) is None
