# Codex bundled rg access denied

## 现象

在 `C:\workspace\codex_web` 下运行 `rg` 时，PowerShell 报错：

```text
Program 'rg.exe' failed to run ... OpenAI.Codex_...\resources\rg.exe ... 拒绝访问。
```

## 根因

当前 shell 解析到的是 Codex Desktop WindowsApps 包里的 `rg.exe`。在这个目录和当前权限组合下，Windows 拒绝启动该打包路径里的二进制。

## 影响范围

只影响用 `rg` 做本地搜索，不影响项目运行、构建、测试或官方 IPC/app-server 连接。

## 最终解决方案

临时使用 PowerShell 原生命令替代：

```powershell
Get-ChildItem -Path docs,documentation -Recurse -File |
  Select-String -Pattern '审批','approval','Search'
```

后续如果频繁遇到，可以安装独立的 ripgrep，并确保独立安装路径在 PATH 中优先于 Codex Desktop 打包路径。

## 后续避免方式

当 `rg` 启动失败时，不要卡住任务；直接切换到 `Get-ChildItem` + `Select-String`，并在需要时记录使用的替代命令。
