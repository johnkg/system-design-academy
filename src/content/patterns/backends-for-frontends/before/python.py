# Without the pattern: one general API returns everything to every client.

def general_order_api(order_id):  # 6 fields for everybody
    return {
        "id": order_id,
        "customer": "Ada",
        "lines": 2,
        "total": "40.00",
        "shipping_address": "1 Analytical Way",
        "loyalty_badge": "gold",
    }


response = general_order_api(7)
print(f"general API returns {len(response)} fields")
print("mobile uses 2 of them (id, total) and downloads the rest for nothing")
print("web uses 4 of them (id, customer, lines, total)")
# Any change to this response has to be agreed with every client.
