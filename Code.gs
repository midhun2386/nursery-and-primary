/**
 * WonderSprout backend — Google Apps Script + Google Sheets.
 * ============ CONFIGURATION ============
 */
const CONFIG = {
  SPREADSHEET_ID: '1EYgg6aWt-ts_aNppYv9NLmPw6WYn0TsRz5jrOCAZ0q0',
  ADMISSIONS_SHEET: 'Admissions',
  ENQUIRIES_SHEET: 'Enquiries',
  NOTIFY_EMAIL: '',                              // school's official email
  NOTIFY_ENABLED: false,                         // true to send notifications
  PROGRAMS: ['Playschool', 'Nursery', 'LKG & UKG', 'Primary School'],
  CATEGORIES: ['Admissions', 'Fees', 'Visit / Tour', 'Other'],
  MAX: { name: 100, age: 40, phone: 15, email: 120, session: 60, notes: 1000, message: 1000 },
  MAX_BODY_CHARS: 8000,                          // reject oversized requests
  RATE_LIMIT_PER_HOUR: 10                        // per phone number
};
// ==============================================================

const HEADERS = {
  Admissions: ['Submission ID','Submission Date','Parent/Guardian Name','Child Name','Date of Birth or Age','Program','Parent Phone','Email','Preferred Admission Year','Additional Information','Consent','Status'],
  Enquiries: ['Submission ID','Submission Date','Parent/Guardian Name','Phone','Email','Enquiry Category','Message','Consent','Status']
};

/** Health check and diagnostic tool. Visiting the URL in your browser shows your Sheet link! */
function doGet() {
  let info = {};
  try {
    const ss = getSpreadsheet_();
    info = {
      ok: true,
      service: 'WonderSprout API',
      status: 'Connected & Ready',
      spreadsheetName: ss.getName(),
      spreadsheetUrl: ss.getUrl(),
      spreadsheetId: ss.getId(),
      time: new Date().toISOString()
    };
  } catch (err) {
    info = {
      ok: false,
      service: 'WonderSprout API',
      status: 'Configuration Error',
      error: err.message,
      time: new Date().toISOString()
    };
  }
  return json_(info);
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (!raw || raw.length > CONFIG.MAX_BODY_CHARS) return json_({ ok: false, error: 'Invalid or oversized request.' });
    let body;
    try { body = JSON.parse(raw); } catch (_) { return json_({ ok: false, error: 'Malformed request.' }); }
    if (body.website) return json_({ ok: true, id: 'OK' });          // honeypot: bots fill this hidden field

    const v = validate_(body);
    if (v.errors.length) return json_({ ok: false, error: v.errors.join(' ') });
    if (!rateOk_(v.data.phone)) return json_({ ok: false, error: 'Too many submissions. Please try again later.' });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);                                              // serialize ID generation + append
    let id;
    try {
      id = body.type === 'admission' ? saveAdmission_(v.data) : saveEnquiry_(v.data);
    } finally { lock.releaseLock(); }

    let emailSent = null;                                              // email failure never undoes a save
    try { emailSent = notify_(body.type, id, v.data); } catch (err) { console.error('Email failed: ' + err.name); emailSent = false; }
    return json_({ ok: true, id: id, emailSent: emailSent });
  } catch (err) {
    console.error('doPost error: ' + err.name + ' ' + (err.message || ''));
    const errMsg = (err && err.message) ? err.message : 'Server error. Please try again or call the school.';
    return json_({ ok: false, error: errMsg });
  }
}

/** Validate + normalize. Returns {errors, data}. */
function validate_(b) {
  const M = CONFIG.MAX, errors = [], d = {};
  const t = (v, max) => safe_(String(v == null ? '' : v).trim().slice(0, max));
  if (b.type !== 'admission' && b.type !== 'enquiry') return { errors: ['Unknown submission type.'], data: {} };
  d.parent = t(b.parentName, M.name);
  d.phone = String(b.phone || '').replace(/[^\d+]/g, '');
  d.email = t(b.email, M.email);
  d.consent = b.consent === true || b.consent === 'true' || b.consent === 'on';
  if (d.parent.length < 2) errors.push('Name is required.');
  if (!/^\+?\d{10,15}$/.test(d.phone)) errors.push('Enter a valid phone number (10-15 digits).');
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) errors.push('Enter a valid email.');
  if (!d.consent) errors.push('Guardian consent is required.');
  if (b.type === 'admission') {
    d.child = t(b.childName, M.name); d.age = t(b.dobOrAge, M.age);
    d.program = t(b.program, 40); d.session = t(b.session, M.session); d.notes = t(b.notes, M.notes);
    if (d.child.length < 2) errors.push("Child's name is required.");
    if (!d.age) errors.push("Child's date of birth or age is required.");
    if (CONFIG.PROGRAMS.indexOf(d.program) < 0) errors.push('Select a valid program.');
    if (!d.session) errors.push('Select an admission session.');
    if (String(b.notes || '').length > M.notes) errors.push('Notes are too long.');
  } else {
    d.category = t(b.category, 40); d.message = t(b.message, M.message);
    if (CONFIG.CATEGORIES.indexOf(d.category) < 0) errors.push('Select a valid topic.');
    if (!d.message) errors.push('Message is required.');
    if (String(b.message || '').length > M.message) errors.push('Message is too long.');
  }
  return { errors: errors, data: d };
}

