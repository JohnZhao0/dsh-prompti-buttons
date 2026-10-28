# dsh-prompti-buttons

DeepSeek Harness（DSH）插件：**输入框提示词按钮** + **提醒音引擎** + **插件设置中心**。

## 功能

### ① 提示词按钮（输入框工具条）

在会话输入框左侧放置一组可切换的按钮（默认「简洁」「详细」）。点击按钮，对应的提示词会**换行追加到输入框草稿末尾**——发送前可见、可改；再点一次从草稿移除；**发送后按钮自动取消选中**（一次性）。

- 默认按钮：
  - 简洁 → `[输出格式：不要废话，只简洁明了输出回复]`
  - 详细 → `[输出格式：尽可能详细，不要错过任何一个重点]`
- 按钮可以自行新增、改名、改提示词、停用（见「插件设置」）。
- 机制说明：采用**草稿追加**而非隐形注入——纯浏览器实现，对所有会话（包括插件安装前已存在的会话）立即生效。

### ② 提醒音引擎

四类事件各有独立音色、开关与试听：

| 事件 | 默认音色 |
|---|---|
| 需要审批 | 警醒 |
| 需要回答 | 轻点 |
| 输出完成 | 叮咚 |
| 发生错误 | 低沉 |

- 审批/提问**未处理时按间隔重复提醒**（关 / 10 / 20 / 30 秒），直到你回来处理；
- 总音量、提醒范围（所有会话 / 仅当前会话）可调；
- 检测基于 DSH 0.2.0-rc.2 的 `uiSession.sessionStatus` 公开面；
- 纯浏览器 Web Audio 合成音色，无音频文件、无网络请求。

### ③ 插件设置（设置 → 插件设置）

新增一级设置导航「插件设置」，内置二级标签：

- **提示词按钮**：按钮的增删改、启用开关、恢复默认；
- **提醒音**：上述提醒音的全部设置，改动即时生效。

从 0.3.1 开始，其他 Client 插件可以注册 `prompt-buttons.settings.tab` 列表槽，将页面放在内置标签右侧。注册时提供唯一 `id`、数字 `order` 和本地化 `label`，组件使用 DSH 原生 slot renderer 渲染。标签沿用内置间距，窄屏换行；卸载当前扩展后返回“提示词按钮”。

```js
ctx.slots.inject('prompt-buttons.settings.tab', () => ctx.slots.register({
  name: 'prompt-buttons.settings.tab', id: 'my-plugin', order: 10,
  label: () => t('tab'),
}, MySettingsPage));
```

扩展插件的 `dsh.client.inject` 应包含 `@local/dsh-prompt-buttons`。例如 Hidden Arrow 在此注册“HA强化”，排列在“提醒音”右侧。

## 安装

```sh
dsh plugin --profile web add github:<owner>/dsh-prompti-buttons
```

安装后**硬刷新浏览器页面**（Cmd/Ctrl+Shift+R）。

要求：DSH ≥ 0.2.0-rc.2（提醒音的审批/提问检测依赖 `uiSession.sessionStatus`；更早版本只有完成/出错两类会响）。

## 配置存储

全部存浏览器 `localStorage`：

| 键 | 内容 |
|---|---|
| `dsh-prompt-buttons.v1` | 按钮列表（名称/提示词/启用） |
| `dsh-prompt-buttons.alerts.v1` | 提醒音设置 |

## 隐私

不发起任何网络请求，不读取会话内容，不保存任何会话数据；配置不出浏览器。

## 致谢

提醒音引擎的事件检测与音色数据参考自 [@machine-126/dsh-alert-sound](https://github.com/Machine-126/dsh-alert-sound)（MIT），经吸收重写后配置与 UI 归本插件所有。

## License

MIT
