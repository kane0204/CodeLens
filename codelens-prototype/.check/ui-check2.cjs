const path=require('path');
const fs=require('fs');
const puppeteer=require('puppeteer-core');
(async()=>{
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox']});
 const page=await browser.newPage();
 await page.setViewport({width:1440,height:900});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle0'});
 const sampleFiles=[['service.py','.tmp-sample/pkg/service.py'],['main.ts','.tmp-sample/main.ts'],['Risk.java','.tmp-sample/Risk.java']]
  .map(([name,file])=>({name,content:fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8')}));
 await page.evaluate(items=>{const i=document.querySelector('input[type=file]');const dt=new DataTransfer();for(const it of items)dt.items.add(new File([it.content],it.name));i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));},sampleFiles);
 await page.waitForFunction(()=>document.body.innerText.includes('健康度总分'),{timeout:30000});

 // 图谱缩放
 await page.evaluate(()=>{[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim()==='关系图谱').click();});
 await new Promise(r=>setTimeout(r,900));
 const canvasBox=await (await page.$('.graph-canvas')).boundingBox();
 await page.mouse.move(canvasBox.x+canvasBox.width/2,canvasBox.y+canvasBox.height/2);
 await page.mouse.wheel({deltaY:-300});
 await new Promise(r=>setTimeout(r,400));
 let zoom=await page.evaluate(()=>document.querySelector('.graph-canvas')?.parentElement?.parentElement?.innerText.match(/\d+%/)?.[0]);
 console.log('zoom-after-wheel',zoom);
 // 拖拽平移
 const before=await page.evaluate(()=>document.querySelector('.graph-canvas g')?.getAttribute('transform'));
 await page.mouse.move(canvasBox.x+300,canvasBox.y+200);
 await page.mouse.down();
 await page.mouse.move(canvasBox.x+380,canvasBox.y+260,{steps:5});
 await page.mouse.up();
 const after=await page.evaluate(()=>document.querySelector('.graph-canvas g')?.getAttribute('transform'));
 console.log('pan-changed',before,'->',after);
 await page.screenshot({path:'.check/shots/06-graph-zoom.png'});

 // 设置弹窗校验
 await page.click('[aria-label="模型设置"]');
 await new Promise(r=>setTimeout(r,300));
 await page.type('#llm-base-url','ftp://bad');
 await page.click('button[form="llm-settings-form"]');
 await new Promise(r=>setTimeout(r,300));
 const settingErr=await page.evaluate(()=>document.querySelector('[role=alert]')?.textContent??null);
 console.log('settings-url-error',settingErr);
 await page.evaluate(()=>{document.querySelector('#llm-base-url').value='';});
 await page.keyboard.press('Escape');
 await new Promise(r=>setTimeout(r,300));

 // 重新导入确认
 await page.evaluate(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.includes('重新导入')).click();});
 await new Promise(r=>setTimeout(r,300));
 const confirmText=await page.evaluate(()=>document.querySelector('[role=dialog]')?.innerText?.slice(0,120).replace(/\n/g,' '));
 console.log('confirm-dialog',confirmText);
 await page.screenshot({path:'.check/shots/07-confirm.png'});
 await page.evaluate(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.includes('取消'))?.click();});

 // 逻辑说明页
 await page.evaluate(()=>{[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim()==='逻辑说明').click();});
 await new Promise(r=>setTimeout(r,700));
 await page.screenshot({path:'.check/shots/08-logic.png'});

 // 768px 窄屏
 await page.setViewport({width:760,height:900});
 await new Promise(r=>setTimeout(r,600));
 await page.screenshot({path:'.check/shots/09-narrow-logic.png'});
 await page.evaluate(()=>{[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim()==='总览').click();});
 await new Promise(r=>setTimeout(r,600));
 await page.screenshot({path:'.check/shots/10-narrow-overview.png'});
 console.log('errors',JSON.stringify(errors));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
