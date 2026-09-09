<script setup lang="ts">
import {
  computed,
  inject,
  onMounted,
  onUnmounted,
  provide,
  shallowRef,
  useId,
} from "vue";
import type { BMapClient, CreateBMapClientOptions } from "../../client/types";
import { BMapError } from "../../core/errors/BMapError";
import {
  bmapClientContextKey,
  createClientContext,
  defaultClientDefinitionKey,
  type BMapClientContext,
} from "../../core/context/client";

export interface BMapProviderProps {
  client?: BMapClient;
  definition?: CreateBMapClientOptions;
  autoLoad?: boolean;
  suspense?: boolean;
}

export interface ProviderErrorSlotProps {
  error: BMapError;
  retry: () => Promise<void>;
}

const props = withDefaults(defineProps<BMapProviderProps>(), {
  autoLoad: true,
  suspense: false,
});

const emit = defineEmits<{
  ready: [client: BMapClient];
  error: [error: BMapError];
}>();

// 查找顺序:显式 client/definition > 最近 Provider > app.use 默认 definition
const parentClient = inject(bmapClientContextKey, undefined);
const appDefaultDefinition = inject(defaultClientDefinitionKey, undefined);

const resolvedDefinition = computed<CreateBMapClientOptions | undefined>(
  () => props.definition ?? appDefaultDefinition,
);

const context: BMapClientContext = props.client
  ? createClientContext({ client: props.client })
  : parentClient && !props.definition
    ? parentClient
    : createClientContext({ definition: resolvedDefinition.value, client: undefined });

// 仅当本层新建 context 时才 provide,避免覆盖父 Provider 的同一实例
const isOwnContext = context !== parentClient;
if (isOwnContext) {
  provide(bmapClientContextKey, context);
  // 子树 <BMap> 无显式 definition 时可经此覆盖后的 definition 解析
  if (props.definition) {
    provide(defaultClientDefinitionKey, props.definition);
  }
}

const providerId = useId();
void providerId;

const status = computed(() => context.status.value);
const error = computed(() => context.error.value);

async function ensureLoad(signal?: AbortSignal) {
  if (!props.autoLoad && !signal) return;
  // SSR:服务端不执行 SDK load,保持 idle
  if (typeof window === "undefined") return;
  try {
    const client = await context.load(signal);
    emit("ready", client);
  } catch (e) {
    const err =
      e instanceof BMapError
        ? e
        : new BMapError("BMAP_SDK_LOAD_FAILED", String(e), { cause: e });
    // abort 不对外广播 error
    if ((e as Error)?.name === "AbortError" || signal?.aborted) return;
    emit("error", err);
  }
}

async function retry() {
  error.value;
  try {
    const client = await context.retry();
    emit("ready", client);
  } catch (e) {
    const err =
      e instanceof BMapError
        ? e
        : new BMapError("BMAP_SDK_LOAD_FAILED", String(e), { cause: e });
    emit("error", err);
    throw err;
  }
}

onMounted(() => {
  if (props.autoLoad) void ensureLoad();
});

onUnmounted(() => {
  // 仅释放本层创建的 context;复用父 context 时不 dispose
  if (isOwnContext && !props.client) {
    // Provider 卸载默认释放 client 上下文(子 Map 已随组件树先卸载)
    context.dispose();
  }
});

defineExpose({
  status,
  client: computed(() => context.client.value),
  error,
  load: (signal?: AbortSignal) => context.load(signal),
  retry,
});

defineOptions({ name: "BMapProvider" });
</script>

<template>
  <slot v-if="status === 'error'" name="error" :error="error" :retry="retry" />
  <slot v-else-if="status === 'loading'" name="loading" :status="status" />
  <slot :status="status" />
</template>
