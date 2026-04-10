const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');

const VERIFICATION_TOKEN = 'mK9xQ3nP7rT2wV6yJ4hD8fA5bN1cL0eG7uZ';
const ENDPOINT_URL = 'https://ebay-endpoint-fsjm.onrender.com';

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/ebay') {
    const query = new URLSearchParams(parsed.query).toString();
    const ebayUrl = `https://svcs.ebay.com/services/search/FindingService/v1?${query}`;
    https.get(ebayUrl, (ebayRes) => {
      let data = '';
      ebayRes.on('data', chunk => data += chunk);
      ebayRes.on('end', () => {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(data);
      });
    }).on('error', (e) => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });
  } else if (parsed.query.challenge_code) {
    const hash = crypto.createHash('sha256')
      .update(parsed.query.challenge_code + VERIFICATION_TOKEN + ENDPOINT_URL)
      .digest('hex');
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ challengeResponse: hash }));
  } else {
    res.writeHead(200);
    res.end('OK');
  }
}).listen(process.env.PORT || 3000);
