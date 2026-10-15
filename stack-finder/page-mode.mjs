// Page composition only. Finder decisions and analytics have independent mounts.
export const isValidationMode = hash => hash === '#stack-finder';

export function initializePage(view) {
  const doc = view.document;
  const validation = isValidationMode(view.location.hash);
  if (validation) {
    doc.documentElement.setAttribute('data-finder-validation', '');
  } else {
    const placeholder = doc.getElementById('legacy-app-root');
    if (placeholder) {
      placeholder.replaceWith(placeholder.content.cloneNode(true));
      // Preserve the legacy entry point and its ordering, without loading it in validation.
      for (const src of ['/AppEntry.js', '/spark.js']) {
        const script = doc.createElement('script');
        script.src = src;
        script.async = false;
        doc.body.append(script);
      }
    }
  }

  // A fragment change cannot stop an already running Expo app. Reload on mode
  // changes so the next document starts only the selected applications.
  view.addEventListener('hashchange', () => {
    const nextValidation = isValidationMode(view.location.hash);
    if (nextValidation === validation) return;
    if (nextValidation) {
      doc.documentElement.setAttribute('data-finder-validation', '');
      doc.getElementById('root')?.remove();
    }
    view.location.reload();
  });
}

if (typeof window !== 'undefined') initializePage(window);
