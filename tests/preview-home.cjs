const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../inspiracred");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  // Preview isolates real CRM/Meta tracking while keeping the submit flow usable.
  if (pathname === "/assets/js/track.js") {
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    return res.end('window.inspiraTrack={lead:function(data){sessionStorage.setItem("home-preview-lead",JSON.stringify(data));},event:function(){}};');
  }
  const target = path.resolve(root, "." + pathname, pathname.endsWith("/") ? "index.html" : "");
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404); return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(target).pipe(res);
});
server.listen(0, "127.0.0.1", () => console.log("http://127.0.0.1:" + server.address().port + "/home/"));
