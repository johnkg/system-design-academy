// Without the pattern: one general API returns everything to every client.

function generalOrderApi(id) { // 6 fields for everybody
  return {
    id,
    customer: "Ada",
    lines: 2,
    total: "40.00",
    shippingAddress: "1 Analytical Way",
    loyaltyBadge: "gold",
  };
}

const response = generalOrderApi(7);
console.log(`general API returns ${Object.keys(response).length} fields`);
console.log("mobile uses 2 of them (id, total) and downloads the rest for nothing");
console.log("web uses 4 of them (id, customer, lines, total)");
// Any change to this response has to be agreed with every client.
