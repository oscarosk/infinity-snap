const { applyDiscount } = require("./pricing");

function calculateCartTotal(items, discountPercent = 0) {
  // ❌ BUG 1: allows non-arrays
  if (!items) {
    return 0;
  }

  const subtotal = items.reduce((sum, item) => {
    // ❌ BUG 2: quantity default is wrong (should be 1)
    const qty = item.quantity || 0;

    // ❌ BUG 3: allows string prices
    return sum + item.price * qty;
  }, 0);

  // ❌ BUG 4: passes discount as string sometimes
  return applyDiscount(subtotal, String(discountPercent));
}

module.exports = { calculateCartTotal };