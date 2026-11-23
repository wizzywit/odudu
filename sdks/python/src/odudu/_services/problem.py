"""What a refusal says, read from a body that may be anything."""

from __future__ import annotations

import json
from dataclasses import dataclass, field

MAX_TEXT = 1000
MAX_FIELD_ERRORS = 100


@dataclass(frozen=True)
class FieldError:
    """One field a request was refused for. `line` and `column` locate a mistake in a document."""

    path: str
    message: str
    code: str | None = None
    detail: str | None = None
    line: int | None = None
    column: int | None = None


@dataclass(frozen=True)
class ProblemInit:
    status: int
    code: str | None = None
    title: str | None = None
    detail: str | None = None
    type: str | None = None
    instance: str | None = None
    errors: list[FieldError] = field(default_factory=list)


def _text(value: object) -> str | None:
    return value[:MAX_TEXT] if isinstance(value, str) and value else None


def _code_of_type(problem_type: str | None) -> str | None:
    if problem_type is None or "#" not in problem_type:
        return None
    return _text(problem_type.split("#", 1)[1])


def _position(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _field_error(value: object) -> FieldError | None:
    if not isinstance(value, dict):
        return None
    path, message = _text(value.get("path")), _text(value.get("message"))
    if path is None or message is None:
        return None
    return FieldError(
        path=path,
        message=message,
        code=_text(value.get("code")),
        detail=_text(value.get("detail")),
        line=_position(value.get("line")),
        column=_position(value.get("column")),
    )


def _field_errors(value: object) -> list[FieldError]:
    if not isinstance(value, list):
        return []
    parsed = (_field_error(entry) for entry in value[:MAX_FIELD_ERRORS])
    return [entry for entry in parsed if entry is not None]


def _parse(body: str | None) -> object:
    if body is None:
        return None
    try:
        return json.loads(body)
    except (ValueError, RecursionError):
        return None


def problem_from_body(status: int, body: str | None) -> ProblemInit:
    """Reads a problem body (RFC 9457) or a me API refusal.

    A body that is neither, such as a proxy's error page, contributes nothing but
    the status, so its text is never echoed.
    """
    parsed = _parse(body)
    if not isinstance(parsed, dict):
        return ProblemInit(status=status)
    problem_type = _text(parsed.get("type"))
    return ProblemInit(
        status=status,
        type=problem_type,
        code=_code_of_type(problem_type) or _text(parsed.get("error")),
        title=_text(parsed.get("title")),
        detail=_text(parsed.get("detail")) or _text(parsed.get("error_description")),
        instance=_text(parsed.get("instance")),
        errors=_field_errors(parsed.get("errors")),
    )
