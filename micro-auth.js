/* micro-auth.js – a single-file, “just-enough” auth stack
   — No deps beyond Node’s stdlib
   — POST /signup   {username,password}
   — POST /login    {username,password}  -> sets sid cookie
   — GET  /protected                     -> “hi <user>”
   (Put behind HTTPS in production!)                                   */

const http = require('http'), fs = require('fs');
const { randomBytes, scryptSync, timingSafeEqual, createHmac } = require('crypto');

/*----- constants (tiny + opinionated) -----*/
const DB = 'u.json';                      // flat-file “DB”
const TTL = 1.8e6;                        // 30 min in ms
const SECRET = process.env.SECRET || randomBytes(32);
const N = 1 << 15, SALT = 16, LEN = 64;   // scrypt cost, salt, keylen

/*----- persistence -----*/
let U = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB)) : {};
const save = () => fs.writeFileSync(DB, JSON.stringify(U));

/*----- crypto helpers (all constant-time) -----*/
const hash = pw => {
  const s = randomBytes(SALT);
  return [s.toString('base64'),
          scryptSync(pw, s, LEN, { N }).toString('base64')];
};
const check = (pw, s, h) =>
  timingSafeEqual(
    scryptSync(pw, Buffer.from(s, 'base64'), LEN, { N }),
    Buffer.from(h, 'base64')
  );
const sign = uid => {
  const exp = Date.now() + TTL,
        body = `${uid}.${exp}`,
        sig = createHmac('sha256', SECRET).update(body).digest('base64');
  return Buffer.from(`${body}.${sig}`).toString('base64url');
};
const verify = t => {
  try {
    const [u, e, s] = Buffer.from(t, 'base64url').toString().split('.');
    if (+e < Date.now()) return;
    const good = createHmac('sha256', SECRET).update(`${u}.${e}`).digest('base64');
    return s === good ? u : undefined;
  } catch { /* bad token */ }
};

/*----- tiny helpers -----*/
const body = req => new Promise(r => {
  let d = ''; req.on('data', c => d += c).on('end', () => r(JSON.parse(d||'{}')));
});
const send = (res, c, m = '') => { res.writeHead(c); res.end(m); };

/*----- HTTP routes -----*/
http.createServer(async (req, res) => {
  const path = req.url;

  if (req.method === 'POST' && path === '/signup') {
    const { username: u, password: p } = await body(req);
    if (!u || !p || U[u]) return send(res, 400);
    U[u] = hash(p); save();            return send(res, 201);
  }

  if (req.method === 'POST' && path === '/login') {
    const { username: u, password: p } = await body(req), d = U[u];
    if (!d || !check(p, ...d))         return send(res, 401);
    res.setHeader('Set-Cookie',
      `sid=${sign(u)}; HttpOnly; SameSite=Strict; Max-Age=${TTL/1e3}`);
                                        return send(res, 200);
  }

  if (path === '/protected') {
    const sid = req.headers.cookie?.match(/sid=([^;]+)/)?.[1],
          u   = sid && verify(sid);
    return u ? send(res, 200, `hi ${u}\n`) : send(res, 401);
  }

  send(res, 404);
}).listen(8080, () =>
  console.log('listening on http://localhost:8080 – remember TLS!'));
