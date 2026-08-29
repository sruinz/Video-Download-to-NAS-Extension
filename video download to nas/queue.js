(function initializeQueue(globalScope) {
  'use strict';

  const ACTIVE_STATUSES = new Set(['pending', 'sending', 'waiting']);
  const ALL_STATUSES = ['pending', 'sending', 'waiting', 'accepted', 'failed'];

  function createState() {
    return {
      version: 1,
      nextItemId: 1,
      nextBatchId: 1,
      paused: false,
      resumeRequired: false,
      items: []
    };
  }

  function enqueue(state, candidates, source, now) {
    const activeUrls = new Set(
      state.items
        .filter((item) => ACTIVE_STATUSES.has(item.status))
        .map((item) => item.url)
    );
    const validCandidates = [];
    let skipped = 0;

    for (const candidate of candidates) {
      if (!candidate || typeof candidate.url !== 'string' || activeUrls.has(candidate.url)) {
        skipped += 1;
        continue;
      }
      activeUrls.add(candidate.url);
      validCandidates.push(candidate);
    }

    if (validCandidates.length === 0) {
      return { added: 0, skipped, batchId: null };
    }

    const batchId = `batch-${state.nextBatchId}`;
    state.nextBatchId += 1;

    for (const candidate of validCandidates) {
      state.items.push({
        id: `item-${state.nextItemId}`,
        batchId,
        url: candidate.url,
        title: candidate.title || candidate.url,
        resolution: candidate.resolution || 'best',
        sourceTitle: source && source.title ? source.title : '',
        sourceUrl: source && source.url ? source.url : '',
        createdAt: now,
        status: 'pending',
        error: null,
        retryAt: null,
        downloadId: null
      });
      state.nextItemId += 1;
    }

    return { added: validCandidates.length, skipped, batchId };
  }

  function updateItem(state, itemId, patch) {
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      return null;
    }
    Object.assign(item, patch);
    return item;
  }

  function retryFailed(state) {
    let changed = 0;
    for (const item of state.items) {
      if (item.status === 'failed') {
        item.status = 'pending';
        item.error = null;
        item.retryAt = null;
        changed += 1;
      }
    }
    return changed;
  }

  function removePending(state) {
    const before = state.items.length;
    state.items = state.items.filter(
      (item) => item.status !== 'pending' && item.status !== 'waiting'
    );
    return before - state.items.length;
  }

  function clearAccepted(state) {
    const before = state.items.length;
    state.items = state.items.filter((item) => item.status !== 'accepted');
    return before - state.items.length;
  }

  function getSummary(state) {
    const summary = {
      total: state.items.length,
      pending: 0,
      sending: 0,
      waiting: 0,
      accepted: 0,
      failed: 0,
      outstanding: 0
    };

    for (const item of state.items) {
      if (ALL_STATUSES.includes(item.status)) {
        summary[item.status] += 1;
      }
      if (ACTIVE_STATUSES.has(item.status)) {
        summary.outstanding += 1;
      }
    }
    return summary;
  }

  globalScope.VdtnQueue = {
    createState,
    enqueue,
    updateItem,
    retryFailed,
    removePending,
    clearAccepted,
    getSummary
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
