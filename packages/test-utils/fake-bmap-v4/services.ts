/**
 * Fake BMap v4 服务替身（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 覆盖面只到「Service Facet 会调用 + 共享契约会断言」的成员：六个基础服务的**唯一调用入口**
 * （`Geocoder#getPoint/getLocation`、`Convertor#translate`、`Boundary#get`、
 * `Geolocation#getCurrentPosition/getStatus`、`LocalCity#get`、`Autocomplete#search`）与
 * ViewAnimation 的构造选项。不补 getter 家族，避免 Fake 先于实现膨胀（同 `objects.ts` 口径）。
 *
 * 三条刻意建模的运行时事实：
 *
 * 1. **回包恒为异步**：真实服务是 JSONP，回调至少在下一个微任务才到。这不只是像不像的问题
 *    ——Facet 的 JSONP 错误嗅探（`captureJsonpServiceError`）必须在 `getPoint()` **返回之后**
 *    才有机会 `rescan()` 包装注册表；如果 Fake 同步回包，错误就永远捕获不到，测试会给出
 *    「嗅探没用」的假结论。
 * 2. **失败只回 `null`**：错误码藏在 `_rd` 回调注册表的参数里（`{ result: { error, error_msg } }`），
 *    与真实 JSONP 一致——「空结果 vs 失败」的判定只能靠嗅探，Fake 必须能造出这两种情形。
 * 3. **手动时序**：`queue.auto = false` 时回调进入队列，由测试 `flush()` 触发，
 *    用来固定「取消 / 超时之后的迟到回包」这类顺序敏感的语义。
 */

/* ------------------------------------------------------------- 回包时序控制 */

export class FakeV4CallbackQueue {
  /** true（默认）：回包在下一个微任务自动触发；false：进入队列等 `flush()`。 */
  auto = true
  private queue: Array<() => void> = []

  get pending(): number {
    return this.queue.length
  }

  dispatch(run: () => void): void {
    if (this.auto) {
      queueMicrotask(run)
      return
    }
    this.queue.push(run)
  }

  /** 手动触发已排队的回包，返回触发数量。 */
  flush(): number {
    const queued = this.queue
    this.queue = []
    for (const run of queued) run()
    return queued.length
  }

  /** 只触发队列里指定的一个回包（「乱序回包」用例用）；索引越界返回 false。 */
  flushOne(index: number): boolean {
    if (index < 0 || index >= this.queue.length) return false
    const [run] = this.queue.splice(index, 1)
    if (run) run()
    return true
  }
}

/** `_rd` 注册表：JSONP 回调注册表（错误嗅探的唯一依据）。 */
export interface FakeV4JsonpRegistry {
  registry: Record<string, unknown>
  /** 模拟服务端错误：注册一个回包时会带 `error/error_msg` 的回调，并返回其 key。 */
  registerError(code: number | string, message: string): string
  /** 模拟成功回包：注册一个不带错误码的回调，并返回其 key。 */
  registerSuccess(content?: unknown): string
  /** 触发某个已注册回调（真实 SDK 由 JSONP 回包脚本调用）。 */
  invoke(key: string, payload?: unknown): void
}

export function createFakeV4JsonpRegistry(): FakeV4JsonpRegistry {
  const registry: Record<string, unknown> = {}
  /** 每个回调「服务端本该回给它的响应体」——真实 JSONP 由回包脚本作为**实参**传入。 */
  const payloads = new Map<string, unknown>()
  let counter = 0

  const register = (payload: unknown): string => {
    counter += 1
    const key = `_cbk${counter}`
    payloads.set(key, payload)
    registry[key] = () => payload
    return key
  }

  return {
    registry,
    registerError(code, message) {
      return register({ result: { error: code, error_msg: message } })
    },
    registerSuccess(content) {
      return register({ result: { error: 0 }, content })
    },
    invoke(key, payload) {
      // 关键：响应体必须以**参数**形式传入——错误嗅探包装的就是「参数里的 result.error」，
      // 用返回值传会被包装器完全看不见（那会让「失败」退化成「空结果」）。
      const value = payload === undefined ? payloads.get(key) : payload
      const fn = registry[key]
      if (typeof fn === 'function') (fn as (incoming: unknown) => unknown)(value)
    },
  }
}

