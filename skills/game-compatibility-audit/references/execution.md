# 执行手册

## 何时使用这些工具

普通专项使用项目现有表格/报告即可，不强制JSON。本目录的指纹与JSON工具用于**有实际移动端目标的H5包/目录审计**，提供稳定编号、范围和证据绑定；不替代原生引擎测试器、实际平台PC模拟器或真实设备。

默认生成完整49项计划。聚焦问题可重复传`--case`选择，P03产物检查自动保留。例如：

```text
python <skill>/scripts/init_audit.py --project <repo> --target web=<actual.zip> --case V07 --case V10 --out <evidence-dir>/audit.json
```

生成结果标记`scope.mode=targeted`；只能称所选范围完成。全量计划逐项目标判断适用性，不能从全量计划删除未测行来冒充通过。原生/桌面专用目标沿用[状态与报告约定](evidence-and-report.md)记录各环境结果，不套用本JSON中的手机验收要求。

## 选择测试目标

先按项目指令使用现有构建/测试工具。目标是实际发布入口；ZIP 从最终包解压运行，目录须是最终构建目录，不能用整个仓库替代。保存最近交付的原始包，记录平台独有修复，再改代码。测试过程中的报告、截图、服务器日志放在目标外。

脚本只用 Python 标准库。使用当前机器/项目约定的解释器，先核实`sys.executable`；不要复制来源机器的绝对路径，或向游戏包加入Python依赖。命令中的尖括号均为需要替换的参数，不要直接执行占位符。

```text
python <skill>/scripts/init_audit.py --project <repo> --target web=<actual.zip-or-build-dir> --out <evidence-dir>/audit.json
```

可重复 `--target web=... --target hostA=... --target hostB=...`；只登记实际目标，不创建不存在的平台。命令只生成未测试计划，不改项目文件，也不覆盖已有报告。ZIP 会读取每个成员校验 CRC 并记录 manifest，拒绝路径穿越/重复条目；目录按排序后的相对路径、文件 SHA256 和字节数计算指纹，不接受目录内链接。

每个目标填 `entry`，例如 `index.html` 或 `game/index.html`，必须是该产物里的实际文件。单独 HTML 文件目标的 entry 为文件名。静态托管服务根、入口 URL 和解压副本对应关系写入报告；同一字节 ZIP 不同启动路径需要分别操作。

## 逐项记录

每个 case/target 对都有一行，不能删除未做项：

- `applicability`：`unreviewed` / `applicable` / `not_applicable`。后两者均填 `reason`；不适用要说明技术/功能为何不存在。没有真机或缺工具不能当不适用。P03 始终适用。
- `local_status`：`not_run` / `passed` / `fixed` / `failed` / `blocked`。`fixed` 要有修复前复现与修复后通过证据。`passed` 也需要操作证据，静态扫描不能替代动作。
- `device_status`：`pending` / `passed` / `not_applicable`。适用项即使本地通过也先留 `pending`；手机报告需具体设备/系统/宿主/运行版本。对适用项不能用 device not_applicable 规避未测。
- `notes`：实际操作脚本、入口、正常对照、发现、修复及剩余限制。

`evidence` 是修复后或当前通过证明；`reproduction_evidence` 是修复前证明；`device_evidence` 是真机证明。数组元素格式：

```json
{"file":"J01-web-after.json","sha256":"该证据文件的实际SHA256"}
```

路径相对 audit.json，或绝对路径。证明文件必须来自实际运行，其格式：

```json
{
  "case_id": "J01",
  "target_id": "web",
  "target_sha256": "实际测试产物的SHA256",
  "stage": "after",
  "passed": true,
  "checks": [
    {
      "action": "缺失 globalThis 的新上下文打开实际入口，再点击开始",
      "expected": "进入可操作主场景且无启动异常",
      "observed": "实际状态/日志/断言结果，不能只抄 expected",
      "pass": true
    }
  ],
  "attachments": ["截图或原始测试报告路径，可选"]
}
```

