const path=require('path');
const puppeteer=require('puppeteer-core');
(async()=>{
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox']});
 const page=await browser.newPage();
 await page.setViewport({width:1440,height:900});
 page.on('console',m=>console.log('CONSOLE',m.type(),m.text()));
 page.on('pageerror',e=>console.log('PAGEERROR',e.message));
 page.on('response',async r=>{if(r.url().includes('/api/')) console.log('RESP',r.status(),r.url());});
 await page.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle0'});
 await new Promise(r=>setTimeout(r,800));
 console.log('BEFORE', (await page.evaluate(()=>document.body.innerText)).slice(0,600).replace(/\n/g,' | '));
 const files=[
  path.resolve('C:/Users/qianyk/Desktop/CodeLens _1/.tmp-sample/pkg/service.py'),
  path.resolve('C:/Users/qianyk/Desktop/CodeLens _1/.tmp-sample/main.ts'),
  path.resolve('C:/Users/qianyk/Desktop/CodeLens _1/.tmp-sample/Risk.java')
 ];
 console.log('files exist',files.map(f=>[f,require('fs').existsSync(f)]));
 const input=await page.$('input[type=file]');
 console.log('input',!!input, await page.evaluate(()=>{const i=document.querySelector('input[type=file]');return i?{multiple:i.multiple,dir:i.hasAttribute('webkitdirectory'),hidden:i.className}:null}));
 await input.uploadFile(...files);
 await new Promise(r=>setTimeout(r,6000));
 console.log('AFTER', (await page.evaluate(()=>document.body.innerText)).slice(0,1200).replace(/\n/g,' | '));
 await page.screenshot({path:'.check/debug.png'});
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
