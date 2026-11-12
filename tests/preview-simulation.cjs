const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../inspiracred");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};
const leads = [];

function json(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/__qa/lead" && req.method === "POST") {
    try {
      leads.push(JSON.parse(await readBody(req)));
      return json(res, { success: true });
    } catch {
      return json(res, { success: false }, 400);
    }
  }
  if (pathname === "/__qa/leads") return json(res, { count: leads.length, leads });
  if (pathname === "/__qa/reset" && req.method === "POST") {
    leads.length = 0;
    return json(res, { success: true });
  }
  if (pathname === "/__qa/whatsapp") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end("<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><title>WhatsApp isolado</title><body><main id=\"qa-whatsapp\"><h1>Encaminhamento isolado</h1><p>Nenhum dado saiu deste computador.</p></main></body></html>");
  }
  if (pathname === "/assets/js/track.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(`window.inspiraTrack={
      leadConfirmed:function(data){return fetch('/__qa/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.ok;});},
      event:function(){return Promise.resolve(true);}
    };`);
  }

  const requested = pathname === "/" ? "/index.html" : pathname;
  const target = path.resolve(root, "." + requested, requested.endsWith("/") ? "index.html" : "");
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }

  const extension = path.extname(target);
  if (target === path.join(root, "index.html")) {
    const html = fs.readFileSync(target, "utf8")
      .replace('return "https://wa.me/5521977340731?text=" +', 'return "/__qa/whatsapp?text=" +');
    res.writeHead(200, { "Content-Type": mime[extension], "Cache-Control": "no-store" });
    return res.end(html);
  }

  res.writeHead(200, { "Content-Type": mime[extension] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(target).pipe(res);
});

server.listen(0, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${server.address().port}/`);
});
