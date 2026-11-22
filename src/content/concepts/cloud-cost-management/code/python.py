# Cloud cost: the same web service priced several ways. Prices are cents per server-hour; everything is integers.
# The prices and discounts are illustrative toy figures, not any provider's real rates.
# LOAD is how many right-sized servers the traffic needs in each hour of a day.
LOAD = [4, 3, 3, 3, 3, 4, 6, 9, 12, 14, 15, 16, 16, 15, 15, 14, 13, 12, 11, 10, 9, 7, 6, 5]
ON_DEMAND = 20      # cents per right-sized server-hour, pay as you go
COMMITTED = 12      # 40% off, but paid every hour for the committed servers, used or not
SPOT = 6            # 70% off spare capacity that the provider can take back
RECLAIM_EVERY = 20  # about 1 spot hour in 20 is taken back and rerun at the on-demand price
TEST_SERVERS = 6    # a test environment, also billed on demand
DAYS = 30


def headroom(load):
    return (load * 5 + 3) // 4  # run 25% above the load (rounded up), so a spike does not hurt


def price(large, autoscale, commit, spot, test_hours):
    size = 2 if large else 1  # a large server costs twice as much and is half idle
    peak = headroom(max(LOAD))
    committed = on_demand = spot_cost = spot_hours = used = paid = 0
    for load in LOAD:
        run = headroom(load) if autoscale else peak
        committed += commit * COMMITTED * size
        extra = max(0, run - commit)
        if spot:
            spot_hours += extra
            spot_cost += extra * SPOT * size
        else:
            on_demand += extra * ON_DEMAND * size
        used += load
        paid += max(run, commit) * size
    on_demand += spot_hours // RECLAIM_EVERY * ON_DEMAND * size
    test = TEST_SERVERS * test_hours * ON_DEMAND * size
    day = committed + on_demand + spot_cost + test
    return {"month": day * DAYS, "committed": committed * DAYS, "on_demand": on_demand * DAYS,
            "spot": spot_cost * DAYS, "test": test * DAYS, "used": used, "paid": paid}


def dollars(cents):
    return f"${cents // 100}.{cents % 100:02d}"


def show(name, **options):
    p = price(**options)
    print(f"-- {name}")
    print(f"  month {dollars(p['month'])}: committed {dollars(p['committed'])}, on demand {dollars(p['on_demand'])}, "
          f"spot {dollars(p['spot'])}, test environment {dollars(p['test'])}")
    print(f"  utilization {p['used'] * 100 // p['paid']}% ({p['used']} of {p['paid']} server-hours a day do work)")
    if p["month"] != p["committed"] + p["on_demand"] + p["spot"] + p["test"]:
        raise RuntimeError("the parts must add up to the bill")
    return p["month"]


start = show("large servers, fixed for the peak, all on demand, test always on", large=True, autoscale=False, commit=0, spot=False, test_hours=24)
show("right-sized", large=False, autoscale=False, commit=0, spot=False, test_hours=24)
show("right-sized, autoscaled", large=False, autoscale=True, commit=0, spot=False, test_hours=24)
show("right-sized, autoscaled, commit to 4 servers, burst on spot, test off at night", large=False, autoscale=True, commit=4, spot=True, test_hours=12)
over = show("the same, but commit to 20 servers", large=False, autoscale=True, commit=20, spot=True, test_hours=12)
if over >= start:
    raise RuntimeError("the over-commitment should still be cheaper than the start here")
