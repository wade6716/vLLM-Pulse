# vLLM-Pulse

**vLLM-Pulse** 是一款轻量级、专属于 **vLLM** 的实时 NOC / TV 监控墙风格可视化大屏。纯远程 `/metrics` 轮询驱动，零外部数据库依赖，前后端编译为单一可执行文件（约 10 MB，Docker 镜像 < 30 MB）。

---

## 核心特性

- **纯远程指标驱动**：仅通过 HTTP 轮询一个或多个 vLLM 实例原生暴露的 `/metrics`（Prometheus 文本格式）工作，不依赖宿主机 `nvidia-smi`、`/proc` 或任何本地 Agent。
- **零外部依赖**：不引入 Prometheus、Grafana、Redis 或时序数据库；内置双层内存 Ring Buffer（1s 粒度 15 分钟高频环 + 1m 粒度 6~24 小时降采样环）。
- **V0 / V1 指标自动兼容与防呆保护**：
  - 自动兼容 `vllm:kv_cache_usage_perc` / `vllm:gpu_cache_usage_perc`、`vllm:prefix_cache_*` / `vllm:gpu_prefix_cache_*`、`vllm:inter_token_latency_seconds_bucket` / `vllm:time_per_output_token_seconds_bucket`。
  - **首次基线保护**：首次采集累计 Counter 仅作基线，增量严格归零。
  - **容器重启重置保护**：自动识别 `curr < prev` 或 `*_created` 时间戳变更并重置基线，杜绝负值尖刺。
  - **30s 滑动窗口**：实时计算 Prefix Cache 命中率（`Δqueries == 0` 自动显示 `IDLE`）与 TTFT / ITL `P50` / `P95`（Prometheus 线性插值）。
  - **投机解码自动探测**：检测到 `vllm:spec_decode_*` 指标时自动激活专项诊断面板与逐位置接受率柱状图。
- **16:9 Calm UI 监控大屏**：
  - 锁定 `100vw × 100vh` 零滚动条布局，强制等宽数字（`tabular-nums`）。
  - KV Cache 70% 琥珀预警、85% 红色告警、`waiting(capacity)` 高亮、抢占脉冲扩散与主波形图红色垂直 `MarkLine`。
  - 支持 **TV 自动轮播**（30s 轮换）与 **异常节点自动锁定**。

---

## 快速开始

### 1. 使用内置 Mock 模式体验（无需 GPU）

```bash
./vllm-pulse --mock --port 8080
```

内置 3 个模拟节点：
- `gpu-a100-01 (Qwen3-27B)`：开启投机解码，周期性演示正常态 → KV 飙升至 90%+ → 抢占尖刺与红线标记 → 恢复。
- `gpu-h100-02 (Llama-3.3-70B)`：稳定高吞吐与抢占事件流面板。
- `gpu-l40s-03 (DeepSeek-R1-32B)`：间歇静默期演示 Prefix Cache `IDLE` 空闲态。

浏览器访问：`http://localhost:8080`

### 2. 监控单个真实 vLLM 实例

```bash
./vllm-pulse --target http://host1:11435/metrics --port 8080
```

### 3. 多节点 YAML 配置与反向代理鉴权

复制并修改 [configs/config.example.yaml](configs/config.example.yaml)：

```yaml
server:
  host: 0.0.0.0
  port: 8080

scrape:
  interval: 1s
  timeout: 2s

retention_hours: 6

nodes:
  - id: qwen3-a100
    name: "gpu-a100-01 (Qwen3-27B)"
    url: "http://10.0.1.10:11435/metrics"
    headers:
      Authorization: "Bearer ${VLLM_API_KEY}"
```

启动服务：

```bash
export VLLM_API_KEY="your-secret-token"
./vllm-pulse --config configs/config.example.yaml
```

---

## Docker / Docker Compose 部署

GitHub Actions 会自动构建多架构超轻量 `scratch` 镜像并发布到 GHCR：

```bash
docker run -d --name vllm-pulse -p 8080:8080 \
  ghcr.io/wade6716/vllm-pulse:latest --mock --port 8080
```

或使用 `docker-compose.yml`：

```bash
docker compose up -d
```

---

## 系统架构

```
vLLM /metrics (1..N)
        │  并发拉取 (默认 1s 周期, 2s 超时, 独立 goroutine)
        ▼
  PromText Parser  ──▶  Metric Engine (V0/V1 兼容 · 首次基线/重启保护 · 5s/30s 滑窗)
                              │
                              ▼
                      Dual Ring Buffer (1s × 900 + 1m × 360~1440 + 抢占日志)
                              │
                              ▼
                     SSE Broadcaster (1Hz 非阻塞推送) + go:embed 静态资源
```

### 支持的 HTTP 接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/nodes` | 返回已配置节点列表及实时状态摘要 |
| `GET /api/snapshot?node={id\|all}&range=15m\|6h` | 返回指定节点或集群聚合的历史 Ring Buffer 快照 |
| `GET /api/stream` | SSE 长连接，每秒推送实时增量帧 |
| `POST /api/nodes` | 运行时动态新增临时监控节点 |
| `DELETE /api/nodes/{id}` | 运行时移除临时监控节点 |

---

## 本地单二进制构建

前置依赖：Go 1.24+、Node.js 22+

**Linux / macOS：**
```bash
make build
```

**Windows PowerShell：**
```powershell
.\scripts\build.ps1
```

产物为根目录下的单个可执行文件 `vllm-pulse` / `vllm-pulse.exe`，无需任何外部运行时文件即可直接启动。
