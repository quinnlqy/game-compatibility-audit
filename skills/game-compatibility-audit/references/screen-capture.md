# 指定界面：尺寸矩阵、批量截图与问题报告

用于“检查订单页在不同屏幕上的样子”“指定界面自动出尺寸和截图”“批量找遮挡/裁切”。本工具运行H5/浏览器页面；原生游戏需要项目已有的实际引擎截图/输入通道，不拿DOM规则代替原生验收。Canvas/WebGL内部对象、文字和像素问题仍需专项检查或人工看图。

## 先确定一个可复现界面

从项目记录找到实际入口、交付包/构建目录、进入步骤和关键控件。用户只给界面名称时，先查已有入口，无法唯一确定再问。完整源码和正式包不同，报告中明确当前对象；不把开发服务器当正式包。

使用隔离浏览器上下文和测试数据，不读取用户个人浏览器资料或真实钱包。只执行打开目标界面所需动作；不默认购买、接单、领取、删档、上传或分享。复杂导航/准备使用项目适配文件，不把具体游戏步骤写进通用skill。

## 配置与运行

复用项目已有Playwright，不自动安装浏览器或在游戏目录添加依赖。Node工具仅依赖Node内置模块和项目的Playwright，支持chromium/webkit/firefox；实际安装了什么引擎就运行什么，没有对应引擎时明确缺口。

在报告目录之外创建配置`screen.json`：

```json
{
  "title": "商店界面屏幕检查",
  "timeoutMs": 20000,
  "matrix": {
    "common": true,
    "boundaries": true,
    "maxCases": 60,
    "bounds": {"minWidth": 320, "maxWidth": 1920, "minHeight": 300, "maxHeight": 1280},
    "sizes": [{"width": 390, "height": 844, "input": "touch", "dpr": 2, "group": "phone-portrait"}]
  },
  "screens": [{
    "id": "shop",
    "title": "商店",
    "url": "/index.html",
    "root": "#app",
    "actions": [{"type": "activate", "selector": "#open-shop"}],
    "readySelector": ".shop-panel:not([hidden])",
    "checks": [
      {"selector": ".shop-close", "label": "关闭", "required": true},
      {"selector": ".shop-confirm", "label": "确认", "required": true},
      {"selector": ".price", "label": "价格", "hitTest": false, "textOverflow": true}
    ]
  }]
}
```

相对URL需要`--serve`。不使用本地静态目录时，`url`填实际`http://`或`https://`地址。配置中的`root`是进入步骤之前就可见的根容器；目标面板晚显示时，用`readySelector`等到进入完成，不把隐藏面板设为前置可见根。

```text
node <skill>/scripts/screen-audit.mjs --config <screen.json> --out <new-report-dir> --serve <actual-build-dir> --project <game-repo> --channel msedge
```

- 不指定`--channel`则使用所选引擎已安装的默认浏览器。WebKit/Firefox不要传Chromium专用channel。
- 不方便按项目解析依赖时，传`--playwright <项目已安装的playwright/index.mjs>`或设`PLAYWRIGHT_MODULE`。不要复制其他机器的绝对路径。
- `--out`必须是新的目录，并位于被测产物之外；工具拒绝覆盖旧证据。`--serve`只读静态文件，不代表真实宿主。
- 支持多个`screens`，每个界面用唯一`id`，分别记录截图与问题。
- `actions`支持`activate/click/tap/waitFor/press`。`activate`按明确配置的`input`选择真实浏览器tap或鼠标click；不按屏宽猜输入方式。`press`另填`key`，`waitFor`可填`state`。

复杂准备：配置`"adapter": "./project-screen.mjs"`，由可信本地文件导出`prepare({page, context, screen, sample, phase})`和/或`settle(...)`。prepare在页面载入、root可见之后且actions之前；settle在actions、readySelector、字体/可见图片有界等待之后。`phase`为`discovery`或`capture`。适配器可等待项目自己的首帧标记、打开测试面板，避免固定睡眠和跳过真实就绪。适配文件与CSS来源均记录哈希；不执行网页提供的不可信脚本。

## 尺寸如何生成

所有尺寸是**CSS可用视口**，不是物理像素，也不对应唯一手机型号。

1. 用户明确指定的`sizes`优先。
2. 默认15种常见手机/短横屏/平板/桌面样本。它们是选样，不是平台统一支持标准。
3. 运行目标界面读取可访问的CSS媒体查询，生成像素宽/高断点的前1px、断点、后1px。宽边界固定参考高度（默认768），高边界固定参考宽度（默认1024）；不声称覆盖所有组合。
4. 可用`cssSources`列出相对配置目录的CSS文件，或`breakpointConditions`补充明确条件。跨域样式表不可读取及无法换算的rem/em/device-width等记录为覆盖缺口，不猜实际像素。发现的是已加载样式中的媒体查询，不保证每条都影响指定界面；容器查询、JS布局阈值和其他动态规则不会自动穷尽，需要项目补充。
5. 指定有限范围扫描可添加：`"sweep": {"widths": [320, 480, 20], "heights": [568, 932, 52]}`。三数为起点、终点、步长；不匹配步长的终点不额外加入。与其他样本合并去重。

