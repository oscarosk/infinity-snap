function roundToTwo(num) {
  // ❌ BUG 7: string concatenation bug
  return Math.round(num + "00") / 100;
}

module.exports = { roundToTwo };