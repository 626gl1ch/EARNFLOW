/**
 * App bootstrap: decides whether to show the landing page or the dashboard,
 * and wires up the landing page's static CTAs.
 *
 * Antigravity: replace the stubbed auth check with real Supabase Auth
 * (supabase.auth.onAuthStateChange), following the same pattern already
 * used in SnipeJob's index.html.
 */

const CATEGORY_PREVIEW = [
  { slug: 'watch_ads', name: 'Watch & Earn', desc: 'Short rewarded video ads.' },
  { slug: 'captcha', name: 'Captcha Tasks', desc: 'Quick, easy, pays fast.' },
  { slug: 'cpa', name: 'App & Offer Installs', desc: 'Try an app, get paid.' },
  { slug: 'survey', name: 'Surveys', desc: 'Share your opinion for cash.' },
  { slug: 'testing', name: 'Software Testing', desc: 'Test new apps, report back.' },
  { slug: 'download', name: 'Download & Earn', desc: 'Install games and software.' },
  { slug: 'ppc', name: 'Pay-Per-Call', desc: 'Take a quick call, get paid.' },
  { slug: 'referral', name: 'Referrals', desc: 'Earn from friends you invite.' },
  { slug: 'microtask', name: 'Micro-Tasks', desc: 'Small data/labeling jobs.' },
  { slug: 'social', name: 'Social Tasks', desc: 'Follow, like, earn.' },
  { slug: 'streak', name: 'Daily Streak', desc: 'Log in daily for bonuses.' },
  { slug: 'sponsored_video', name: 'Sponsored Video', desc: 'Longer videos, bigger payouts.' },
];

function renderCategoryPreview() {
  const grid = document.getElementById('ef-category-preview');
  if (!grid) return;
  grid.innerHTML = CATEGORY_PREVIEW.map(
    (c) => `
    <div class="ef-card" style="cursor: pointer;" onclick="showAuthModal('signup')">
      <div class="cat">${c.slug.replace('_', ' ')}</div>
      <h3>${c.name}</h3>
      <p style="opacity:0.75;font-size:0.9rem;">${c.desc}</p>
    </div>`
  ).join('');
}

let authMode = 'signup'; // 'signup' | 'login'

function showAuthModal(mode = 'signup') {
  authMode = mode;
  const modal = document.getElementById('ef-auth-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  const title = document.getElementById('auth-title');
  const submit = document.getElementById('btn-auth-submit');
  const groupName = document.getElementById('group-display-name');
  const groupRef = document.getElementById('group-referral');
  const toggle = document.getElementById('auth-toggle');

  if (authMode === 'signup') {
    title.innerText = 'Sign Up';
    submit.innerText = 'Create Account';
    if (groupName) groupName.style.display = 'flex';
    if (groupRef) groupRef.style.display = 'flex';
    toggle.innerText = 'Already have an account? Log in';
  } else {
    title.innerText = 'Log In';
    submit.innerText = 'Log In';
    if (groupName) groupName.style.display = 'none';
    if (groupRef) groupRef.style.display = 'none';
    toggle.innerText = "Don't have an account? Sign up";
  }
}

function wireLandingCtas() {
  document.getElementById('btn-signup')?.addEventListener('click', () => showAuthModal('signup'));
  document.getElementById('btn-hero-signup')?.addEventListener('click', () => showAuthModal('signup'));
  document.getElementById('btn-login')?.addEventListener('click', () => showAuthModal('login'));
  document.getElementById('btn-how')?.addEventListener('click', () => {
    document.getElementById('ef-category-preview')?.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('btn-close-auth')?.addEventListener('click', () => {
    document.getElementById('ef-auth-modal').style.display = 'none';
  });

  document.getElementById('auth-toggle')?.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthModal(authMode === 'signup' ? 'login' : 'signup');
  });

  document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const displayName = document.getElementById('auth-display-name')?.value || '';
    const referral = document.getElementById('auth-referral')?.value || '';

    const submitBtn = document.getElementById('btn-auth-submit');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Please wait...';

    const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8787'
      : 'https://earnflow-api.daniellancce1.workers.dev';

    try {
      if (authMode === 'signup') {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName,
            }
          }
        });
        if (error) throw error;
        
        const session = data.session || (await sb.auth.getSession()).data.session;
        if (session) {
          // Call post-signup risk check on worker
          const res = await fetch(`${API_BASE}/api/auth/post-signup`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ referral_code: referral || null })
          });
          const resData = await res.json();
          if (resData.error === 'signup_blocked') {
            await sb.auth.signOut();
            throw new Error('Access blocked: High risk IP detected.');
          }
        } else {
          alert('Account created! Please check your email to verify and log in.');
          document.getElementById('ef-auth-modal').style.display = 'none';
          return;
        }
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const session = data.session;
        if (session) {
          // Call login risk check on worker
          const checkRes = await fetch(`${API_BASE}/api/auth/login-check`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            }
          });
          const checkData = await checkRes.json();
          if (checkData.error === 'login_blocked') {
            await sb.auth.signOut();
            throw new Error('Access blocked: High risk IP detected.');
          }
        }
      }
      document.getElementById('ef-auth-modal').style.display = 'none';
    } catch (err) {
      alert(err.message || 'Authentication failed');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = authMode === 'signup' ? 'Create Account' : 'Log In';
    }
  });
}

function boot() {
  renderCategoryPreview();
  wireLandingCtas();

  if (sb) {
    sb.auth.onAuthStateChange(async (event, session) => {
      const isLoggedIn = !!session;
      document.getElementById('ef-landing').style.display = isLoggedIn ? 'none' : 'block';
      document.getElementById('ef-app').style.display = isLoggedIn ? 'grid' : 'none';

      if (isLoggedIn && window.EFDashboard) {
        window.EFDashboard.init();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', boot);
