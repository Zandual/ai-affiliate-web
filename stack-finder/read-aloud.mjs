/* Optional local-voice speech only. No network, storage, microphone or analytics. */
export function localEnglishVoice(voices) {
  return voices.find(v => v.localService === true && /^en(?:[-_]|$)/i.test(v.lang) && v.default)
    || voices.find(v => v.localService === true && /^en(?:[-_]|$)/i.test(v.lang));
}
export function speechChunks(text) {
  const words = text.trim().split(/\s+/).filter(Boolean), chunks = [];
  let part = '';
  for (const word of words) {
    if (part && part.length + word.length > 220) { chunks.push(part); part = ''; }
    part += (part ? ' ' : '') + word;
  }
  if (part) chunks.push(part);
  return chunks;
}
export function setupReadAloud(doc = document, view = doc.defaultView) {
  const button = doc.getElementById('read-aloud');
  const status = doc.getElementById('read-aloud-status');
  const content = doc.getElementById('stack-finder');
  if (!button || !status || !content) return;
  const synth = view.speechSynthesis;
  let active = false, generation = 0, timer, utterance;
  function finish(message) {
    const wasActive = active;
    active = false; generation++;
    view.clearTimeout(timer);
    utterance = null;
    button.textContent = 'Read aloud';
    status.textContent = message;
    if (wasActive) {
      try { synth.cancel(); }
      catch { status.textContent = 'Stop requested, but the browser speech engine did not respond. Close this tab if audio continues.'; }
    }
  }
  function available() {
    if (active) return;
    let voice;
    try { voice = localEnglishVoice(synth?.getVoices() || []); } catch {}
    button.disabled = !voice || typeof view.SpeechSynthesisUtterance !== 'function';
    status.textContent = button.disabled
      ? 'Read aloud unavailable: this browser has no local English voice. All text remains available.'
      : 'Read aloud is off. Reads the current Finder section using a browser-reported local English voice. No remote voices are used. If you use a screen reader, leave this off.';
    return voice;
  }
  button.addEventListener('click', () => {
    if (active) { finish('Reading stopped.'); return; }
    const voice = available();
    if (button.disabled) return;
    if (synth.speaking || synth.pending) { status.textContent = 'Other page speech is busy. Try again when it finishes.'; return; }
    const chunks = speechChunks(content.innerText || '');
    if (!chunks.length) { status.textContent = 'Nothing to read in the current Finder section.'; return; }
    active = true;
    const token = ++generation;
    button.textContent = 'Stop reading';
    status.textContent = 'Reading the current Finder section. Select Stop reading to stop. Changing the questionnaire or leaving this tab also stops reading.';
    function next() {
      if (!active || token !== generation) return;
      if (!chunks.length) { finish('Reading finished.'); return; }
      try {
        utterance = new view.SpeechSynthesisUtterance(chunks.shift());
        utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 1;
        utterance.onend = () => { if (token !== generation) return; view.clearTimeout(timer); next(); };
        utterance.onerror = () => { if (token === generation) finish('Reading unavailable or interrupted. You can try Read aloud again.'); };
        timer = view.setTimeout(() => { if (token === generation) finish('Reading timed out. You can try Read aloud again.'); }, 45000);
        synth.speak(utterance);
      } catch { finish('Reading unavailable. You can still read all text on this page.'); }
    }
    next();
  });
  // Do not announce prose through aria-live or move focus: speech is opt-in only.
  const stopForChange = () => { if (active) finish('Reading stopped because the Finder changed. Select Read aloud to read the new section.'); };
  const observer = new view.MutationObserver(stopForChange);
  observer.observe(content, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['open', 'hidden', 'aria-hidden'] });
  // Native form edits and details toggles need not alter text nodes.
  content.addEventListener('input', stopForChange);
  content.addEventListener('change', stopForChange);
  content.addEventListener('toggle', stopForChange, true);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden && active) finish('Reading stopped.'); });
  view.addEventListener('pagehide', () => { if (active) finish('Reading stopped.'); });
  synth?.addEventListener?.('voiceschanged', available);
  available();
}
if (typeof document !== 'undefined') setupReadAloud();
