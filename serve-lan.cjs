// 零依赖局域网静态服务器：先 npm run build，然后 node serve-lan.cjs
// 同一局域网内的手机/电脑浏览器直接访问 http://<本机IP>:8080
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "dist");
const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function handler(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 回退到 index.html
      fs.readFile(path.join(ROOT, "index.html"), (e2, d2) => {
        if (e2) {
          res.writeHead(404);
          return res.end("not found: 请先执行 npm run build");
        }
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}

function lanIPs() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push(`${name}: ${a.address}`);
    }
  }
  return out;
}

const server = http.createServer(handler);

if (process.argv.includes("--selftest")) {
  server.listen(PORT, HOST, () => {
    http.get(`http://127.0.0.1:${PORT}/`, (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => {
        const ok = r.statusCode === 200 && body.includes("<div id=\"root\">");
        console.log("SELFTEST", ok ? "OK" : "FAIL", r.statusCode, body.length + " bytes");
        server.close(() => process.exit(ok ? 0 : 1));
      });
    }).on("error", (e) => {
      console.log("SELFTEST FAIL", String(e));
      process.exit(1);
    });
  });
} else {
  server.listen(PORT, HOST, () => {
    console.log(`《今天也没倒闭》局域网服务已启动（端口 ${PORT}）`);
    console.log("  本机访问：http://localhost:" + PORT);
    for (const ip of lanIPs()) console.log("  局域网访问：http://" + ip.split(": ")[1] + ":" + PORT + "  （" + ip.split(": ")[0] + "）");
    console.log("手机/其他电脑与本机连同一 WiFi/局域网即可游玩；各设备进度存于各自浏览器 IndexedDB。");
    console.log("按 Ctrl+C 停止。");
  });
  server.on("error", (e) => {
    console.error("启动失败：", String(e), e && e.code === "EADDRINUSE" ? `\n端口 ${PORT} 被占用，可改用：set PORT=8888 && node serve-lan.cjs` : "");
  });
}
