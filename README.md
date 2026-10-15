# 人脉图谱 Link Board

整理人脉关系的桌面软件。把认识的人画成图谱，记下各自的领域、性格、优势，看谁在什么时候用得上。

## 功能

- **关系图谱**：人物是圆形头像，亲密度越高头像越大，颜色按领域区分。连线可以从任意方向拉出，贴着头像边缘走，线宽表示关系强度。
- **人物档案**：姓名、身份、组织、领域标签、性格特点、优势（能帮上什么忙）、亲密度、联系方式、备注。
- **搜索**：按姓名、标签、优势等关键词筛选，命中的人高亮，其余变淡。
- **一键整理**：按关系聚拢（有关系的人靠近、亲密度高的人居中），或按领域分组。整理后可撤销（Cmd+Z）。
- **导出**：JSON，或带 Mermaid 关系图的 Markdown。
- **WebDAV 定时备份**：自动上传备份到自己的 WebDAV 目录，可设置间隔和保留份数。
- **外部 Agent 接口**：只读 HTTP API，带 Bearer token，方便让 AI agent 读取和检索人脉数据。
- **桌面软件**：Electron 打包，macOS arm64，浅色深色跟随系统。

## 开发

需要 Node 22+ 和 pnpm。

```bash
pnpm install
pnpm dev            # 后端 3789 + Vite 前端
pnpm dev:desktop    # Electron 开发模式
pnpm test           # vitest
pnpm typecheck      # tsc
```

## 打包

```bash
pnpm dist           # 生成 .app、.dmg、.zip 到 release/
```

产物未签名，macOS 首次打开需右键选择「打开」。

## Agent 接口

软件运行时会监听 `127.0.0.1:3789`。接口文档见 `GET /api/agent`，token 在软件「设置」里查看。

```bash
curl -H "Authorization: Bearer <token>" "http://127.0.0.1:3789/api/agent/search?q=律师"
```

| 接口 | 说明 |
| --- | --- |
| `GET /api/agent/board` | 完整数据 |
| `GET /api/agent/people` | 人物列表 |
| `GET /api/agent/people/:id` | 单个人物及其关系 |
| `GET /api/agent/search?q=` | 按需求关键词找人，按匹配度排序 |
| `GET /api/agent/export.md` | Markdown（含 Mermaid 图） |

## 数据存放

- 桌面软件：`~/Library/Application Support/人脉图谱/data`
- 开发模式：项目下的 `data/`

数据、API token 和 WebDAV 密码都以明文存在该目录，已加入 `.gitignore`。

## 安全说明

网页端接口没有登录鉴权，因此后端默认只监听 `127.0.0.1`。如需让其他设备访问，请在前面加一层带鉴权的反向代理。外部 agent 接口只读，且需要 token。

## 技术栈

React 19 + React Flow 12 + Vite + TypeScript，后端 Express 5（JSON 文件存储），Electron 打包。
