require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const helmet = require('helmet');
const ejsLayouts = require("express-ejs-layouts");
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

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
  ['password_hash', "TEXT DEFAULT ''"]
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

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(function(req, res, next) { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('X-XSS-Protection', '1; mode=block'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); next(); });
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
  cookie: { maxAge: 30*24*60*60*1000, path: '/', sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' }
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
var loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts. Please try again in 15 minutes.' });
// ============================================================
app.get(BASE + '/login', function(req, res) {
  if (req.session.adminId) return res.redirect(BASE + '/');
  res.render('login', { base: BASE, error: null, layout: false });
});

app.post(BASE + '/login', loginLimiter, function(req, res) {
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


  // Set member password if provided
  if (b.member_password && b.member_password.trim().length >= 4) {
    var pwHash = bcrypt.hashSync(b.member_password.trim(), 10);
    db.prepare("UPDATE members SET password_hash = ? WHERE id = ?").run(pwHash, id);
  }
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
  var id = req.params.id;
  // Save revision before updating
  var current = db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
  if (current && (current.content_sv || current.content_en)) {
    db.prepare('INSERT INTO page_revisions (page_id, title_sv, title_en, content_sv, content_en, saved_by) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, current.title_sv, current.title_en, current.content_sv, current.content_en, req.session.adminUsername || 'admin'
    );
    // Keep only last 20 revisions per page
    db.prepare('DELETE FROM page_revisions WHERE page_id = ? AND id NOT IN (SELECT id FROM page_revisions WHERE page_id = ? ORDER BY created_at DESC LIMIT 20)').run(id, id);
  }
  var status = b.status || 'published';
  db.prepare("UPDATE pages SET title_sv = ?, title_en = ?, content_sv = ?, content_en = ?, status = ?, auto_saved = '', updated_at = datetime('now') WHERE id = ?").run(
    b.title_sv || '', b.title_en || '', b.content_sv || '', b.content_en || '', status, id
  );
  res.redirect(BASE + '/pages/' + id + '?saved=1');
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
  var archive = db.prepare("SELECT * FROM newsletter_sent ORDER BY sent_at DESC LIMIT 50").all(); res.render("newsletter", { base: BASE, subscribers: subscribers, archive: archive, success: req.query.sent === "1" });
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
// PASSWORD CHANGE
// ============================================================
app.get(BASE + "/password", auth, function(req, res) {
  res.render("password", { base: BASE, success: req.query.changed === "1", error: null });
});
app.post(BASE + "/password", auth, function(req, res) {
  var user = db.prepare("SELECT * FROM admin_users WHERE id = ?").get(req.session.adminId);
  if (!user || !bcrypt.compareSync(req.body.current_password, user.password_hash)) {
    return res.render("password", { base: BASE, success: false, error: "Current password is incorrect" });
  }
  if (req.body.new_password !== req.body.confirm_password) {
    return res.render("password", { base: BASE, success: false, error: "New passwords do not match" });
  }
  if (req.body.new_password.length < 6) {
    return res.render("password", { base: BASE, success: false, error: "Password must be at least 6 characters" });
  }
  var hash = bcrypt.hashSync(req.body.new_password, 10);
  db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(hash, req.session.adminId);
  res.redirect(BASE + "/password?changed=1");
});

// ============================================================
// PUBLIC API ROUTES (no auth)
// ============================================================
// SEO & ANALYTICS
// ============================================================
app.get(BASE + '/seo', auth, function(req, res) {
  var settings = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(function(r) { settings[r.key] = r.value; });
  res.render('seo', { base: BASE, settings: settings, success: req.query.saved === '1' });
});
app.post(BASE + '/seo', auth, function(req, res) {
  var upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  var seoKeys = ['seo_title', 'seo_description', 'seo_keywords', 'og_title', 'og_description', 'og_image', 'ga_id', 'canonical_url', 'robots_meta', 'schema_json'];
  seoKeys.forEach(function(k) {
    if (req.body[k] !== undefined) upsert.run(k, String(req.body[k]));
  });
  // Update the frontend HTML with GA ID
  var gaId = req.body.ga_id || '';
  try {
    var htmlPath = '/var/www/skylarkmedia/filmcentrum/index.html';
    var fs = require('fs');
    if (fs.existsSync(htmlPath)) {
      var html = fs.readFileSync(htmlPath, 'utf-8');
      html = html.replace(/content="G-[A-Z0-9]*"/, 'content="' + gaId + '"');
      html = html.replace(/content=""/, 'content="' + gaId + '"');
      if (req.body.seo_title) html = html.replace(/<title>[^<]*<\/title>/, '<title>' + (req.body.seo_title || '').replace(/[<>"]/g, '') + '</title>');
      if (req.body.seo_description) html = html.replace(/name="description" content="[^"]*"/, 'name="description" content="' + req.body.seo_description + '"');
      if (req.body.seo_keywords) html = html.replace(/name="keywords" content="[^"]*"/, 'name="keywords" content="' + req.body.seo_keywords + '"');
      if (req.body.og_title) html = html.replace(/property="og:title" content="[^"]*"/, 'property="og:title" content="' + req.body.og_title + '"');
      if (req.body.og_description) html = html.replace(/property="og:description" content="[^"]*"/, 'property="og:description" content="' + req.body.og_description + '"');
      if (req.body.canonical_url) html = html.replace(/rel="canonical" href="[^"]*"/, 'rel="canonical" href="' + req.body.canonical_url + '"');
      fs.writeFileSync(htmlPath, html);
    }
  } catch(e) { console.error('SEO HTML update error:', e.message); }
  res.redirect(BASE + '/seo?saved=1');
});

// ============================================================
// NEWSLETTER COMPOSE & SEND
// ============================================================
app.get(BASE + '/newsletter/compose', auth, function(req, res) {
  var active = db.prepare("SELECT COUNT(*) as c FROM newsletter_subscribers WHERE is_active = 1").get().c;
  var total = db.prepare("SELECT COUNT(*) as c FROM newsletter_subscribers").get().c;
  res.render('newsletter-compose', { base: BASE, stats: { active: active, total: total } });
});

// Create newsletter_sent table
try {
  db.exec("CREATE TABLE IF NOT EXISTS newsletter_sent (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, content TEXT, recipient_count INTEGER DEFAULT 0, sent_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
} catch(e) {}

app.post(BASE + '/newsletter/send', auth, function(req, res) {
  var subject = req.body.subject;
  var content = req.body.content;
  if (!subject || !content) return res.redirect(BASE + '/newsletter/compose');

  var subscribers = db.prepare("SELECT email, name FROM newsletter_subscribers WHERE is_active = 1").all();

  // Store the newsletter
  db.prepare("INSERT INTO newsletter_sent (subject, content, recipient_count) VALUES (?, ?, ?)").run(subject, content, subscribers.length);

  // Note: Actual SMTP sending would go here. For now it stores and shows success.
  res.redirect(BASE + '/newsletter?sent=1&count=' + subscribers.length);
});

app.get(BASE + '/newsletter/export', auth, function(req, res) {
  var subscribers = db.prepare('SELECT email, name, is_active, subscribed_at FROM newsletter_subscribers ORDER BY subscribed_at DESC').all();
  var csv = 'Email,Name,Status,Subscribed\n';
  subscribers.forEach(function(s) {
    csv += '"' + (s.email || '') + '","' + (s.name || '') + '","' + (s.is_active ? 'Active' : 'Inactive') + '","' + (s.subscribed_at || '') + '"\n';
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=filmcentrum_subscribers.csv');
  res.send(csv);
});

// ============================================================
// CHATBOT API (public)
var chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: JSON.stringify({ error: 'Too many requests' }) });
// ============================================================
app.post(BASE + '/api/public/chat', chatLimiter, function(req, res) {
  var message = req.body.message;
  if (!message) return res.status(400).json({ error: 'Message required' });

  // Simple rule-based chatbot for FilmCentrum
  var msg = message.toLowerCase();
  var reply = '';

  if (msg.indexOf('medlem') !== -1 || msg.indexOf('member') !== -1 || msg.indexOf('join') !== -1) {
    reply = 'Medlemskap i FilmCentrum kostar 100 kr per ar. Du kan bli medlem genom att klicka pa "Bli medlem" pa var hemsida. Som medlem far du distribution, synlighet, natverk och rostrett pa arsmote!';
  } else if (msg.indexOf('pris') !== -1 || msg.indexOf('kost') !== -1 || msg.indexOf('price') !== -1 || msg.indexOf('avgift') !== -1) {
    reply = 'Medlemskapet kostar 100 kr per ar. Det inkluderar distribution, filmsida, synlighet mot skolor/bibliotek, intakter fran visningar, och natverk med oberoende filmskapare.';
  } else if (msg.indexOf('kontakt') !== -1 || msg.indexOf('contact') !== -1 || msg.indexOf('email') !== -1) {
    reply = 'Du kan kontakta oss via kontaktformulaaret pa hemsidan eller skicka e-post till info@filmcentrum.se. Vi svarar vanligtvis inom 1-2 arbetsdagar.';
  } else if (msg.indexOf('skolbio') !== -1 || msg.indexOf('school') !== -1) {
    reply = 'FilmCentrum arbetar aktivt med skolbioprogram runt om i landet. Vi erbjuder pedagogiskt material och filmsamtal for alla aldersgrupper. Kontakta oss for mer information!';
  } else if (msg.indexOf('distribution') !== -1 || msg.indexOf('distribute') !== -1) {
    reply = 'Genom FC Distribution sprider vi kvalitetsfilm till skolor, bibliotek och kulturinstitutioner over hela Sverige. Som medlem far du din film distribuerad och synlig i vart natverk.';
  } else if (msg.indexOf('hej') !== -1 || msg.indexOf('hello') !== -1 || msg.indexOf('hi') !== -1) {
    reply = 'Hej! Valkommen till FilmCentrum Riks. Hur kan jag hjalpa dig? Jag kan svara pa fragor om medlemskap, priser, skolbio, distribution och mer.';
  } else if (msg.indexOf('tack') !== -1 || msg.indexOf('thank') !== -1) {
    reply = 'Tack sjalv! Hor garna av dig igen om du har fler fragor. Valkommen till FilmCentrum!';
  } else {
    reply = 'Tack for din fraga! Jag kan hjalpa dig med information om medlemskap (100 kr/ar), distribution, skolbio och kontaktuppgifter. Vad vill du veta mer om?';
  }

  res.json({ success: true, reply: reply });
});

// ============================================================
// PUBLIC SEO ROUTES
// ============================================================
app.get(BASE + '/api/public/seo', function(req, res) {
  var settings = {};
  var keys = ['seo_title', 'seo_description', 'seo_keywords', 'og_title', 'og_description', 'og_image', 'ga_id', 'canonical_url', 'robots_meta', 'schema_json'];
  db.prepare("SELECT key, value FROM settings WHERE key IN (" + keys.map(function() { return '?'; }).join(',') + ")").all(keys).forEach(function(r) {
    settings[r.key] = r.value;
  });
  res.json({ success: true, settings: settings });
});
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
// ============================================================
// PUBLIC MEMBERS DIRECTORY

// ============================================================
// PUBLIC NEWS PAGE
// ============================================================
app.get(BASE.replace('/admin', '') + '/nyheter', function(req, res) {
  var articles = db.prepare("SELECT * FROM articles WHERE is_published = 1 ORDER BY published_at DESC").all();
  res.render('public-news', { layout: false, articles: articles });
});

app.get(BASE.replace('/admin', '') + '/nyheter/:slug', function(req, res) {
  var article = db.prepare("SELECT * FROM articles WHERE slug = ? AND is_published = 1").get(req.params.slug);
  if (!article) return res.redirect(BASE.replace('/admin', '') + '/nyheter');
  res.render('public-article', { layout: false, article: article });
});

// ============================================================
// NEWS / ARTICLES

// ============================================================
// MEDIA UPLOAD API

// ============================================================
// AUTO-SAVE API

// ============================================================
// AI WRITING ASSISTANT (Gemini)
// ============================================================
app.post(BASE + '/api/ai/write', auth, async function(req, res) {
  try {
    var action = req.body.action;
    var text = req.body.text;
    var prompt = req.body.prompt;
    if (!text && !prompt) return res.status(400).json({ error: 'No text provided' });

    var geminiKey = db.prepare("SELECT value FROM settings WHERE key = 'gemini_api_key'").get();
    if (!geminiKey || !geminiKey.value) return res.status(400).json({ error: 'Gemini API key not set. Go to Settings and add it.' });

    var systemPrompt = '';
    if (action === 'improve') systemPrompt = 'You are a professional content writer. Improve the following text to be more professional, engaging, and well-structured. Keep the same language. Return only the improved HTML (use <h2>, <h3>, <p>, <strong>, <em>, <ul>, <li> tags). No explanation.';
    else if (action === 'translate_en') systemPrompt = 'Translate the following text to English. Return only the translated HTML. No explanation.';
    else if (action === 'translate_sv') systemPrompt = 'Translate the following text to Swedish. Return only the translated HTML. No explanation.';
    else if (action === 'expand') systemPrompt = 'Expand and elaborate on the following text. Make it more detailed. Keep the same language. Return only HTML. No explanation.';
    else if (action === 'summarize') systemPrompt = 'Create a concise summary. Keep the same language. Return only HTML. No explanation.';
    else if (action === 'proofread') systemPrompt = 'Fix grammar, spelling, and punctuation errors. Keep the same language and tone. Return only the corrected HTML. No explanation.';
    else if (action === 'generate') systemPrompt = 'You are a professional content writer for FilmCentrum Riks, a Swedish film cooperative. Write content based on the following prompt. Write in Swedish unless specified otherwise. Return well-structured HTML (use <h2>, <h3>, <p>, <strong>, <ul>, <li> tags). No explanation.';
    else return res.status(400).json({ error: 'Unknown action' });

    var inputText = action === 'generate' ? prompt : text;

    var response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + geminiKey.value, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt + '\n\n' + inputText }] }],
        generationConfig: { maxOutputTokens: 2000, temperature: 0.7 }
      })
    });

    var data = await response.json();
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      var result = data.candidates[0].content.parts[0].text;
      res.json({ success: true, result: result });
    } else {
      res.status(500).json({ error: 'AI returned no content', details: JSON.stringify(data).substring(0, 200) });
    }
  } catch(e) {
    res.status(500).json({ error: 'AI error: ' + e.message });
  }
});
// ============================================================
app.post(BASE + '/api/pages/:id/autosave', auth, function(req, res) {
  var b = req.body;
  db.prepare("UPDATE pages SET auto_saved = ?, auto_saved_at = datetime('now') WHERE id = ?").run(
    JSON.stringify({ title_sv: b.title_sv, title_en: b.title_en, content_sv: b.content_sv, content_en: b.content_en }), req.params.id
  );
  res.json({ success: true });
});

