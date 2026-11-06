import http from "node:http";
http.createServer((_request, response) => { response.writeHead(401); response.end("auth required"); }).listen(Number(process.env.RUNTIME_RPC_PORT), "127.0.0.1");
console.log("fixture runtime started");
