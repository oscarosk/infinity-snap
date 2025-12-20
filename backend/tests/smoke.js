// backend/tests/smoke.js
// Run: npm run smoke
const http = require("http");

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;

    const opts = {
      hostname: "localhost",
      port: process.env.PORT || 4000,
      path: "/api/v1" + path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BACKEND_API_KEY ? { "x-api-key": process.env.BACKEND_API_KEY } : {}),
        ...(data ? { "Content-Length": data.length } : {}),
      },
    };

    const r = http.request(opts, (res) => {
      let out = "";
      res.on("data", (c) => (out += c));
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(out); } catch {}
        resolve({ status: res.statusCode, body: parsed || out });
      });
    });

    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  console.log("SMOKE: /health");
  const h = await req("GET", "/health");
  if (h.status !== 200 || !h.body || !h.body.ok) {
    console.error("❌ health failed:", h);
    process.exit(1);
  }
  console.log("✅ health ok");

  console.log("SMOKE: command policy blocks rm -rf");
  const bad = await req("POST", "/snap", {
    repoPathOnHost: ".",
    command: "rm -rf /",
  });
  if (bad.status === 200) {
    console.error("❌ policy did not block dangerous command:", bad);
    process.exit(1);
  }
  console.log("✅ policy blocks dangerous command");

  console.log("✅ SMOKE PASSED");
})().catch((e) => {
  console.error("❌ SMOKE ERROR:", e);
  process.exit(1);
});
