/**
 * useResourceScope
 *
 * 组件优先使用此 composable,避免手写 onUnmounted(scope.dispose)。
 * scope 随 Vue effect scope 自动释放。
 */
import { onScopeDispose } from "vue";
import { ResourceScope, type ResourceScopeOptions } from "./ResourceScope";

export function useResourceScope(labelOrOptions?: string | ResourceScopeOptions): ResourceScope {
  const options: ResourceScopeOptions =
    typeof labelOrOptions === "string" ? { label: labelOrOptions } : (labelOrOptions ?? {});
  const scope = new ResourceScope(options);
  onScopeDispose(() => scope.dispose("vue-scope-disposed"));
  return scope;
}
