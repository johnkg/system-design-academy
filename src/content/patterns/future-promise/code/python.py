# Future/Promise in Python. Start both lookups, then wait for the futures together.
import asyncio


async def lookup_price() -> int:  # wrapped in a task, the coroutine's result becomes a future
    await asyncio.sleep(0.15)
    return 40


async def lookup_stock(fails: bool) -> int:
    await asyncio.sleep(0.10)
    if fails:
        raise RuntimeError("stock service down")
    return 7


async def show(stock_fails: bool) -> None:
    print("started price and stock lookups")
    price_future = asyncio.ensure_future(lookup_price())  # the work has begun, the value is not here yet
    stock_future = asyncio.ensure_future(lookup_stock(stock_fails))

    price, stock = await asyncio.gather(price_future, stock_future, return_exceptions=True)  # keep each outcome
    if isinstance(stock, Exception):
        print(f"stock failed: {stock}")
        print(f"price still arrived: {price}")
    else:
        print(f"price {price}, stock {stock}")


async def main() -> None:
    await show(False)
    await show(True)


asyncio.run(main())
