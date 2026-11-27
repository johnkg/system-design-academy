# Without the pattern: each lookup is awaited before the next one starts, and one failure loses everything.
import asyncio


async def lookup_price():
    await asyncio.sleep(0.15)
    return 40


async def lookup_stock(fails):
    await asyncio.sleep(0.10)
    if fails:
        raise RuntimeError("stock service down")
    return 7


async def show(stock_fails):
    try:
        print("asked for the price, waiting...")
        price = await lookup_price()  # nothing else happens during this wait
        print(f"got price {price}")
        print("asked for the stock, waiting...")
        stock = await lookup_stock(stock_fails)  # only now does the second lookup start
        print(f"got stock {stock}")
    except RuntimeError as error:
        print(f"page failed: {error}")  # the page fails, and the price that had arrived is thrown away


async def main():
    await show(False)
    await show(True)


asyncio.run(main())