`before` 中 passed 表示**成功复现预期缺陷**，expected 应写失败现象，不是假装旧包正常。`device` 另需：

```json
{"device":{"real_device":true,"model":"实际型号","os":"实际系统版本","host_version":"实际宿主及版本/浏览器版本","build":"实际运行版本"}}
```

首次计划自动保留 `baseline_sha256`/`baseline_path`。新产物生成后使用：

```text
python <skill>/scripts/init_audit.py --snapshot <new-final-artifact>
```

用输出更新目标当前 `path/kind/sha256/bytes/manifest`，保留原基线字段与原包。新包哈希变了，不能批量改旧证明的哈希冒充重测；实际重跑受影响项，重新生成证明。尚未重测的结论留 pending/blocked。本 skill 的严格证明绑定要求当前目标所有通过证明匹配当前包，因此即使代码路径不相关，也需在最终包重新验证或诚实留下未测。

```text
python <skill>/scripts/validate_audit.py <evidence-dir>/audit.json
```

无效、证据篡改、漏项、未完成时非零退出。`--allow-incomplete` 仅允许诚实未完成，不允许无效或哈希不匹配；`--require-device` 在任务要求真实设备验收时使用，必须本地和真机都完成。这两个选项互斥，不能用允许待验绕过真机门禁。输出分别给范围、`local_complete` 与 `device_complete`。校验器只能验证文档结构、覆盖和文件绑定，不能替人玩游戏或识别编造的断言。

## 可复用浏览器故障注入

`scripts/capability-fixtures.mjs` 是纯测试辅助模块。不要复制进游戏包。用项目已有 Playwright/Puppeteer 环境导入；序列化函数在页面脚本前执行，各故障使用新 context。Puppeteer 需用等价 API 适配，`readMainWorld` 只接受 Playwright Chromium Page。

```javascript
import { installCapabilityFaults, readMainWorld, installHostOccupancy,
         installClearcoatFault } from '<skill>/scripts/capability-fixtures.mjs';
const context = await browser.newContext();
await context.addInitScript(installCapabilityFaults, { faults: ['no-globalThis'] });
const page = await context.newPage();
await page.goto(actualEntryUrl, { waitUntil: 'load' });
// 不使用依赖 globalThis 的框架轮询去判断缺 globalThis 的页面。
const injected = await readMainWorld(page, 'window.__compatFaultStats');
// 必须断言 failed 为空、选中故障 installed 命中，并执行实际业务动作/观察实际结果。
```

支持的故障名见模块中的 apply 列表：数组方法、DOM/Canvas、crypto、dialog、CSSOM、全局属性，以及 WebGL2 缺失/抗锯齿上下文创建失败/浮点扩展缺失。每项检查安装结果，支持拦截的地方还应检查 hit 计数。CSSOM、dialog 类与方法是独立故障。保留已有现代浏览器其他能力，因此这不是完整旧 WebView 模拟器，也不检验旧语法解析。

存储注入：`storage-read-denied` / `storage-write-denied` / `storage-silent-write` 要提供 `storageKeys: ['实际权威key']`，`['*']` 明确表示全部；作用于 localStorage 的 getItem/setItem，不劫持 sessionStorage。`storage-getter-denied` 是全对象访问拒绝，不能模拟仅某个 key 拒绝。IndexedDB、宿主缓存、网络、Promise 挂起和原生 JSON EOF 需要按项目建立真实适配器，不能用 localStorage mock 代替所有后端验证。

安全区注入：

```javascript
await context.addInitScript(installHostOccupancy, {
  delayMs: 800,
  variables: { '--项目实际读取的变量': '80px' },
  source: 'stylesheet',
  rects: [{ bottom: 0, right: 0, width: 100, height: 70 }],
  dispatchResize: false
});
```

按项目实际变量和宿主占位调整，80/100/70 只是示例；默认只注入顶层，避免 iframe 重复 inset。`selector` 可指定继承来源容器。控件真实拦截点击，须验证元素命中和实际业务动作。测试晚到、归零、继承、样式表来源、横屏和前后台；单次注入不自动覆盖这些场景，测试需主动更新变量并记录。不要通过强制 resize 掩盖无 resize 的缺陷。