/** Neutralize spreadsheet formulas (=, +, -, @) and control characters. */
function safe_(s) {
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function saveAdmission_(d) {
  const id = nextId_('ADM');
  sheet_(CONFIG.ADMISSIONS_SHEET).appendRow([id, new Date(), d.parent, d.child, d.age, d.program, "'" + d.phone, d.email, d.session, d.notes, 'Yes', 'New']);
  return id;
}
function saveEnquiry_(d) {
  const id = nextId_('ENQ');
  sheet_(CONFIG.ENQUIRIES_SHEET).appendRow([id, new Date(), d.parent, "'" + d.phone, d.email, d.category, d.message, 'Yes', 'New']);
  return id;
}

/** e.g. ADM-20260301-0007. Call only while holding the lock. */
function nextId_(prefix) {
  const p = PropertiesService.getScriptProperties(), key = 'seq_' + prefix;
  const n = Number(p.getProperty(key) || 0) + 1;
  p.setProperty(key, String(n));
  return prefix + '-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-' + ('000' + n).slice(-4);
}

/**
 * Connects to Google Sheet with automatic creation fallback:
 * 1. Checks PropertiesService for already created/saved sheet
 * 2. Checks if opened from a Sheet (getActiveSpreadsheet)
 * 3. Checks CONFIG.SPREADSHEET_ID
 * 4. Otherwise creates a brand new Sheet in Google Drive automatically!
 */
function getSpreadsheet_() {
  const p = PropertiesService.getScriptProperties();

  // 1. Saved sheet
  const savedId = p.getProperty('AUTO_SHEET_ID');
  if (savedId) {
    try {
      const ss = SpreadsheetApp.openById(savedId);
      initTabs_(ss);
      return ss;
    } catch (_) {}
  }

  // 2. Bound script
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) {
      p.setProperty('AUTO_SHEET_ID', active.getId());
      initTabs_(active);
      return active;
    }
  } catch (_) {}

  // 3. Configured ID or URL
  const raw = CONFIG.SPREADSHEET_ID;
  if (raw && raw !== 'PASTE_YOUR_SPREADSHEET_ID' && String(raw).trim() !== '') {
    const match = String(raw).match(/\/d\/([a-zA-Z0-9_-]+)/);
    const id = match ? match[1] : String(raw).trim();
    try {
      const ss = SpreadsheetApp.openById(id);
      p.setProperty('AUTO_SHEET_ID', id);
      initTabs_(ss);
      return ss;
    } catch (err) {
      throw new Error('Cannot open Google Sheet ID "' + id + '": ' + err.message);
    }
  }

  // 4. Automatic Sheet Creation in Google Drive
  try {
    const ss = SpreadsheetApp.create('WonderSprout School Submissions');
    initTabs_(ss);
    p.setProperty('AUTO_SHEET_ID', ss.getId());
    return ss;
  } catch (err) {
    throw new Error('Auto-creating Google Sheet failed: ' + err.message);
  }
}

function initTabs_(ss) {
  [[CONFIG.ADMISSIONS_SHEET, HEADERS.Admissions], [CONFIG.ENQUIRIES_SHEET, HEADERS.Enquiries]].forEach(function(x) {
    const sh = ss.getSheetByName(x[0]) || ss.insertSheet(x[0]);
    if (sh.getLastRow() === 0) {
      sh.appendRow(x[1]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, x[1].length).setFontWeight('bold');
    }
  });
}

function sheet_(name) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Sheet tab "' + name + '" is missing.');
  return sh;
}

/** Simple abuse protection: max N submissions/hour per phone (hashed in cache). */
function rateOk_(phone) {
  const cache = CacheService.getScriptCache();
  const key = 'rl_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, phone));
  const n = Number(cache.get(key) || 0);
  if (n >= CONFIG.RATE_LIMIT_PER_HOUR) return false;
  cache.put(key, String(n + 1), 3600);
  return true;
}

/** Optional email. Returns true/false/null(disabled). */
function notify_(type, id, d) {
  if (!CONFIG.NOTIFY_ENABLED || !CONFIG.NOTIFY_EMAIL) return null;
  const lines = type === 'admission'
    ? ['Parent: ' + d.parent, 'Child: ' + d.child, 'Age/DOB: ' + d.age, 'Program: ' + d.program, 'Session: ' + d.session, 'Phone: ' + d.phone, 'Email: ' + d.email, 'Notes: ' + d.notes]
    : ['Name: ' + d.parent, 'Phone: ' + d.phone, 'Email: ' + d.email, 'Topic: ' + d.category, 'Message: ' + d.message];
  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, '[WonderSprout] New ' + type + ' ' + id, lines.join('\n') + '\n\nView it in the Google Sheet.');
  return true;
}

/** Manual setup (optional — getSpreadsheet_ sets up tabs automatically now). */
function setup() {
  const ss = getSpreadsheet_();
  initTabs_(ss);
  console.log('Setup complete. Sheet URL: ' + ss.getUrl());
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
