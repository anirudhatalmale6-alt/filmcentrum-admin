require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const helmet = require('helmet');
const ejsLayouts = require("express-ejs-layouts");
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3150;
const BASE = process.env.BASE_PATH || '/filmcentrum/admin';

const db = new Database(path.join(__dirname, 'data/filmcentrum.db'));
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT DEFAULT '', password_hash TEXT NOT NULL, role TEXT DEFAULT 'admin', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, film_type TEXT, status TEXT DEFAULT 'pending', payment_status TEXT DEFAULT 'unpaid', payment_method TEXT, payment_ref TEXT, joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, renewed_at DATETIME, notes TEXT);
  CREATE TABLE IF NOT EXISTS translations (id INTEGER PRIMARY KEY AUTOINCREMENT, lang TEXT NOT NULL, key TEXT NOT NULL, value TEXT DEFAULT '', UNIQUE(lang, key));

  CREATE TABLE IF NOT EXISTS film_branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_sv TEXT,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS member_branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    role TEXT DEFAULT '',
    is_primary INTEGER DEFAULT 0,
    FOREIGN KEY (member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS member_education (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    institution TEXT,
    qualification TEXT,
    field_of_study TEXT,
    start_year INTEGER,
    end_year INTEGER,
    notes TEXT,
    FOREIGN KEY (member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS member_experience (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    project_title TEXT,
    project_type TEXT,
    role TEXT,
    production_company TEXT,
    year INTEGER,
    description TEXT,
    link TEXT,
    is_featured INTEGER DEFAULT 0,
    FOREIGN KEY (member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS member_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    type TEXT DEFAULT 'photo',
    url TEXT,
    filename TEXT,
    caption TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label_sv TEXT NOT NULL,
    label_en TEXT DEFAULT '',
    url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1
  );
`);

// ALTER members table to add new columns (safe - ignore if already exist)
var memberCols = [
  ['stage_name', "TEXT DEFAULT ''"],
  ['website', "TEXT DEFAULT ''"],
  ['imdb_link', "TEXT DEFAULT ''"],
  ['social_media', "TEXT DEFAULT ''"],
  ['cv_file', "TEXT DEFAULT ''"],
  ['country', "TEXT DEFAULT 'SE'"],
  ['city', "TEXT DEFAULT ''"],
  ['languages_spoken', "TEXT DEFAULT ''"],
  ['profile_photo', "TEXT DEFAULT ''"],
  ['headline', "TEXT DEFAULT ''"],
  ['biography', "TEXT DEFAULT ''"],
  ['skills', "TEXT DEFAULT ''"],
  ['awards', "TEXT DEFAULT ''"],
  ['equipment', "TEXT DEFAULT ''"],
  ['profile_slug', "TEXT DEFAULT ''"],
  ['is_public', "INTEGER DEFAULT 0"],
  ['approved', "INTEGER DEFAULT 0"],
  ['showreel_url', "TEXT DEFAULT ''"]
];
memberCols.forEach(function(col) {
  try { db.exec("ALTER TABLE members ADD COLUMN " + col[0] + " " + col[1]); } catch(e) {}
});

// Drop the old pages table if it has the wrong schema (missing bilingual columns)
try {
  var pagesCols = db.prepare("PRAGMA table_info(pages)").all().map(function(c) { return c.name; });
  if (pagesCols.indexOf('title_sv') === -1) {
    db.exec("DROP TABLE pages");
  }
} catch(e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title_sv TEXT DEFAULT '',
    title_en TEXT DEFAULT '',
    content_sv TEXT DEFAULT '',
    content_en TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed admin user
try {
  db.prepare("INSERT INTO admin_users (username, email, password_hash, role) VALUES (?, ?, ?, ?)").run('admin', 'talat@krrc.org', bcrypt.hashSync('FCAdmin2026!', 10), 'super_admin');
} catch(e) {}

// Seed settings
var defaults = { site_name: 'FilmCentrum Riks', membership_fee: '100', currency: 'SEK', swish_number: '', default_language: 'sv' };
Object.entries(defaults).forEach(function([k,v]) { try { db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(k, v); } catch(e) {} });

// Seed film branches
var branchSeeds = [
  ['Directing', 'Regi'],
  ['Producing', 'Producent'],
  ['Screenwriting', 'Manus'],
  ['Cinematography/Camera', 'Foto/Kamera'],
  ['Lighting & Grip', 'Ljus & Grip'],
  ['Editing/Post-production', 'Klipp/Efterproduktion'],
  ['Sound', 'Ljud'],
  ['Music', 'Musik'],
  ['Production Design/Art', 'Scenografi/Konst'],
  ['Costume/Wardrobe', 'Kostym/Garderob'],
  ['Hair & Makeup', 'Har & Smink'],
  ['Visual Effects (VFX)', 'Visuella effekter (VFX)'],
  ['Animation', 'Animation'],
  ['Acting', 'Skadespeleri'],
  ['Casting', 'Casting'],
  ['Stunts', 'Stunts'],
  ['Documentary', 'Dokumentar'],
  ['Marketing & Distribution', 'Marknadsforing & Distribution'],
  ['Crew/Support', 'Crew/Support'],
  ['Students/Emerging', 'Studenter/Nya talanger']
];
branchSeeds.forEach(function(b, i) {
  try { db.prepare("INSERT INTO film_branches (name, name_sv, sort_order) VALUES (?, ?, ?)").run(b[0], b[1], i + 1); } catch(e) {}
});

// Seed default pages
var pageSeeds = [
  ['hem', 'Hem', 'Home'],
  ['om-oss', 'Om oss', 'About us'],
  ['skolbio', 'Skolbio', 'School cinema'],
  ['medlemmar', 'Medlemmar', 'Members'],
  ['kontakt', 'Kontakt', 'Contact']
];
pageSeeds.forEach(function(p) {
  try { db.prepare("INSERT INTO pages (slug, title_sv, title_en) VALUES (?, ?, ?)").run(p[0], p[1], p[2]); } catch(e) {}
});

// Seed default menu items
var menuSeeds = [
  ['Hem', 'Home', '/', 1],
  ['Om oss', 'About us', '/om-oss', 2],
  ['Skolbio', 'School cinema', '/skolbio', 3],
  ['Medlemmar', 'Members', '/medlemmar', 4],
  ['Nyhetsbrev', 'Newsletter', '/nyhetsbrev', 5],
  ['Kontakt', 'Contact', '/kontakt', 6]
];
var menuCount = db.prepare('SELECT COUNT(*) as c FROM menu_items').get().c;
if (menuCount === 0) {
  menuSeeds.forEach(function(m) {
    db.prepare("INSERT INTO menu_items (label_sv, label_en, url, sort_order) VALUES (?, ?, ?, ?)").run(m[0], m[1], m[2], m[3]);
  });
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set("layout", "layout");
app.use(BASE, express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ dir: path.join(__dirname, 'data'), db: 'fc-sessions.db' }),
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 30*24*60*60*1000, path: '/', sameSite: 'lax', httpOnly: true }
}));

function auth(req, res, next) {
  if (!req.session.adminId) return res.redirect(BASE + '/login');
  next();
}

app.use(function(req, res, next) {
  res.locals.base = BASE;
  res.locals.admin = req.session.adminUsername || null;
  res.locals.adminRole = req.session.adminRole || 'admin';
  res.locals.currentPath = req.path;
  next();
});

// Languages
var LANGS = ['sv','no','da','fi','en','de','es','it','ur','hi','se_sami','ar','prs','tr'];
var LANG_NAMES = {sv:'Svenska',no:'Norsk',da:'Dansk',fi:'Suomi',en:'English',de:'Deutsch',es:'Espanol',it:'Italiano',ur:'اردو',hi:'हिन्दी',se_sami:'Sami',ar:'العربية',prs:'دری',tr:'Turkce'};

// ============================================================
// AUTH ROUTES
// ============================================================
app.get(BASE + '/login', function(req, res) {
  if (req.session.adminId) return res.redirect(BASE + '/');
  res.render('login', { base: BASE, error: null, layout: false });
});

app.post(BASE + '/login', function(req, res) {
  var user = db.prepare('SELECT * FROM admin_users WHERE username = ? OR email = ?').get(req.body.username, req.body.username);
  if (!user || !bcrypt.compareSync(req.body.password, user.password_hash)) return res.render('login', { base: BASE, error: 'Invalid credentials', layout: false });
  req.session.adminId = user.id;
  req.session.adminUsername = user.username;
  req.session.adminRole = user.role;
  res.redirect(BASE + '/');
});

app.get(BASE + '/logout', function(req, res) { req.session.destroy(); res.redirect(BASE + '/login'); });

// ============================================================
// DASHBOARD
// ============================================================
app.get(BASE + '/', auth, function(req, res) {
  var stats = {
    total_members: db.prepare('SELECT COUNT(*) as c FROM members').get().c,
    active_members: db.prepare("SELECT COUNT(*) as c FROM members WHERE status = 'active'").get().c,
    pending_members: db.prepare("SELECT COUNT(*) as c FROM members WHERE status = 'pending'").get().c,
    paid_members: db.prepare("SELECT COUNT(*) as c FROM members WHERE payment_status = 'paid'").get().c,
    public_profiles: db.prepare("SELECT COUNT(*) as c FROM members WHERE is_public = 1").get().c,
    pending_approval: db.prepare("SELECT COUNT(*) as c FROM members WHERE approved = 0").get().c,
    newsletter_subscribers: db.prepare("SELECT COUNT(*) as c FROM newsletter_subscribers WHERE is_active = 1").get().c,
    total_pages: db.prepare('SELECT COUNT(*) as c FROM pages').get().c,
  };
  res.render('dashboard', { base: BASE, stats: stats });
});

// ============================================================
// MEMBERS LIST
// ============================================================
app.get(BASE + '/members', auth, function(req, res) {
  var members = db.prepare('SELECT * FROM members ORDER BY joined_at DESC').all();
  res.render('members', { base: BASE, members: members });
});
app.post(BASE + '/members', auth, function(req, res) {
  var b = req.body;
  db.prepare('INSERT INTO members (name, email, phone, film_type, status, notes) VALUES (?, ?, ?, ?, ?, ?)').run(b.name, b.email, b.phone || '', b.film_type || '', b.status || 'pending', b.notes || '');
  res.redirect(BASE + '/members');
});
app.post(BASE + '/members/:id/approve', auth, function(req, res) {
  db.prepare("UPDATE members SET status = 'active' WHERE id = ?").run(req.params.id);
  res.redirect(BASE + '/members');
});
app.post(BASE + '/members/:id/payment', auth, function(req, res) {
  db.prepare("UPDATE members SET payment_status = 'paid', payment_method = ?, payment_ref = ?, renewed_at = datetime('now') WHERE id = ?").run(req.body.method || 'manual', req.body.ref || '', req.params.id);
  res.redirect(BASE + '/members');
});
app.post(BASE + '/members/:id/delete', auth, function(req, res) {
  // Delete related data
  db.prepare('DELETE FROM member_branches WHERE member_id = ?').run(req.params.id);
  db.prepare('DELETE FROM member_education WHERE member_id = ?').run(req.params.id);
  db.prepare('DELETE FROM member_experience WHERE member_id = ?').run(req.params.id);
  db.prepare('DELETE FROM member_media WHERE member_id = ?').run(req.params.id);
  db.prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
  res.redirect(BASE + '/members');
});

// ============================================================
// MEMBER EDIT (single member profile)
// ============================================================
app.get(BASE + '/members/:id', auth, function(req, res) {
  var member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.redirect(BASE + '/members');
  var branches = db.prepare('SELECT * FROM film_branches ORDER BY sort_order').all();
  var memberBranches = db.prepare('SELECT * FROM member_branches WHERE member_id = ?').all(req.params.id);
  var education = db.prepare('SELECT * FROM member_education WHERE member_id = ? ORDER BY start_year DESC').all(req.params.id);
  var experience = db.prepare('SELECT * FROM member_experience WHERE member_id = ? ORDER BY year DESC').all(req.params.id);
  var media = db.prepare('SELECT * FROM member_media WHERE member_id = ? ORDER BY sort_order').all(req.params.id);
  res.render('member-edit', {
    base: BASE,
    member: member,
    branches: branches,
    memberBranches: memberBranches,
    education: education,
    experience: experience,
    media: media,
    success: req.query.saved === '1'
  });
});

app.post(BASE + '/members/:id', auth, function(req, res) {
  var b = req.body;
  var id = req.params.id;

  // Update main member info
  db.prepare(`UPDATE members SET
    name = ?, email = ?, phone = ?, film_type = ?, status = ?, notes = ?,
    stage_name = ?, website = ?, imdb_link = ?, social_media = ?,
    country = ?, city = ?, languages_spoken = ?,
    headline = ?, biography = ?,
    skills = ?, awards = ?, equipment = ?,
    profile_slug = ?, is_public = ?, approved = ?, showreel_url = ?
    WHERE id = ?`).run(
    b.name || '', b.email || '', b.phone || '', b.film_type || '', b.status || 'pending', b.notes || '',
    b.stage_name || '', b.website || '', b.imdb_link || '', b.social_media || '',
    b.country || 'SE', b.city || '', b.languages_spoken || '',
    b.headline || '', b.biography || '',
    b.skills || '', b.awards || '', b.equipment || '',
    b.profile_slug || '', b.is_public ? 1 : 0, b.approved ? 1 : 0, b.showreel_url || '',
    id
  );

  // Update branches
  db.prepare('DELETE FROM member_branches WHERE member_id = ?').run(id);
  var branchIds = b.branch_ids || [];
  if (!Array.isArray(branchIds)) branchIds = [branchIds];
  var primaryBranch = b.primary_branch || '';
  branchIds.forEach(function(bid) {
    db.prepare('INSERT INTO member_branches (member_id, branch_id, is_primary) VALUES (?, ?, ?)').run(id, bid, String(bid) === String(primaryBranch) ? 1 : 0);
  });

  // Update education - delete old, insert new
  db.prepare('DELETE FROM member_education WHERE member_id = ?').run(id);
  var eduInstitutions = b.edu_institution || [];
  if (!Array.isArray(eduInstitutions)) eduInstitutions = [eduInstitutions];
  var eduQualifications = b.edu_qualification || [];
  if (!Array.isArray(eduQualifications)) eduQualifications = [eduQualifications];
  var eduFields = b.edu_field || [];
  if (!Array.isArray(eduFields)) eduFields = [eduFields];
  var eduStarts = b.edu_start_year || [];
  if (!Array.isArray(eduStarts)) eduStarts = [eduStarts];
  var eduEnds = b.edu_end_year || [];
  if (!Array.isArray(eduEnds)) eduEnds = [eduEnds];
  for (var i = 0; i < eduInstitutions.length; i++) {
    if (eduInstitutions[i] && eduInstitutions[i].trim()) {
      db.prepare('INSERT INTO member_education (member_id, institution, qualification, field_of_study, start_year, end_year) VALUES (?, ?, ?, ?, ?, ?)').run(
        id, eduInstitutions[i], eduQualifications[i] || '', eduFields[i] || '',
        eduStarts[i] ? parseInt(eduStarts[i]) : null,
        eduEnds[i] ? parseInt(eduEnds[i]) : null
      );
    }
  }

  // Update experience - delete old, insert new
  db.prepare('DELETE FROM member_experience WHERE member_id = ?').run(id);
  var expTitles = b.exp_title || [];
  if (!Array.isArray(expTitles)) expTitles = [expTitles];
  var expTypes = b.exp_type || [];
  if (!Array.isArray(expTypes)) expTypes = [expTypes];
  var expRoles = b.exp_role || [];
  if (!Array.isArray(expRoles)) expRoles = [expRoles];
  var expCompanies = b.exp_company || [];
  if (!Array.isArray(expCompanies)) expCompanies = [expCompanies];
  var expYears = b.exp_year || [];
  if (!Array.isArray(expYears)) expYears = [expYears];
  var expFeatured = b.exp_featured || [];
  if (!Array.isArray(expFeatured)) expFeatured = [expFeatured];
  for (var j = 0; j < expTitles.length; j++) {
    if (expTitles[j] && expTitles[j].trim()) {
      db.prepare('INSERT INTO member_experience (member_id, project_title, project_type, role, production_company, year, is_featured) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id, expTitles[j], expTypes[j] || '', expRoles[j] || '', expCompanies[j] || '',
        expYears[j] ? parseInt(expYears[j]) : null,
        expFeatured.indexOf(String(j)) !== -1 ? 1 : 0
      );
    }
  }

  res.redirect(BASE + '/members/' + id + '?saved=1');
});

// ============================================================
// FILM BRANCHES
// ============================================================
app.get(BASE + '/branches', auth, function(req, res) {
  var branches = db.prepare('SELECT * FROM film_branches ORDER BY sort_order').all();
  res.render('branches', { base: BASE, branches: branches, success: req.query.saved === '1' });
});

app.post(BASE + '/branches', auth, function(req, res) {
  var b = req.body;
  if (b.action === 'add') {
    var maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM film_branches').get().m || 0;
    db.prepare('INSERT INTO film_branches (name, name_sv, sort_order) VALUES (?, ?, ?)').run(b.name || '', b.name_sv || '', maxOrder + 1);
  } else if (b.action === 'update' && b.id) {
    db.prepare('UPDATE film_branches SET name = ?, name_sv = ? WHERE id = ?').run(b.name || '', b.name_sv || '', b.id);
  } else if (b.action === 'delete' && b.id) {
    db.prepare('DELETE FROM member_branches WHERE branch_id = ?').run(b.id);
    db.prepare('DELETE FROM film_branches WHERE id = ?').run(b.id);
  } else if (b.action === 'move_up' && b.id) {
    var current = db.prepare('SELECT * FROM film_branches WHERE id = ?').get(b.id);
    if (current) {
      var prev = db.prepare('SELECT * FROM film_branches WHERE sort_order < ? ORDER BY sort_order DESC LIMIT 1').get(current.sort_order);
      if (prev) {
        db.prepare('UPDATE film_branches SET sort_order = ? WHERE id = ?').run(prev.sort_order, current.id);
        db.prepare('UPDATE film_branches SET sort_order = ? WHERE id = ?').run(current.sort_order, prev.id);
      }
    }
  } else if (b.action === 'move_down' && b.id) {
    var cur = db.prepare('SELECT * FROM film_branches WHERE id = ?').get(b.id);
    if (cur) {
      var nxt = db.prepare('SELECT * FROM film_branches WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1').get(cur.sort_order);
      if (nxt) {
        db.prepare('UPDATE film_branches SET sort_order = ? WHERE id = ?').run(nxt.sort_order, cur.id);
        db.prepare('UPDATE film_branches SET sort_order = ? WHERE id = ?').run(cur.sort_order, nxt.id);
      }
    }
  }
  res.redirect(BASE + '/branches?saved=1');
});

// ============================================================
// PAGES (CMS)
// ============================================================
app.get(BASE + '/pages', auth, function(req, res) {
  var pages = db.prepare('SELECT * FROM pages ORDER BY id').all();
  res.render('pages', { base: BASE, pages: pages });
});

app.get(BASE + '/pages/:id', auth, function(req, res) {
  var page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!page) return res.redirect(BASE + '/pages');
  res.render('page-edit', { base: BASE, page: page, success: req.query.saved === '1' });
});

app.post(BASE + '/pages/:id', auth, function(req, res) {
  var b = req.body;
  db.prepare("UPDATE pages SET title_sv = ?, title_en = ?, content_sv = ?, content_en = ?, updated_at = datetime('now') WHERE id = ?").run(
    b.title_sv || '', b.title_en || '', b.content_sv || '', b.content_en || '', req.params.id
  );
  res.redirect(BASE + '/pages/' + req.params.id + '?saved=1');
});

app.post(BASE + '/pages', auth, function(req, res) {
  var b = req.body;
  if (b.action === 'add' && b.slug) {
    try {
      db.prepare('INSERT INTO pages (slug, title_sv, title_en) VALUES (?, ?, ?)').run(b.slug, b.title_sv || '', b.title_en || '');
    } catch(e) {}
  } else if (b.action === 'delete' && b.id) {
    db.prepare('DELETE FROM pages WHERE id = ?').run(b.id);
  }
  res.redirect(BASE + '/pages');
});

// ============================================================
// MENU EDITOR
// ============================================================
app.get(BASE + '/menu', auth, function(req, res) {
  var menuItems = db.prepare('SELECT * FROM menu_items ORDER BY sort_order').all();
  res.render('menu', { base: BASE, menuItems: menuItems, success: req.query.saved === '1' });
});

app.post(BASE + '/menu', auth, function(req, res) {
  var b = req.body;
  if (b.action === 'add') {
    var maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM menu_items').get().m || 0;
    db.prepare('INSERT INTO menu_items (label_sv, label_en, url, sort_order, is_active) VALUES (?, ?, ?, ?, 1)').run(b.label_sv || '', b.label_en || '', b.url || '/', maxOrder + 1);
  } else if (b.action === 'update' && b.id) {
    db.prepare('UPDATE menu_items SET label_sv = ?, label_en = ?, url = ?, is_active = ? WHERE id = ?').run(b.label_sv || '', b.label_en || '', b.url || '/', b.is_active ? 1 : 0, b.id);
  } else if (b.action === 'delete' && b.id) {
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(b.id);
  } else if (b.action === 'move_up' && b.id) {
    var currentItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(b.id);
    if (currentItem) {
      var prevItem = db.prepare('SELECT * FROM menu_items WHERE sort_order < ? ORDER BY sort_order DESC LIMIT 1').get(currentItem.sort_order);
      if (prevItem) {
        db.prepare('UPDATE menu_items SET sort_order = ? WHERE id = ?').run(prevItem.sort_order, currentItem.id);
        db.prepare('UPDATE menu_items SET sort_order = ? WHERE id = ?').run(currentItem.sort_order, prevItem.id);
      }
    }
  } else if (b.action === 'move_down' && b.id) {
    var curItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(b.id);
    if (curItem) {
      var nxtItem = db.prepare('SELECT * FROM menu_items WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1').get(curItem.sort_order);
      if (nxtItem) {
        db.prepare('UPDATE menu_items SET sort_order = ? WHERE id = ?').run(nxtItem.sort_order, curItem.id);
        db.prepare('UPDATE menu_items SET sort_order = ? WHERE id = ?').run(curItem.sort_order, nxtItem.id);
      }
    }
  }
  res.redirect(BASE + '/menu?saved=1');
});

// ============================================================
// NEWSLETTER
// ============================================================
app.get(BASE + '/newsletter', auth, function(req, res) {
  var subscribers = db.prepare('SELECT * FROM newsletter_subscribers ORDER BY subscribed_at DESC').all();
  res.render('newsletter', { base: BASE, subscribers: subscribers, success: req.query.saved === '1' });
});

app.post(BASE + '/newsletter', auth, function(req, res) {
  var b = req.body;
  if (b.action === 'add' && b.email) {
    try {
      db.prepare('INSERT INTO newsletter_subscribers (email, name) VALUES (?, ?)').run(b.email, b.name || '');
    } catch(e) {} // duplicate email
  } else if (b.action === 'delete' && b.id) {
    db.prepare('DELETE FROM newsletter_subscribers WHERE id = ?').run(b.id);
  } else if (b.action === 'toggle' && b.id) {
    var sub = db.prepare('SELECT is_active FROM newsletter_subscribers WHERE id = ?').get(b.id);
    if (sub) {
      db.prepare('UPDATE newsletter_subscribers SET is_active = ? WHERE id = ?').run(sub.is_active ? 0 : 1, b.id);
    }
  }
  res.redirect(BASE + '/newsletter?saved=1');
});

// ============================================================
// TRANSLATIONS
// ============================================================
app.get(BASE + '/translations', auth, function(req, res) {
  res.render('translations', { base: BASE, langs: LANGS, langNames: LANG_NAMES });
});
app.get(BASE + '/api/translations/:lang', auth, function(req, res) {
  var rows = db.prepare('SELECT key, value FROM translations WHERE lang = ?').all(req.params.lang);
  var t = {}; rows.forEach(function(r) { t[r.key] = r.value; });
  res.json({ success: true, translations: t });
});
app.put(BASE + '/api/translations/:lang', auth, function(req, res) {
  var lang = req.params.lang;
  var upsert = db.prepare('INSERT INTO translations (lang, key, value) VALUES (?, ?, ?) ON CONFLICT(lang, key) DO UPDATE SET value = excluded.value');
  Object.entries(req.body.translations || {}).forEach(function([k,v]) { upsert.run(lang, k, v); });
  res.json({ success: true });
});

// ============================================================
// SETTINGS
// ============================================================
app.get(BASE + '/settings', auth, function(req, res) {
  var settings = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(function(r) { settings[r.key] = r.value; });
  res.render('settings', { base: BASE, settings: settings });
});
app.post(BASE + '/settings', auth, function(req, res) {
  var upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  Object.entries(req.body).forEach(function([k,v]) { upsert.run(k, String(v)); });
  res.redirect(BASE + '/settings');
});

// ============================================================
// PUBLIC API ROUTES (no auth)
// ============================================================
app.get(BASE + '/api/public/translations/:lang', function(req, res) {
  var rows = db.prepare('SELECT key, value FROM translations WHERE lang = ?').all(req.params.lang);
  var t = {}; rows.forEach(function(r) { t[r.key] = r.value; });
  res.json(t);
});

app.get(BASE + '/api/public/members', function(req, res) {
  var members = db.prepare("SELECT id, name, stage_name, headline, profile_slug, profile_photo, city, country, skills, showreel_url FROM members WHERE is_public = 1 AND approved = 1").all();
  // Attach branches
  members.forEach(function(m) {
    m.branches = db.prepare("SELECT fb.name, fb.name_sv, mb.is_primary FROM member_branches mb JOIN film_branches fb ON fb.id = mb.branch_id WHERE mb.member_id = ?").all(m.id);
  });
  res.json({ success: true, members: members });
});

app.get(BASE + '/api/public/members/:slug', function(req, res) {
  var member = db.prepare("SELECT id, name, stage_name, headline, biography, profile_slug, profile_photo, city, country, skills, awards, equipment, website, imdb_link, social_media, showreel_url, languages_spoken FROM members WHERE profile_slug = ? AND is_public = 1 AND approved = 1").get(req.params.slug);
  if (!member) return res.status(404).json({ success: false, error: 'Not found' });
  member.branches = db.prepare("SELECT fb.name, fb.name_sv, mb.is_primary FROM member_branches mb JOIN film_branches fb ON fb.id = mb.branch_id WHERE mb.member_id = ?").all(member.id);
  member.education = db.prepare("SELECT institution, qualification, field_of_study, start_year, end_year FROM member_education WHERE member_id = ? ORDER BY start_year DESC").all(member.id);
  member.experience = db.prepare("SELECT project_title, project_type, role, production_company, year, description, link, is_featured FROM member_experience WHERE member_id = ? ORDER BY year DESC").all(member.id);
  member.media = db.prepare("SELECT type, url, caption FROM member_media WHERE member_id = ? ORDER BY sort_order").all(member.id);
  res.json({ success: true, member: member });
});

app.get(BASE + '/api/public/menu', function(req, res) {
  var items = db.prepare('SELECT label_sv, label_en, url, sort_order FROM menu_items WHERE is_active = 1 ORDER BY sort_order').all();
  res.json({ success: true, items: items });
});

app.get(BASE + '/api/public/pages/:slug', function(req, res) {
  var page = db.prepare('SELECT slug, title_sv, title_en, content_sv, content_en, updated_at FROM pages WHERE slug = ?').get(req.params.slug);
  if (!page) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, page: page });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, '127.0.0.1', function() {
  console.log('FilmCentrum Admin running on http://127.0.0.1:' + PORT + BASE);
});
