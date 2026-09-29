const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gxuxtfmczgrvlhpghpor.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}

async function readState() {
  const { data, error } = await supabase
    .from('routewise_state')
    .select('data')
    .eq('id', 'main')
    .single();

  if (error) throw error;
  return data.data;
}

async function writeState(state) {
  const { data, error } = await supabase
    .from('routewise_state')
    .upsert({ id: 'main', data: state })
    .select('data')
    .single();

  if (error) throw error;
  return data.data;
}

async function ensureInitialAdmin(state) {
  if ((state.users || []).some(user => user.isHost === true)) return state;

  const password = process.env.ROUTEWISE_ADMIN_PASSWORD;
  if (!password) throw new Error('ROUTEWISE_ADMIN_PASSWORD is not configured.');

  state.users = state.users || [];
  state.users.push({
    id: 'HOST-1',
    name: 'Host Admin',
    username: 'admin@routewise.com',
    email: 'admin@routewise.com',
    phone: '',
    passwordHash: hashPassword(password),
    role: 'admin',
    isHost: true,
    createdAt: new Date().toISOString()
  });
  await writeState(state);
  return state;
}

function parseBody(event) {
  if (!event.body) return {};
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  return JSON.parse(body);
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(user, password) {
  if (typeof user.passwordHash === 'string') {
    const [, salt, expectedHex] = user.passwordHash.split('$');
    if (!salt || !expectedHex) return false;

    const expected = Buffer.from(expectedHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return expected.length > 0 && crypto.timingSafeEqual(actual, expected);
  }

  return typeof user.password === 'string' && user.password === password;
}

function publicUser(user) {
  const { password, passwordHash, ...safeUser } = user;
  return safeUser;
}

exports.handler = async event => {
  if (!supabase) {
    return response(503, { error: 'The Netlify API needs SUPABASE_SERVICE_KEY configured.' });
  }

  const method = event.httpMethod || 'GET';
  const route = `/${(event.path || '').split('/').slice(4).join('/')}`.replace(/\/$/, '') || '/';

  try {
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? parseBody(event) : {};
    const state = await ensureInitialAdmin(await readState());

    if (method === 'GET' && route === '/init') {
      return response(200, {
        users: (state.users || []).map(publicUser),
        complaints: state.complaints || [],
        notifications: state.notifications || [],
        host: publicUser((state.users || []).find(user => user.isHost === true) || {})
      });
    }

    if (method === 'GET' && route === '/users') {
      return response(200, (state.users || []).map(publicUser));
    }

    if (method === 'GET' && route === '/complaints') {
      return response(200, state.complaints || []);
    }

    if (method === 'POST' && route === '/auth/admin-login') {
      const email = normalize(body.email);
      const user = (state.users || []).find(item =>
        item.role === 'admin' &&
        (normalize(item.email) === email || normalize(item.username) === email)
      );

      if (!user || !verifyPassword(user, body.password)) {
        return response(401, { error: 'Invalid admin email or password.' });
      }

      return response(200, {
        user: { id: user.id, name: user.name, email: user.email, role: user.role }
      });
    }

    if (method === 'PUT' && route === '/auth/admin-access') {
      const hostEmail = normalize(body.hostEmail);
      const userId = String(body.userId || '');
      const decision = String(body.decision || '');
      const host = (state.users || []).find(user => user.isHost === true);

      if (!hostEmail || !body.currentPassword || !userId || !['grant', 'deny'].includes(decision)) {
        return response(400, { error: 'Host credentials and a valid account decision are required.' });
      }

      if (
        !host ||
        (normalize(host.email) !== hostEmail && normalize(host.username) !== hostEmail) ||
        !verifyPassword(host, body.currentPassword)
      ) {
        return response(401, { error: 'Current host admin credentials are incorrect.' });
      }

      const user = (state.users || []).find(item => item.id === userId);
      if (!user || user.isHost === true) {
        return response(404, { error: 'Account not found.' });
      }

      user.role = decision === 'grant' ? 'admin' : 'student';
      user.adminAccessStatus = decision === 'grant' ? 'approved' : 'denied';
      user.adminAccessReviewedAt = new Date().toISOString();
      await writeState(state);
      return response(200, {
        success: true,
        user: { id: user.id, name: user.name, email: user.email, role: user.role }
      });
    }

    if (method === 'POST' && route === '/auth/login') {
      const email = normalize(body.email);
      const user = (state.users || []).find(item =>
        normalize(item.email) === email || normalize(item.username) === email
      );

      if (!user) return response(404, { error: 'Account not found. Please register first.' });
      if (!verifyPassword(user, body.password)) return response(401, { error: 'Incorrect password.' });

      if (user.password) {
        user.passwordHash = hashPassword(user.password);
        delete user.password;
        await writeState(state);
      }

      return response(200, { user: publicUser(user) });
    }

    if (method === 'POST' && route === '/users') {
      const user = body;
      if (!user || !user.email || !user.password) {
        return response(400, { error: 'Invalid user payload.' });
      }

      if ((state.users || []).some(item => normalize(item.email) === normalize(user.email))) {
        return response(409, { error: 'User already exists.' });
      }

      state.users = state.users || [];
      const savedUser = { ...user, passwordHash: hashPassword(String(user.password)) };
      delete savedUser.password;
      state.users.push(savedUser);
      await writeState(state);
      return response(201, publicUser(savedUser));
    }

    if (method === 'POST' && route === '/complaints') {
      const complaint = body;
      const reference = String(complaint?.reference || complaint?.id || '').trim();

      if (!complaint || !reference || !complaint.userId || !complaint.description) {
        return response(400, { error: 'Invalid complaint payload.' });
      }

      if ((state.complaints || []).some(item =>
        String(item.reference || item.id || '').trim() === reference
      )) {
        return response(409, { error: 'Complaint reference already exists. Please submit again.' });
      }

      state.complaints = state.complaints || [];
      state.complaints.unshift(complaint);
      await writeState(state);
      return response(201, complaint);
    }

    if (method === 'PUT' && ['/users', '/complaints', '/notifications'].includes(route)) {
      const key = route.slice(1);
      if (!Array.isArray(body)) {
        return response(400, { error: `${key} must be an array.` });
      }

      if (key === 'users') {
        state.users = body.map(user => {
          const existing = (state.users || []).find(item => item.id === user.id);
          const savedUser = { ...user };
          if (existing?.passwordHash) {
            savedUser.passwordHash = existing.passwordHash;
          } else if (typeof user.password === 'string') {
            savedUser.passwordHash = hashPassword(user.password);
          }
          delete savedUser.password;
          return savedUser;
        });
      } else {
        state[key] = body;
      }
      await writeState(state);
      return response(200, { success: true });
    }

    return response(404, { error: 'API route not found.' });
  } catch (error) {
    if (error.message === 'ROUTEWISE_ADMIN_PASSWORD is not configured.') {
      return response(503, { error: 'Set ROUTEWISE_ADMIN_PASSWORD in Netlify environment variables.' });
    }
    console.error('RouteWise API error:', error);
    return response(500, { error: 'The shared API request failed.' });
  }
};