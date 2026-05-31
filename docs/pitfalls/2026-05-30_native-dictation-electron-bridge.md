# 2026-05-30 Native Dictation Transcribe Proxy

## 现象

Codex Desktop 的 Composer 里有麦克风按钮，可以直接录音并转写；Web 端也需要使用同一套官方转写能力，而不是浏览器内置 SpeechRecognition。

## 根因

Desktop 的应用内麦克风并不是浏览器 SpeechRecognition。实际链路是：

- renderer 采集音频 Blob，组装 multipart form。
- Electron bridge 把 `/transcribe` 请求转到 `https://chatgpt.com/backend-api/transcribe`。
- main 进程通过 app-server `getAuthStatus({ includeToken: true })` 取得当前官方登录 token。
- 请求头带上 `Authorization`、`ChatGPT-Account-Id`、`originator: Codex Desktop` 等 Desktop 风格字段；401 时刷新 token 后重试。

浏览器页面没有 Electron preload/IPC，不能直接调用 Desktop renderer 私有函数；但 Web 后端可以连接同一个 app-server，因此可以复刻 main 进程的 `/transcribe` 代理。

## 影响范围

Web 端如果想使用“官方原生语音识别”，不能走浏览器 SpeechRecognition，也不应该依赖全局热键粘贴。正确方向是：

- 前端只负责录音并上传音频。
- 后端复用 Codex Desktop app-server 的官方登录态。
- 后端调用官方 `/transcribe`，返回文本后插入 Composer。

## 最终解决方案

Web Composer 麦克风按钮点击后开始录音，再次点击停止。停止后把音频提交到 `/api/native-dictation/transcribe`：

- server 调 `appServer.getAuthToken({ refreshToken: false })`。
- 前端和 Desktop 一样不强制指定 `MediaRecorder` mimeType，让 Chromium 产出默认音频格式。
- server 手工构造 Desktop 同款 multipart body，把音频作为 `file` 发送到官方 `/transcribe`，避免 Node `FormData` 与 Electron bridge 请求形态不一致。
- server 默认不传 `language` 字段；实测同一段 `webm/opus` 音频不带 `language` 能成功，带 `language=en-US` 会触发官方 ASR 500。
- 如果官方返回 401，则调 `getAuthToken({ refreshToken: true })` 再重试一次。
- 成功后只把返回文本插入当前 textarea，不把 token、音频内容或转写文本写入诊断日志。

全局热键桥接只保留为历史方案，不作为默认实现。

注意：Desktop Composer 的普通麦克风听写不是实时流式字幕，它也是停止听写后调用 `/transcribe` 再把文本插入输入框。真正“一边说一边出字”的能力属于另一套 realtime voice 链路，会走 `thread/realtime/*`、WebRTC 和 data channel；不要把它和普通听写按钮混为一谈。

## 后续避免方式

- 不要把浏览器 SpeechRecognition 当成“官方原生语音识别”。
- 不要假设 Desktop Composer 的应用内麦克风按钮能通过 app-server/follower 协议直接调用。
- 不要把 token 打到日志里；测试只能断言 token 是否存在、请求头是否带上对应字段。
- 如果官方 Desktop 包更新了转写路径或鉴权字段，优先重新审计 Desktop main/webview bundle，再调整代理。
