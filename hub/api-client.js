(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const API_BASE = params.get('api') || window.AGORA_API_URL || '/api';

  async function fetchJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  window.AgoraApi = {
    async loadPackages() {
      const data = await fetchJson(`${API_BASE}/packages`);
      return (data.packages || []).map(normalizePackage);
    },

    async loadWorkflows() {
      const data = await fetchJson(`${API_BASE}/workflows`);
      return (data.workflows || []).map(normalizeWorkflow);
    }
  };

  function normalizePackage(p) {
    return {
      id: p.id,
      name: p.name,
      description: p.description || '',
      author: p.author,
      version: p.version || '1.0.0',
      category: p.category || 'mcp',
      tags: JSON.parse(p.tags || '[]'),
      stars: Number(p.stars || 0),
      installs: Number(p.installs || 0),
      repository: p.repository || '',
      npmPackage: p.npm_package || p.npmPackage || '',
      createdAt: p.created_at || p.createdAt || '',
      quality: 85,
      status: 'Ready'
    };
  }

  function normalizeWorkflow(w) {
    return {
      id: w.id,
      name: w.name,
      description: w.description || '',
      author: w.author,
      prompt: w.prompt || '',
      model: w.model || 'Any',
      tags: JSON.parse(w.tags || '[]'),
      stars: Number(w.stars || 0),
      forks: Number(w.forks || 0),
      createdAt: w.created_at || w.createdAt || ''
    };
  }
})();
