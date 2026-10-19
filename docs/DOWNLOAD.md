# 下载与安装

## 普通用户

1. 打开 [最新版本下载页](https://github.com/nanyun818/agent-desk/releases/latest)。
2. 展开 Assets，下载 `Agent-Desk-Setup-0.5.2-x64.exe`。`Source code` 是开发源码，不是安装包。
3. 双击安装文件，选择安装目录；安装后从桌面或开始菜单打开 Agent Desk。
4. 在“模型服务”中填入自己的服务商地址、API Key 和可用模型，新建对话即可使用。

当前提供 Windows x64 早期体验版。安装包包含 Node.js 运行时，不需要 npm、终端或开发环境。
没有捆绑 API Key、付费模型额度或其他人的对话记录。桌宠随桌面版一起安装。

## 下载安全

目前安装包未做代码签名，Windows 可能显示未知发布者或信誉提示。只从本仓库的 Releases
下载，并核对同一版本发布页中的 `SHA256SUMS.txt`。不要关闭杀毒软件或直接忽略恶意软件告警。
校验值用于确认下载完整性，不代替发布者身份和源码审查；第三方转发的校验值不可信。

可选：在下载文件所在目录打开 PowerShell 核对：

```powershell
Get-FileHash .\Agent-Desk-Setup-0.5.2-x64.exe -Algorithm SHA256
```

将结果与发布页校验文件中的值逐字比较。不一致请停止安装并重新下载。
遇到拦截或错误，可提交系统版本、软件版本和脱敏后的错误截图；不要提交密钥或聊天数据库。

## 更新与卸载

更新前退出 Agent Desk，并备份 `%LOCALAPPDATA%\AgentDesk`，再安装新版本。
该目录包含聊天记录、快照及本机密钥库，请私下保管，切勿上传到 Issue 或公开网盘。
当前没有自动更新，手动下载新版本安装即可。卸载程序默认保留用户数据。

## 第一次使用

- 不调用模型时，查看与搜索本地历史不消耗 API 额度。
- “导入 CLI 历史”会只读导入本机 Claude Code / Codex CLI 记录，不会自动执行其中的指令。
- 导入的记录可以复制为工作台分支，用自己配置的 API 续聊；原 CLI 恢复命令可复制回终端执行。
- 对话分支保留旧记录；文件回退需要事先手动创建快照，不会追溯此前的文件修改。
- 桌宠脑袋点击是摸头，身体轻点打开随手聊，按住身体可以拖动；外观设置中可隐藏或缩放。

## 从源码运行

需要 Node.js 24+。在项目目录运行：

```powershell
npm ci
npm test
npm run build
npm start
```

Windows 也可以在依赖安装并构建后双击 `Start-AgentDesk.cmd`。
Windows 开发桌面版使用 `npm run desktop`；生成本地安装包使用 `npm run desktop:build`。
