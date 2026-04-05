"""
main.py — Local polling loop.

Runs the pipeline on a configurable interval (default: 10 seconds).
Use this when running the project locally on your own machine.
"""
from __future__ import annotations

import asyncio
import logging

from .action_center_store import append_action_center_entries_from_pipeline_results
from .config import Config
from .errors import ConfigurationError
from .logging_utils import setup_logging
from .pipeline import run_pipeline, send_due_leave_alerts

setup_logging(Config.log_level, force=True)
log = logging.getLogger("smart-calendar")


def _assert_startup_ready() -> None:
    report = Config.validation_report()
    for error in report["errors"]:
        log.error("CONFIG: %s", error)
    for warning in report["warnings"]:
        log.warning("CONFIG: %s", warning)

    if report["errors"]:
        raise ConfigurationError("Startup validation failed.")


def _log_startup_banner() -> None:
    """Log the local polling-loop configuration once at startup."""
    log.info("Smart Calendar starting")
    log.info(
        "LLM provider: %s (%s)",
        Config.active_llm,
        Config.llm_providers[Config.active_llm]["model"],
    )
    log.info("Poll interval: %ds", Config.poll_interval)
    log.info("Max emails per cycle: %d", Config.max_emails_per_cycle)


async def run_cycle() -> tuple[list[dict], list[dict]]:
    """Run one poll cycle and return processed emails plus leave alerts."""
    results = await run_pipeline()
    if results:
        failures = sum(1 for result in results if "error" in result)
        log.info(
            "Handled %d email(s) this cycle (%d succeeded, %d failed)",
            len(results),
            len(results) - failures,
            failures,
        )

    leave_alerts = await send_due_leave_alerts()
    if leave_alerts:
        failures = sum(1 for result in leave_alerts if "error" in result)
        log.info(
            "Handled %d leave alert(s) this cycle (%d succeeded, %d failed)",
            len(leave_alerts),
            len(leave_alerts) - failures,
            failures,
        )

    return results, leave_alerts


async def poll_forever(stop_event: asyncio.Event | None = None) -> None:
    """Run the local polling loop until cancelled or the stop event is set."""
    _assert_startup_ready()
    _log_startup_banner()

    while True:
        try:
            await run_cycle()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("Unexpected error in main loop: %s", exc, exc_info=True)

        if stop_event is None:
            await asyncio.sleep(Config.poll_interval)
            continue

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=Config.poll_interval)
        except asyncio.TimeoutError:
            continue
        break


async def main() -> None:
    await poll_forever()


def run() -> None:
    """Run the local polling loop."""
    asyncio.run(main())


if __name__ == "__main__":
    run()
