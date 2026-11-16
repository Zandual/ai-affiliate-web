/* In-memory only: no cookies, storage, network, or analytics events. */
export function textScale(value) {
  return ['100', '125', '150'].includes(String(value)) ? String(value) : '100';
}
export function colorTheme(value) {
  return ['default', 'contrast', 'light'].includes(value) ? value : 'default';
}
export function setupAccessibility(doc = document) {
  const root = doc.documentElement;
  const tools = doc.getElementById('accessibility-tools');
  const toggle = doc.getElementById('accessibility-toggle');
  const panel = doc.getElementById('accessibility-panel');
  const size = doc.getElementById('accessibility-text');
  const theme = doc.getElementById('accessibility-theme');
  const reset = doc.getElementById('accessibility-reset');
  const status = doc.getElementById('accessibility-status');
  if (![tools, toggle, panel, size, theme, reset, status].every(Boolean)) return;
  const initialFontSize = root.style.fontSize;
  function apply() {
    const scale = textScale(size.value);
    root.style.fontSize = scale === '100' ? initialFontSize : scale + '%';
    const selectedTheme = colorTheme(theme.value);
    root.setAttribute('data-display-theme', selectedTheme);
    root.toggleAttribute('data-higher-contrast', selectedTheme === 'contrast');
    status.textContent = (scale === '100' ? 'Browser default text size.' : 'Text size ' + scale + '%.') +
      ' Theme: ' + ({default:'Default (warm)', contrast:'High contrast', light:'Light (white)'})[selectedTheme] + '.';
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
  theme.addEventListener('change', apply);
  reset.addEventListener('click', () => { size.value = '100'; theme.value = 'default'; apply(); });
  tools.hidden = false;
}
if (typeof document !== 'undefined') setupAccessibility();
