const { applyDiscount } = require("../src/pricing");

test("applies percentage discount correctly", () => {
  expect(applyDiscount(100, 10)).toBe(90);
  expect(applyDiscount(200, 25)).toBe(150);
});

test("throws on invalid discount", () => {
  expect(() => applyDiscount(100, -5)).toThrow();
  expect(() => applyDiscount(100, 150)).toThrow();
});
