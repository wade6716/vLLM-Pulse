# 更新日志 (Changelog)

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范与 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

每次发版只需更新根目录 `VERSION` 文件并在本文件顶部添加对应 `## [x.y.z]` 段落，推送至 `main` 分支后 GitHub Actions 将自动打 Tag、提取此处更新说明并发布 Release 与多架构镜像。

## [0.1.0] - 2026-11-27

### ✨ 新特性
- **纯远程指标驱动**：并发轮询多台 vLLM 实例的原生 `/metrics` 接口（默认 `1s` 周期、`2s` 超时），支持 YAML 多节点配置、自定义鉴权 Header（含 `${ENV_VAR}` 环境变量展开）及页面动态增删临时节点。
- **V0 / V1 指标兼容与计算引擎**：
  - 自动兼容 `kv_cache_usage_perc` / `gpu_cache_usage_perc`、`prefix_cache_*` / `gpu_prefix_cache_*`、`inter_token_latency_seconds_bucket` / `time_per_output_token_seconds_bucket` 及多 `engine` 聚合。
  - 内置首次采集基线归零与容器重启重置保护（`curr < prev` 或 `*_created` 变更），彻底消除历史累加误报与负值尖刺。
  - 基于双层内存 Ring Buffer（1s 高频环 + 24 小时 1m 降采样环）提供 `1分 / 5分 / 15分 / 1时 / 6时 / 24时` 6 档时间窗口、近 30s Prefix Cache 命中率（`空闲` 除零保护）、TTFT/ITL P50/P95 线性插值以及投机解码自动探测面板。
- **Apple Pro Dark 全中文监控大屏**：
  - `100vw × 100vh` 零滚动条布局、macOS 毛玻璃卡片、Apple Watch 开放式 KV 压力圆环、双 Y 轴 TTFT/ITL 延迟对比及 `tabular-nums` 等宽数字。
  - 内置 `InfoTip` 指标词典悬浮窗、图表图例自由开关、网页 Favicon、文本自由复制与大屏 30s 自动轮播 + 异常节点锁定。
- **内置 `--mock` 仿真模式**：无需 GPU 即可完整模拟正常推理、KV 飙升至 90%+、抢占红线尖刺、Prefix Cache 空闲态与投机解码。
- **单二进制与超轻量容器交付**：前后端通过 `go:embed` 编译为约 9 MB 单二进制，多阶段 `scratch` 镜像 < 15 MB。