// ============================================================
// REVISION HISTORY
// ============================================================
app.get(BASE + '/api/pages/:id/revisions', auth, function(req, res) {
  var revisions = db.prepare('SELECT id, saved_by, created_at FROM page_revisions WHERE page_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
  res.json({ success: true, revisions: revisions });
});

app.get(BASE + '/api/pages/:id/revisions/:revId', auth, function(req, res) {
  var rev = db.prepare('SELECT * FROM page_revisions WHERE id = ? AND page_id = ?').get(req.params.revId, req.params.id);
  if (!rev) return res.status(404).json({ error: 'Revision not found' });
  res.json({ success: true, revision: rev });
});

app.post(BASE + '/api/pages/:id/revisions/:revId/restore', auth, function(req, res) {
  var rev = db.prepare('SELECT * FROM page_revisions WHERE id = ? AND page_id = ?').get(req.params.revId, req.params.id);
  if (!rev) return res.status(404).json({ error: 'Revision not found' });
  db.prepare("UPDATE pages SET title_sv = ?, title_en = ?, content_sv = ?, content_en = ?, updated_at = datetime('now') WHERE id = ?").run(
    rev.title_sv, rev.title_en, rev.content_sv, rev.content_en, req.params.id
  );
  res.json({ success: true });
});

// ============================================================
// REUSABLE BLOCKS
// ============================================================
app.get(BASE + '/api/reusable-blocks', auth, function(req, res) {
  var blocks = db.prepare('SELECT * FROM reusable_blocks ORDER BY updated_at DESC').all();
  res.json({ success: true, blocks: blocks });
});

app.post(BASE + '/api/reusable-blocks', auth, function(req, res) {
  var b = req.body;
  if (b.id) {
    db.prepare("UPDATE reusable_blocks SET name = ?, category = ?, content = ?, is_linked = ?, updated_at = datetime('now') WHERE id = ?").run(
      b.name || '', b.category || 'custom', b.content || '', b.is_linked ? 1 : 0, b.id
    );
    res.json({ success: true, id: b.id });
  } else {
    var r = db.prepare("INSERT INTO reusable_blocks (name, category, content, is_linked) VALUES (?, ?, ?, ?)").run(
      b.name || '', b.category || 'custom', b.content || '', b.is_linked ? 1 : 0
    );
    res.json({ success: true, id: r.lastInsertRowid });
  }
});

app.delete(BASE + '/api/reusable-blocks/:id', auth, function(req, res) {
  db.prepare('DELETE FROM reusable_blocks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});
// ============================================================
var multer = require('multer');
var mediaStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    var dir = path.join(__dirname, 'public/uploads');
    var fs = require('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function(req, file, cb) {
    var ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'media_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + ext);
  }
});
var mediaUpload = multer({ storage: mediaStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: function(req, file, cb) { if (file.mimetype.startsWith('image/')) cb(null, true); else cb(new Error('Only images'), false); } });

app.post(BASE + '/api/upload', auth, mediaUpload.single('file'), function(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  var url = BASE + '/uploads/' + req.file.filename;
  res.json({ data: [url] });
});

app.post(BASE + '/api/upload-media', auth, mediaUpload.array('files[]', 10), function(req, res) {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files' });
  var urls = req.files.map(function(f) { return BASE + '/uploads/' + f.filename; });
  res.json({ data: urls });
});
// ============================================================
app.get(BASE + '/articles', auth, function(req, res) {
  var articles = db.prepare('SELECT * FROM articles ORDER BY published_at DESC').all();
  res.render('articles', { base: BASE, articles: articles });
});

app.get(BASE + '/articles/new', auth, function(req, res) {
  res.render('article-edit', { base: BASE, article: { id: null, title_sv: '', title_en: '', slug: '', excerpt_sv: '', excerpt_en: '', content_sv: '', content_en: '', image: '', category: 'news', is_published: 0 }, isNew: true, success: false });
});

app.get(BASE + '/articles/:id', auth, function(req, res) {
  var article = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  if (!article) return res.redirect(BASE + '/articles');
  res.render('article-edit', { base: BASE, article: article, isNew: false, success: req.query.saved === '1' });
});

app.post(BASE + '/articles', auth, function(req, res) {
  var b = req.body;
  if (b._method === 'delete' && b.id) {
    db.prepare('DELETE FROM articles WHERE id = ?').run(b.id);
    return res.redirect(BASE + '/articles');
  }
  var slug = (b.slug || b.title_sv || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (b.id) {
    db.prepare("UPDATE articles SET title_sv=?, title_en=?, slug=?, excerpt_sv=?, excerpt_en=?, content_sv=?, content_en=?, image=?, category=?, is_published=?, published_at=?, updated_at=datetime('now') WHERE id=?").run(
      b.title_sv||'', b.title_en||'', slug, b.excerpt_sv||'', b.excerpt_en||'', b.content_sv||'', b.content_en||'', b.image||'', b.category||'news', b.is_published?1:0, b.published_at||null, b.id
    );
    res.redirect(BASE + '/articles/' + b.id + '?saved=1');
  } else {
    var r = db.prepare("INSERT INTO articles (title_sv, title_en, slug, excerpt_sv, excerpt_en, content_sv, content_en, image, category, is_published, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
      b.title_sv||'', b.title_en||'', slug, b.excerpt_sv||'', b.excerpt_en||'', b.content_sv||'', b.content_en||'', b.image||'', b.category||'news', b.is_published?1:0, b.published_at||null
    );
    res.redirect(BASE + '/articles/' + r.lastInsertRowid + '?saved=1');
  }
});

// Public news API
app.get(BASE + '/api/public/articles', function(req, res) {
  var articles = db.prepare("SELECT id, title_sv, title_en, slug, excerpt_sv, excerpt_en, image, category, published_at FROM articles WHERE is_published = 1 ORDER BY published_at DESC").all();
  res.json({ success: true, articles: articles });
});

app.get(BASE + '/api/public/articles/:slug', function(req, res) {
  var article = db.prepare("SELECT * FROM articles WHERE slug = ? AND is_published = 1").get(req.params.slug);
  if (!article) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, article: article });
});
// ============================================================
app.get(BASE.replace("/admin", "") + "/members", function(req, res) {
  var members = db.prepare("SELECT m.*, GROUP_CONCAT(COALESCE(fb.name_sv, fb.name)) as branch_names FROM members m LEFT JOIN member_branches mb ON mb.member_id = m.id LEFT JOIN film_branches fb ON fb.id = mb.branch_id WHERE m.is_public = 1 AND m.approved = 1 GROUP BY m.id ORDER BY m.name").all();
  var branches = db.prepare("SELECT * FROM film_branches ORDER BY sort_order").all();
  res.render("members-directory", { layout: false, members: members, branches: branches });
});

// MEMBER PORTAL (login + profile + password change)
// ============================================================
function memberAuth(req, res, next) {
  if (!req.session.memberId) return res.redirect(BASE.replace('/admin', '') + '/login');
  next();
}

// Member login page
app.get(BASE.replace('/admin', '') + '/login', function(req, res) {
  if (req.session.memberId) return res.redirect(BASE.replace('/admin', '') + '/profile');
  res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FilmCentrum - Logga in</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh}.login-card{background:#1e293b;border-radius:12px;padding:40px;border:1px solid #334155;width:100%;max-width:400px}h2{color:#dc2626;font-size:24px;margin-bottom:8px;text-align:center}p.sub{color:#64748b;font-size:13px;text-align:center;margin-bottom:28px}.form-group{margin-bottom:18px}.form-group label{display:block;font-size:13px;color:#94a3b8;margin-bottom:6px}.form-group input{width:100%;padding:10px 14px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:14px;outline:none}.form-group input:focus{border-color:#dc2626}.btn{width:100%;padding:12px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}.btn:hover{background:#b91c1c}.error{background:#7f1d1d;color:#fca5a5;padding:10px;border-radius:6px;margin-bottom:16px;font-size:13px;text-align:center}.back{display:block;text-align:center;margin-top:16px;color:#64748b;font-size:13px;text-decoration:none}.back:hover{color:#dc2626}</style></head><body><div class="login-card"><h2>FilmCentrum</h2><p class="sub">Logga in pa ditt medlemskonto</p>' + (req.query.error === '1' ? '<div class="error">Fel e-post eller losenord</div>' : '') + (req.query.changed === '1' ? '<div style="background:#064e3b;color:#6ee7b7;padding:10px;border-radius:6px;margin-bottom:16px;font-size:13px;text-align:center;">Losenord andrat!</div>' : '') + '<form method="POST" action="' + BASE.replace('/admin', '') + '/login"><div class="form-group"><label>E-post</label><input type="email" name="email" required></div><div class="form-group"><label>Losenord</label><input type="password" name="password" required></div><button type="submit" class="btn">Logga in</button></form><a href="/filmcentrum/" class="back">Tillbaka till startsidan</a></div></body></html>');
});

app.post(BASE.replace('/admin', '') + '/login', loginLimiter, function(req, res) {
  var member = db.prepare('SELECT * FROM members WHERE email = ?').get(req.body.email);
  if (!member || !member.password_hash || !bcrypt.compareSync(req.body.password, member.password_hash)) {
    return res.redirect(BASE.replace('/admin', '') + '/login?error=1');
  }
  req.session.memberId = member.id;
  req.session.memberName = member.name;
  req.session.memberEmail = member.email;
  res.redirect(BASE.replace('/admin', '') + '/profile');
});

app.get(BASE.replace('/admin', '') + '/logout-member', function(req, res) {
  req.session.memberId = null;
  req.session.memberName = null;
  req.session.memberEmail = null;
  res.redirect(BASE.replace('/admin', '') + '/login');
});

// Member profile page
app.get(BASE.replace('/admin', '') + '/profile', memberAuth, function(req, res) {
  var member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.session.memberId);
  if (!member) return res.redirect(BASE.replace('/admin', '') + '/login');
  var branches = db.prepare('SELECT * FROM film_branches ORDER BY sort_order').all();
  var memberBranches = db.prepare('SELECT branch_id FROM member_branches WHERE member_id = ?').all(member.id).map(function(b) { return b.branch_id; });
  var education = db.prepare('SELECT * FROM member_education WHERE member_id = ? ORDER BY start_year DESC').all(member.id);
  var experience = db.prepare('SELECT * FROM member_experience WHERE member_id = ? ORDER BY year DESC').all(member.id);
  res.render('member-profile', {
    layout: false,
    portalBase: BASE.replace('/admin', ''),
    member: member,
    branches: branches,
    memberBranches: memberBranches,
    education: education,
    experience: experience,
    saved: req.query.saved === '1',
    pwOk: req.query.pw === '1',
    pwErr: req.query.pwerr || null
  });
});

