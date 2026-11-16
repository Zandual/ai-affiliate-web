/* In-memory only: no cookies, storage, network, or analytics events. */
export function textScale(value) {
  return ['100', '125', '150'].includes(String(value)) ? String(value) : '100';
}
export function setupAccessibility(doc = document) {
  const root = doc.documentElement;
  const tools = doc.getElementById('accessibility-tools');
  const toggle = doc.getElementById('accessibility-toggle');
  const panel = doc.getElementById('accessibility-panel');
  const size = doc.getElementById('accessibility-text');
  const contrast = doc.getElementById('accessibility-contrast');
  const reset = doc.getElementById('accessibility-reset');
  const status = doc.getElementById('accessibility-status');
  if (![tools, toggle, panel, size, contrast, reset, status].every(Boolean)) return;
  const initialFontSize = root.style.fontSize;
  function apply() {
    const scale = textScale(size.value);
    root.style.fontSize = scale === '100' ? initialFontSize : scale + '%';
    root.toggleAttribute('data-higher-contrast', contrast.checked);
    status.textContent = (scale === '100' ? 'Browser default text size.' : 'Text size ' + scale + '%.') +
      (contrast.checked ? ' Higher contrast on.' : ' Standard contrast.');
  }
  function close() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); toggle.focus(); event.preventDefault(); }
  });
  size.addEventListener('change', apply);
  contrast.addEventListener('change', apply);
  reset.addEventListener('click', () => { size.value = '100'; contrast.checked = false; apply(); });
  tools.hidden = false;
}
if (typeof document !== 'undefined') setupAccessibility();
