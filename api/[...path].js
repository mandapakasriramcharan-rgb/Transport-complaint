const { handler } = require('../netlify/functions/api');

module.exports = async (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  const apiPath = requestUrl.pathname.replace(/^\/api\/?/, '');
  const body = typeof req.body === 'string'
    ? req.body
    : req.body === undefined
      ? ''
      : JSON.stringify(req.body);

  const result = await handler({
    httpMethod: req.method,
    path: `/.netlify/functions/api/${apiPath}`,
    body,
    isBase64Encoded: false
  });

  res.statusCode = result.statusCode;
  Object.entries(result.headers || {}).forEach(([name, value]) => {
    res.setHeader(name, value);
  });
  res.end(result.body);
};