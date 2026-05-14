(function () {
  'use strict';

  const packages = [
    {
      id: 'mcp-filesystem',
      name: '@modelcontextprotocol/server-filesystem',
      description: 'Read, write, and edit files on your local filesystem.',
      author: 'modelcontextprotocol',
      version: '0.5.0',
      category: 'mcp',
      tags: ['filesystem', 'files', 'io'],
      stars: 2450,
      installs: 89000,
      repository: 'https://github.com/modelcontextprotocol/server-filesystem',
      npmPackage: '@modelcontextprotocol/server-filesystem',
      createdAt: '2024-08-15',
      quality: 98,
      status: 'Ready'
    },
    {
      id: 'mcp-github',
      name: '@modelcontextprotocol/server-github',
      description: 'Interact with GitHub API: issues, pull requests, repositories, and more.',
      author: 'modelcontextprotocol',
      version: '0.3.0',
      category: 'mcp',
      tags: ['github', 'git', 'api'],
      stars: 1890,
      installs: 45000,
      repository: 'https://github.com/modelcontextprotocol/server-github',
      npmPackage: '@modelcontextprotocol/server-github',
      createdAt: '2024-09-20',
      quality: 94,
      status: 'Ready'
    },
    {
      id: 'mcp-brave-search',
      name: '@modelcontextprotocol/server-brave-search',
      description: 'Web search with the Brave Search API for agent research tasks.',
      author: 'modelcontextprotocol',
      version: '0.2.0',
      category: 'mcp',
      tags: ['search', 'web', 'brave'],
      stars: 890,
      installs: 23000,
      repository: 'https://github.com/modelcontextprotocol/server-brave-search',
      npmPackage: '@modelcontextprotocol/server-brave-search',
      createdAt: '2024-10-05',
      quality: 88,
      status: 'Review'
    },
    {
      id: 'prompt-code-review',
      name: 'Comprehensive Code Review',
      description:
        'Detailed code review prompt covering security, performance, and maintainability.',
      author: 'agora-community',
      version: '1.0.0',
      category: 'prompt',
      tags: ['review', 'security', 'best-practices'],
      stars: 324,
      installs: 1200,
      createdAt: '2025-01-10',
      quality: 82,
      status: 'Ready'
    },
    {
      id: 'workflow-refactor-large',
      name: 'Large Scale Refactor',
      description: 'A workflow for breaking down and refactoring large codebases safely.',
      author: 'agora-community',
      version: '2.0.0',
      category: 'workflow',
      tags: ['refactor', 'large-scale', 'safety'],
      stars: 189,
      installs: 567,
      createdAt: '2025-02-15',
      quality: 79,
      status: 'Draft'
    },
    {
      id: 'skill-release-captain',
      name: 'Release Captain',
      description:
        'A release-readiness skill for changelogs, smoke tests, and staged rollout notes.',
      author: 'agora-labs',
      version: '0.4.0',
      category: 'skill',
      tags: ['release', 'qa', 'workflow'],
      stars: 143,
      installs: 410,
      createdAt: '2025-03-18',
      quality: 76,
      status: 'Review'
    }
  ];

  const workflows = [
    {
      id: 'wf-tdd-cycle',
      name: 'TDD Development Cycle',
      description: 'Test-driven development workflow with red, green, refactor checkpoints.',
      author: 'testdriven',
      prompt:
        'You are following TDD methodology. For each feature request:\n1. Write a failing test first\n2. Write minimal code to pass the test\n3. Refactor while keeping tests green\n\nAlways start by understanding the requirements and writing tests that describe expected behavior.',
      model: 'claude-sonnet-4-5',
      tags: ['tdd', 'testing', 'workflow'],
      stars: 456,
      forks: 89,
      createdAt: '2025-01-20'
    },
    {
      id: 'wf-security-audit',
      name: 'Security Audit Workflow',
      description: 'Comprehensive security analysis for application and dependency risk.',
      author: 'security-first',
      prompt:
        'Perform a thorough security audit of the codebase:\n1. Check for OWASP Top 10 vulnerabilities\n2. Look for hardcoded secrets and credentials\n3. Validate input sanitization\n4. Check dependency vulnerabilities\n5. Review authentication and authorization\n\nReport findings with severity levels and suggested fixes.',
      tags: ['security', 'audit', 'owasp'],
      stars: 234,
      forks: 45,
      createdAt: '2025-02-01'
    },
    {
      id: 'wf-support-triage',
      name: 'Support Triage',
      description: 'Turns incoming issue reports into reproduction steps, labels, and owner notes.',
      author: 'agora-labs',
      prompt:
        'Triage each incoming report by extracting the affected area, likely severity, reproduction steps, missing context, and suggested owner. Ask for logs only when they would change the next action.',
      tags: ['support', 'issues', 'ops'],
      stars: 171,
      forks: 22,
      createdAt: '2025-03-07'
    }
  ];

  const baseDiscussions = [
    {
      id: 'disc-mcp-vs-openai',
      title: 'MCP Servers vs OpenAI Function Calling',
      author: 'devarchitect',
      content:
        'I have been experimenting with both approaches. MCP seems more flexible for tool-based workflows, but function calling is simpler to set up.',
      category: 'question',
      replies: 23,
      stars: 45,
      createdAt: '2025-03-01',
      reviewed: false,
      pinned: true
    },
    {
      id: 'disc-best-coder-model',
      title: 'Best local model for coding in 2025?',
      author: 'local-llm-fan',
      content: 'With Qwen, DeepSeek Coder, and others, what are you using for local development?',
      category: 'discussion',
      replies: 67,
      stars: 89,
      createdAt: '2025-03-10',
      reviewed: false,
      pinned: false
    },
    {
      id: 'disc-release-runbook',
      title: 'Showcase: a release runbook skill',
      author: 'release-captain',
      content:
        'I put together a skill that turns PR history into a release checklist and rollback note.',
      category: 'showcase',
      replies: 12,
      stars: 37,
      createdAt: '2025-03-23',
      reviewed: true,
      pinned: false
    },
    {
      id: 'disc-curated-quality',
      title: 'Idea: quality badges for packages',
      author: 'agora-community',
      content:
        'Could the marketplace surface compatibility, docs coverage, and maintainer response signals?',
      category: 'idea',
      replies: 18,
      stars: 52,
      createdAt: '2025-04-02',
      reviewed: false,
      pinned: false
    }
  ];

  const state = {
    view: 'overview',
    query: '',
    packageCategory: 'all',
    discussionCategory: 'all',
    packageSort: 'stars',
    selectedPackageId: 'mcp-filesystem',
    selectedWorkflowId: 'wf-tdd-cycle',
    analyticsMode: 'installs',
    queue: readJson('agora-hub-queue', ['mcp-filesystem']),
    discussions: readJson('agora-hub-discussions', baseDiscussions)
  };

  const els = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    bindEvents();
    render();
  }

  function cacheElements() {
    els.viewTitle = document.querySelector('#view-title');
    els.globalSearch = document.querySelector('#global-search');
    els.metricGrid = document.querySelector('#metric-grid');
    els.barChart = document.querySelector('#bar-chart');
    els.activityList = document.querySelector('#activity-list');
    els.recommendedGrid = document.querySelector('#recommended-grid');
    els.packageList = document.querySelector('#package-list');
    els.packageDetail = document.querySelector('#package-detail');
    els.workflowList = document.querySelector('#workflow-list');
    els.workflowDetail = document.querySelector('#workflow-detail');
    els.discussionList = document.querySelector('#discussion-list');
    els.moderationStats = document.querySelector('#moderation-stats');
    els.discussionForm = document.querySelector('#discussion-form');
    els.queueList = document.querySelector('#queue-list');
    els.configOutput = document.querySelector('#config-output');
    els.installCommands = document.querySelector('#install-commands');
    els.toast = document.querySelector('#toast');
    els.sidebarReady = document.querySelector('#sidebar-ready');
    els.packageSort = document.querySelector('#package-sort');
    els.analyticsMode = document.querySelector('#analytics-mode');
  }

  function bindEvents() {
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.addEventListener('click', () => setView(button.dataset.view));
    });

    document.querySelectorAll('[data-jump-view]').forEach((button) => {
      button.addEventListener('click', () => setView(button.dataset.jumpView));
    });

    document.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', () => {
        state.packageCategory = button.dataset.category;
        setActive('[data-category]', button);
        renderMarketplace();
      });
    });

    document.querySelectorAll('[data-discussion-category]').forEach((button) => {
      button.addEventListener('click', () => {
        state.discussionCategory = button.dataset.discussionCategory;
        setActive('[data-discussion-category]', button);
        renderCommunity();
      });
    });

    els.globalSearch.addEventListener('input', (event) => {
      state.query = event.target.value.trim().toLowerCase();
      renderActiveView();
    });

    els.packageSort.addEventListener('change', (event) => {
      state.packageSort = event.target.value;
      renderMarketplace();
    });

    els.analyticsMode.addEventListener('change', (event) => {
      state.analyticsMode = event.target.value;
      renderOverview();
    });

    document.querySelector('#clear-queue').addEventListener('click', () => {
      state.queue = [];
      persistQueue();
      renderInstall();
      renderOverview();
      showToast('Install queue cleared');
    });

    document.querySelector('#copy-config').addEventListener('click', () => {
      copyText(els.configOutput.textContent, 'Config copied');
    });

    document.querySelector('#clear-state').addEventListener('click', () => {
      localStorage.removeItem('agora-hub-queue');
      localStorage.removeItem('agora-hub-discussions');
      state.queue = ['mcp-filesystem'];
      state.discussions = baseDiscussions.map((discussion) => ({ ...discussion }));
      render();
      showToast('Local workspace reset');
    });

    els.discussionForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(els.discussionForm);
      const discussion = {
        id: `disc-local-${Date.now()}`,
        title: String(formData.get('title')).trim(),
        category: String(formData.get('category')),
        content: String(formData.get('content')).trim(),
        author: 'you',
        replies: 0,
        stars: 0,
        createdAt: new Date().toISOString().slice(0, 10),
        reviewed: false,
        pinned: false
      };

      state.discussions = [discussion, ...state.discussions];
      persistDiscussions();
      els.discussionForm.reset();
      renderCommunity();
      renderOverview();
      showToast('Thread created');
    });
  }

  function render() {
    renderShell();
    renderOverview();
    renderMarketplace();
    renderWorkflows();
    renderCommunity();
    renderInstall();
  }

  function renderShell() {
    const readyCount = packages.filter((item) => item.status === 'Ready').length;
    els.sidebarReady.textContent = String(readyCount);
    document.querySelectorAll('.view').forEach((view) => {
      view.classList.toggle('is-active', view.id === `view-${state.view}`);
    });
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.view === state.view);
    });
    els.viewTitle.textContent = titleCase(state.view === 'install' ? 'Install plan' : state.view);
  }

  function renderActiveView() {
    if (state.view === 'overview') renderOverview();
    if (state.view === 'marketplace') renderMarketplace();
    if (state.view === 'workflows') renderWorkflows();
    if (state.view === 'community') renderCommunity();
    if (state.view === 'install') renderInstall();
  }

  function renderOverview() {
    const packageStars = packages.reduce((sum, item) => sum + item.stars, 0);
    const installs = packages.reduce((sum, item) => sum + item.installs, 0);
    const replies = state.discussions.reduce((sum, item) => sum + item.replies, 0);
    const pending = state.discussions.filter((item) => !item.reviewed).length;

    els.metricGrid.innerHTML = [
      metric(
        'Packages',
        String(packages.length),
        `${packages.filter((item) => item.status === 'Ready').length} ready`
      ),
      metric('Installs', formatNumber(installs), 'sample marketplace'),
      metric('Stars', formatNumber(packageStars), 'across tools'),
      metric('Open threads', String(pending), `${replies} total replies`)
    ].join('');

    const metricKey = state.analyticsMode;
    const max = Math.max(...packages.map((item) => item[metricKey]));
    els.barChart.innerHTML = packages
      .map((item) => {
        const height = Math.max(12, Math.round((item[metricKey] / max) * 100));
        return `
          <div class="bar">
            <div class="bar-fill" style="height:${height}%"></div>
            <span class="bar-value">${formatNumber(item[metricKey])}</span>
            <span class="bar-label">${escapeHtml(shortName(item.name))}</span>
          </div>
        `;
      })
      .join('');

    const topDiscussions = [...state.discussions]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.stars - a.stars)
      .slice(0, 5);

    els.activityList.innerHTML = topDiscussions
      .map(
        (discussion) => `
          <article class="activity">
            <div>
              <strong>${escapeHtml(discussion.title)}</strong>
              <span>${escapeHtml(discussion.category)} by ${escapeHtml(discussion.author)} - ${discussion.replies} replies</span>
            </div>
          </article>
        `
      )
      .join('');

    const recommended = filteredPackages('').slice(0, 3);
    els.recommendedGrid.innerHTML = recommended.map(packageCard).join('');
    bindCardActions(els.recommendedGrid);
  }

  function renderMarketplace() {
    const items = filteredPackages(state.query);
    if (!items.some((item) => item.id === state.selectedPackageId) && items.length > 0) {
      state.selectedPackageId = items[0].id;
    }

    els.packageList.innerHTML = items.length
      ? items.map((item) => resultCard(item, state.selectedPackageId === item.id)).join('')
      : emptyState('No packages found', 'The current filters have no matching package records.');

    els.packageList.querySelectorAll('[data-select-package]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedPackageId = button.dataset.selectPackage;
        renderMarketplace();
      });
    });
    bindCardActions(els.packageList);

    const selected = packages.find((item) => item.id === state.selectedPackageId) || items[0];
    els.packageDetail.innerHTML = selected
      ? packageDetail(selected)
      : emptyState('Nothing selected', 'Package details will appear here.');
    bindDetailActions(els.packageDetail);
  }

  function renderWorkflows() {
    const items = workflows
      .filter((item) => matchesQuery(item, state.query))
      .sort((a, b) => b.stars - a.stars);

    if (!items.some((item) => item.id === state.selectedWorkflowId) && items.length > 0) {
      state.selectedWorkflowId = items[0].id;
    }

    els.workflowList.innerHTML = items.length
      ? items.map((item) => workflowCard(item, state.selectedWorkflowId === item.id)).join('')
      : emptyState('No workflows found', 'The current filters have no matching workflow records.');

    els.workflowList.querySelectorAll('[data-select-workflow]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedWorkflowId = button.dataset.selectWorkflow;
        renderWorkflows();
      });
    });
    bindCardActions(els.workflowList);

    const selected = workflows.find((item) => item.id === state.selectedWorkflowId) || items[0];
    els.workflowDetail.innerHTML = selected
      ? workflowDetail(selected)
      : emptyState('Nothing selected', 'Workflow details will appear here.');
    bindDetailActions(els.workflowDetail);
  }

  function renderCommunity() {
    const items = state.discussions
      .filter(
        (item) => state.discussionCategory === 'all' || item.category === state.discussionCategory
      )
      .filter((item) => matchesQuery(item, state.query))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.stars - a.stars);

    els.discussionList.innerHTML = items.length
      ? items.map(discussionCard).join('')
      : emptyState(
          'No discussions found',
          'The current filters have no matching discussion records.'
        );

    els.discussionList.querySelectorAll('[data-toggle-reviewed]').forEach((button) => {
      button.addEventListener('click', () =>
        updateDiscussion(button.dataset.toggleReviewed, { toggleReviewed: true })
      );
    });

    els.discussionList.querySelectorAll('[data-toggle-pinned]').forEach((button) => {
      button.addEventListener('click', () =>
        updateDiscussion(button.dataset.togglePinned, { togglePinned: true })
      );
    });

    const pending = state.discussions.filter((item) => !item.reviewed).length;
    const pinned = state.discussions.filter((item) => item.pinned).length;
    const questions = state.discussions.filter((item) => item.category === 'question').length;
    els.moderationStats.innerHTML = [
      moderationStat('Pending review', pending),
      moderationStat('Pinned threads', pinned),
      moderationStat('Questions', questions)
    ].join('');
  }

  function renderInstall() {
    const queuedItems = state.queue.map(findInstallable).filter(Boolean);
    els.queueList.innerHTML = queuedItems.length
      ? queuedItems.map(queueItem).join('')
      : emptyState('Queue is empty', 'No packages or workflows are staged.');

    els.queueList.querySelectorAll('[data-remove-queue]').forEach((button) => {
      button.addEventListener('click', () => {
        state.queue = state.queue.filter((id) => id !== button.dataset.removeQueue);
        persistQueue();
        renderInstall();
        renderOverview();
        showToast('Removed from queue');
      });
    });

    els.configOutput.textContent = JSON.stringify(generateConfig(queuedItems), null, 2);
    const commands = queuedItems
      .filter((item) => item.npmPackage)
      .map((item) => `<code>npm install -g ${escapeHtml(item.npmPackage)}</code>`);
    els.installCommands.innerHTML = commands.length
      ? commands.join('')
      : '<code>No npm packages selected.</code>';
  }

  function setView(view) {
    state.view = view;
    renderShell();
    renderActiveView();
  }

  function setActive(selector, activeButton) {
    document.querySelectorAll(selector).forEach((button) => {
      button.classList.toggle('is-active', button === activeButton);
    });
  }

  function filteredPackages(query) {
    const normalized = query || state.query;
    const category = state.packageCategory;
    const items = packages
      .filter((item) => category === 'all' || item.category === category)
      .filter((item) => matchesQuery(item, normalized));

    return items.sort((a, b) => {
      if (state.packageSort === 'name') return a.name.localeCompare(b.name);
      if (state.packageSort === 'installs') return b.installs - a.installs;
      if (state.packageSort === 'recent') return b.createdAt.localeCompare(a.createdAt);
      return b.stars - a.stars;
    });
  }

  function resultCard(item, selected) {
    return `
      <article class="result-card ${selected ? 'is-selected' : ''}">
        <header>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta-row">${escapeHtml(item.author)} - v${escapeHtml(item.version)} - ${item.quality}% quality</div>
          </div>
          <span class="badge ${escapeHtml(item.category)}">${escapeHtml(item.category)}</span>
        </header>
        <p>${escapeHtml(item.description)}</p>
        ${tagRow(item.tags)}
        <div class="card-actions">
          <button class="secondary-button" data-select-package="${escapeHtml(item.id)}" type="button">Inspect</button>
          <button class="primary-button" data-add-queue="${escapeHtml(item.id)}" type="button">Add to plan</button>
        </div>
      </article>
    `;
  }

  function packageCard(item) {
    return `
      <article class="item-card">
        <header>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta-row">${formatNumber(item.stars)} stars - ${formatNumber(item.installs)} installs</div>
          </div>
          <span class="badge ${escapeHtml(item.category)}">${escapeHtml(item.category)}</span>
        </header>
        <p>${escapeHtml(item.description)}</p>
        ${tagRow(item.tags.slice(0, 3))}
        <div class="card-actions">
          <button class="secondary-button" data-open-package="${escapeHtml(item.id)}" type="button">Open</button>
          <button class="primary-button" data-add-queue="${escapeHtml(item.id)}" type="button">Add to plan</button>
        </div>
      </article>
    `;
  }

  function workflowCard(item, selected) {
    return `
      <article class="result-card ${selected ? 'is-selected' : ''}">
        <header>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta-row">${escapeHtml(item.author)} - ${formatNumber(item.stars)} stars - ${item.forks} forks</div>
          </div>
          <span class="badge workflow">workflow</span>
        </header>
        <p>${escapeHtml(item.description)}</p>
        ${tagRow(item.tags)}
        <div class="card-actions">
          <button class="secondary-button" data-select-workflow="${escapeHtml(item.id)}" type="button">Inspect</button>
          <button class="primary-button" data-add-queue="${escapeHtml(item.id)}" type="button">Add to plan</button>
        </div>
      </article>
    `;
  }

  function discussionCard(item) {
    return `
      <article class="discussion-card">
        <header>
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <div class="meta-row">${escapeHtml(item.author)} - ${item.replies} replies - ${item.stars} stars</div>
          </div>
          <span class="badge ${escapeHtml(item.category)}">${escapeHtml(item.category)}</span>
        </header>
        <p>${escapeHtml(item.content)}</p>
        <div class="card-actions">
          <button class="secondary-button" data-toggle-pinned="${escapeHtml(item.id)}" type="button">${item.pinned ? 'Unpin' : 'Pin'}</button>
          <button class="primary-button" data-toggle-reviewed="${escapeHtml(item.id)}" type="button">${item.reviewed ? 'Reopen' : 'Mark reviewed'}</button>
        </div>
      </article>
    `;
  }

  function packageDetail(item) {
    const config = generateConfig([item]);
    return `
      <div>
        <span class="badge ${escapeHtml(item.category)}">${escapeHtml(item.category)}</span>
        <h2>${escapeHtml(item.name)}</h2>
      </div>
      <p>${escapeHtml(item.description)}</p>
      <div class="detail-metrics">
        ${miniMetric('Stars', formatNumber(item.stars))}
        ${miniMetric('Installs', formatNumber(item.installs))}
        ${miniMetric('Quality', `${item.quality}%`)}
      </div>
      ${tagRow(item.tags)}
      <pre>${escapeHtml(JSON.stringify(config, null, 2))}</pre>
      <div class="card-actions">
        <button class="primary-button" data-add-queue="${escapeHtml(item.id)}" type="button">Add to plan</button>
        <button class="secondary-button" data-copy-package="${escapeHtml(item.id)}" type="button">Copy config</button>
      </div>
    `;
  }

  function workflowDetail(item) {
    return `
      <div>
        <span class="badge workflow">workflow</span>
        <h2>${escapeHtml(item.name)}</h2>
      </div>
      <p>${escapeHtml(item.description)}</p>
      <div class="detail-metrics">
        ${miniMetric('Stars', formatNumber(item.stars))}
        ${miniMetric('Forks', String(item.forks))}
        ${miniMetric('Model', item.model || 'Any')}
      </div>
      ${tagRow(item.tags)}
      <pre>${escapeHtml(item.prompt)}</pre>
      <div class="card-actions">
        <button class="primary-button" data-add-queue="${escapeHtml(item.id)}" type="button">Add to plan</button>
        <button class="secondary-button" data-copy-workflow="${escapeHtml(item.id)}" type="button">Copy prompt</button>
      </div>
    `;
  }

  function bindCardActions(root) {
    root.querySelectorAll('[data-add-queue]').forEach((button) => {
      button.addEventListener('click', () => addToQueue(button.dataset.addQueue));
    });

    root.querySelectorAll('[data-open-package]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedPackageId = button.dataset.openPackage;
        setView('marketplace');
      });
    });
  }

  function bindDetailActions(root) {
    bindCardActions(root);
    root.querySelectorAll('[data-copy-package]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = packages.find((candidate) => candidate.id === button.dataset.copyPackage);
        copyText(JSON.stringify(generateConfig([item]), null, 2), 'Package config copied');
      });
    });

    root.querySelectorAll('[data-copy-workflow]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = workflows.find((candidate) => candidate.id === button.dataset.copyWorkflow);
        copyText(item.prompt, 'Workflow prompt copied');
      });
    });
  }

  function addToQueue(id) {
    if (!state.queue.includes(id)) {
      state.queue = [...state.queue, id];
      persistQueue();
      renderInstall();
      showToast('Added to install plan');
    } else {
      showToast('Already in install plan');
    }
  }

  function updateDiscussion(id, action) {
    state.discussions = state.discussions.map((discussion) => {
      if (discussion.id !== id) return discussion;
      return {
        ...discussion,
        reviewed: action.toggleReviewed ? !discussion.reviewed : discussion.reviewed,
        pinned: action.togglePinned ? !discussion.pinned : discussion.pinned
      };
    });
    persistDiscussions();
    renderCommunity();
    renderOverview();
  }

  function findInstallable(id) {
    return packages.find((item) => item.id === id) || workflows.find((item) => item.id === id);
  }

  function generateConfig(items) {
    const mcpServers = {};
    const plugins = ['opencode-agora'];

    items.forEach((item) => {
      if (item.npmPackage) {
        mcpServers[item.id] = {
          command: 'npx',
          args: [item.npmPackage],
          env: {}
        };
      } else if (item.id && item.id.startsWith('wf-')) {
        plugins.push(item.id.replace('wf-', 'skill-'));
      }
    });

    return {
      $schema: 'https://opencode.ai/config.json',
      mcpServers,
      plugins: [...new Set(plugins)]
    };
  }

  function metric(label, value, note) {
    return `
      <article class="metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(note)}</small>
      </article>
    `;
  }

  function moderationStat(label, value) {
    return `
      <div class="moderation-stat">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(String(value))}</strong>
      </div>
    `;
  }

  function miniMetric(label, value) {
    return `
      <div class="mini-metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function queueItem(item) {
    return `
      <article class="queue-item">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.category || 'workflow')} - ${escapeHtml(item.author)}</span>
        </div>
        <button class="secondary-button" data-remove-queue="${escapeHtml(item.id)}" type="button">Remove</button>
      </article>
    `;
  }

  function tagRow(tags) {
    return `<div class="tag-row">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>`;
  }

  function emptyState(title, body) {
    return `
      <div class="empty-state">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(body)}</span>
      </div>
    `;
  }

  function matchesQuery(item, query) {
    if (!query) return true;
    const haystack = [
      item.name,
      item.title,
      item.description,
      item.content,
      item.author,
      ...(item.tags || [])
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  }

  function shortName(name) {
    return name
      .replace('@modelcontextprotocol/server-', '')
      .replace('@', '')
      .replace('Comprehensive ', '');
  }

  function formatNumber(value) {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return String(value);
  }

  function titleCase(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function readJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : clone(fallback);
    } catch {
      return clone(fallback);
    }
  }

  function persistQueue() {
    localStorage.setItem('agora-hub-queue', JSON.stringify(state.queue));
  }

  function persistDiscussions() {
    localStorage.setItem('agora-hub-discussions', JSON.stringify(state.discussions));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function copyText(text, message) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        () => showToast(message),
        () => fallbackCopy(text, message)
      );
      return;
    }
    fallbackCopy(text, message);
  }

  function fallbackCopy(text, message) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showToast(message);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      els.toast.classList.remove('is-visible');
    }, 2200);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
