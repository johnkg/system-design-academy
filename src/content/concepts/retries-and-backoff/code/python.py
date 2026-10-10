"""Retry with exponential backoff and full jitter in Python. Sleep and random are passed in so the demo is deterministic."""
import asyncio
import math
import random as random_module


class ServiceError(Exception):
    def __init__(self, message, retryable):
        super().__init__(message)
        self.retryable = retryable


async def retry(operation, *, max_attempts=5, base_ms=100, cap_ms=2000, random=random_module.random, sleep):
    attempt = 1
    while True:
        try:
            return await operation(attempt)
        except ServiceError as error:
            if not error.retryable or attempt == max_attempts:
                raise  # give up: not worth retrying, or out of attempts
            ceiling = min(cap_ms, base_ms * 2 ** (attempt - 1))  # 100, 200, 400, 800 ...
            delay = math.floor(random() * ceiling)  # full jitter: anywhere from 0 to the ceiling
            print(f"attempt {attempt} failed ({error}); waiting {delay} ms")
            await sleep(delay)
            attempt += 1


async def sleep(ms):
    pass  # a real version would wait; here we only print the chosen delay


def fixed_random():
    return 0.5


# A service that fails twice with a temporary error, then works
async def flaky(attempt):
    if attempt <= 2:
        raise ServiceError("503 unavailable", retryable=True)
    return f"ok on attempt {attempt}"


# A permanent error is not retried at all
async def not_found(attempt):
    raise ServiceError("404 not found", retryable=False)


# A service that never recovers: stops after the maximum attempts
async def down(attempt):
    raise ServiceError("503 unavailable", retryable=True)


async def main():
    print(await retry(flaky, random=fixed_random, sleep=sleep))

    try:
        await retry(not_found, random=fixed_random, sleep=sleep)
    except ServiceError as e:
        print(f"gave up immediately: {e}")

    try:
        await retry(down, max_attempts=3, random=fixed_random, sleep=sleep)
    except ServiceError as e:
        print(f"gave up after 3 attempts: {e}")


asyncio.run(main())
