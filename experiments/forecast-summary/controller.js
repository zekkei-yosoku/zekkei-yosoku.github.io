(function createForecastSummary({ document, host, context, presentation, openDetail, announce }) {
  // Selection belongs to the forecast list. Keep identifiers, never a second prediction copy.
  // Constructing the owner does no DOM work, IO, routing, or persistent storage.
  let placeKey = null, selected = null, scrollLeft = 0, focusedCell = null;
  const summaryId = 'forecastSelection';
  function reconcilePlace() {
    const next = context().placeKey;
    if (next !== placeKey) { placeKey = next; selected = null; scrollLeft = 0; focusedCell = null; }
  }
  function entry() {
    if (!selected) return null;
    return context().weeks[selected.id]?.find(item => item.dayMs === selected.dayMs) || null;
  }
  function removeSummary() { host()?.querySelector('#' + summaryId)?.remove(); }
  function capture() {
    const previous = placeKey;
    reconcilePlace();
    const root = host(), scroller = root?.querySelector('.mxscroll');
    // Hidden views and loading skeletons do not own a usable comparison position.
    // Capture before the view switch, and keep the last visible prediction until replacement arrives.
    if (previous === placeKey && scroller?.clientWidth && scroller.querySelector('.cell[data-cell]')) scrollLeft = scroller.scrollLeft;
    const active = document.activeElement;
    focusedCell = previous === placeKey && root?.contains(active) && active?.matches('.cell[data-cell]') ? active.dataset.cell : null;
  }
  function timing(id, ev) {
    if (presentation.timeBandPhases(ev)?.some(phase => Number.isFinite(phase.score))) return '';
    if (id === 'capCloud') {
      if (ev.timing?.allDay) return '一日を通して';
      if (Number.isFinite(ev.timing?.from) && Number.isFinite(ev.timing?.to)) return presentation.time(ev.timing.from) + '–' + presentation.time(ev.timing.to);
      return '時間帯を絞れません';
    }
    if (ev.specificTime === false) return presentation.meta(id).timeOfDay || '時間帯を絞れません';
    if (Array.isArray(ev.window) && ev.window.every(Number.isFinite)) return presentation.time(ev.window[0]) + '–' + presentation.time(ev.window[1]);
    return Number.isFinite(ev.peak) ? presentation.time(ev.peak) + 'ごろ' : '';
  }
  function update() {
    reconcilePlace();
    const root = host();
    if (!root) return;
    const hit = entry();
    if (selected && !hit) selected = null;
    for (const button of root.querySelectorAll('.cell[data-cell]')) {
      button.setAttribute('aria-pressed', String(!!selected && button.dataset.cell === selected.id + '|' + selected.dayMs));
      if (selected) button.setAttribute('aria-controls', summaryId);
      else button.removeAttribute('aria-controls');
    }
    if (!selected || !hit) { removeSummary(); return; }
    const id = selected.id, ev = hit.evaluation, p = presentation, e = p.escape;
    let box = root.querySelector('#' + summaryId);
    if (!box) { box = document.createElement('section'); box.id = summaryId; box.className = 'card forecast-selection'; box.setAttribute('aria-labelledby', summaryId + 'Title'); root.append(box); }
    const unavailable = ev.unavailable;
    const grade = unavailable ? null : p.grade(ev);
    const phrase = unavailable ? null : p.phrase(id, ev);
    const when = timing(id, ev);
    box.innerHTML = `<div class="forecast-selection-head"><div class="ph-head"><span class="ic">${p.icon(id, ev.peak)}</span><span class="nm" id="${summaryId}Title">${e(p.name(id))}</span></div><button type="button" class="tap forecast-selection-open">詳細を見る →</button><button type="button" class="tap forecast-selection-close" aria-label="プレビューを閉じる">×</button></div>`
      + `<div class="forecast-selection-overview"><span class="muted">${e(p.day(hit.dayMs, context().now))}</span>`
      + (unavailable ? '' : `<span class="forecast-selection-verdict" style="color:${p.color(ev)}">${e(phrase.label)} <span class="forecast-selection-score">${Math.round(ev.score)} <span class="grade" title="${e(grade.caption)}" aria-label="信頼度${e(grade.key)}">${e(grade.key)}</span></span></span>`) + '</div>'
      + (unavailable ? `<p class="ph-out">${e(unavailable.message)}</p>` : `${when ? `<div class="forecast-selection-time">${e(when)}</div>` : ''}<p class="forecast-selection-say">${e(phrase.say)}</p>${p.bands(ev)}`);
    box.querySelector('.forecast-selection-open').onclick = () => {
      const current = entry();
      if (current && selected) openDetail(selected.id, current.dayMs);
    };
    box.querySelector('.forecast-selection-close').onclick = () => {
      const cell = selected && [...root.querySelectorAll('.cell[data-cell]')].find(button => button.dataset.cell === selected.id + '|' + selected.dayMs);
      selected = null; update(); cell?.focus({ preventScroll: true });
    };
  }
  function restore() {
    update();
    const root = host(), scroller = root?.querySelector('.mxscroll');
    if (scroller) { scroller.scrollLeft = scrollLeft; scroller.classList.toggle('scrolled', scroller.scrollLeft > 0); }
    if (focusedCell) {
      const button = [...root.querySelectorAll('.cell[data-cell]')].find(node => node.dataset.cell === focusedCell);
      button?.focus({ preventScroll: true });
    }
    focusedCell = null;
  }
  function select(id, dayMs) {
    reconcilePlace();
    const hit = context().weeks[id]?.find(item => item.dayMs === dayMs);
    if (!hit) return false;
    selected = { id, dayMs };
    update();
    const p = presentation, ev = hit.evaluation;
    announce(`${p.day(dayMs, context().now)} ${p.name(id)}。${ev.unavailable ? ev.unavailable.message : p.phrase(id, ev).label}。プレビューで時間帯を確認できます`);
    return true;
  }
  function waiting() { reconcilePlace(); removeSummary(); }
  return { capture, restore, select, waiting };
})
