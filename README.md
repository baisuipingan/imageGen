# HaHaCode AI Image Worker

简体中文 | [English](./README.en.md)

一个部署在 Cloudflare Workers 上的轻量级 AI 图片生成工作台。项目使用 Workers Assets 托管静态 SPA，并通过 Hono API 路由代理图片生成请求。

## 功能特性

- 单页图片生成工作台
- API Key 仅保存在用户浏览器本地
- 浏览器本地会话历史
- 支持文生图和参考图编辑流程
- 支持 OpenAI Image 与 HaHaCode Nana 系列生图模型
- 适配桌面端和移动端的响应式布局
- 图片结果预览、全屏查看和下载
- 支持 Cloudflare Workers Static Assets 部署

## 技术栈

- TypeScript
- Hono
- Cloudflare Workers
- Cloudflare Workers Static Assets
- Wrangler
- 原生 HTML/CSS/JavaScript 前端

## 项目结构

```text
.
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── logo.png
├── src/
│   └── index.ts
├── package.json
├── tsconfig.json
└── wrangler.jsonc
```

## 工作原理

- `public/` 目录中的静态前端文件由 Cloudflare Workers Assets 托管。
- `/api/*` 下的请求会先进入 Worker。
- 用户输入的 API Key 保存在浏览器 `localStorage` 中。
- 前端只会在生成图片时通过 `Authorization` 请求头发送 API Key。
- Worker 会把请求转发到 `BASE_URL`，该地址应为 OpenAI 兼容接口的基础地址。

## 本地开发

安装依赖：

```bash
npm install
```

启动本地 Worker：

```bash
npm run dev
```

然后打开 Wrangler 输出的本地地址，通常是：

```text
http://localhost:8787
```

类型检查：

```bash
npx tsc --noEmit
```

## 配置说明

`wrangler.jsonc` 中包含 Worker 和静态资源配置：

```jsonc
{
  "vars": {
    "BASE_URL": "https://api.hahacode.com"
  }
}
```

如果需要使用其他 OpenAI 兼容接口，修改 `BASE_URL` 即可。

API Key 不会作为 Worker Secret 保存。用户需要在页面中输入自己的 Key，它只会保存在当前浏览器的本地存储中。

## 部署

先确认已经登录 Cloudflare：

```bash
npx wrangler login
```

部署到 Cloudflare Workers：

```bash
npm run deploy
```

Wrangler 会上传 Worker 代码，并一起发布 `public/` 目录下的静态资源。

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。
