const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');

const VERIFICATION_TOKEN = 'mK9xQ3nP7rT2wV6yJ4hD8fA5bN1cL0eG7uZ';
const ENDPOINT_URL = 'https://ebay-endpoint-fsjm.onrender.com';
const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Missing CLIENT_ID or CLIENT_SECRET env vars');
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  return new Promise((resolve, reject) => {
    const body = 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope';
    const req = https.request({
      hostname: 'api.ebay.com',
      path: '/identity/v1/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(`eBay auth error: ${json.error} - ${json.error_description}`);
          if (!json.access_token) throw new Error(`No access token in response: ${data}`);
          cachedToken = json.access_token;
          tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
          resolve(cachedToken);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', (e) => reject(new Error(`Token request failed: ${e.message}`)));
    req.write(body);
    req.end();
  });
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/browse') {
    try {
      const token = await getToken();
      const query = parsed.query;
      const filterParts = [];
      if (query.minPrice && query.maxPrice) {
        filterParts.push(`price:[${query.minPrice}..${query.maxPrice}]`);
        filterParts.push(`priceCurrency:${query.currency || 'USD'}`);
      }
      if (query.buyingOptions) filterParts.push(`buyingOptions:{${query.buyingOptions}}`);
      if (query.conditions) filterParts.push(`conditions:{${query.conditions}}`);
      if (query.itemLocationCountry) filterParts.push(`itemLocationCountry:${query.itemLocationCountry}`);
      if (query.freeShipping === 'true') filterParts.push('maxDeliveryCost:0');
      if (query.returnsAccepted === 'true') filterParts.push('returnsAccepted:true');
      const params = new URLSearchParams({
        q: query.q || '',
        category_ids: '212',
        sort: 'newlyListed',
        limit: query.limit || '25',
        filter: filterParts.join(',')
      });
      const ebayUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`;
      https.get(ebayUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': query.marketplace || 'EBAY_US',
          'Content-Type': 'application/json'
        }
      }, (ebayRes) => {
        let data = '';
        ebayRes.on('data', chunk => data += chunk);
        ebayRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      }).on('error', (e) => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: `eBay fetch failed: ${e.message}` }));
      });
    } catch(e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }

  } else if (parsed.query.challenge_code) {
    const hash = crypto.createHash('sha256')
      .update(parsed.query.challenge_code + VERIFICATION_TOKEN + ENDPOINT_URL)
      .digest('hex');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ challengeResponse: hash }));

  } else {
    res.writeHead(200);
    res.end('OK');
  }
}).listen(process.env.PORT || 3000);
