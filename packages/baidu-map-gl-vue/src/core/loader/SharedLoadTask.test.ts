import { describe, it, expect, vi, afterEach } from "vitest";
import { SharedLoadTask } from "./SharedLoadTask";

const SRC = "https://sdk.example.com/bmap.js";

function trackScripts(): HTMLScriptElement[] {
  const created: HTMLScriptElement[] = [];
  const container = document.createElement("div");
  Object.defineProperty(document, "body", { value: container, configurable: true });
  const realAppend = Node.prototype.appendChild;
  vi.spyOn(Node.prototype, "appendChild").mockImplementation(function (this: Node, node: Node) {
    if (node instanceof HTMLScriptElement) created.push(node);
    return realAppend.call(this, node as never) as never;
  });
  return created;
}

/** 脱离文档的容器里，用 parentNode 判断 script 是否仍在 DOM。 */
function isAttached(script: HTMLScriptElement): boolean {
  return script.parentNode !== null;
}

describe("SharedLoadTask", () => {
  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).body;
    vi.restoreAllMocks();
  });

  it("多消费者共享一个 script，单个取消不影响其它消费者", async () => {
    const created = trackScripts();
    const task = new SharedLoadTask({ mode: "load", src: SRC, exportGetter: () => "sdk" });
    const c1 = new AbortController();
    const p1 = task.subscribe(c1.signal);
    const p2 = task.subscribe();

    expect(created).toHaveLength(1);
    expect(task.consumerCount).toBe(2);

    c1.abort();
    await expect(p1).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    expect(task.consumerCount).toBe(1);
    expect(isAttached(created[0])).toBe(true);

    created[0].dispatchEvent(new Event("load"));
    await expect(p2).resolves.toBe("sdk");
    expect(task.consumerCount).toBe(0);
    expect(task.status).toBe("settled");
  });

  it("最后一个消费者离开时取消底层任务并触发 onCancelled", async () => {
    const created = trackScripts();
    const onCancelled = vi.fn();
    const task = new SharedLoadTask({ mode: "load", src: SRC }, { onCancelled });
    const c1 = new AbortController();
    const c2 = new AbortController();
    const p1 = task.subscribe(c1.signal);
    const p2 = task.subscribe(c2.signal);

    c1.abort();
    expect(onCancelled).not.toHaveBeenCalled();
    c2.abort();
    await Promise.allSettled([p1, p2]);

    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(task.isSettled).toBe(true);
    expect(task.consumerCount).toBe(0);
    expect(isAttached(created[0])).toBe(false);
  });

  it("失败时触发 onFailure 并移除 script", async () => {
    const created = trackScripts();
    const onFailure = vi.fn();
    const onSuccess = vi.fn();
    const task = new SharedLoadTask({ mode: "load", src: SRC }, { onFailure, onSuccess });
    const promise = task.subscribe();

    created[0].dispatchEvent(new Event("error"));
    await expect(promise).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(isAttached(created[0])).toBe(false);
  });

  it("已 abort 的 signal 在订阅时立即被拒绝", async () => {
    trackScripts();
    const task = new SharedLoadTask({ mode: "load", src: SRC });
    const controller = new AbortController();
    controller.abort();
    await expect(task.subscribe(controller.signal)).rejects.toMatchObject({
      code: "BMAP_PROVIDER_ABORTED",
    });
    expect(task.status).toBe("idle");
  });
});