材质注入：`installClearcoatFault` 在匹配 `#define USE_CLEARCOAT` 的 fragment shader 最后一个函数末尾把 RGB 写黑，要求 main 是最后一个函数、gl_FragColor 有效或存在别名。仅适用这种着色器布局；其他引擎提供独立测试钩子。断言 matchedShaders > 0、编译成功、实际读回黑色，并有健康与兼容材质对照。若未匹配/编译失败，该次测试无效；此注入不模拟真实驱动。浮点扩展缺失也不能代替实际 render target 完整性和读回失败测试。

测试结束总是关闭 context/服务器、释放 GPU 资源，防止测试自己制造泄漏。若引用最终包启动测试，包应已定稿，再运行证据收集；从测试报告到证明 JSON 的转换只能整理已有断言，不能生成未经执行的“通过”。

## 跨 DOM / Canvas 工具可见性（I02/I03）

拾取成功不等于玩家看得见手中的工具。除库存/结果断言，还要检查实际图像加载、computed display、所在裁剪容器、层级和触屏专用隐藏规则。使用真实触控先进入供应区、再进入画布、最后在捕获仍有效时返回 UI。`event.target` 在指针捕获下不表示手指所在元素；显示判断用物理坐标与实际命中。图像可用已有透明缓存，不默认新建 WebGL 上下文。

若工具改用独立显示层，验证它不拦截点击，图像不重复、没有留在上一个位置，取消/失焦/放下/结束时正确清理；主场景材质和操作坐标仍保持原行为。UI 透明预览不应出现在成品照片里。不要凭 class 名含 visible 就通过，也不要把桌面鼠标预览通过当触屏也通过。

把显示层移到 body 等组件之外时，必须绑定制作会话的销毁钩子，清理节点和新增监听；不能只等整个网页卸载。单页宿主实际退出（若有放弃确认，须完成确认）并连续重进至少数次，确认每次只有一个当前显示层、退出后没有残留。不要因“返回按钮已点”就假定已经销毁；也不要让测试选择器误中残留在 body 上的 data-recipe 等属性。

跨显示层还需检查手中物品：UI 上不能同时在画布留下携带物残影；回到画布、放置或取消后恢复原对象可见性，不因临时隐藏留下隐形作品。用真实截图/渲染像素验证，不能只看库存扣除或 CSS class。WebGL 未保留绘图缓冲时，呈现后直接读 canvas 可能全黑，测试应在实际渲染帧内读取或使用页面截图，并以已知可见物为正对照确认读取有效。


## 原始资源路径与大小写检查（可选）

对实际ZIP或最终构建目录运行只读标准库工具，不启动游戏、不改路径、不写存档：

```text
python <skill>/scripts/check_resource_paths.py <actual.zip-or-build-dir>
```

输出包含产物SHA-256、原引用/词法解析路径、大小写候选、缺失项及人工复核项；可将标准输出保存在产物目录之外作为证据。精确比较ZIP成员/目录枚举名称，不依赖宿主系统的大小写规则。退出码0表示覆盖范围内静态引用通过，1表示文件/大小写/产物错误，2表示存在未解析内容需人工复核。

覆盖UTF-8 HTML的src/poster、link href、内联样式和CSS url/@import，按各CSS文件目录解析相对路径；先去查询和片段，再解码URL路径。srcset、base href、动态URL及非UTF-8文本列为人工复核，不伪造检查完成。JS构造路径、SVG内部引用、远端依赖与CSP不在此工具范围；根路径引用还要按实际托管前缀运行验证。静态通过不能替代动态资源、运行时映射、图片显示和交互。

复现大小写盲区时保留旧包失败、新包通过两份结果。不要在测试服务器中忽略大小写、把缺资源返回index.html，或预先改写引用以让测试通过；修复应进入项目构建源码。案例与审核结果边界见[审核回归记录](review-regressions.md)。
