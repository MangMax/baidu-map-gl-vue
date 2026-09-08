---
title: useBMapAsyncTask
---

# useBMapAsyncTask 异步任务

用于统一封装 geocoder、convertor 或其他异步服务的 loading、data、error 和取消状态。

```ts
import { useBMapAsyncTask } from 'baidu-map-gl-vue'
```

## 基本用法

```ts
const task = useBMapAsyncTask({
  immediate: false,
  runner: async ({ signal, requestId }, address: string) => {
    const response = await fetch(`/api/search?q=${encodeURIComponent(address)}`, {
      signal,
    })
    if (!response.ok) throw new Error('request failed')
    return response.json() as Promise<{ id: string }>
  },
})

await task.execute('Beijing')
```

## runner 参数

`runner` 的第一个参数始终是任务上下文，业务参数从第二个参数开始：

```ts
type AsyncTaskContext = {
  signal: AbortSignal
  requestId: number
}
```

- `signal`：传给 `fetch` 或插件请求；取消任务时会触发 abort。
- `requestId`：当前请求序号。新请求发起后，旧请求的结果不会写回状态。

百度 callback API 不一定支持 AbortSignal。此时应在 callback 中检查：

```ts
runner: ({ signal }) => new Promise((resolve) => {
  service.request((result) => {
    if (signal.aborted) return
    resolve(result)
  })
})
```

## 状态与方法

| 返回值 | 说明 |
| --- | --- |
| `data` | 最近一次成功结果 |
| `error` | 最近一次未取消的错误 |
| `status` | `idle`、`loading`、`success` 或 `error` |
| `isLoading` | 是否有当前请求 |
| `execute(...args)` | 发起请求；会取消并使旧请求逻辑失效 |
| `cancel(reason?)` | 取消当前请求；不会把状态标记为 error |
| `reset()` | 取消当前请求，并清空 data、error，恢复 idle |

组件 scope 销毁时，当前请求会自动 abort，迟到的结果不会再回写任何 ref。
