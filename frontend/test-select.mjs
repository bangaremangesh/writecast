import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173/board', { waitUntil: 'networkidle0' });

  // Select shape tool
  await page.evaluate(() => {
    document.querySelector('button[title="Shapes"]').click();
  });
  
  // Select rectangle
  await page.evaluate(() => {
    document.querySelector('button[title="Rectangle"]').click();
  });

  // Draw rectangle
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(300, 300);
  await page.mouse.up();

  // Try clicking it to see if it moves
  
  // Now explicitly select tool
  await page.evaluate(() => {
    document.querySelector('button[title="Select/Move"]').click();
  });

  // Try moving
  await page.mouse.move(250, 250);
  await page.mouse.down();
  await page.mouse.move(400, 400);
  await page.mouse.up();

  // Draw a path using pen
  await page.evaluate(() => {
    document.querySelector('button[title="Pen"]').click();
  });
  
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(150, 150);
  await page.mouse.up();

  // Switch to select
  await page.evaluate(() => {
    document.querySelector('button[title="Select/Move"]').click();
  });

  // Try moving the path
  await page.mouse.move(125, 125);
  await page.mouse.down();
  await page.mouse.move(150, 200);
  await page.mouse.up();

  await page.screenshot({ path: 'final-debug.png' });
  
  console.log("Screenshot saved.");

  await browser.close();
})();
