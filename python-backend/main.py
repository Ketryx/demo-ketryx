```python
import logging
import signal
import sys
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response

app = FastAPI(title="Analytical Backend Server", version="1.0.0")

# Configure CORS to allow requests from NodeJS frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Adjust according to your NodeJS server URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("analytical-backend")


@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check() -> Dict[str, Any]:
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Endpoint to perform analytical processing.

    Expects a JSON payload with the data for analysis.
    """
    try:
        # Example placeholder analytical calculation:
        # Assume input JSON contains a list of numbers under 'values'
        values = data.get("values")
        if not isinstance(values, list) or not all(isinstance(x, (int, float)) for x in values):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Field 'values' must be a list of numbers.",
            )

        result = await run_in_threadpool(simple_analysis, values)
        return {"result": result}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Processing error: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal analytical processing error.",
        ) from exc


def simple_analysis(numbers: list[float]) -> Dict[str, float]:
    if not numbers:
        raise ValueError("Empty list provided for analysis")
    total = sum(numbers)
    count = len(numbers)
    mean = total / count
    minimum = min(numbers)
    maximum = max(numbers)
    return {
        "count": count,
        "mean": mean,
        "min": minimum,
        "max": maximum,
        "total": total,
    }


@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"Start request: {request.method} {request.url}")
    try:
        response = await call_next(request)
    except Exception as exc:
        logger.error(f"Unhandled error: {exc}", exc_info=True)
        raise
    logger.info(f"Completed request: {request.method} {request.url} - Status: {response.status_code}")
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    logger.warning(f"HTTP error: {exc.detail} (status {exc.status_code})")
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.on_event("startup")
async def on_startup():
    logger.info("Starting Analytical Backend Server...")


@app.on_event("shutdown")
async def on_shutdown():
    logger.info("Shutting down Analytical Backend Server...")


def _graceful_shutdown(signum, frame):
    logger.info(f"Received signal {signum}. Initiating graceful shutdown.")
    sys.exit(0)


signal.signal(signal.SIGINT, _graceful_shutdown)
signal.signal(signal.SIGTERM, _graceful_shutdown)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, log_level="info")
```