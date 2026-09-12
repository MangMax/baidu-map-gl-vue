/**
 * Fake v4 运行时注入的可控开关（M3A3-FAKE-DUAL / issue #24 实施步骤 3）
 *
 * 官方 4.0 有一批成员是**运行时注入**的：扩展 API 的 `PointLayer` / `ClusterLayer` /
 * `Heatmap` / `TrackLine`，以及 `PanoramaCoverageLayer`。它们在
 * `@baidumap/jsapi-v4-types@4.0.4` 里没有类声明（见 #23 ADR 的决策 4），因此能力探测
 * **不能在 Driver 构造期冻结结论**——「注入前失败、注入后同一个 Driver 可创建」是一条
 * 真实存在的运行时语义，需要能被测试主动摆出来。
 *
 * 在此之前，各测试都是自己 `delete fake.namespace.PointLayer` 手改命名空间：问题是
 * ① 忘记恢复就污染后续用例（`try/finally` 全凭自觉）；② 「注入前 / 注入后」两个时机在
 * 不同文件里写法不一致。这里把「卸下 / 装回」变成有名有姓、可枚举、可整体恢复的入口。
 *
 * 官方语义与 Fake 建模的界线：**成员的名单**是官方事实（运行时提供、类型包没有）；
 * 「怎么卸、怎么装」是 Fake 特有的测试手段。
 */
import type { FakeBMapV4Namespace } from './index.ts'

/** 运行时注入的成员名单（4.0.4 类型包未声明、4.0 运行时公开）。 */
export const FAKE_V4_RUNTIME_INJECTED_MEMBERS = [
  'PointLayer',
  'ClusterLayer',
  'Heatmap',
  'TrackLine',
  'PanoramaCoverageLayer',
] as const

export type FakeV4RuntimeInjectedMember = (typeof FAKE_V4_RUNTIME_INJECTED_MEMBERS)[number]

export class FakeV4RuntimeExtensions {
  /** 已被卸下的成员 → 原构造器（装回时还原）。 */
  private readonly saved = new Map<FakeV4RuntimeInjectedMember, unknown>()
  /**
   * 可索引的命名空间视图：各成员的构造器类型互不相同，写回/删除必须走 `Record` 视图
   * （否则每写一个成员都要单独断言类型）。
   */
  private readonly writable: Record<string, unknown>

  constructor(namespace: FakeBMapV4Namespace) {
    this.writable = namespace as unknown as Record<string, unknown>
  }

  /** 当前被卸下的成员（模拟「可视化实现尚未注入」的状态）。 */
  uninstalled(): FakeV4RuntimeInjectedMember[] {
    return [...this.saved.keys()]
  }

  /**
   * 把成员从命名空间卸下。
   *
   * 幂等：已经卸下、或该成员本来就不在命名空间里，都返回 `false` 而不是抛错
   * （与 Driver 侧 `remove` 的幂等口径一致——重复调用不该让测试有机会「碰巧通过」）。
   */
  uninstall(member: FakeV4RuntimeInjectedMember): boolean {
    if (this.saved.has(member)) return false
    const value = this.writable[member]
    if (value === undefined) return false
    this.saved.set(member, value)
    delete this.writable[member]
    return true
  }

  /** 装回成员；未被卸下时是 no-op。 */
  install(member: FakeV4RuntimeInjectedMember): boolean {
    if (!this.saved.has(member)) return false
    this.writable[member] = this.saved.get(member)
    this.saved.delete(member)
    return true
  }

  /**
   * 全部装回。
   *
   * 用例开头与结尾、以及引擎描述的 `reset()` 都应调用它：一个忘了恢复的用例会把
   * 「命名空间缺成员」带进后续用例，而那种失败会伪装成「Driver 探测错了」。
   */
  restoreAll(): void {
    for (const member of [...this.saved.keys()]) this.install(member)
  }
}
