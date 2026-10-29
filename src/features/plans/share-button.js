function planButtons(attrs = '') {
  return `<button type="button" class="plan-trigger" aria-label="撮影計画を共有" title="共有" data-plan-action="share" ${attrs}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8v12M8.4 6.3 12 2.8l3.6 3.5M8.6 9.5H7.2A2.2 2.2 0 0 0 5 11.7v7.1A2.2 2.2 0 0 0 7.2 21h9.6a2.2 2.2 0 0 0 2.2-2.2v-7.1a2.2 2.2 0 0 0-2.2-2.2h-1.4"/></svg></button>`;
}
