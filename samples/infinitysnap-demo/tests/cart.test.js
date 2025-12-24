const { calculateCartTotal } = require("../src/cart");

test("calculates total with discount", () => {
  const items = [
    { price: 50, quantity: 2 }, // 100
    { price: 25, quantity: 1 }  // 25
  ];

  // 125 with 20% discount → 100
  expect(calculateCartTotal(items, 20)).toBe(100);
});

test("calculates total without discount", () => {
  const items = [{ price: 10, quantity: 3 }];
  expect(calculateCartTotal(items)).toBe(30);
});
