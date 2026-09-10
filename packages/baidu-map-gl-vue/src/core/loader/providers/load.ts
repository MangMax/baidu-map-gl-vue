/**
 * v4 script 加载编排（CDN / Custom 共用）
 *
 * 两个 script 型 Provider 共用同一套「先验证、再提交」的加载契约：
 *
 * 1. `assertReady` 交给底层 Loader，在**成功提交之前**执行（见 `SharedLoadTask.succeed`）：
 *    命名空间不完整 / 版本不符都算本次加载失败，底层因此不写成功缓存、并移除 script；
 * 2. 加载返回后重新读取全局命名空间——metadata 需要它，而且这里读到的才是「当下可用」的对象；
 * 3. 任一步失败都失效底层缓存：覆盖「成功提交之后命名空间仍不可用」的过期缓存，
 *    否则重试会命中它而不再插入 script。
 *
 * `exportGetter` 在这里刻意不用：它只是「回调没带实参时的取值兜底」，回调带实参时会整段跳过，
 * 拿它当校验点会留下绕过路径（见 #57 评审 R2）。
 */
import type { ScriptLoader, ScriptLoaderOptions } from "../ScriptLoader";
import { getScriptKey } from "../ScriptLoader";
import { requireJsapiV4Global } from "./namespace";
import type { JsapiV4ProviderId } from "./types";

export interface LoadJsapiV4ScriptInput {
  readonly loader: ScriptLoader;
  /** 已包含 `assertReady` 的 Loader 选项（就绪校验由调用方按 Provider 语义给出）。 */
  readonly loadOptions: ScriptLoaderOptions;
  readonly providerId: JsapiV4ProviderId;
  readonly signal?: AbortSignal;
}

/** 执行一次 v4 script 加载并返回校验通过的全局命名空间。 */
export async function loadJsapiV4Script(
  input: LoadJsapiV4ScriptInput,
): Promise<Record<string, unknown>> {
  const key = getScriptKey(input.loadOptions);
  try {
    await input.loader.load(input.loadOptions, input.signal);
    return requireJsapiV4Global(input.providerId);
  } catch (error) {
    // `clear` 幂等：失败路径底层本就不写成功缓存，这里主要覆盖「成功提交之后命名空间
    // 仍不可用」的过期成功缓存，避免重试命中它而不再插入 script。
    input.loader.clear(key);
    throw error;
  }
}
