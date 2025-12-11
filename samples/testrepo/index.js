// /mnt/c/Users/Oscar/Desktop/infinitysnap/samples/testrepo/index.js
function main() {
  console.log("Hello from testrepo before error");
  throw new Error("Crash for InfinitySnap demo");
}

main();
