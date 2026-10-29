
const UI_ICONS = {"observer": "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"6\" y=\"3\" width=\"12\" height=\"7\" rx=\"1.5\"/><circle cx=\"13\" cy=\"6.5\" r=\"2\"/><path d=\"M12 10v3m0 0L5 22m7-9 7 9m-7-9v9\"/></svg>", "pin": "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0Z\"/><circle cx=\"12\" cy=\"9\" r=\"2.5\"/></svg>", "search": "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10.5\" cy=\"10.5\" r=\"6.5\"/><path d=\"M15.5 15.5 21 21\"/></svg>", "map": "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16\"/></svg>", "recenter": "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 7V3h4m6 0h4v4M5 17v4h4m6 0h4v-4M12 13v8m0-8-5 8m5-8 5 8\"/><rect x=\"8\" y=\"7\" width=\"8\" height=\"6\" rx=\"1\"/></svg>", "history": "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 7v5h5M3.5 11a9 9 0 1 1 2 7\"/><path d=\"M12 7v5l3 2\"/></svg>", "upload": "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 16V3m-4 4 4-4 4 4M4 15v5h16v-5\"/></svg>", "download": "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3v13m-4-4 4 4 4-4M4 17v4h16v-4\"/></svg>", "photo": "<svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8\" cy=\"8\" r=\"2\"/><path d=\"m3 17 5-5 4 4 4-7 5 8\"/></svg>"};
// E185: visual choices forward to the original native control; no calculation path is added.
function uiVisualChoices(select, kind) {
  if (!select) return;
  let group = select.parentElement.querySelector('[data-visual-choices]');
  if (!group) {
    select.hidden = true;
    group = document.createElement('div'); group.className = 'camera-visual-choices';
    group.dataset.visualChoices = kind; group.setAttribute('role', 'group');
    group.setAttribute('aria-label', select.getAttribute('aria-label'));
    select.parentElement.classList.add('camera-visual-row');
    for (const option of Array.from(select.options)) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'camera-visual-choice';
      b.dataset.visualValue = option.value; b.setAttribute('aria-label', option.textContent);
      const portrait = option.value === 'portrait', grid = option.value !== 'none';
      let drawing = kind === 'orientation' ? (portrait ? '<rect x="9" y="3" width="18" height="30" rx="2"/>' : '<rect x="3" y="8" width="30" height="20" rx="2"/>') : '<rect x="3" y="8" width="30" height="20" rx="1"/>';
      if (kind === 'grid' && grid) drawing += '<path d="M13 8v20m10-20v20M3 14.7h30M3 21.3h30"/>';
      if (kind === 'grid' && option.value === 'diagonal') drawing += '<path d="m3 8 30 20M33 8 3 28"/>';
      b.innerHTML = '<svg viewBox="0 0 36 36" width="44" height="36" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' + drawing + '</svg><span>' + (option.value === 'diagonal' ? '9分割<small>＋対角</small>' : option.textContent) + '</span>';
      b.onclick = () => { if (select.value === option.value) return; select.value = option.value; select.dispatchEvent(new Event('change', {bubbles: true})); uiVisualChoices(select, kind); };
      group.append(b);
    }
    select.parentElement.append(group);
  }
  for (const b of group.children) {
    const option = Array.from(select.options).find(o => o.value === b.dataset.visualValue);
    const disabled = select.disabled || !!option?.disabled, hidden = !!option?.hidden;
    if (b.disabled !== disabled) b.disabled = disabled; if (b.hidden !== hidden) b.hidden = hidden;
    const on = String(select.value === b.dataset.visualValue);
    if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on);
  }
}
