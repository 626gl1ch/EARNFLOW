/**
 * Dashboard controller — loads wallet balance, feed, handles tab navigation,
 * withdrawal flows, captcha solving, and streak check-ins.
 */

const EFDashboard = {
  activeTab: 'dashboard',
  userProfile: null,
  activeCompletionId: null,

  async init() {
    // Setup tab listeners once
    this.setupTabNavigation();
    this.setupModalListeners();
    this.setupWithdrawalFlow();

    // Fetch user details first
    try {
      const session = await getSupabaseSession();
      if (!session) return;
      
      const { data: profile } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
      this.userProfile = profile;
    } catch (e) {
      console.error('Failed to load user profile', e);
    }

    await Promise.all([this.loadWallet(), this.loadActiveTabContent()]);
  },

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
          if (l.getAttribute('href') === href) {
            l.classList.add('active');
          } else {
            l.classList.remove('active');
          }
        });

        this.loadActiveTabContent();
      });
    });
  },

  setupModalListeners() {
    document.getElementById('btn-close-captcha')?.addEventListener('click', () => {
      document.getElementById('ef-captcha-modal').style.display = 'none';
      this.activeCompletionId = null;
    });

    document.getElementById('btn-close-withdrawal')?.addEventListener('click', () => {
      document.getElementById('ef-withdrawal-modal').style.display = 'none';
    });

    // Captcha submit form
    document.getElementById('captcha-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const solution = document.getElementById('captcha-input').value;
      if (!this.activeCompletionId) return;

      try {
        await EF.submitCompletion(this.activeCompletionId, { solution });
        alert('Captcha solved correctly! Earnings added to your wallet.');
        document.getElementById('ef-captcha-modal').style.display = 'none';
        document.getElementById('captcha-input').value = '';
        this.activeCompletionId = null;
        await Promise.all([this.loadWallet(), this.loadActiveTabContent()]);
      } catch (err) {
        alert(err.message || 'Verification failed. Try again.');
      }
    });
  },

  async loadWallet() {
    try {
      const wallet = await EF.getWallet();
      const formatted = (wallet.balance_minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
      animateBalance(formatted);
      
      // Update currency symbol if applicable
      const currencySymbols = { 'NGN': '₦', 'USD': '$', 'GHS': 'GH₵', 'KES': 'KSh' };
      const symbol = currencySymbols[wallet.currency] || wallet.currency;
      const curEl = document.getElementById('ef-currency');
      if (curEl) curEl.innerText = symbol;
    } catch (e) {
      console.error('Failed to load wallet', e);
    }
  },

  async loadActiveTabContent() {
    const mainCol = document.querySelector('.ef-main');
    if (!mainCol) return;

    // Preserve the balance header
    const balanceHeader = mainCol.querySelector('.ef-balance-header');
    
    // Clear out previous custom views, keep header
    const previousView = mainCol.querySelector('.ef-view-content');
    if (previousView) previousView.remove();

    const viewContent = document.createElement('div');
    viewContent.className = 'ef-view-content ef-reveal';

    if (this.activeTab === 'dashboard') {
      viewContent.innerHTML = `
        <h3 style="font-family:var(--font-display);color:#fff;margin-top:20px;">Recommended for you</h3>
        <div class="ef-grid" id="ef-task-feed">Loading tasks...</div>
      `;
      mainCol.appendChild(viewContent);
      await this.loadFeed('dashboard');
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
        <p style="opacity:0.7;font-size:0.9rem;margin-bottom:20px;">CPA app installs, registrations, and cost-per-action offers.</p>
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
        <h3 style="font-family:var(--font-display);color:#fff;margin-top:20px;">Earnings & Transaction History</h3>
        <p style="opacity:0.7;font-size:0.9rem;margin-bottom:20px;">Complete immutable ledger of your task payouts, referral bonuses, and bank withdrawals.</p>
        <div class="ef-table-wrapper" id="ef-history-container">
          <p style="padding:20px;opacity:0.7;">Loading history log...</p>
        </div>
      `;
      mainCol.appendChild(viewContent);
      await this.loadHistoryLog();
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
        alert('Referral link copied to clipboard!');
      });
    } else if (this.activeTab === 'profile') {
      viewContent.innerHTML = `
        <h3 style="font-family:var(--font-display);color:#fff;margin-top:20px;">My Profile</h3>
        <div class="ef-card" style="max-width:500px;margin-top:20px;cursor:default;">
          <h4 style="font-family:var(--font-display);margin-bottom:15px;color:#fff;">Account Details</h4>
          <div style="display:flex;flex-direction:column;gap:12px;font-size:0.95rem;opacity:0.9;margin-bottom:24px;">
            <div><strong>Email:</strong> ${sb.auth.user()?.email || 'N/A'}</div>
            <div><strong>Country:</strong> ${this.userProfile?.country_code || 'GLOBAL'} (${this.userProfile?.country_status || 'unverified'})</div>
            <div><strong>Tier:</strong> <span style="text-transform:capitalize;color:var(--gold);font-weight:600;">${this.userProfile?.tier || 'bronze'}</span></div>
          </div>
          <button class="ef-btn" id="btn-logout" style="background:var(--coral);color:#fff;">Log Out</button>
        </div>
      `;
      mainCol.appendChild(viewContent);
      document.getElementById('btn-logout')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to log out?')) {
          await sb.auth.signOut();
        }
      });
    }
  },

  async loadFeed(type) {
    const grid = document.getElementById('ef-task-feed');
    if (!grid) return;

    try {
      let data;
      if (type === 'offers') {
        data = await EF.getOffers();
      } else {
        data = await EF.getFeed(1);
        if (type === 'tasks') {
          // Filter out offers and surveys
          data.items = data.items.filter(t => !['cpa','ppc','download','survey'].includes(t.task_categories?.slug));
        }
      }

      if (!data.items || !data.items.length) {
        grid.innerHTML = `<p style="opacity:0.6;grid-column:1/-1;">No offers currently available for your region. Try check-in daily!</p>`;
        return;
      }

      grid.innerHTML = data.items.map((t) => this.renderCard(t)).join('');
      grid.querySelectorAll('[data-task-id]').forEach((card) => {
        card.addEventListener('click', () => this.startTask(card.dataset.taskId));
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
      
      // Render survey tasks
      if (data.tasks && data.tasks.length) {
        taskGrid.innerHTML = data.tasks.map(t => this.renderCard(t)).join('');
        taskGrid.querySelectorAll('[data-task-id]').forEach((card) => {
          card.addEventListener('click', () => this.startTask(card.dataset.taskId));
        });
      } else {
        taskGrid.innerHTML = `<p style="opacity:0.6;grid-column:1/-1;">No direct survey tasks available right now.</p>`;
      }

      // Render widgets
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

  renderCard(task) {
    const payout = (task.payout_minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    // Setup currency prefix
    const symbols = { 'NGN': '₦', 'USD': '$' };
    const curPrefix = symbols[task.currency] || '';
    
    return `
      <div class="ef-card ef-reveal" data-task-id="${task.id}">
        <div class="cat">${task.task_categories?.name || ''}</div>
        <h3>${task.title}</h3>
        <p style="font-size:0.85rem;opacity:0.8;margin:8px 0;max-height:40px;overflow:hidden;text-overflow:ellipsis;">${task.description || ''}</p>
        <div class="payout">${curPrefix}${payout}</div>
      </div>`;
  },

  async startTask(taskId) {
    try {
      const res = await EF.startTask(taskId);
      const completionId = res.completion_id;

      // Check if it returned a captcha challenge
      if (res.captcha) {
        this.activeCompletionId = completionId;
        document.getElementById('captcha-challenge-text').innerText = res.captcha;
        document.getElementById('ef-captcha-modal').style.display = 'flex';
        document.getElementById('captcha-input').focus();
        return;
      }

      // Query database to see what category this task belongs to
      const { data: task } = await sb
        .from('tasks')
        .select('*, task_categories(slug)')
        .eq('id', taskId)
        .single();

      if (task?.task_categories?.slug === 'streak') {
        // Daily check-in is verified instantly!
        await EF.submitCompletion(completionId, { check_in: true });
        alert('Daily check-in completed! Streak bonus added to your wallet.');
        await Promise.all([this.loadWallet(), this.loadActiveTabContent()]);
        return;
      }

      // If it is a third-party link task (CPA offers etc.)
      const isThirdParty = ['cpa', 'ppc', 'download'].includes(task?.task_categories?.slug);
      if (isThirdParty && task.instructions) {
        // If there's instructions, maybe show instructions first or open link directly
        // Append tracking completion_id as query subid/uid
        let url = task.instructions;
        if (url.includes('?')) {
          url += `&subid=${completionId}`;
        } else {
          url += `?subid=${completionId}`;
        }
        window.open(url, '_blank');
        alert('Task link opened! Follow instructions. Once the advertiser approves, your payout will credit automatically.');
      } else {
        alert('Task attempt started! Completion ID: ' + completionId);
      }
    } catch (e) {
      alert(e.message || 'Could not start this task right now.');
    }
  },

  setupWithdrawalFlow() {
    let resolvedRecipient = null;

    const verifyBtn = document.getElementById('btn-withdraw-verify');
    const submitBtn = document.getElementById('btn-withdraw-submit');
    const groupName = document.getElementById('group-resolved-name');
    const nameBox = document.getElementById('resolved-account-name');

    verifyBtn?.addEventListener('click', async () => {
      const bankCode = document.getElementById('withdraw-bank').value;
      const accountNum = document.getElementById('withdraw-account').value;

      if (!bankCode || accountNum.length !== 10) {
        alert('Please select a bank and enter a valid 10-digit account number.');
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
          throw new Error(res.message || 'Verification failed');
        }
      } catch (e) {
        alert('Failed to resolve account: ' + e.message);
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.innerText = 'Verify Account';
      }
    });

    // Reset verification on input change
    const resetForm = () => {
      resolvedRecipient = null;
      groupName.style.display = 'none';
      verifyBtn.style.display = 'block';
      submitBtn.style.display = 'none';
    };

    document.getElementById('withdraw-bank')?.addEventListener('change', resetForm);
    document.getElementById('withdraw-account')?.addEventListener('input', resetForm);

    document.getElementById('withdrawal-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = parseFloat(document.getElementById('withdraw-amount').value);

      if (!resolvedRecipient) {
        alert('Please verify your account details first.');
        return;
      }

      if (amount < 1000) {
        alert('Minimum withdrawal amount is 1,000 NGN.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerText = 'Submitting...';

      try {
        const payload = {
          bank_code: document.getElementById('withdraw-bank').value,
          account_number: document.getElementById('withdraw-account').value,
          account_name: resolvedRecipient.account_name,
          amount_minor: Math.round(amount * 100), // convert to minor unit kobo
        };

        const res = await EF.requestWithdrawal(payload);
        alert('Withdrawal request submitted! ID: ' + res.withdrawal_id + '. Your funds will be sent shortly.');
        document.getElementById('ef-withdrawal-modal').style.display = 'none';
        document.getElementById('withdraw-amount').value = '';
        resetForm();
        await Promise.all([this.loadWallet(), this.loadActiveTabContent()]);
      } catch (err) {
        alert(err.message || 'Failed to submit withdrawal request.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Confirm Payout';
      }
    });
  },

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
          </tr>
        `;
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
          <tbody>
            ${rows}
          </tbody>
        </table>
      `;
    } catch (e) {
      container.innerHTML = '<p style="padding:20px;color:var(--coral);">Failed to load history log.</p>';
      console.error(e);
    }
  }
};

window.EFDashboard = EFDashboard;
