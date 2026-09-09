import { describe, it, expect } from "vitest";
import { captureJsonpServiceError } from "./services";

function fakeSdk() {
  return { _rd: {} as Record<string, unknown> };
}

describe("captureJsonpServiceError", () => {
  it("returns null capture without _rd", () => {
    const capture = captureJsonpServiceError({});
    capture.rescan();
    expect(capture.getLastError()).toBeNull();
  });

  it("records server error from newly registered callbacks", () => {
    const sdk = fakeSdk();
    const capture = captureJsonpServiceError(sdk);
    capture.rescan();
    // 模拟 SDK 发起请求时注册 JSONP 回调
    (sdk._rd as Record<string, unknown>)._cbk1 = () => "ok";
    capture.rescan();
    // 模拟服务端返回配额错误
    const fn = (sdk._rd as Record<string, (...args: unknown[]) => unknown>)._cbk1;
    const ret = fn({ result: { error: 302, error_msg: "当天配额已用完" } });
    expect(ret).toBe("ok");
    expect(capture.getLastError()).toEqual({ code: 302, message: "当天配额已用完" });
  });

  it("ignores success responses (error 0)", () => {
    const sdk = fakeSdk();
    const capture = captureJsonpServiceError(sdk);
    (sdk._rd as Record<string, unknown>)._cbk2 = () => {};
    capture.rescan();
    const fn = (sdk._rd as Record<string, (...args: unknown[]) => unknown>)._cbk2;
    fn({ result: { error: 0 }, content: {} });
    expect(capture.getLastError()).toBeNull();
  });

  it("ignores pre-existing keys and non-function values", () => {
    const sdk = { _rd: { old: 42 } };
    const capture = captureJsonpServiceError(sdk);
    capture.rescan();
    expect(capture.getLastError()).toBeNull();
  });
});
