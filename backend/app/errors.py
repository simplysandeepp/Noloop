"""NestJS-shaped error responses.

The frontends read `data.message` (string or string[]) — see lib/api.ts —
so we mirror Nest's {message, error, statusCode} bodies, including 400
(not FastAPI's 422) for validation failures.
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_ERROR_NAMES = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    500: "Internal Server Error",
}


def nest_error(status: int, message) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "message": message,
            "error": _ERROR_NAMES.get(status, "Error"),
            "statusCode": status,
        },
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_exc(request: Request, exc: StarletteHTTPException):
        return nest_error(exc.status_code, exc.detail)

    @app.exception_handler(RequestValidationError)
    async def validation_exc(request: Request, exc: RequestValidationError):
        # Nest's ValidationPipe returns message: string[] with a 400.
        msgs = [
            f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}"
            for e in exc.errors()
        ]
        return nest_error(400, msgs)
