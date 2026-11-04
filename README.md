# 游戏界面与设备适配检查

一个可供 Codex 使用的 skill，用于检查游戏的跨设备界面与交互适配，并明确区分源码修复、实际包模拟和真实设备验收。

本版合并原仓库的跨设备审计流程与`mobile-game-compat-audit`的手机H5回归经验：一个入口，49项按需选用的稳定编号检查、历史案例边界及可选产物/证据工具。保留原35项编号并新增14项；不把具体机型、游戏玩法或本地机器路径作为通用要求。

适用于 H5、WebView、Canvas／WebGL 游戏，也可按实际引擎选用界面坐标、裁切、输入和生命周期检查。不依赖特定项目、账号或平台 SDK。

## 安装最新版到另一台电脑

最新版以本仓库的`main`分支为准，包含合并后的49项检查。在另一台电脑的 Codex 中发送：

```text
使用 $skill-installer，从下面的 GitHub 地址安装 game-compatibility-audit，读取 main 分支当前最新版：
https://github.com/quinnlqy/game-compatibility-audit/tree/main/skills/game-compatibility-audit
```

该链接每次安装获取`main`当时的内容，不绑定旧ZIP；**已安装到电脑的副本不会随仓库更新自动升级**。已有同名目录时，按下节更新，安装器不会直接覆盖。

