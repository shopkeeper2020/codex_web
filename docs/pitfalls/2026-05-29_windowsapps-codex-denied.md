# WindowsApps 里的 `codex.exe` 直接启动被拒绝

## 现象

在 `codex_web` 中启动 app-server 时，`codex app-server` 立即退出。手动执行：

```powershell
codex app-server --help
```

报错：

```text
Program 'codex.exe' failed to run ... WindowsApps ... 拒绝访问
```

## 根因

当前 PATH 中的 `codex` 解析到了 Microsoft Store / WindowsApps 包内的 Desktop 资源路径：

```text
C:\Program Files\WindowsApps\OpenAI.Codex_...\app\resources\codex.exe
```

该路径在普通工作目录下直接作为外部命令启动会被 Windows 权限模型拦截。

## 解决方案

命令解析优先使用 VS Code Codex 扩展内的 bundled `codex.exe`：

```text
%USERPROFILE%\.vscode\extensions\openai.chatgpt-*\bin\windows-x86_64\codex.exe
```

只有找不到 VS Code bundled 可执行文件时，才 fallback 到 PATH 中的 `codex`。

## 后续避免

- app-server 进程不要裸用 PATH `codex` 作为第一选择。
- Windows 下如果命令是绝对 `.exe` 路径，直接 `spawn`，不要额外包 shell。
