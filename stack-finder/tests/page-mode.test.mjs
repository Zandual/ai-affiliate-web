import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { initializePage, isValidationMode } from '../page-mode.mjs';

function page(hash) {
  const scripts = [];
  const attributes = new Map();
  const listeners = new Map();
  const actions = [];
  const fragment = { root: { remove() { actions.push('remove-root'); } } };
  let mountedRoot = null;
  let clones = 0;
  const placeholder = {
    content: { cloneNode(deep) { assert.equal(deep, true); clones++; return fragment; } },
    replaceWith(node) { assert.equal(node, fragment); mountedRoot = node.root; },
  };
  const view = {
    location: { hash, reload() { actions.push('reload'); } },
    addEventListener(name, listener) { listeners.set(name, listener); },
    document: {
      documentElement: { setAttribute(name, value) { attributes.set(name, value); } },
      getElementById(id) { return id === 'legacy-app-root' ? placeholder : id === 'root' ? mountedRoot : null; },
      createElement(tag) { assert.equal(tag, 'script'); return {}; },
      body: { append(script) { scripts.push(script); } },
    },
  };
  return {
    view, scripts, attributes, actions,
    get clones() { return clones; },
    get root() { return mountedRoot; },
    changeHash(next) { view.location.hash = next; listeners.get('hashchange')(); },
  };
}

test('only the exact Finder fragment selects validation mode', () => {
  assert.equal(isValidationMode('#stack-finder'), true);
  for (const hash of ['', '#dashboard', '#stack-finder-extra', '#STACK-FINDER']) {
    assert.equal(isValidationMode(hash), false);
  }
});

test('validation leaves the legacy template inert and loads no legacy scripts', () => {
  const state = page('#stack-finder');
  initializePage(state.view);
  assert.equal(state.attributes.has('data-finder-validation'), true);
  assert.equal(state.clones, 0);
  assert.equal(state.root, null);
  assert.deepEqual(state.scripts, []);
});

test('nonvalidation mounts the preserved root before loading ordered legacy scripts', () => {
  const state = page('');
  state.view.document.body.append = script => {
    assert.ok(state.root, 'the legacy root must exist before an entry script can run');
    state.scripts.push(script);
  };
  initializePage(state.view);
  assert.equal(state.clones, 1);
  assert.equal(state.attributes.has('data-finder-validation'), false);
  assert.deepEqual(state.scripts, [
    { src: '/AppEntry.js', async: false },
    { src: '/spark.js', async: false },
  ]);
});

test('entering validation removes a running legacy root before reloading', () => {
  const state = page('#dashboard');
  initializePage(state.view);
  state.changeHash('#another-legacy-section');
  assert.deepEqual(state.actions, []);
  state.changeHash('#stack-finder');
  assert.equal(state.attributes.has('data-finder-validation'), true);
  assert.deepEqual(state.actions, ['remove-root', 'reload']);
});

test('leaving validation reloads instead of starting legacy code in the old document', () => {
  const state = page('#stack-finder');
  initializePage(state.view);
  state.changeHash('#stack-finder');
  assert.deepEqual(state.actions, []);
  state.changeHash('');
  assert.deepEqual(state.actions, ['reload']);
  assert.equal(state.clones, 0);
  assert.deepEqual(state.scripts, []);
});

test('HTML keeps the root inside its inert template and delegates legacy loading', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const template = html.match(/<template\b[^>]*\bid=["']legacy-app-root["'][^>]*>[\s\S]*?<\/template>/i);
  assert.ok(template, 'legacy root template is present');
  assert.match(template[0], /<div\b[^>]*\bid=["']root["']/i);
  assert.doesNotMatch(html.replace(template[0], ''), /<[^>]+\bid=["']root["']/i);
  const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map(match => match[0]);
  assert.ok(scriptTags.some(tag => /\bsrc=["']\/stack-finder\/page-mode\.mjs["']/.test(tag) && /\btype=["']module["']/.test(tag)));
  assert.equal(scriptTags.some(tag => /\bsrc=["']\/(?:AppEntry|spark)\.js["']/.test(tag)), false);
});
