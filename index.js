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
          cachedToken = json.access_token;
          tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
          resolve(cachedToken);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchUrl(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/rss') {
    try {
      const q = parsed.query.q || '';
      const minPrice = parsed.query.minPrice || '';
      const maxPrice = parsed.query.maxPrice || '';
      const params = new URLSearchParams({
        _nkw: q,
        _sacat: '212',
        _sop: '10',
        _rss: '1'
      });
      if (minPrice) params.set('_udlo', minPrice);
      if (maxPrice) params.set('_udhi', maxPrice);
      if (parsed.query.buyItNow === 'true') params.set('LH_BIN', '1');
      if (parsed.query.auction === 'true') params.set('LH_Auction', '1');
      if (parsed.query.loc === 'US') params.set('LH_PrefLoc', '1');
      else if (parsed.query.loc === 'GB') params.set('LH_PrefLoc', '2');
      const rssUrl = `https://www.ebay.com/sch/i.html?${params.toString()}`;
      const xml = await fetchUrl(rssUrl);
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(xml);
    } catch(e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }

  } else if (parsed.pathname === '/browse') {
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
        res.end(JSON.stringify({ error: e.message }));
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
