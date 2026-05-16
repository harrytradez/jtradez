const express = require('express');
const session = require('express-session');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const path = require('path');

const app = express();

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  DISCORD_CLIENT_ID:     process.env.DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI:  process.env.DISCORD_REDIRECT_URI,   // e.g. https://yourapp.railway.app/auth/callback
  DISCORD_SERVER_ID:     '1403771648955388046',
  DISCORD_ROLE_ID:       '1425429409388560499',
  SESSION_SECRET:        process.env.SESSION_SECRET || 'change-this-to-a-random-string',
  PORT:                  process.env.PORT || 3000,
};

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(session({
  secret: CONFIG.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

app.use(express.static(path.join(__dirname, 'public')));

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// 1. Start Discord OAuth — redirect user to Discord login
app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id:     CONFIG.DISCORD_CLIENT_ID,
    redirect_uri:  CONFIG.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope:         'identify guilds guilds.members.read',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// 2. Discord sends user back here with a code
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CONFIG.DISCORD_CLIENT_ID,
        client_secret: CONFIG.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  CONFIG.DISCORD_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/?error=token_failed');

    const accessToken = tokenData.access_token;

    // Get user's Discord profile
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = await userRes.json();

    // Check if user is in the JTradesFX server AND has the paid role
    const memberRes = await fetch(
      `https://discord.com/api/users/@me/guilds/${CONFIG.DISCORD_SERVER_ID}/member`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!memberRes.ok) {
      // User is not in the server at all
      return res.redirect('/?error=not_in_server');
    }

    const member = await memberRes.json();
    const hasRole = member.roles && member.roles.includes(CONFIG.DISCORD_ROLE_ID);

    if (!hasRole) {
      // In server but doesn't have the paid role
      return res.redirect('/?error=no_role');
    }

    // ✅ Access granted — save to session
    req.session.user = {
      id:       user.id,
      username: user.username,
      avatar:   user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
      nickname: member.nick || user.username,
    };

    res.redirect('/dashboard');

  } catch (err) {
    console.error('Auth error:', err);
    res.redirect('/?error=server_error');
  }
});

// 3. Check if user is logged in (called by frontend)
app.get('/auth/me', (req, res) => {
  if (req.session.user) {
    res.json({ authenticated: true, user: req.session.user });
  } else {
    res.json({ authenticated: false });
  }
});

// 4. Logout
app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// 5. Dashboard — protected route
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 6. Root — login page
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(CONFIG.PORT, () => {
  console.log(`🚀 The Trading Pit running on port ${CONFIG.PORT}`);
});

