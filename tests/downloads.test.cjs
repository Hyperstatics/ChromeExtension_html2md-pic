const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function background(download) {
  let listener;
  const context = vm.createContext({
    URL, console,
    chrome: {
      runtime: {
        onMessage: { addListener(fn) { listener = fn; } },
        onInstalled: { addListener() {} }
      },
      // No completion events: downloads may remain in progress indefinitely.
      downloads: { download }
    }
  });
  vm.runInContext(fs.readFileSync('background/background.js', 'utf8'), context);
  return { context, send(data, respond) { return listener({ action: 'saveArticle', data }, {}, respond); } };
}

function article(images = []) {
  return {
    content: images.map(image => `![photo](${image.originalUrl})`).join('\n'),
    fileName: 'WebArticles/test.md', images,
    imageFolderName: 'test_images', imageFolderPath: 'WebArticles/test_images'
  };
}
const image = originalUrl => ({ originalUrl });

test('background queues all files even when popup is gone and no download completes', async () => {
  const calls = [];
  let acceptMarkdown;
  let respond;
  const done = new Promise(resolve => { respond = resolve; });
  const bg = background(options => {
    calls.push(options);
    return calls.length === 1 ? new Promise(resolve => { acceptMarkdown = resolve; }) : Promise.resolve(calls.length);
  });
  assert.equal(bg.send(article([image('https://example.com/a.png'), image('https://example.com/b.webp')]), respond), true);
  assert.equal(calls.length, 1);
  // The caller sends nothing else; destroying the popup cannot remove this background work.
  acceptMarkdown(1);
  const result = await done;
  assert.equal(result.success, true);
  assert.equal(calls.length, 3);
  assert.equal(result.data.images.queued, 2);
  const markdown = decodeURIComponent(calls[0].url.split(',')[1]);
  assert.match(markdown, /test_images\/image-001.png/);
  assert.match(markdown, /test_images\/image-002.webp/);
  assert.equal(calls[1].filename, 'WebArticles/test_images/image-001.png');
  assert.equal(calls[2].filename, 'WebArticles/test_images/image-002.webp');
});

test('one rejected image does not prevent later images being queued', async () => {
  const calls = [];
  const bg = background(async options => {
    calls.push(options);
    if (options.url === 'invalid') throw new Error('Invalid URL');
    return calls.length;
  });
  const result = await new Promise(resolve => bg.send(article([image('invalid'), image('https://example.com/ok.jpeg')]), resolve));
  assert.equal(result.success, true);
  assert.equal(result.data.images.failed, 1);
  assert.equal(result.data.images.queued, 1);
  assert.equal(calls[2].filename, 'WebArticles/test_images/image-002.jpg');
});

test('Markdown-only export submits exactly one download', async () => {
  const calls = [];
  const bg = background(async options => { calls.push(options); return 1; });
  const data = article();
  data.content = '中文内容 ![remote](https://example.com/a.png)';
  const result = await new Promise(resolve => bg.send(data, resolve));
  assert.equal(result.success, true);
  assert.equal(result.data.images.total, 0);
  assert.equal(calls.length, 1);
  assert.equal(decodeURIComponent(calls[0].url.split(',')[1]), data.content);
});

test('Markdown initiation errors are returned without claiming success', async () => {
  const bg = background(async () => { throw new Error('disk unavailable'); });
  const result = await new Promise(resolve => bg.send(article(), resolve));
  assert.equal(result.success, false);
  assert.equal(result.error, 'disk unavailable');
});

test('local references retain literal dollar signs in titles', async () => {
  const calls = [];
  const bg = background(async options => { calls.push(options); return calls.length; });
  const data = article([image('https://example.com/a.PNG?size=1')]);
  data.imageFolderName = '$&_images';
  await new Promise(resolve => bg.send(data, resolve));
  assert.equal(decodeURIComponent(calls[0].url.split(',')[1]), '![photo](./$&_images/image-001.png)');
});

test('popup submits one complete job and blocks duplicate clicks while submitting', async () => {
  const elements = new Map();
  const messages = [];
  let respond;
  const context = vm.createContext({
    console, setTimeout() {},
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: 'WebArticles', checked: true, addEventListener() {} });
        return elements.get(id);
      },
      addEventListener() {}
    },
    chrome: { runtime: { sendMessage(message) {
      messages.push(message);
      return new Promise(resolve => { respond = resolve; });
    } } }
  });
  vm.runInContext(fs.readFileSync('popup/popup.js', 'utf8'), context);
  vm.runInContext(`
    showProgress = updateProgress = updateProgressStep = showToast = () => {};
    extractedArticle = { title: 'Test', markdown: '![a](https://example.com/a.png)', images: [{ originalUrl: 'https://example.com/a.png' }] };
  `, context);
  const first = vm.runInContext('saveMarkdown()', context);
  await vm.runInContext('saveMarkdown()', context);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].action, 'saveArticle');
  assert.equal(messages[0].data.images.length, 1);
  assert.equal(messages[0].data.fileName, 'WebArticles/Test.md');
  respond({ success: true, data: { images: { queued: 1, failed: 0, total: 1 } } });
  await first;
  assert.equal(elements.get('saveBtn').disabled, false);
  assert.equal(messages.length, 1);
});
