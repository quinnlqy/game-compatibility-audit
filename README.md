# 游戏界面与设备适配检查

一个可供 Codex 使用的 skill，用于检查游戏的跨设备界面与交互适配，并明确区分源码修复、实际包模拟和真实设备验收。

适用于 H5、WebView、Canvas／WebGL 游戏，也可按实际引擎选用界面坐标、裁切、输入和生命周期检查。不依赖特定项目、账号或平台 SDK。

## 安装到另一台电脑

在另一台电脑的 Codex 中发送：

```text
使用 skill-installer，从这个地址安装 game-compatibility-audit：
https://github.com/quinnlqy/game-compatibility-audit/tree/main/skills/game-compatibility-audit
```

也可以下载本仓库 ZIP 并解压，将 `skills/game-compatibility-audit` 整个文件夹放入本机 Codex 的 skills 目录：

- Windows 默认位置：`%USERPROFILE%\.codex\skills\game-compatibility-audit`
- macOS／Linux 默认位置：`~/.codex/skills/game-compatibility-audit`
- 如果设置了 `CODEX_HOME`，则放入其下的 `skills/game-compatibility-audit`。

最终该目录下应直接有 `SKILL.md`、`agents/` 和 `references/`，不要多嵌套一层同名文件夹。安装完成后在后续对话中调用；若未显示，重新打开 Codex 或新建聊天后使用。

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

检查范围随项目能力和用户任务选择，不要求每个游戏执行全部矩阵。参考尺寸不是统一平台规范，平台现行规则需要另行核对。

## 目录

```text
skills/game-compatibility-audit/
├── SKILL.md
├── agents/openai.yaml
└── references/
    ├── check-matrix.md
    └── evidence-and-report.md
```

## 验证边界

Skill 文件已通过 Codex skill 结构校验，内部引用已检查。尚未据此对多个独立游戏完成系统性验证。

静态检查、桌面浏览器模拟、平台运行代码本地镜像、实际 PC 模拟器和真机结果分别记录。使用此 skill 不代表自动拥有设备访问能力，也不代表游戏已兼容全部手机或通过平台审核。
