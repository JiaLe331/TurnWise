class DomainError(Exception):
    status_code = 400
    code = "domain_error"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code


class BadRequest(DomainError):
    status_code = 422
    code = "bad_request"


class Forbidden(DomainError):
    status_code = 403
    code = "forbidden"


class NotFound(DomainError):
    status_code = 404
    code = "not_found"


class InvalidTransition(DomainError):
    status_code = 409
    code = "invalid_transition"


class VersionConflict(DomainError):
    status_code = 409
    code = "version_conflict"


class IdempotencyConflict(DomainError):
    status_code = 422
    code = "idempotency_key_reused"
