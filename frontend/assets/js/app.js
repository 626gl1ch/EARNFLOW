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
    <div class="ef-card">
      <div class="cat">${c.slug.replace('_', ' ')}</div>
      <h3>${c.name}</h3>
      <p style="opacity:0.75;font-size:0.9rem;">${c.desc}</p>
    </div>`
  ).join('');
}

function wireLandingCtas() {
  const goToAuth = (mode) => {
    // Antigravity: open the real signup/login modal here.
    console.log(`open auth modal: ${mode}`);
  };
  document.getElementById('btn-signup')?.addEventListener('click', () => goToAuth('signup'));
  document.getElementById('btn-hero-signup')?.addEventListener('click', () => goToAuth('signup'));
  document.getElementById('btn-login')?.addEventListener('click', () => goToAuth('login'));
  document.getElementById('btn-how')?.addEventListener('click', () => {
    document.getElementById('ef-category-preview')?.scrollIntoView({ behavior: 'smooth' });
  });
}

function boot() {
  renderCategoryPreview();
  wireLandingCtas();

  const isLoggedIn = !!window.__efSession; // Antigravity: replace with real session check
  document.getElementById('ef-landing').style.display = isLoggedIn ? 'none' : 'block';
  document.getElementById('ef-app').style.display = isLoggedIn ? 'grid' : 'none';

  if (isLoggedIn && window.EFDashboard) {
    window.EFDashboard.init();
  }
}

document.addEventListener('DOMContentLoaded', boot);
