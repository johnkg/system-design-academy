"""An orchestrated saga in Python: do each step, and on failure undo the completed ones in reverse."""
import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable


@dataclass
class Step:
    name: str
    action: Callable[[dict], Awaitable[None]]
    compensate: Callable[[dict], Awaitable[None]]


class Saga:
    def __init__(self, steps):
        self.steps = steps

    async def run(self, context):
        completed = []
        for step in self.steps:
            try:
                print(f"do    {step.name}")
                await step.action(context)
                completed.append(step)
            except Exception as error:
                print(f"FAIL  {step.name}: {error}")
                for done in reversed(completed):  # compensate in reverse order
                    print(f"undo  {done.name}")
                    await done.compensate(context)
                return False
        return True


async def noop(context):
    pass


def trip_saga(payment_works):
    async def charge_card(context):
        if not payment_works:
            raise RuntimeError("card declined")

    return Saga([
        Step("reserve flight", noop, noop),  # each local step can be undone
        Step("reserve hotel", noop, noop),
        Step("charge card", charge_card, noop),
    ])


async def main():
    print("--- happy path")
    print("booked:", str(await trip_saga(True).run({})).lower())
    print("--- payment fails")
    print("booked:", str(await trip_saga(False).run({})).lower())


asyncio.run(main())