也可以[下载 main 分支最新版ZIP](https://github.com/quinnlqy/game-compatibility-audit/archive/refs/heads/main.zip)，解压后找到`game-compatibility-audit-main/skills/game-compatibility-audit`，将其中整个`game-compatibility-audit`文件夹放入本机 Codex 的 skills 目录：

- Windows 默认位置：`%USERPROFILE%\.codex\skills\game-compatibility-audit`
- macOS／Linux 默认位置：`~/.codex/skills/game-compatibility-audit`
- 如果设置了 `CODEX_HOME`，则放入其下的 `skills/game-compatibility-audit`。

最终该目录下应直接有`SKILL.md`、`agents/`、`references/`和`scripts/`，不要只复制`SKILL.md`或多嵌套一层同名文件夹。安装后可在下一轮对话调用；若尚未显示，重新打开 Codex。[官方安装说明](https://learn.chatgpt.com/docs/build-skills#install-curated-skills-for-local-use)支持从其他仓库安装本地skill。

阅读和调用skill无需单独安装Python或Node依赖；执行可选审计脚本时才使用下文所述运行环境。

## 更新已有安装

在已安装过的电脑上发送：

```text
将本机 game-compatibility-audit 更新到下面仓库 main 分支的最新版：
https://github.com/quinnlqy/game-compatibility-audit/tree/main/skills/game-compatibility-audit
先下载到独立目录并验证，检查本机版本是否有自定义改动，再把旧版备份到 skills 目录之外，然后替换该 skill；保留其他 skills。如有本机自定义改动，先保留并说明差异，不静默覆盖。完成后核对远端版本与文件完整性。
```

手动更新时同样先保留旧目录，再用新版完整文件夹替换；不要只覆盖部分文件而留下旧脚本。若仍保留旧的`mobile-game-compat-audit`，确认没有本机自定义内容后可将其备份到skills目录之外，统一使用`game-compatibility-audit`。

当前合并版可通过`references/regressions.json`的`revision: 2026-11-04.1`及49个唯一条目识别。后续更新以远端实际提交与清单为准，不能只按目录名判断是否最新。

## 使用示例

全面检查：

```text
使用 $game-compatibility-audit 检查这个游戏的界面与设备适配，按优先级列出问题，区分模拟通过和真机待验。先检查，不改代码。
```

排查 PC 模拟器按钮：

```text
使用 $game-compatibility-audit 排查这个按钮在平台 PC 模拟器里点不动的问题，对照鼠标和手机触摸检查。
```

修复与验证：

```text
使用 $game-compatibility-audit 修复短横屏关闭按钮被遮挡的问题，验证受影响流程，暂不打包。
```

发布包检查：

```text
使用 $game-compatibility-audit 检查这个实际交付 ZIP，列出阻断问题、已通过的检查和需要真机补测的项目。
```

## 检查内容

- 可用窗口、安全区、宿主原生按钮、窄屏／短横屏、关键操作与信息的完整可见性。
- PC 模拟器鼠标与手机触摸、长按补发事件、拖动确认、3D／Canvas 命中与混合输入。
- 资源路径、大小写、图片准备、失败降级、异步取消、发布包完整性与资源生命周期。
- 旧环境 API／CSS、贴图与渲染、前后台恢复、声音、系统原生弹窗。
- 有相关能力时的保存、购买、奖励、刷新、中断和重试。
- 问题处理状态、验证环境、优先级和关闭条件。
- 旧接口/旧CSS、平板直接冷启动、布局状态污染、触点残留与跨DOM拖拽、材质自检、保存挂起及迟到写保护。

检查范围随项目能力和用户任务选择，不要求每个游戏执行全部矩阵。参考尺寸不是统一平台规范，平台现行规则需要另行核对。

## 目录

```text
skills/game-compatibility-audit/
├── SKILL.md
├── agents/openai.yaml
├── references/
│   ├── check-matrix.md
│   ├── evidence-and-report.md
│   ├── regressions.json
│   ├── device-evidence.md
│   └── execution.md
└── scripts/
    ├── artifact_snapshot.py
    ├── init_audit.py
    ├── validate_audit.py
    └── capability-fixtures.mjs
```

## 可选移动H5包审计工具

简单专项使用项目原报告即可。需要可核对的移动端实际包记录时，按`references/execution.md`运行：

```text
python <skill>/scripts/init_audit.py --project <repo> --target web=<actual.zip> --case V07 --case V10 --out <evidence-dir>/audit.json
python <skill>/scripts/validate_audit.py <evidence-dir>/audit.json --allow-incomplete
```

不传`--case`生成49项全量计划；传入则生成专项并自动保留P03产物检查。计划默认未测试，`--allow-incomplete`只接受诚实待验，不能掩盖错哈希、漏项或无效证据。Python工具只用标准库，使用当前机器约定的解释器；浏览器夹具使用项目已有自动化环境，且只注入隔离测试上下文。

## 合并说明

两份经验的结论一致：基于实际可用区域和能力检查、分别验证输入方式、保护存档、绑定实际包与证据，不将模拟结果冒充真机。原仓库对PC模拟器、长按与补发事件、资源映射及原生界面更细；手机H5经验补充旧接口启动、动态安全区、跨区工具、尺寸循环、材质与可靠提交。案例及原始基线见`references/device-evidence.md`。

专项不默认跑完整交叉矩阵；完整审计才逐目标判断所有能力。原生引擎采用对应坐标/裁切/输入机制，DOM/CSS条目按真实技术适用性判断，可选移动H5 JSON工具不强加于桌面/原生项目。

## 验证边界

2026-11-04合并版通过skill结构与内部引用检查、49项编号完整性、17项工具正反例及8组Edge浏览器夹具测试（包括真实像素对照）。独立前向评估发现的真机门禁参数冲突已修复，并加入回归。上述是skill及工具验证，不是游戏或手机验收；尚未据此对多个独立游戏完成系统性实机验证。

维护者可用标准库运行`python -B -m unittest discover -s tests -v`。浏览器夹具使用项目已安装的Playwright；通过`PLAYWRIGHT_MODULE`指定其`index.mjs`，必要时以`BROWSER_CHANNEL`指定已有浏览器，再运行`node tests/browser-fixtures.mjs`。测试不触碰真实游戏、存档或账号。

静态检查、桌面浏览器模拟、平台运行代码本地镜像、实际 PC 模拟器和真机结果分别记录。使用此 skill 不代表自动拥有设备访问能力，也不代表游戏已兼容全部手机或通过平台审核。
