/**
 * Dashboard controller — loads wallet balance and the personalized task
 * feed, renders task cards, and handles the start-task click flow.
 */

const EFDashboard = {
  async init() {
    await Promise.all([this.loadWallet(), this.loadFeed()]);
  },

  async loadWallet() {
    try {
      const wallet = await EF.getWallet();
      const formatted = (wallet.balance_minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
      animateBalance(formatted);
    } catch (e) {
      console.error('Failed to load wallet', e);
    }
  },

  async loadFeed() {
    const grid = document.getElementById('ef-task-feed');
    if (!grid) return;
    grid.innerHTML = '<p style="opacity:0.6;">Loading your tasks…</p>';

    try {
      const feed = await EF.getFeed(1);
      if (!feed.items.length) {
        grid.innerHTML = `<p style="opacity:0.6;">No tasks available for your region right now — check back soon, or try the Surveys tab.</p>`;
        return;
      }
      grid.innerHTML = feed.items.map((t) => this.renderCard(t)).join('');
      grid.querySelectorAll('[data-task-id]').forEach((card) => {
        card.addEventListener('click', () => this.startTask(card.dataset.taskId));
      });
    } catch (e) {
      grid.innerHTML = `<p style="opacity:0.6;">Couldn't load tasks. Please refresh.</p>`;
      console.error(e);
    }
  },

  renderCard(task) {
    const payout = (task.payout_minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    return `
      <div class="ef-card ef-reveal" data-task-id="${task.id}">
        <div class="cat">${task.task_categories?.name || ''}</div>
        <h3>${task.title}</h3>
        <div class="payout">₦${payout}</div>
      </div>`;
  },

  async startTask(taskId) {
    try {
      const { completion_id } = await EF.startTask(taskId);
      // Antigravity: route to the task's provider URL / in-house task flow,
      // passing completion_id as the subid/tracking param so the postback
      // (or, for in-house categories, the submit call) can match it back.
      console.log('started task', taskId, completion_id);
    } catch (e) {
      alert(e.message || 'Could not start this task right now.');
    }
  },
};

window.EFDashboard = EFDashboard;
