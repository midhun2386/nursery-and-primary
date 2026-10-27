const API_URL = 'https://script.google.com/macros/s/AKfycbyXKfjwFGxPNfY8OYg2waU598Bi9s-nlKRND7htX1qEyZ8dff1-Akxiaxjkb4KVlogB/exec';
const busy = new Set();

/**
 * Sends text/plain (a CORS "simple request": no preflight, which Apps Script cannot answer).
 * Apps Script replies via a 302 redirect; fetch follows it and the final response carries
 * Access-Control-Allow-Origin: *, so the JSON is readable and success can be truly confirmed.
 */
async function submitForm(form, type, mapFn) {
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  if (busy.has(form.id)) return;                       // block repeat submits
  const status = form.querySelector('.status'), btn = form.querySelector('button[type=submit]');
  const setStatus = (msg, cls) => { status.textContent = msg; status.className = 'status ' + (cls || ''); };
  busy.add(form.id); btn.disabled = true; setStatus('Sending… ⏳', 'loading');
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const f = Object.fromEntries(new FormData(form));
    const res = await fetch(API_URL, {
      method: 'POST', redirect: 'follow', signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ type: type, consent: form.consent.checked, website: f.website || '' }, mapFn(f)))
    });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || 'Submission failed.');
    form.reset();                                      // reset ONLY after confirmed save
    setStatus('Thank you! 🎉 Reference: ' + out.id, 'ok');
  } catch (err) {                                      // form data is preserved on failure
    setStatus(err.name === 'AbortError' ? 'Request timed out. Please retry.' :
      (err instanceof TypeError ? 'Network problem. Please check your connection and retry.' : err.message), 'err');
  } finally { clearTimeout(timer); busy.delete(form.id); btn.disabled = false; }
}

document.getElementById('admissionForm').addEventListener('submit', e => {
  e.preventDefault();
  submitForm(e.target, 'admission', f => ({ parentName: f.parentName, childName: f.childName, dobOrAge: f.dobOrAge, program: f.program, phone: f.phone, email: f.email, session: f.session, notes: f.notes }));
});
document.getElementById('enquiryForm').addEventListener('submit', e => {
  e.preventDefault();
  submitForm(e.target, 'enquiry', f => ({ parentName: f.parentName, phone: f.phone, email: f.email, category: f.category, message: f.message }));
});

// Mobile navigation toggle
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');
if (navToggle && navMenu) {
  navToggle.addEventListener('click', () => {
    const isOpen = navMenu.classList.toggle('open');
    navToggle.classList.toggle('open', isOpen);
    navToggle.setAttribute('aria-expanded', isOpen);
  });
  navMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navMenu.classList.remove('open');
      navToggle.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