// Member password change
app.post(BASE.replace('/admin', '') + '/change-password', memberAuth, function(req, res) {
  var member = db.prepare('SELECT password_hash FROM members WHERE id = ?').get(req.session.memberId);
  if (!bcrypt.compareSync(req.body.current_password, member.password_hash)) {
    return res.redirect(BASE.replace('/admin', '') + '/profile?pwerr=wrong');
  }
  if (req.body.new_password !== req.body.confirm_password) {
    return res.redirect(BASE.replace('/admin', '') + '/profile?pwerr=mismatch');
  }
  if (req.body.new_password.length < 4) {
    return res.redirect(BASE.replace('/admin', '') + '/profile?pwerr=short');
  }
  var hash = bcrypt.hashSync(req.body.new_password, 10);
  db.prepare("UPDATE members SET password_hash = ? WHERE id = ?").run(hash, req.session.memberId);
  res.redirect(BASE.replace('/admin', '') + '/profile?pw=1');
});
// ============================================================
app.listen(PORT, '127.0.0.1', function() {
  console.log('FilmCentrum Admin running on http://127.0.0.1:' + PORT + BASE);
});

// Newsletter templates page
app.get('/filmcentrum/admin/newsletter/templates', function(req, res) {
  if (!req.session.adminId) return res.redirect('/filmcentrum/admin/login');
  res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Newsletter Templates</title><link rel="stylesheet" href="https://unpkg.com/grapesjs@0.21.10/dist/css/grapes.min.css"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px}.container{max-width:900px;margin:0 auto}.back{color:#94a3b8;text-decoration:none;font-size:13px;display:inline-block;margin-bottom:16px}.back:hover{color:#dc2626}h2{font-size:20px;margin-bottom:20px}.tmpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;margin-bottom:24px}.tmpl-card{background:#1e293b;border-radius:10px;padding:20px;border:1px solid #334155;cursor:pointer;transition:border-color 0.2s}.tmpl-card:hover{border-color:#dc2626}.tmpl-card h3{font-size:15px;margin-bottom:6px}.tmpl-card p{font-size:12px;color:#64748b}.tmpl-card.active{border-color:#dc2626;background:#1a1a2e}.editor-wrap{background:#1e293b;border-radius:10px;padding:20px;border:1px solid #334155;margin-bottom:16px}.editor-wrap h3{font-size:16px;color:#dc2626;margin-bottom:12px}#tmplEditor{height:400px}.btn{padding:10px 24px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}.btn:hover{background:#b91c1c}.btn-gray{background:#334155}.btn-gray:hover{background:#475569}</style></head><body><div class="container"><a href="/filmcentrum/admin/newsletter" class="back">&larr; Back to Newsletter</a><h2>Newsletter Templates</h2><div class="tmpl-grid"><div class="tmpl-card active" onclick="loadTmpl(0)"><h3>News Update</h3><p>Standard newsletter with header, content, footer</p></div><div class="tmpl-card" onclick="loadTmpl(1)"><h3>Event Invitation</h3><p>Event details with date, time, location</p></div><div class="tmpl-card" onclick="loadTmpl(2)"><h3>Welcome Member</h3><p>New member welcome email</p></div><div class="tmpl-card" onclick="loadTmpl(3)"><h3>Member Update</h3><p>Membership status and news</p></div><div class="tmpl-card" onclick="loadTmpl(4)"><h3>Minimal</h3><p>Simple clean layout</p></div></div><div class="editor-wrap"><h3>Edit Template</h3><div id="tmplEditor"></div></div><button class="btn" onclick="saveTmpl()">Save as Template</button> <button class="btn btn-gray" onclick="useTmpl()">Use for Newsletter</button></div><script src="https://unpkg.com/grapesjs@0.21.10/dist/grapes.min.js"></script><script>var templates=[{name:"News",html:"<div style=\"max-width:600px;margin:0 auto;font-family:Arial,sans-serif;\"><div style=\"background:#dc2626;padding:24px;text-align:center;\"><h1 style=\"color:#fff;font-size:24px;margin:0;\">FilmCentrum Riks</h1><p style=\"color:#fecaca;font-size:13px;margin:4px 0 0;\">Nyhetsbrev</p></div><div style=\"padding:32px 24px;background:#fff;\"><h2 style=\"color:#1e293b;font-size:20px;\">Rubrik</h2><p style=\"color:#374151;line-height:1.7;\">Innehall har...</p></div><div style=\"padding:16px 24px;background:#f1f5f9;text-align:center;font-size:12px;color:#64748b;\">FilmCentrum Riks | filmcentrum.se</div></div>"},{name:"Event",html:"<div style=\"max-width:600px;margin:0 auto;font-family:Arial,sans-serif;\"><div style=\"background:#1a1a2e;padding:32px;text-align:center;\"><h1 style=\"color:#dc2626;font-size:28px;\">Inbjudan</h1></div><div style=\"padding:32px 24px;background:#fff;\"><h2>Evenemang</h2><p><strong>Datum:</strong> </p><p><strong>Tid:</strong> </p><p><strong>Plats:</strong> </p><p>Beskrivning...</p><a href=\"#\" style=\"display:inline-block;padding:12px 28px;background:#dc2626;color:#fff;border-radius:6px;text-decoration:none;margin-top:16px;\">Anmal dig</a></div></div>"},{name:"Welcome",html:"<div style=\"max-width:600px;margin:0 auto;font-family:Arial,sans-serif;\"><div style=\"background:#dc2626;padding:32px;text-align:center;\"><h1 style=\"color:#fff;\">Valkommen!</h1></div><div style=\"padding:32px 24px;background:#fff;\"><h2>Valkommen som medlem</h2><p>Vi ar glada att du blivit en del av FilmCentrum Riks.</p><h3>Vad du kan gora nu:</h3><ul><li>Skapa din profil</li><li>Utforska medlemskatalogen</li><li>Delta i evenemang</li></ul></div></div>"},{name:"Update",html:"<div style=\"max-width:600px;margin:0 auto;font-family:Arial,sans-serif;\"><div style=\"background:#1a1a2e;padding:20px 24px;display:flex;align-items:center;gap:12px;\"><span style=\"color:#dc2626;font-weight:700;font-size:18px;\">FC</span><span style=\"color:#94a3b8;font-size:13px;\">Medlemsuppdatering</span></div><div style=\"padding:32px 24px;background:#fff;\"><h2>Uppdatering</h2><p>Hej medlemmar!</p><p>Innehall...</p></div></div>"},{name:"Minimal",html:"<div style=\"max-width:600px;margin:0 auto;padding:32px;font-family:Arial,sans-serif;\"><h2 style=\"color:#1e293b;\">FilmCentrum</h2><p style=\"color:#374151;line-height:1.7;\">Meddelande...</p><p style=\"margin-top:24px;color:#64748b;font-size:12px;\">FilmCentrum Riks</p></div>"}];var editor=grapesjs.init({container:"#tmplEditor",height:"400px",storageManager:false,components:templates[0].html});function loadTmpl(i){document.querySelectorAll(".tmpl-card").forEach(function(c,j){c.classList.toggle("active",j===i);});editor.setComponents(templates[i].html);}function saveTmpl(){var name=prompt("Template name:");if(name){var html=editor.getHtml();templates.push({name:name,html:html});alert("Template saved!");}}function useTmpl(){var html=editor.getHtml();localStorage.setItem("nl_template",html);window.location.href="/filmcentrum/admin/newsletter/compose";}</script></body></html>');
});
