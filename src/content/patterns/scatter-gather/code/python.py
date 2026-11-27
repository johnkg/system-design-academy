# Scatter-Gather in Python. Ask every vendor at once, then gather what arrives before the deadline.
# The clock is simulated (each vendor has a fixed answer time) so that the output is the same every run.
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Vendor:  # Worker
    name: str
    latency: int
    price: int | None = None
    error: str | None = None

    def ask(self) -> int:  # answers or fails
        if self.error:
            raise RuntimeError(self.error)
        return self.price


VENDORS = [
    Vendor("A", 120, 105),
    Vendor("B", 80, 99),
    Vendor("C", 450, 90),  # cheap, but too slow
    Vendor("D", 200, 102),
    Vendor("E", 60, error="out of stock feed"),
]


def scatter_gather(workers: list[Vendor], deadline: int) -> tuple[str, int] | None:
    print(f"Scatter: asking {len(workers)} vendors, deadline {deadline} ms")
    gathered: list[tuple[str, int]] = []
    for worker in sorted(workers, key=lambda w: w.latency):  # all were asked at time 0; Gatherer handles arrivals in order
        if worker.latency > deadline:
            print(f"  {worker.name} too slow ({worker.latency} ms), ignored")
            continue
        try:
            price = worker.ask()
            gathered.append((worker.name, price))
            print(f"  {worker.name} answered in {worker.latency} ms: {price}")
        except RuntimeError as error:
            print(f"  {worker.name} failed at {worker.latency} ms: {error}")
    print(f"Gathered {len(gathered)} of {len(workers)} answers")
    if not gathered:  # nothing arrived in time: the caller decides what to show
        return None
    return min(gathered, key=lambda g: g[1])


best = scatter_gather(VENDORS, 300)
print(f"Best price: {best[1]} ({best[0]})" if best else "No answers arrived before the deadline")
