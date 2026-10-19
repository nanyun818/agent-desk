# 参与贡献

请先通过 Issue 描述问题、复现步骤和预期行为。截图、日志和示例应脱敏，不要提交 API Key、
私人聊天记录、客户代码、用户数据目录、`.env` 或完整桌面截图。

## 本地开发

Node.js 24+：

```powershell
npm ci
npm test
npm run build
npm run dev
```

桌面开发需要 Windows：先 `npm run build`，再 `npm run desktop`。
桌面打包：`npm run desktop:build`；输出在 `release/`，不提交安装包到 Git。

开发或测试请设置独立的 `AGENT_DESK_DATA_DIR`，避免触碰日常使用的数据。
核心测试使用临时数据和本地模拟接口，不需要真实 API Key。
改动应聚焦具体问题，涉及导入、分支、密钥、文件快照或桌面 IPC 时请补充对应测试。

程序代码贡献按 MIT 许可提交；请勿加入来源不明的角色图、插件代码、字体或其他素材。
美术资产与品牌使用范围见 `ASSETS.md`，第三方署名见 `THIRD_PARTY_NOTICES.md`。