`boundaryWidth/boundaryHeight/boundaryInput/dpr`可按项目修改。宽高、输入和DPR共同去重；桌面鼠标、手机触摸和大屏触控是不同条件。默认60组上限，可显式调整`maxCases`（最多1000）。达到上限后，其余候选列为`deferred`，不能删掉后宣称全覆盖。范围外尺寸也保留原因；显式请求超出bounds会报错，需先调整支持范围。

### 中文分组与标签

报告固定按**手机竖屏、手机横屏、平板、电脑、边界测试**排列，可切换分组并与候选状态/横竖屏筛选组合使用。每组有数量和用途说明；标签显示“触摸/鼠标”“像素倍率”“常见尺寸/指定尺寸”“高度切换点450像素（前1像素）”等中文。CSV列名和文字报告也按中文分组，JSON保留原始编号、来源和技术证据。

分组依据预设或显式配置，不单凭横竖比例猜机型：常见预设已有分类；自动断点和范围扫描归“边界测试”。指定尺寸可设置`group`为`phone-portrait/phone-landscape/tablet/desktop/boundary`。未指定分组时，仅匹配已知参考预设；其他自定义尺寸放边界组并说明来源，不假称真实手机。一个样本有多个来源时保持主分类，并展示全部来源；去重不改变实际采集数量。自定义label保持用户原文。

仅生成计划：加`--matrix-only`，输出`matrix.json`，不启动浏览器、不截图；只能从配置和CSS文件发现边界，不能替代运行时CSS发现。

## 自动检查什么

- 可见关键元素缺失、页面横向溢出、控件超出视口或被祖先裁切。
- 实际布局视口是否匹配指定CSS尺寸；例如缺少viewport meta时，手机模拟可能按980px布局，必须列出偏差，不能仍宣称测到了390px布局。
- 5个命中采样点是否被其他元素挡住；关闭/确认等关键控件可显式要求存在。
- `textOverflow:true`的指定文字是否超出容器；允许人工判断合法滚动/省略。
- 可见图片加载失败、画布固有缓冲零尺寸、页面脚本异常与资源失败。
- 滚动区被挤到不足自身一行文字高；这种情况不能因“理论上能滚动”就算可用。特定区域可另配`minVisibleWidth/minVisibleHeight`采用项目阈值。
- 可选`minTargetSize`采用**项目**触控标准，没有配置就不强套44px。

滚动容器里暂时看不见的内容记为`scroll-reachable-unverified`，需要另做实际滚轮/触摸测试，不直接判裁切。禁用按钮不按可点击按钮失败；它是否因合法业务前置条件而禁用需人工确认。超出`maxElements`（默认160）的探测会标记`truncated`。

全部自动发现均为**candidate-needs-review**；不等同确认Bug。几何/命中检查不能证明实际点击结果、触摸滚动、Canvas内容、文字美观、图片比例、存档、官方审核或手机真机兼容。截图拍视口而非整页长图，避免把应被屏幕裁切的内容拼接出来掩盖问题。截图阶段暂停支持的CSS动画，不代表玩法计时已测试。

## 输出与验收

- `index.html`：离线截图画廊，按五类屏幕分组，并按界面、方向和候选状态筛选，放大与前后对比。
- `screenshots/*.png`：逐尺寸完整视口截图；失败尽量保留现场。
- `matrix.csv`：尺寸、输入、DPR、来源、采集状态与截图路径。
- `issues.csv`：逐条候选问题。
- `report.md`及`report.json`：文字报告与完整测量、错误、覆盖缺口、来源指纹。

页面运行错误/资源异常列候选，导航/就绪/截图失败列`error`；有执行失败则退出码2。0只代表本次采集执行完成，不表示没有候选或游戏通过适配。没有候选也只写“未见自动候选”，不写“全部通过”。HTML可直接打开，分享时必须带上整个报告目录，不只拷贝index.html。

完成后至少实际查看一张小竖屏、一张短横屏、一张平板与候选问题截图，并检查画廊能打开图片。将人工确认、自动候选和真机待验分别交付；不要把工具生成的列表冒充人工看过全部图片。

已有报告只改分组/中文展示时，无需重跑游戏或截图：

```text
node <skill>/scripts/screen-report.mjs --refresh <existing-report-dir>/report.json
```

该命令先备份原有HTML/JSON/CSV/文字报告到同目录的`report-backups/`，再刷新展示。截图、测量、输入、DPR和原始问题证据不变；不要把展示刷新称为新一轮游戏回归。
