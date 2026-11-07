const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[type=file]', { timeout: 10000 });

  const sampleFiles = [
    ['service.py', '.tmp-sample/pkg/service.py'],
    ['main.ts', '.tmp-sample/main.ts'],
    ['Risk.java', '.tmp-sample/Risk.java'],
  ].map(([name, file]) => ({
    name,
    content: fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'),
  }));

  await page.evaluate((items) => {
    const input = document.querySelector('input[type=file]');
    const transfer = new DataTransfer();
    for (const item of items) transfer.items.add(new File([item.content], item.name, { type: 'text/plain' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, sampleFiles);
  await page.waitForFunction(() => document.body.innerText.includes('健康度总分'), { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));

  const measure = async (label) => {
    const metrics = await page.evaluate(() => ({
      title: document.title,
      innerHeight: window.innerHeight,
      docScroll: document.documentElement.scrollHeight,
      bodyScroll: document.body.scrollHeight,
      mainScroll: document.querySelector('main')?.scrollHeight ?? 0,
      mainClient: document.querySelector('main')?.clientHeight ?? 0,
      text: document.body.innerText.slice(0, 120).replace(/\n/g, ' '),
    }));
    console.log(label, JSON.stringify(metrics));
    await page.screenshot({ path: path.join(SHOTS, `${label}.png`) });
    return metrics;
  };

  await measure('01-overview');

  // health popover
  const help = await page.$('[aria-label="查看健康度计算方式"]');
  if (help) {
    const box = await help.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await new Promise((r) => setTimeout(r, 350));
    const popover = await page.evaluate(() => {
      const tooltip = document.querySelector('[role="tooltip"]');
      if (!tooltip) return null;
      const rect = tooltip.getBoundingClientRect();
      return {
        text: tooltip.innerText.slice(0, 400),
        width: rect.width,
        left: rect.left,
        right: rect.right,
        inViewport: rect.left >= 0 && rect.right <= window.innerWidth,
      };
    });
    console.log('health-popover', JSON.stringify(popover));
    await page.screenshot({ path: path.join(SHOTS, '02-health-popover.png') });
    await page.mouse.move(700, 500);
  }

  const routes = [
    ['project-structure', '项目结构'],
    ['logic', '逻辑说明'],
    ['graphs', '关系图谱'],
    ['metrics', '质量体检'],
    ['solid', '设计检查'],
    ['risks', '风险专项评估'],
  ];
  for (const [key, label] of routes) {
    const ok = await page.evaluate((text) => {
      const buttons = [...document.querySelectorAll('nav button')];
      const button = buttons.find((item) => item.textContent?.trim() === text);
      if (button) {
        button.click();
        return true;
      }
      return false;
    }, label);
    if (!ok) {
      console.log('nav-missing', label);
      continue;
    }
    await new Promise((r) => setTimeout(r, 900));
    await measure(`03-${key}`);
  }

  // 展开质量体检里的第一个风险分组
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('nav button')];
    buttons.find((item) => item.textContent?.trim() === '质量体检')?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const expanded = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('[id^="risk-group-"] button[aria-expanded="false"]')];
    if (groups[0]) {
      groups[0].click();
      return true;
    }
    return false;
  });
  await new Promise((r) => setTimeout(r, 500));
  console.log('risk-group-expanded', expanded);
  await page.screenshot({ path: path.join(SHOTS, '04-metrics-expanded.png') });

  // 图谱：滚轮缩放 + 点击节点抽屉
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('nav button')];
    buttons.find((item) => item.textContent?.trim() === '关系图谱')?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const graphInfo = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.graph-node')];
    return { nodes: nodes.length, edges: document.querySelectorAll('.graph-canvas path').length };
  });
  console.log('graph-info', JSON.stringify(graphInfo));
  const canvas = await page.$('.graph-canvas');
  if (canvas) {
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel({ deltaY: -240 });
    await new Promise((r) => setTimeout(r, 300));
    const zoom = await page.evaluate(() => {
      const badge = [...document.querySelectorAll('div')].find((el) => /^\d+%$/.test(el.textContent?.trim() ?? ''));
      return badge?.textContent?.trim();
    });
    console.log('graph-zoom', zoom);
    const clicked = await page.evaluate(() => {
      const node = document.querySelector('.graph-node');
      if (!node) return null;
      const id = node.getAttribute('data-node');
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return id;
    });
    await new Promise((r) => setTimeout(r, 500));
    const drawer = await page.evaluate(() => document.querySelector('aside')?.innerText?.slice(0, 160).replace(/\n/g, ' ') ?? null);
    console.log('graph-click', clicked, 'drawer', drawer);
    await page.screenshot({ path: path.join(SHOTS, '05-graph-drawer.png') });
  }

  console.log('browser-errors', JSON.stringify(errors));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
