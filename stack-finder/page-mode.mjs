// Finder-only composition. URL fragments are anchors, never application selectors.
// Keep this exported helper for compatibility with existing composition tests.
export const isValidationMode = () => true;

export function initializePage(view) {
  const doc = view.document;
  doc.documentElement.setAttribute('data-finder-validation', '');
  // Do not instantiate the legacy template or load legacy scripts for old/unknown
  // fragments. Preserve the URL and native anchor behavior, with no forced reload.
  doc.getElementById('legacy-app-root')?.remove();
}

if (typeof window !== 'undefined') initializePage(window);
