var db = require("better-sqlite3")("/var/www/filmcentrum-admin/data/filmcentrum.db");

var cols = [
  "username TEXT DEFAULT ''",
  "password_hash TEXT DEFAULT ''",
  "mobile TEXT DEFAULT ''",
  "date_of_birth TEXT DEFAULT ''",
  "gender TEXT DEFAULT ''",
  "nationality TEXT DEFAULT ''",
  "address TEXT DEFAULT ''",
  "postal_code TEXT DEFAULT ''",
  "region TEXT DEFAULT ''",
  "primary_roles TEXT DEFAULT '[]'",
  "years_experience TEXT DEFAULT ''",
  "career_stage TEXT DEFAULT ''",
  "tagline TEXT DEFAULT ''",
  "availability TEXT DEFAULT ''",
  "willing_to_travel INTEGER DEFAULT 0",
  "base_location TEXT DEFAULT ''",
  "day_rate TEXT DEFAULT ''",
  "cover_image TEXT DEFAULT ''",
  "cv_upload TEXT DEFAULT ''",
  "notable_credits TEXT DEFAULT ''",
  "technical_skills TEXT DEFAULT ''",
  "festival_selections TEXT DEFAULT ''",
  "press_features TEXT DEFAULT ''",
  "guild_memberships TEXT DEFAULT ''",
  "associations TEXT DEFAULT ''",
  "instagram TEXT DEFAULT ''",
  "linkedin TEXT DEFAULT ''",
  "twitter TEXT DEFAULT ''",
  "vimeo_channel TEXT DEFAULT ''",
  "youtube_channel TEXT DEFAULT ''",
  "membership_tier TEXT DEFAULT 'professional'",
  "how_heard TEXT DEFAULT ''",
  "referral TEXT DEFAULT ''",
  "services_offered TEXT DEFAULT ''",
  "newsletter_optin INTEGER DEFAULT 0",
  "terms_agreed INTEGER DEFAULT 0",
  "gdpr_consent INTEGER DEFAULT 0",
  "gdpr_consent_date DATETIME",
  "verified INTEGER DEFAULT 0"
];

var added = 0;
cols.forEach(function(col) {
  try { db.exec("ALTER TABLE members ADD COLUMN " + col); added++; } catch(e) {}
});

db.exec("CREATE TABLE IF NOT EXISTS member_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER, title TEXT, year INTEGER, category TEXT)");
db.exec("CREATE TABLE IF NOT EXISTS member_affiliations (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER, organization TEXT, type TEXT DEFAULT 'guild')");
db.exec("CREATE TABLE IF NOT EXISTS member_festivals (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER, experience_id INTEGER, festival_name TEXT, year INTEGER, result TEXT DEFAULT 'selected')");

console.log("Added " + added + " new columns");
console.log("Schema updated successfully");
