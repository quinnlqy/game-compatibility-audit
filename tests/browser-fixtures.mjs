/** Fixture smoke tests, not a game audit. Use the project's installed Playwright. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {installCapabilityFaults, installHostOccupancy, installClearcoatFault, readMainWorld}
  from '../skills/game-compatibility-audit/scripts/capability-fixtures.mjs';

const moduleName = process.env.PLAYWRIGHT_MODULE;
const {chromium} = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const server = http.createServer((_req, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><html><head></head><body><button id="under" style="position:fixed;top:0;left:0;width:120px;height:60px">Fixture</button></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless: true,
  ...(process.env.BROWSER_CHANNEL ? {channel: process.env.BROWSER_CHANNEL} : {})});
const checks = [];
async function run(name, action) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await action(page, context);
    checks.push({name, passed: true});
  } finally { await context.close(); }
}
function readRedPixel() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const gl = canvas.getContext('webgl', {preserveDrawingBuffer: true});
  if (!gl) throw new Error('Fixture requires a WebGL context; no GPU conclusion can be made');
  const shader = (type, source) => {
    const item = gl.createShader(type);
    gl.shaderSource(item, source);
    gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item));
    return item;
  };
  const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){gl_Position=vec4(a,0.0,1.0);}');
  const fragment = shader(gl.FRAGMENT_SHADER,
    '#define USE_CLEARCOAT\nprecision mediump float; void main(){gl_FragColor=vec4(1.0,0.0,0.0,1.0);}');
  const program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, 'a');
  gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0,0,8,8); gl.drawArrays(gl.TRIANGLES,0,3);
  const pixel = new Uint8Array(4); gl.readPixels(4,4,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return {pixel: [...pixel], stats: window.__compatShaderStats ?? null};
}
try {
  await run('healthy context remains native', async page => {
    await page.goto(origin);
    assert.equal(await page.evaluate(() => [1,2].at(-1)), 2);
  });
  await run('missing global read via CDP', async (page, context) => {
    await context.addInitScript(installCapabilityFaults, {faults: ['no-globalThis']});
    await page.goto(origin);
    assert.equal(await readMainWorld(page, 'typeof globalThis'), 'undefined');
    const stats = await readMainWorld(page, 'window.__compatFaultStats');
    assert.deepEqual(stats.failed, []); assert.ok(stats.installed.includes('no-globalThis'));
  });
  await run('runtime API faults are installed and isolated', async (page, context) => {
    await context.addInitScript(installCapabilityFaults, {faults: ['no-array-at','no-replaceChildren','uuid-throws']});
    await page.goto(origin);
    const result = await page.evaluate(() => {
      try { crypto.randomUUID(); } catch {}
      return {at: typeof Array.prototype.at, dom: typeof document.body.replaceChildren,
        stats: window.__compatFaultStats};
    });
    assert.equal(result.at, 'undefined'); assert.equal(result.dom, 'undefined');
    assert.deepEqual(result.stats.failed, []); assert.equal(result.stats.hits.randomUUID, 1);
  });
  await run('unknown fault cannot silently pass', async (page, context) => {
    await context.addInitScript(installCapabilityFaults, {faults: ['not-a-real-fault']});
    await page.goto(origin);
    const stats = await page.evaluate(() => window.__compatFaultStats);
    assert.equal(stats.failed.length, 1);
  });
  await run('storage injection only affects selected keys', async (page, context) => {
    await context.addInitScript(installCapabilityFaults,
      {faults: ['storage-silent-write'], storageKeys: ['fixture-blocked']});
    await page.goto(origin);
    const result = await page.evaluate(() => {
      localStorage.setItem('fixture-blocked','x'); localStorage.setItem('fixture-ok','y');
      return {blocked: localStorage.getItem('fixture-blocked'), ok: localStorage.getItem('fixture-ok'),
        stats: window.__compatFaultStats};
    });
    assert.equal(result.blocked, null); assert.equal(result.ok, 'y');
    assert.equal(result.stats.hits['storage-silent-write'], 1);
  });
  await run('late host occupancy intercepts clicks without resize', async (page, context) => {
    await context.addInitScript(() => {
      window.fixtureResizes = 0; addEventListener('resize', () => window.fixtureResizes++);
    });
    await context.addInitScript(installHostOccupancy, {delayMs: 60, source: 'stylesheet',
      variables: {'--fixture-safe-top':'60px'}, rects: [{top:0,left:0,width:120,height:60}],
      dispatchResize: false});
    await page.goto(origin);
    await page.waitForFunction(() => window.__compatHostStats?.installed);
    await page.mouse.click(30, 30);
    const result = await page.evaluate(() => ({resizes: window.fixtureResizes,
      clicks: window.__compatHostStats.clicks,
      value: getComputedStyle(document.documentElement).getPropertyValue('--fixture-safe-top').trim()}));
    assert.equal(result.resizes, 0); assert.equal(result.clicks, 1); assert.equal(result.value,'60px');
  });
  await run('healthy shader produces actual red pixels', async page => {
    await page.goto(origin);
    const result = await page.evaluate(readRedPixel);
    assert.ok(result.pixel[0] > 240 && result.pixel[1] < 10 && result.pixel[3] > 240);
  });
  await run('clearcoat fault produces black pixels and records hit', async (page, context) => {
    await context.addInitScript(installClearcoatFault);
    await page.goto(origin);
    const result = await page.evaluate(readRedPixel);
    assert.deepEqual(result.pixel.slice(0,3), [0,0,0]);
    assert.ok(result.pixel[3] > 240); assert.equal(result.stats.matchedShaders, 1);
  });
  console.log(JSON.stringify({kind:'synthetic-browser-fixture-tests', passed:true, checks},null,2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
