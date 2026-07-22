/**
 * Dashboard controller — EarnFlow v2
 *
 * NEW in this version:
 *   - Earnings Tracker card: per-category breakdown of how much you've earned
 *   - Pending balance display (CPA tasks in confirmation window)
 *   - Completed tasks auto-removed from feed with animated slide-out
 *   - ✕ dismiss button on completed task cards in the feed
 *   - /api/tasks/history — tabular completed task history with status badges
 *   - /api/tasks/earnings-by-category — live earnings data per earning method
 */

const EFDashboard = {
  activeTab: 'dashboard',
  userProfile: null,
  activeCompletionId: null,

  // Track which task IDs have been completed this session so we can auto-remove them
  _sessionCompletedTaskIds: new Set(),

  async init() {
    this.setupTabNavigation();
    this.setupModalListeners();
    this.setupWithdrawalFlow();

    try {
      const session = await getSupabaseSession();
      if (!session) return;
      const { data: profile } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
      this.userProfile = profile;
      
      const sidebarName = document.getElementById('sidebar-name');
      const sidebarTier = document.getElementById('sidebar-tier');
      const sidebarAvatar = document.getElementById('sidebar-avatar');
      if (sidebarName && profile) {
        sidebarName.innerText = profile.display_name || 'User';
        if (sidebarTier) sidebarTier.innerText = profile.tier || 'BRONZE';
        if (sidebarAvatar) sidebarAvatar.innerText = (profile.display_name || 'U').charAt(0).toUpperCase();
      }
    } catch (e) {
      console.error('Failed to load user profile', e);
    }

    await Promise.all([this.loadWallet(), this.loadActiveTabContent()]);
  },

  // ───────────────────────────── Tab Navigation ──────────────────────────────

  setupTabNavigation() {
    const allNavLinks = document.querySelectorAll('.ef-nav a, .ef-mobile-nav a');
    allNavLinks.forEach(link => {
      const newLink = link.cloneNode(true);
      link.parentNode.replaceChild(newLink, link);

      newLink.addEventListener('click', (e) => {
        e.preventDefault();
        const href = newLink.getAttribute('href');
        const tab = href.replace('#/', '');
        this.activeTab = tab;

        document.querySelectorAll('.ef-nav a, .ef-mobile-nav a').forEach(l => {
          l.classList.toggle('active', l.getAttribute('href') === href);
        });

        this.loadActiveTabContent();
      });
    });
  },

  // ───────────────────────────── Modal Listeners ─────────────────────────────

  setupModalListeners() {
    document.getElementById('btn-close-captcha')?.addEventListener('click', () => {
      document.getElementById('ef-captcha-modal').style.display = 'none';
      this.activeCompletionId = null;
    });

    document.getElementById('btn-close-withdrawal')?.addEventListener('click', () => {
      document.getElementById('ef-withdrawal-modal').style.display = 'none';
    });

    document.getElementById('captcha-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const solution = document.getElementById('captcha-input').value;
      if (!this.activeCompletionId) return;

      const submitBtn = document.getElementById('btn-captcha-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.innerText = 'Verifying...'; }

      try {
        await EF.submitCompletion(this.activeCompletionId, { solution });
        this._showToast('✅ Captcha solved! Earnings added to your wallet.', 'success');
        document.getElementById('ef-captcha-modal').style.display = 'none';
        document.getElementById('captcha-input').value = '';
        this.activeCompletionId = null;
        await Promise.all([this.loadWallet(), this.loadActiveTabContent()]);
      } catch (err) {
        this._showToast(err.message || 'Verification failed. Try again.', 'error');
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Submit & Earn'; }
      }
    });

    // Support enter key natively without requiring explicit form submit click
    document.getElementById('captcha-input')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('captcha-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    });
  },

  // ───────────────────────────── Wallet Header ───────────────────────────────

  async loadWallet() {
    try {
      const wallet = await EF.getWallet();
      const formatted = (wallet.balance_minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
      animateBalance(formatted);

      const currencySymbols = { 'NGN': '₦', 'USD': '$', 'GHS': 'GH₵', 'KES': 'KSh' };
      const symbol = currencySymbols[wallet.currency] || wallet.currency;
      const curEl = document.getElementById('ef-currency');
      if (curEl) curEl.innerText = symbol;

      // Show pending balance if any
      const pendingEl = document.getElementById('ef-pending-balance');
      if (pendingEl && wallet.pending_minor > 0) {
        const pendingFormatted = (wallet.pending_minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
        pendingEl.innerHTML = `<span style="font-size:0.82rem;opacity:0.75;font-family:var(--font-mono);">⏳ Pending: ${symbol}${pendingFormatted}</span>`;
        pendingEl.style.display = 'block';
      } else if (pendingEl) {
        pendingEl.style.display = 'none';
      }
    } catch (e) {
      console.error('Failed to load wallet', e);
    }
  },

  // ─────────────────────────── Tab Content Router ────────────────────────────

  async loadActiveTabContent() {
    const mainCol = document.querySelector('.ef-main');
    if (!mainCol) return;

    const previousView = mainCol.querySelector('.ef-view-content');
    if (previousView) previousView.remove();

    const viewContent = document.createElement('div');
    viewContent.className = 'ef-view-content ef-reveal';

    if (this.activeTab === 'dashboard') {
      viewContent.innerHTML = this._renderDashboardShell();
      mainCol.appendChild(viewContent);
      await Promise.all([this.loadFeed('dashboard'), this.loadEarningsTracker()]);

    } else if (this.activeTab === 'tasks') {
      viewContent.innerHTML = `
        <h3 style="font-family:var(--font-display);color:#fff;margin-top:20px;">Tasks</h3>
        <p style="opacity:0.7;font-size:0.9rem;margin-bottom:20px;">Complete captcha solving, streaks, or app test gigs.</p>
        <div class="ef-grid" id="ef-task-feed">Loading tasks...</div>
      `;
      mainCol.appendChild(viewContent);
      await this.loadFeed('tasks');

    } else if (this.activeTab === 'offers') {
      viewContent.innerHTML = `
        <h3 style="font-family:var(--font-display);color:#fff;margin-top:20px;">Offerwalls</h3>
        <p style="opacity:0.7;font-size:0.9rem;margin-bottom:20px;">CPA app installs, registrations, and cost-per-action offers. Earnings confirmed within 24–48hrs.</p>
        <div class="ef-grid" id="ef-task-feed">Loading offers...</div>
      `;
      mainCol.appendChild(viewContent);
      await this.loadFeed('offers');

    } else if (this.activeTab === 'surveys') {
      viewContent.innerHTML = `
        <h3 style="font-family:var(--font-display);color:#fff;margin-top:20px;">Paid Surveys</h3>
        <p style="opacity:0.7;font-size:0.9rem;margin-bottom:20px;">Take market research surveys to get paid.</p>
        <div class="ef-grid" id="ef-survey-tasks" style="margin-bottom:30px;">Loading surveys...</div>
        <h4 style="font-family:var(--font-display);color:#fff;margin-bottom:15px;">Survey Routers</h4>
        <div class="ef-grid" id="ef-survey-widgets"></div>
      `;
      mainCol.appendChild(viewContent);
      await this.loadSurveys();

    } else if (this.activeTab === 'history') {
      viewContent.innerHTML = `
        <h3 style="font-family:var(--font-display);color:#fff;margin-top:20px;">Completed Tasks & Earnings History</h3>
        <p style="opacity:0.7;font-size:0.9rem;margin-bottom:16px;">Track every task you've completed, how much you've earned from each, and your current status.</p>
        <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
          <button class="ef-btn ef-btn-primary ef-history-filter active" data-status="paid" style="padding:8px 18px;font-size:0.85rem;">✅ Paid</button>
          <button class="ef-btn ef-btn-ghost ef-history-filter" data-status="pending,pending_confirmation" style="padding:8px 18px;font-size:0.85rem;">⏳ Pending</button>
          <button class="ef-btn ef-btn-ghost ef-history-filter" data-status="rejected" style="padding:8px 18px;font-size:0.85rem;">❌ Rejected</button>
          <button class="ef-btn ef-btn-ghost ef-history-filter" data-status="all" style="padding:8px 18px;font-size:0.85rem;">All</button>
        </div>
        <div id="ef-history-container" class="ef-table-wrapper">
          <p style="padding:20px;opacity:0.6;">Loading history...</p>
        </div>
      `;
      mainCol.appendChild(viewContent);
      await this.loadCompletedTasksTable('paid');

      // History filter tabs
      viewContent.querySelectorAll('.ef-history-filter').forEach(btn => {
        btn.addEventListener('click', async () => {
          viewContent.querySelectorAll('.ef-history-filter').forEach(b => {
            b.classList.remove('active', 'ef-btn-primary');
            b.classList.add('ef-btn-ghost');
          });
          btn.classList.add('active', 'ef-btn-primary');
          btn.classList.remove('ef-btn-ghost');
          await this.loadCompletedTasksTable(btn.dataset.status);
        });
      });

    } else if (this.activeTab === 'withdraw') {
      viewContent.innerHTML = `
        <h3 style="font-family:var(--font-display);color:#fff;margin-top:20px;">Withdraw Funds</h3>
        <div class="ef-card" style="max-width:500px;margin-top:20px;cursor:default;">
          <h4 style="font-family:var(--font-display);margin-bottom:8px;color:#fff;">Cash Out via Paystack</h4>
          <p style="font-size:0.9rem;opacity:0.8;margin-bottom:20px;">Minimum payout is 1,000 NGN. Funds are batched and paid out automatically.</p>
          <button class="ef-btn ef-btn-primary" id="btn-trigger-withdraw">Initiate Payout</button>
        </div>
      `;
      mainCol.appendChild(viewContent);
      document.getElementById('btn-trigger-withdraw')?.addEventListener('click', () => {
        document.getElementById('ef-withdrawal-modal').style.display = 'flex';
      });

    } else if (this.activeTab === 'referrals') {
      const code = this.userProfile?.referral_code || '------';
      const refLink = `${window.location.origin}?ref=${code}`;
      viewContent.innerHTML = `
        <h3 style="font-family:var(--font-display);color:#fff;margin-top:20px;">Referrals</h3>
        <div class="ef-card" style="max-width:600px;margin-top:20px;cursor:default;">
          <h4 style="font-family:var(--font-display);margin-bottom:8px;color:#fff;">Invite Friends. Earn 10%.</h4>
          <p style="font-size:0.9rem;opacity:0.8;margin-bottom:20px;">Share your link and earn 10% of your friends' task earnings during their first 30 days.</p>
          <div class="ef-form-group">
            <label>Your Referral Link</label>
            <div style="display:flex;gap:10px;">
              <input type="text" readonly value="${refLink}" style="font-family:var(--font-mono);background:#000;" />
              <button class="ef-btn ef-btn-primary" id="btn-copy-ref" style="padding:10px 20px;border-radius:8px;">Copy</button>
            </div>
          </div>
        </div>
      `;
      mainCol.appendChild(viewContent);
      document.getElementById('btn-copy-ref')?.addEventListener('click', () => {
        navigator.clipboard.writeText(refLink);
        this._showToast('Referral link copied!', 'success');
      });

    } else if (this.activeTab === 'profile') {
      viewContent.innerHTML = `
        <h3 style="font-family:var(--font-display);color:#fff;margin-top:20px;">My Profile</h3>
        <div class="ef-card" style="max-width:500px;margin-top:20px;cursor:default;">
          <h4 style="font-family:var(--font-display);margin-bottom:15px;color:#fff;">Account Details</h4>
          <div style="display:flex;flex-direction:column;gap:12px;font-size:0.95rem;opacity:0.9;margin-bottom:24px;">
            <div><strong>Email:</strong> <span id="profile-email">Loading...</span></div>
            <div><strong>Country:</strong> ${this.userProfile?.country_code || 'GLOBAL'} (${this.userProfile?.country_status || 'unverified'})</div>
            <div><strong>Tier:</strong> <span style="text-transform:capitalize;color:var(--gold);font-weight:600;">${this.userProfile?.tier || 'bronze'}</span></div>
          </div>
          <button class="ef-btn" id="btn-logout" style="background:var(--coral);color:#fff;">Log Out</button>
        </div>
      `;
      mainCol.appendChild(viewContent);
      const session = await getSupabaseSession();
      const emailEl = document.getElementById('profile-email');
      if (emailEl) emailEl.innerText = session?.user?.email || 'N/A';
      document.getElementById('btn-logout')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to log out?')) {
          await sb.auth.signOut();
        }
      });
    }
  },

  // ─────────────────────────── Dashboard Shell ───────────────────────────────

  _renderDashboardShell() {
    return `
      <!-- Earnings Tracker -->
      <div id="ef-earnings-tracker" style="margin-top:20px;margin-bottom:24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <h3 style="font-family:var(--font-display);color:#fff;margin:0;">Earnings by Category</h3>
          <button id="btn-refresh-earnings" class="ef-btn ef-btn-ghost" style="padding:6px 14px;font-size:0.82rem;">↻ Refresh</button>
        </div>
        <div id="ef-earnings-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;">
          <div class="ef-earnings-skeleton" style="height:90px;background:var(--ink-2);border-radius:12px;border:1px solid var(--line);animation:ef-pulse 1.5s infinite;"></div>
          <div class="ef-earnings-skeleton" style="height:90px;background:var(--ink-2);border-radius:12px;border:1px solid var(--line);animation:ef-pulse 1.5s infinite 0.2s;"></div>
          <div class="ef-earnings-skeleton" style="height:90px;background:var(--ink-2);border-radius:12px;border:1px solid var(--line);animation:ef-pulse 1.5s infinite 0.4s;"></div>
        </div>
      </div>

      <!-- Pending balance info strip -->
      <div id="ef-pending-strip" style="display:none;background:rgba(232,184,75,0.07);border:1px solid rgba(232,184,75,0.2);border-radius:10px;padding:10px 16px;margin-bottom:20px;font-size:0.88rem;color:var(--gold-soft);">
        ⏳ You have <strong id="ef-pending-strip-amount"></strong> pending confirmation from CPA/offer tasks. Funds release automatically once the advertiser confirms (24–48hrs).
      </div>

      <!-- Recommended feed -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <h3 style="font-family:var(--font-display);color:#fff;margin:0;">Recommended for you</h3>
        <button id="btn-refresh-feed" class="ef-btn ef-btn-ghost" style="padding:6px 14px;font-size:0.82rem;">↻ New Tasks</button>
      </div>
      <div class="ef-grid" id="ef-task-feed">Loading tasks...</div>
    `;
  },

  // ─────────────────────────── Earnings Tracker ──────────────────────────────

  async loadEarningsTracker() {
    const grid = document.getElementById('ef-earnings-grid');
    const pendingStrip = document.getElementById('ef-pending-strip');
    if (!grid) return;

    try {
      const res = await EF.api('/api/tasks/earnings-by-category', 'GET');
      const data = await res.json();

      // Handle pending strip
      if (pendingStrip && data.pending_minor > 0) {
        const syms = { 'NGN': '₦', 'USD': '$', 'GHS': 'GH₵', 'KES': 'KSh' };
        const sym = syms[data.currency] || data.currency;
        const pendingFmt = (data.pending_minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
        document.getElementById('ef-pending-strip-amount').innerText = `${sym}${pendingFmt}`;
        pendingStrip.style.display = 'block';
      } else if (pendingStrip) {
        pendingStrip.style.display = 'none';
      }

      if (!data.categories || data.categories.length === 0) {
        grid.innerHTML = `
          <div style="grid-column:1/-1;padding:20px 0;opacity:0.6;font-size:0.9rem;">
            No earnings yet. Complete your first task to see your breakdown here! 🚀
          </div>`;
        return;
      }

      const syms = { 'NGN': '₦', 'USD': '$', 'GHS': 'GH₵', 'KES': 'KSh' };
      const sym = syms[data.currency] || data.currency;
      const totalMinor = data.total_earned_minor || 1; // avoid div by 0

      grid.innerHTML = data.categories.map(cat => {
        const earned = (Number(cat.total_earned_minor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
        const pct = Math.round((Number(cat.total_earned_minor) / totalMinor) * 100);
        const icon = cat.category_icon || '💡';
        return `
          <div class="ef-card ef-reveal" style="cursor:default;position:relative;overflow:hidden;padding:16px;">
            <div style="font-size:1.3rem;margin-bottom:8px;">${icon}</div>
            <div class="cat">${cat.category_name || cat.category_slug}</div>
            <div style="font-family:var(--font-display);color:#fff;font-size:1.15rem;margin:6px 0;">${sym}${earned}</div>
            <div style="font-family:var(--font-mono);font-size:0.75rem;opacity:0.6;">${cat.completed_count} task${cat.completed_count !== 1 ? 's' : ''}</div>
            <!-- Progress bar -->
            <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,0.06);">
              <div style="height:100%;width:${pct}%;background:var(--gold);border-radius:2px;transition:width 0.8s ease;"></div>
            </div>
          </div>`;
      }).join('');

      // Bind refresh button
      document.getElementById('btn-refresh-earnings')?.addEventListener('click', () => {
        this.loadEarningsTracker();
      });

      // Bind feed refresh button
      document.getElementById('btn-refresh-feed')?.addEventListener('click', () => {
        const feedGrid = document.getElementById('ef-task-feed');
        if (feedGrid) feedGrid.innerHTML = 'Refreshing...';
        this.loadFeed('dashboard');
      });

    } catch (e) {
      grid.innerHTML = `<div style="grid-column:1/-1;opacity:0.5;font-size:0.85rem;">Could not load earnings tracker.</div>`;
      console.error('[EarningsTracker]', e);
    }
  },

  // ─────────────────────────── Task Feed ─────────────────────────────────────

  async loadFeed(type) {
    const grid = document.getElementById('ef-task-feed');
    if (!grid) return;
    grid.innerHTML = '<p style="opacity:0.5;grid-column:1/-1;font-size:0.9rem;">Loading tasks...</p>';

    try {
      let data;
      if (type === 'offers') {
        data = await EF.getOffers();
      } else {
        data = await EF.getFeed(1);
        if (type === 'tasks') {
          data.items = (data.items || []).filter(t => !['cpa','ppc','download','survey'].includes(t.task_categories?.slug));
        }
      }

      // Filter out tasks the user has already completed this session
      const items = (data.items || []).filter(t => !this._sessionCompletedTaskIds.has(t.id));

      if (!items.length) {
        grid.innerHTML = `<p style="opacity:0.6;grid-column:1/-1;">No tasks available right now. Check back soon — new offers are added daily!</p>`;
        return;
      }

      grid.innerHTML = items.map(t => this.renderCard(t)).join('');
      grid.querySelectorAll('.ef-card[data-task-id]').forEach(card => {
        card.addEventListener('click', (e) => {
          this.startTask(card.dataset.taskId);
        });
      });
    } catch (e) {
      grid.innerHTML = `<p style="opacity:0.6;grid-column:1/-1;">Failed to load feed. Please reload.</p>`;
      console.error(e);
    }
  },

  async loadSurveys() {
    const taskGrid = document.getElementById('ef-survey-tasks');
    const widgetGrid = document.getElementById('ef-survey-widgets');
    if (!taskGrid || !widgetGrid) return;

    try {
      const data = await EF.getSurveys();

      if (data.tasks && data.tasks.length) {
        taskGrid.innerHTML = data.tasks.map(t => this.renderCard(t)).join('');
        taskGrid.querySelectorAll('.ef-card[data-task-id]').forEach(card => {
          card.addEventListener('click', (e) => {
            this.startTask(card.dataset.taskId);
          });
        });
      } else {
        taskGrid.innerHTML = `<p style="opacity:0.6;grid-column:1/-1;">No direct survey tasks available right now.</p>`;
      }

      if (data.widgets && data.widgets.length) {
        widgetGrid.innerHTML = data.widgets.map(w => `
          <div class="ef-card" onclick="window.open('${w.url}', '_blank', 'width=800,height=600')">
            <div class="cat">widget router</div>
            <h3>Open ${w.provider.replace('_', ' ').toUpperCase()}</h3>
            <p style="opacity:0.7;font-size:0.85rem;">Take unlimited surveys. Rates match dynamic aggregator payout.</p>
          </div>
        `).join('');
      } else {
        widgetGrid.innerHTML = `<p style="opacity:0.6;grid-column:1/-1;">No survey routers configured.</p>`;
      }
    } catch (e) {
      taskGrid.innerHTML = `<p style="opacity:0.6;grid-column:1/-1;">Failed to load surveys.</p>`;
      console.error(e);
    }
  },

  // ─────────────────────────── Card Renderer ─────────────────────────────────

  renderCard(task) {
    const payout = (task.payout_minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    const symbols = { 'NGN': '₦', 'USD': '$' };
    const curPrefix = symbols[task.currency] || '';
    const isExternal = ['cpa','ppc','download','survey'].includes(task.task_categories?.slug);
    const confirmNote = isExternal
      ? `<div style="font-size:0.75rem;opacity:0.5;margin-top:6px;font-family:var(--font-mono);">⏳ ~24–48hr confirmation</div>`
      : '';

    return `
      <div class="ef-card ef-reveal" data-task-id="${task.id}" style="position:relative;">
        <div class="cat">${task.task_categories?.name || ''}</div>
        <h3>${task.title}</h3>
        <p style="font-size:0.85rem;opacity:0.8;margin:8px 0;max-height:40px;overflow:hidden;text-overflow:ellipsis;">${task.description || ''}</p>
        <div class="payout">${curPrefix}${payout}</div>
        ${confirmNote}
      </div>`;
  },

  // ─────────────────────────── Start Task ────────────────────────────────────

  async startTask(taskId) {
    try {
      const res = await EF.startTask(taskId);
      const completionId = res.completion_id;

      if (res.captcha) {
        this.activeCompletionId = completionId;
        document.getElementById('captcha-challenge-text').innerText = res.captcha;
        document.getElementById('ef-captcha-modal').style.display = 'flex';
        document.getElementById('captcha-input').focus();
        return;
      }

      const { data: task } = await sb
        .from('tasks')
        .select('*, task_categories(slug)')
        .eq('id', taskId)
        .single();

      if (task?.task_categories?.slug === 'streak') {
        await EF.submitCompletion(completionId, { check_in: true });
        this._showToast('🔥 Daily check-in complete! Streak bonus added.', 'success');
        this._removeTaskFromFeed(taskId);
        this._sessionCompletedTaskIds.add(taskId);
        await Promise.all([this.loadWallet(), this.loadEarningsTracker()]);
        return;
      }

      const isThirdParty = ['cpa', 'ppc', 'download'].includes(task?.task_categories?.slug);
      if (isThirdParty && task.instructions) {
        let url = task.instructions;
        url += url.includes('?') ? `&subid=${completionId}` : `?subid=${completionId}`;
        window.open(url, '_blank');
        this._showToast('✅ Offer opened! Complete it to earn. Payout arrives within 24–48hrs once confirmed.', 'info', 5000);
        // Mark as "started" — track for this session so it floats to bottom
        this._sessionCompletedTaskIds.add(taskId);
        this._dimTaskCard(taskId, 'Started — awaiting confirmation');
        
        // Silently refresh wallet and history if visible
        await Promise.all([this.loadWallet(), this.loadEarningsTracker()]);
        const histContainer = document.getElementById('ef-history-container');
        if (histContainer) {
          const activeFilter = document.querySelector('.ef-history-filter.active');
          const status = activeFilter ? activeFilter.dataset.status : 'paid';
          this.loadCompletedTasksTable(status);
        }
      } else {
        this._showToast('Task started! Completion ID: ' + completionId, 'info');
      }
    } catch (e) {
      this._showToast(e.message || 'Could not start this task right now.', 'error');
    }
  },

  // ─────────────────────────── Completed Tasks History ──────────────────────

  async loadCompletedTasksTable(status = 'paid', page = 1) {
    const container = document.getElementById('ef-history-container');
    if (!container) return;
    container.innerHTML = '<p style="padding:20px;opacity:0.6;">Loading...</p>';

    try {
      const res = await EF.api(`/api/tasks/history?status=${status}&page=${page}`, 'GET');
      const data = await res.json();

      const completions = data.completions || [];
      if (!completions.length) {
        container.innerHTML = `<p style="padding:20px;opacity:0.6;">No ${status === 'all' ? '' : status + ' '}tasks found.</p>`;
        return;
      }

      const syms = { 'NGN': '₦', 'USD': '$', 'GHS': 'GH₵', 'KES': 'KSh' };

      const statusBadge = (s) => {
        const badges = {
          paid: '<span style="color:var(--gold);font-weight:600;">✅ Paid</span>',
          pending_confirmation: '<span style="color:#88b;font-weight:600;">⏳ Pending</span>',
          pending: '<span style="opacity:0.6;">🔄 In Progress</span>',
          rejected: '<span style="color:var(--coral);">❌ Rejected</span>',
          flagged: '<span style="color:var(--coral);">🚩 Flagged</span>',
        };
        return badges[s] || `<span>${s}</span>`;
      };

      const rows = completions.map(c => {
        const task = c.tasks || {};
        const cat  = task.task_categories || {};
        const sym  = syms[task.currency] || task.currency;
        const earned = task.payout_minor
          ? `${sym}${(task.payout_minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
          : '—';

        const date = c.paid_at || c.completed_at || c.started_at;
        const dateStr = date ? new Date(date).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }) : '—';

        const pendingNote = c.status === 'pending_confirmation' && c.confirmed_at
          ? `<br><span style="font-size:0.75rem;opacity:0.5;">Releases ${new Date(c.confirmed_at).toLocaleDateString()}</span>`
          : '';

        return `
          <tr>
            <td style="font-family:var(--font-mono);font-size:0.78rem;opacity:0.5;">${c.id.slice(0,8)}…</td>
            <td>
              <strong style="color:#fff;">${task.title || '—'}</strong>
              <div class="cat" style="margin-top:4px;">${cat.icon || ''} ${cat.name || cat.slug || task.provider || ''}</div>
            </td>
            <td style="font-family:var(--font-mono);color:var(--gold-soft);font-weight:600;">${earned}</td>
            <td>${statusBadge(c.status)}${pendingNote}</td>
            <td style="font-size:0.82rem;opacity:0.75;">${dateStr}</td>
          </tr>`;
      }).join('');

      container.innerHTML = `
        <table class="ef-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Task</th>
              <th>Earned</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>${rows}          </tbody>
        </table>
        ${data.pages > 1 ? `
          <div style="padding:12px 18px; display:flex; gap:10px; align-items:center;">
            <button class="ef-btn ef-btn-ghost" onclick="window.EFDashboard.loadCompletedTasksTable('${status}', ${data.page - 1})" ${data.page <= 1 ? 'disabled' : ''} style="padding:4px 10px;font-size:0.8rem;">Prev</button>
            <span style="opacity:0.6;font-size:0.82rem;">Page ${data.page} of ${data.pages} · ${data.total} total</span>
            <button class="ef-btn ef-btn-ghost" onclick="window.EFDashboard.loadCompletedTasksTable('${status}', ${data.page + 1})" ${data.page >= data.pages ? 'disabled' : ''} style="padding:4px 10px;font-size:0.8rem;">Next</button>
          </div>
        ` : ''}
      `;
    } catch (e) {
      container.innerHTML = `<p style="padding:20px;color:var(--coral);">Failed to load task history.</p>`;
      console.error(e);
    }
  },

  // ─────────────────────────── Withdrawal Flow ───────────────────────────────

  setupWithdrawalFlow() {
    let resolvedRecipient = null;

    const methodSelect = document.getElementById('withdraw-method-select');
    const paystackFields = document.getElementById('withdraw-paystack-fields');
    const cryptoFields = document.getElementById('withdraw-crypto-fields');
    const verifyBtn = document.getElementById('btn-withdraw-verify');
    const submitBtn = document.getElementById('btn-withdraw-submit');
    const groupName = document.getElementById('group-resolved-name');
    const nameBox = document.getElementById('resolved-account-name');

    methodSelect?.addEventListener('change', () => {
      const isCrypto = methodSelect.value === 'crypto_usdt';
      if (isCrypto) {
        paystackFields.style.display = 'none';
        cryptoFields.style.display = 'block';
        verifyBtn.style.display = 'none';
        submitBtn.style.display = 'block';
      } else {
        paystackFields.style.display = 'block';
        cryptoFields.style.display = 'none';
        if (resolvedRecipient) {
          verifyBtn.style.display = 'none';
          submitBtn.style.display = 'block';
        } else {
          verifyBtn.style.display = 'block';
          submitBtn.style.display = 'none';
        }
      }
    });

    verifyBtn?.addEventListener('click', async () => {
      const bankCode = document.getElementById('withdraw-bank').value;
      const accountNum = document.getElementById('withdraw-account').value;
      if (!bankCode || accountNum.length !== 10) {
        this._showToast('Please select a bank and enter a valid 10-digit account number.', 'error');
        return;
      }
      verifyBtn.disabled = true;
      verifyBtn.innerText = 'Verifying...';
      try {
        const res = await EF.resolveAccount({ bank_code: bankCode, account_number: accountNum });
        if (res.status && res.data) {
          resolvedRecipient = res.data;
          nameBox.innerText = res.data.account_name;
          groupName.style.display = 'flex';
          verifyBtn.style.display = 'none';
          submitBtn.style.display = 'block';
        } else {
          this._showToast(res.message || 'Verification failed. Please check your account details.', 'error');
          nameBox.innerText = '';
          groupName.style.display = 'none';
        }
      } catch (e) {
        this._showToast('Failed to resolve account: ' + e.message, 'error');
        nameBox.innerText = '';
        groupName.style.display = 'none';
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.innerText = 'Verify Bank Account';
      }
    });

    const resetForm = () => {
      resolvedRecipient = null;
      if (groupName) groupName.style.display = 'none';
      if (methodSelect && methodSelect.value === 'paystack_bank') {
        verifyBtn.style.display = 'block';
        submitBtn.style.display = 'none';
      }
    };

    document.getElementById('withdraw-bank')?.addEventListener('change', resetForm);
    document.getElementById('withdraw-account')?.addEventListener('input', resetForm);

    document.getElementById('withdrawal-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const method = methodSelect ? methodSelect.value : 'paystack_bank';
      const amount = parseFloat(document.getElementById('withdraw-amount').value);

      if (amount < 1000) {
        this._showToast('Minimum withdrawal amount is ₦1,000.', 'error');
        return;
      }

      let payload = { method, amount_minor: Math.round(amount * 100) };

      if (method === 'crypto_usdt') {
        const walletAddress = document.getElementById('withdraw-crypto-address').value;
        const network = document.getElementById('withdraw-crypto-network').value;
        if (!walletAddress || walletAddress.trim().length < 15) {
          this._showToast('Please enter a valid USDT wallet address.', 'error');
          return;
        }
        payload.wallet_address = walletAddress.trim();
        payload.network = network;
      } else {
        if (!resolvedRecipient) {
          this._showToast('Please verify your bank account details first.', 'error');
          return;
        }
        payload.bank_code = document.getElementById('withdraw-bank').value;
        payload.account_number = document.getElementById('withdraw-account').value;
        payload.account_name = resolvedRecipient.account_name;
      }

      submitBtn.disabled = true;
      submitBtn.innerText = 'Submitting...';

      try {
        const res = await EF.requestWithdrawal(payload);
        this._showToast('💸 Withdrawal queued! Payout ID: ' + res.withdrawal_id, 'success', 6000);
        document.getElementById('ef-withdrawal-modal').style.display = 'none';
        document.getElementById('withdraw-amount').value = '';
        if (document.getElementById('withdraw-crypto-address')) {
          document.getElementById('withdraw-crypto-address').value = '';
        }
        resetForm();
        await Promise.all([this.loadWallet(), this.loadActiveTabContent()]);
      } catch (err) {
        this._showToast(err.message || 'Failed to submit withdrawal request.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Confirm Payout';
      }
    });
  },

  // ─────────────────────────── Ledger History ────────────────────────────────

  async loadHistoryLog() {
    const container = document.getElementById('ef-history-container');
    if (!container) return;

    try {
      const res = await EF.getLedger(50);
      const items = res.items || [];

      if (!items.length) {
        container.innerHTML = '<p style="padding:20px;opacity:0.6;">No activity logged yet. Complete tasks to see your ledger flow!</p>';
        return;
      }

      const rows = items.map(item => {
        const isCredit = item.amount_minor > 0;
        const formattedAmount = (Math.abs(item.amount_minor) / 100).toFixed(2);
        const color = isCredit ? 'var(--gold-soft)' : 'var(--coral)';
        const sign = isCredit ? '+' : '-';
        const date = new Date(item.created_at).toLocaleString();

        let typeBadge = item.entry_type;
        if (item.entry_type === 'task_credit') typeBadge = '💰 Task Credit';
        else if (item.entry_type === 'withdrawal_debit') typeBadge = '💸 Cashout Request';
        else if (item.entry_type === 'referral_bonus') typeBadge = '🔗 Referral Commission';
        else if (item.entry_type === 'streak_bonus') typeBadge = '🔥 Daily Streak';
        else if (item.entry_type === 'withdrawal_reversal') typeBadge = '🔄 Transfer Reversal';

        return `
          <tr>
            <td><strong style="color:var(--mint);">${typeBadge}</strong></td>
            <td style="opacity:0.85;">${item.memo || '-'}</td>
            <td style="font-family:var(--font-mono);font-weight:600;color:${color}">${sign}${item.currency} ${formattedAmount}</td>
            <td style="font-size:0.82rem;opacity:0.75;">${date}</td>
          </tr>`;
      }).join('');

      container.innerHTML = `
        <table class="ef-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Date & Time</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    } catch (e) {
      container.innerHTML = '<p style="padding:20px;color:var(--coral);">Failed to load history log.</p>';
      console.error(e);
    }
  },

  // ─────────────────────────── UI Helpers ────────────────────────────────────

  /**
   * Animates a task card out of the feed (slide-up + fade) and removes it from the DOM.
   */
  _removeTaskFromFeed(taskId) {
    const card = document.querySelector(`[data-task-id="${taskId}"]`);
    if (!card) return;
    card.style.transition = 'transform 0.35s ease, opacity 0.35s ease, max-height 0.4s ease, margin 0.4s ease, padding 0.4s ease';
    card.style.transform = 'translateY(-12px)';
    card.style.opacity = '0';
    card.style.maxHeight = card.offsetHeight + 'px';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.style.maxHeight = '0';
        card.style.marginBottom = '0';
        card.style.paddingTop = '0';
        card.style.paddingBottom = '0';
      });
    });
    setTimeout(() => card.remove(), 450);
  },

  /**
   * Dims a task card with a status overlay (e.g. "Started — awaiting confirmation").
   */
  _dimTaskCard(taskId, message) {
    const card = document.querySelector(`[data-task-id="${taskId}"]`);
    if (!card) return;
    card.style.opacity = '0.45';
    card.style.pointerEvents = 'none';
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:absolute;bottom:10px;right:10px;
      font-size:0.72rem;font-family:var(--font-mono);
      color:var(--gold);opacity:0.8;
    `;
    overlay.innerText = message;
    card.style.position = 'relative';
    card.appendChild(overlay);
  },

  /**
   * Shows a toast notification at the bottom of the screen.
   * type: 'success' | 'error' | 'info'
   */
  _showToast(message, type = 'info', duration = 3500) {
    // Remove existing toasts
    document.querySelectorAll('.ef-toast').forEach(t => t.remove());

    const colors = {
      success: 'linear-gradient(135deg, var(--emerald), var(--emerald-2))',
      error:   'linear-gradient(135deg, #7a2020, var(--coral))',
      info:    'linear-gradient(135deg, var(--ink-2), #1a4040)',
    };

    const toast = document.createElement('div');
    toast.className = 'ef-toast';
    toast.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);
      background:${colors[type]};color:#fff;
      padding:12px 24px;border-radius:999px;
      font-family:var(--font-body);font-size:0.9rem;font-weight:500;
      box-shadow:0 8px 24px rgba(0,0,0,0.35);
      z-index:9999;opacity:0;transition:opacity 0.25s ease, transform 0.25s ease;
      max-width:90vw;text-align:center;
      border:1px solid rgba(255,255,255,0.12);
    `;
    toast.innerText = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
      });
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },
};

window.EFDashboard = EFDashboard;
