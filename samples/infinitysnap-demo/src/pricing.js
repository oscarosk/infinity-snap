const { roundToTwo } = require("./utils");

function applyDiscount(price, discountPercent) {
  const p = Number(price);
  const d = Number(discountPercent);

  if (!Number.isFinite(p) || !Number.isFinite(d)) {
    throw new Error("Invalid input");
  }
  if (d < 0 || d > 100) {
    throw new Error("Invalid discount");
  }

  const discounted = p * (1 - d / 100);
  return roundToTwo(discounted);
}

module.exports = { applyDiscount };