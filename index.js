const http = require('http');
const url = require('url');
const crypto = require('crypto');

const VERIFICATION_TOKEN = 'mK9xQ3nP7rT2wV6yJ4hD8fA5bN1cL0eG7uZ';
const ENDPOINT_URL = 'REPLACE_WITH_YOUR_RENDER_URL';

http.createServer((req, res) => {
  const query = url.parse(req.url, true).query;
  if (query.challenge_code) {
    const hash = crypto.createHash('sha256')
      .update(query.challenge_code + VERIFICATION_TOKEN + ENDPOINT_URL)
      .digest('hex');
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ challengeResponse: hash }));
  } else {
    res.writeHead(200);
    res.end('OK');
  }
}).listen(process.env.PORT || 3000);
