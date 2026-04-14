const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');

const VERIFICATION_TOKEN = 'mK9xQ3nP7rT2wV6yJ4hD8fA5bN1cL0eG7uZ';
const ENDPOINT_URL = 'https://ebay-endpoint-fsjm.onrender.com';

function fetchEbay(searchUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(searchUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://www.ebay.com/',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin'
      }
    };
    const req = https.get(options, (res) => {
      // follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchEbay(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseListings(html, query) {
  const items = [];
  try {
    // extract JSON from window.__INITIAL_STATE__ or similar
    let dataMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+?\});\s*(?:window|<\/script>)/s);
    
    // primary method: parse item tiles from HTML
    const itemRegex = /<li[^>]+s-item[^>]*>([\s\S]*?)<\/li>/g;
    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const block = match[1];
      
      // skip promoted/ad labels that aren't real listings
      if (/s-item--watched|SPONSORED/i.test(block) && !/s-item__image/.test(block)) continue;

      // title
      const titleMatch = block.match(/class="s-item__title[^"]*"[^>]*><span[^>]*>([^<]+)<\/span>/);
      if (!titleMatch) continue;
      const title = titleMatch[1].trim();
      if (title === 'Shop on eBay' || title === 'Results matching fewer words') continue;

      // item URL
      const linkMatch = block.match(/href="(https:\/\/www\.ebay\.com\/itm\/[^"?]+[^"]*?)"/);
      if (!linkMatch) continue;
      const itemUrl = linkMatch[1].split('?')[0];

      // item ID
      const idMatch = itemUrl.match(/\/itm\/(\d+)/);
      if (!idMatch) continue;
      const id = idMatch[1];

      // price
      let price = 0;
      const priceMatch = block.match(/class="s-item__price"[^>]*>[\s\S]*?\$([0-9,]+\.?\d*)/);
      if (priceMatch) price = parseFloat(priceMatch[1].replace(/,/g, ''));

      // image
      let imageUrl = '';
      const imgMatch = block.match(/s-item__image-img[^>]*src="([^"]+)"/);
      if (!imgMatch) {
        const img2 = block.match(/<img[^>]+src="(https:\/\/i\.ebayimg[^"]+)"/);
        if (img2) imageUrl = img2[1];
      } else {
        imageUrl = imgMatch[1];
      }
      // upgrade image to larger size
      if (imageUrl) imageUrl = imageUrl.replace(/s-l\d+/, 's-l400');

      // condition
      let condition = '';
      const condMatch = block.match(/class="SECONDARY_INFO"[^>]*>([^<]+)</);
      if (condMatch) condition = condMatch[1].trim();

      // listing type
      let listingType = '';
      if (/Buy It Now/i.test(block)) listingType = 'BIN';
      else if (/\d+ bid/i.test(block)) listingType = 'Auction';

      // shipping
      let shipping = '';
      const shipMatch = block.match(/s-item__shipping[^>]*>([^<]+)</);
      if (shipMatch) shipping = shipMatch[1].trim().replace(/\+/g, '').trim();

      // time listed — eBay shows "New listing" badge on fresh items
      const isNewListing = /new listing/i.test(block);

      // seller info
      let sellerInfo = '';
      const sellerMatch = block.match(/s-item__seller-info[^>]*>([^<]+)</);
      if (sellerMatch) sellerInfo = sellerMatch[1].trim();

      items.push({
        id,
        title,
        price,
        currency: 'USD',
        itemUrl,
        imageUrl,
        condition,
        listingType,
        shipping,
        isNewListing,
        sellerInfo,
        scrapedAt: new Date().toISOString()
      });
    }
  } catch(e) {
    console.error('Parse error:', e.message);
  }
  return items;
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/scrape') {
    try {
      const q = parsed.query.q || '';
      const minPrice = parsed.query.minPrice || '';
      const maxPrice = parsed.query.maxPrice || '';
      const listingType = parsed.query.listingType || '';
      const loc = parsed.query.loc || '';

      const params = new URLSearchParams({
        _nkw: q,
        _sacat: '212',
        _sop: '10',    // sort by newly listed
        _ipg: '60',    // 60 results per page
        LH_ItemCondition: '',
        rt: 'nc'
      });
      if (minPrice) params.set('_udlo', minPrice);
      if (maxPrice) params.set('_udhi', maxPrice);
      if (listingType === 'bin') params.set('LH_BIN', '1');
      if (listingType === 'auction') params.set('LH_Auction', '1');
      if (loc === 'US') params.set('LH_PrefLoc', '1');

      const ebayUrl = `https://www.ebay.com/sch/i.html?${params.toString()}`;
      const html = await fetchEbay(ebayUrl);
      const items = parseListings(html, q);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items, count: items.length, query: q }));
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
