"""
main.py — Local polling loop.

Runs the pipeline on a configurable interval (default: 60 seconds).
Use this when running the project locally on your own machine.
"""
from __future__ import annotations

import asyncio
import logging

from config import Config
from errors import ConfigurationError
from pipeline import run_pipeline

logging.basicConfig(
    level=getattr(logging, Config.log_level.upper(), logging.INFO),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("smart-calendar")


def _assert_startup_ready() -> None:
    report = Config.validation_report()
    for error in report["errors"]:
        log.error("CONFIG: %s", error)
    for warning in report["warnings"]:
        log.warning("CONFIG: %s", warning)

    if report["errors"]:
        raise ConfigurationError("Startup validation failed.")


async def main() -> None:
    _assert_startup_ready()

    log.info("Smart Calendar starting")
    log.info(
        "LLM provider: %s (%s)",
        Config.active_llm,
        Config.llm_providers[Config.active_llm]["model"],
    )
    log.info("Poll interval: %ds", Config.poll_interval)

    while True:
        try:
            results = await run_pipeline()
            if results:
                log.info("Processed %d email(s) this cycle", len(results))
        except Exception as exc:
            log.error("Unexpected error in main loop: %s", exc, exc_info=True)

        await asyncio.sleep(Config.poll_interval)


if __name__ == "__main__":
    asyncio.run(main())
