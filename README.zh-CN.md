# pi-ticketing

为 [pi](https://pi.dev) 提供工单、待办事项和代理分发功能 —— pi 原生不支持的三大核心能力，打包为一个扩展：

- **工单** —— 不可变记录，仅附加评论流；状态是唯一可变字段。任何内容都不会被删除。
- **待办** —— 热的、按顺序排列的会话级列表（状态存储在会话树中，因此在分支或分叉时自动保持正确）。关闭项目 `N: …` 会自动将工单 N 的状态同步到工单（故障开放：即使存储损坏，刷新也不会中断）。
- **分发** —— 生成 pi 子代理，在隔离上下文中处理工单；工单编号即是合同，子代理的命名空间通过环境变量注入，其写入操作会自动带上该命名空间，无需信任调用方输入。

合约：

- `rollout_id` 就是会话 ID —— 只有一个 ID，没有其他。它是从底层真实信息中获取的（pi 会话 ID，或子代理环境中注入的命名空间）—— 绝不会从模型输入中获取。
- 每个工具一个操作；TypeBox 模式在挂载层验证每个工具的合法参数；每个失败都会返回 `{code, message, corrected_call}`（原样重发即可成功）。
- 一个 SQLite 数据库位于每个仓库之外，由所有会话、所有项目和所有工作区共享：`~/.pi/agent/ticketing/ticket.db` （可通过 `TICKET_DB_HOME` 覆盖）。使用 `node:sqlite` —— 零运行时依赖。

## 工具

`ticket_add` / `ticket_get` / `ticket_list` / `ticket_comment` /
`ticket_status` / `ticket_rules` / `ticket_help`，以及 `todo_write`、`delegate` 和 `/tickets` 覆盖层。完整合约：`ticket_help`。

## 安装

两种方式：安装到目标 git 仓库（项目级），或安装到你的全局 pi 配置（所有项目，当前用户）。

### 项目级 —— `make install-repo DEST=<path/to/git-repo>`

```sh
make install-repo DEST=~/work/some-repo        # → some-repo/.pi/
make install-repo DEST=~/work/some-repo PRUNE=1  # 先清理旧文件
make uninstall-repo DEST=~/work/some-repo
```

生成：

```text
<repo>/
└── .pi/
    ├── extensions/pi-ticketing/   # index.ts + lib/ + tools（一级深度 —— pi 的发现规则）
    └── skills/ticketing/SKILL.md  # 递归发现
```

目标必须是包含 `.git` 的目录（工作树也算 —— 检查是 `test -e`，工作树的 `.git` 是一个文件）。没有它，安装会拒绝，因此路径输入错误不会将 `.pi/` 喷洒到无关目录中。项目级扩展在你信任项目后加载；如果会话处于活动状态，运行 `/reload`。提交 `.pi/` 以与仓库的其他用户共享扩展；`PRUNE=1` 是更安全的重新安装方式（默认覆盖是幂等的，但不会删除文件）。

### 全局 —— `make install-global`

```sh
make install-global             # → ~/.pi/agent/extensions/pi-ticketing/ + skills/ticketing/
make uninstall-global
```

在每个项目中加载，无需信任提示。在活动 pi 会话中运行 `/reload` 立即生效。

### 其他方式

```sh
pi -e ./extensions/index.ts     # 仅在一次调用中尝试，无需安装
make test                       # 14 个合约测试，无需 pi
```

有效载荷仅为 `extensions/` + `skills/ticketing/` —— 无构建步骤，目标中无需 `npm install`（扩展仅导入主机提供的包和 `node:sqlite`），安装程序不会在目标仓库中暂存或提交任何内容。

## 布局

```
Makefile                   install-repo / install-global / uninstall / test / help
package.json               pi 包清单（peerDependencies，无运行时依赖）
extensions/index.ts        入口：存储单例、会话生命周期、7 个工单工具
extensions/schemas.ts      TypeBox 模式 —— 在挂载层不可误用
extensions/todo-tool.ts    todo_write —— 热列表、代理拒绝、故障开放镜像
extensions/delegate-tool.ts  delegate —— 生成 pi 子代理、注入命名空间
extensions/render.ts       /tickets 覆盖层（按状态分组，Esc 关闭）
extensions/lib/ticket.ts   合约：处理程序、信封、帮助/规则文本
extensions/lib/ticket-store.ts  TicketStore（node:sqlite），表 ticket + ticket_comment
extensions/lib/session.ts  rollout-id 解析（env > 捕获的会话 id）
extensions/lib/sync.ts     todo→ticket 镜像，进程内
extensions/lib/ticket.test.ts   合约测试
skills/ticketing/          SKILL.md —— 工作流 + 代理准则
DESIGN.md                  设计（架构、决策、原因）
```