/* ------------------------------------------------------------------- Geocoder */

export interface FakeV4PointLike {
  lng: number
  lat: number
}

export class FakeV4Geocoder {
  readonly callLog: string[] = []
  readonly queue = new FakeV4CallbackQueue()
  /** `getPoint` 的回包；`null` = 服务失败（真实 SDK 的失败形态） */
  pointResult: FakeV4PointLike | null = { lng: 116.404, lat: 39.915 }
  /** `getLocation` 的回包；`null` = 服务失败 */
  locationResult: Record<string, unknown> | null = {
    address: '北京市东城区天安门',
    point: { lng: 116.404, lat: 39.915 },
    business: '天安门',
    surroundingPois: [{ title: 'a' }, { title: 'b' }],
  }
  /** 设为非空时，回包前先在 `_rd` 里注册一个带错误码的回调（模拟配额 302） */
  jsonpError: { code: number | string; message: string } | null = null

  constructor(private readonly jsonp: FakeV4JsonpRegistry) {}

  getPoint(
    address: string,
    callback: (point: FakeV4PointLike | null) => void,
    city?: string,
  ): void {
    this.callLog.push(`getPoint:${address}:${city ?? ''}`)
    const result = this.pointResult
    // 真实 SDK 在**调用内同步**注册 JSONP 回调（先发请求），回包再异步触发它；
    // Facet 的 `probe.rescan()` 必须落在这两步之间才有机会包装。
    const errorKey = this.jsonpError
      ? this.jsonp.registerError(this.jsonpError.code, this.jsonpError.message)
      : null
    this.queue.dispatch(() => {
      if (errorKey) this.jsonp.invoke(errorKey)
      callback(result)
    })
  }

  getLocation(
    _point: unknown,
    callback: (result: Record<string, unknown> | null) => void,
    options?: Record<string, unknown>,
  ): void {
    this.callLog.push(`getLocation:${JSON.stringify(options ?? {})}`)
    const result = this.locationResult
    const errorKey = this.jsonpError
      ? this.jsonp.registerError(this.jsonpError.code, this.jsonpError.message)
      : null
    this.queue.dispatch(() => {
      if (errorKey) this.jsonp.invoke(errorKey)
      callback(result)
    })
  }
}

/* ------------------------------------------------------------------ Convertor */

export class FakeV4Convertor {
  readonly callLog: string[] = []
  readonly queue = new FakeV4CallbackQueue()
  /** 回包状态码：0 = 成功 */
  status = 0
  /** 回包坐标；成功时官方只在 `status === 0` 提供 */
  points: FakeV4PointLike[] | null = [{ lng: 116.404, lat: 39.915 }]
  message: string | null = null

  translate(
    points: unknown[],
    from?: number,
    to?: number,
    callback?: (result: Record<string, unknown>) => void,
  ): void {
    this.callLog.push(`translate:${points.length}:${from ?? ''}->${to ?? ''}`)
    const payload: Record<string, unknown> = { status: this.status }
    if (this.status === 0 && this.points) payload.points = this.points
    if (this.message) payload.message = this.message
    this.queue.dispatch(() => callback?.(payload))
  }
}

/* ------------------------------------------------------------------- Boundary */

export class FakeV4Boundary {
  readonly callLog: string[] = []
  readonly queue = new FakeV4CallbackQueue()
  /** `boundaries` 为空数组 = 查无结果；`null` = 服务失败 */
  boundaries: string[] | null = ['116.30,39.90;116.31,39.91;116.30,39.90']
  jsonpError: { code: number | string; message: string } | null = null

  constructor(private readonly jsonp: FakeV4JsonpRegistry) {}

  get(name: string, callback: (result: { boundaries: string[] } | null) => void): void {
    this.callLog.push(`get:${name}`)
    const value = this.boundaries
    const errorKey = this.jsonpError
      ? this.jsonp.registerError(this.jsonpError.code, this.jsonpError.message)
      : null
    this.queue.dispatch(() => {
      if (errorKey) this.jsonp.invoke(errorKey)
      callback(value === null ? null : { boundaries: value })
    })
  }
}

/* ----------------------------------------------------------------- Geolocation */

export class FakeV4Geolocation {
  readonly callLog: string[] = []
  readonly queue = new FakeV4CallbackQueue()
  /** `getStatus()` 的回包；默认 0（BMAP_STATUS_SUCCESS） */
  status = 0
  /** `getCurrentPosition` 的回包；`null` = 无结果 */
  result: Record<string, unknown> | null = {
    point: { lng: 116.404, lat: 39.915 },
    accuracy: 30,
    address: { city: '北京市', district: '东城区' },
  }

  constructor(options: Record<string, unknown> = {}) {
    this.callLog.push(`construct:${JSON.stringify(options)}`)
  }

  getCurrentPosition(
    callback: (result: Record<string, unknown> | null) => void,
    options?: Record<string, unknown>,
  ): void {
    this.callLog.push(`getCurrentPosition:${JSON.stringify(options ?? {})}`)
    const value = this.result
    this.queue.dispatch(() => callback(value))
  }

  getStatus(): number {
    return this.status
  }
}

/* ------------------------------------------------------------------- LocalCity */

export class FakeV4LocalCity {
  readonly callLog: string[] = []
  readonly queue = new FakeV4CallbackQueue()
  result: Record<string, unknown> | null = {
    name: '北京市',
    center: { lng: 116.404, lat: 39.915 },
    level: 12,
  }
  /** 设为非空时，回包前先在 `_rd` 里注册一个带错误码的回调（模拟配额 302 / 非法请求） */
  jsonpError: { code: number | string; message: string } | null = null

  constructor(
    private readonly jsonp: FakeV4JsonpRegistry,
    options: Record<string, unknown> = {},
  ) {
    this.callLog.push(`construct:${JSON.stringify(options)}`)
  }

  get(callback: (result: Record<string, unknown> | null) => void): void {
    this.callLog.push('get')
    const value = this.result
    // 与 Geocoder / Boundary 同形：真实 SDK 在**调用内同步**注册 JSONP 回调，
    // 回包再异步触发它（Facet 的 `probe.rescan()` 落在两步之间才有机会包装）。
    const errorKey = this.jsonpError
      ? this.jsonp.registerError(this.jsonpError.code, this.jsonpError.message)
      : null
    this.queue.dispatch(() => {
      if (errorKey) this.jsonp.invoke(errorKey)
      callback(value)
    })
  }
}

/* ---------------------------------------------------------------- Autocomplete */

/** 官方 `AutocompleteResult`：只有 `getNumPois` / `getPoi` 两个读法（`keyword` 是可选的）。 */
export class FakeV4AutocompleteResult {
  /** 检索关键字；`includeKeyword: false` 时不填充——用来验证「没有 keyword」的退化路径 */
  keyword?: string

  constructor(
    private readonly pois: Array<Record<string, unknown>>,
    keyword: string,
    includeKeyword = true,
  ) {
    if (includeKeyword) this.keyword = keyword
  }

  getNumPois(): number {
    return this.pois.length
  }

  getPoi(index: number): Record<string, unknown> | undefined {
    return this.pois[index]
  }
}

export class FakeV4Autocomplete {
  readonly callLog: string[] = []
  readonly queue = new FakeV4CallbackQueue()
  /** 下一次 `search` 的结果条目 */
  pois: Array<Record<string, unknown>> = [
    { business: '天安门', province: '北京市', city: '北京市', district: '东城区' },
  ]
  /** `search()` 是否会回包（false = SDK 静默失败，用来验证超时 / 取消） */
  respond = true
  /** 回包是否带 `AutocompleteResult.keyword`（官方声明为可选，运行时是否填充未承诺） */
  includeKeyword = true

  readonly options: Record<string, unknown>

  constructor(options: Record<string, unknown> = {}) {
    this.options = options
    this.callLog.push('construct')
  }

  search(keyword: string): void {
    this.callLog.push(`search:${keyword}`)
    if (!this.respond) return
    const results = new FakeV4AutocompleteResult(this.pois, keyword, this.includeKeyword)
    const onSearchComplete = this.options.onSearchComplete as
      | ((value: FakeV4AutocompleteResult) => void)
      | undefined
    this.queue.dispatch(() => onSearchComplete?.(results))
  }

  /** 官方 `Autocomplete#dispose()`：Driver 的 dispose 入口会调用它 */
  dispose(): void {
    this.callLog.push('dispose')
  }
}
