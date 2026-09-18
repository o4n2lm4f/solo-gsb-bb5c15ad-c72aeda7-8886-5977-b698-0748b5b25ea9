// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import InputStage from './InputStage';
import type { JsonValue } from '../merge/types';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeRenderer(container: HTMLElement) {
  const root = createRoot(container);
  return (node: ReactElement) => act(() => root.render(node));
}

const all = (container: HTMLElement, sel: string) => [...container.querySelectorAll(sel)];
const btnByText = (container: HTMLElement, text: string) =>
  all(container, 'button').find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

/** React 受控组件需要用原生 setter 赋值后再派发 input 事件 */
function typeInto(container: HTMLElement, index: number, v: string) {
  const ta = all(container, 'textarea')[index] as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(ta, v);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('InputStage RFC 6902 补丁模式', () => {
  it('默认是三文档模式，切换后出现基线 + 两份补丁输入', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const render = makeRenderer(container);
    render(<InputStage onMerge={() => {}} onImportSnapshot={() => {}} />);

    expect(btnByText(container, '三文档模式')?.className).toContain('active');
    expect(all(container, 'textarea')).toHaveLength(3);
    expect(btnByText(container, '导入会话快照')).toBeTruthy();

    act(() => btnByText(container, 'RFC 6902 补丁模式')!.click());
    expect(btnByText(container, 'RFC 6902 补丁模式')?.className).toContain('active');
    // 补丁模式下不展示会话快照导入
    expect(btnByText(container, '导入会话快照')).toBeUndefined();
    expect(container.textContent).toContain('add');
    expect(container.textContent).toContain('test');
  });

  it('两份补丁成功应用后，以基线+两个结果调用 onMerge 进入三方合并', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const render = makeRenderer(container);
    let merged: { base: JsonValue; ours: JsonValue; theirs: JsonValue } | null = null;
    render(
      <InputStage
        onMerge={(base, ours, theirs) => {
          merged = { base, ours, theirs };
        }}
        onImportSnapshot={() => {}}
      />,
    );

    act(() => btnByText(container, 'RFC 6902 补丁模式')!.click());
    typeInto(container, 0, JSON.stringify({ a: 1, b: 2, t: [1, 2] }));
    typeInto(container, 1, JSON.stringify([{ op: 'replace', path: '/a', value: 10 }]));
    typeInto(
      container,
      2,
      JSON.stringify([
        { op: 'add', path: '/t/-', value: 3 },
        { op: 'move', from: '/a', path: '/aMoved' },
      ]),
    );
    act(() => btnByText(container, '应用补丁并合并')!.click());

    expect(merged).not.toBeNull();
    expect(merged!.base).toEqual({ a: 1, b: 2, t: [1, 2] });
    expect(merged!.ours).toEqual({ a: 10, b: 2, t: [1, 2] });
    expect(merged!.theirs).toEqual({ aMoved: 1, b: 2, t: [1, 2, 3] });
  });

  it('任一操作失败时阻止 onMerge，标明失败侧与操作序号，且输入保持不变', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const render = makeRenderer(container);
    let called = false;
    render(<InputStage onMerge={() => (called = true)} onImportSnapshot={() => {}} />);

    act(() => btnByText(container, 'RFC 6902 补丁模式')!.click());
    typeInto(container, 0, JSON.stringify({ a: 1 }));
    typeInto(container, 1, JSON.stringify([{ op: 'remove', path: '/missing' }]));
    typeInto(container, 2, JSON.stringify([{ op: 'replace', path: '/a', value: 2 }]));
    act(() => btnByText(container, '应用补丁并合并')!.click());

    expect(called).toBe(false);
    // 失败侧 + 序号（当前分支第 1 个操作）
    const banner = container.querySelector('.patch-failure-banner');
    expect(banner?.textContent).toContain('当前分支');
    expect(banner?.textContent).toContain('1');
    // 面板内也就地标注
    expect(container.textContent).toContain('第 1 个操作应用失败');
    // 输入内容保持不变
    expect((all(container, 'textarea')[1] as HTMLTextAreaElement).value).toContain('/missing');
    expect((all(container, 'textarea')[2] as HTMLTextAreaElement).value).toContain('"value":2');
  });

  it('test 断言失败时给出中文原因并阻止进入合并', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const render = makeRenderer(container);
    let called = false;
    render(<InputStage onMerge={() => (called = true)} onImportSnapshot={() => {}} />);

    act(() => btnByText(container, 'RFC 6902 补丁模式')!.click());
    typeInto(container, 0, JSON.stringify({ a: 1 }));
    typeInto(container, 1, '[]');
    typeInto(container, 2, JSON.stringify([{ op: 'test', path: '/a', value: 999 }]));
    act(() => btnByText(container, '应用补丁并合并')!.click());

    expect(called).toBe(false);
    const banner = container.querySelector('.patch-failure-banner');
    expect(banner?.textContent).toContain('目标分支');
    expect(banner?.textContent).toContain('test 断言失败');
  });

  it('补丁 JSON 非法或形状不合法时就地报错，不进入合并', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const render = makeRenderer(container);
    let called = false;
    render(<InputStage onMerge={() => (called = true)} onImportSnapshot={() => {}} />);

    act(() => btnByText(container, 'RFC 6902 补丁模式')!.click());
    typeInto(container, 0, JSON.stringify({ a: 1 }));
    typeInto(container, 1, '{ not json');
    typeInto(container, 2, JSON.stringify([{ op: 'frobnicate', path: '/a' }]));
    act(() => btnByText(container, '应用补丁并合并')!.click());

    expect(called).toBe(false);
    expect(container.textContent).toContain('当前分支补丁错误');
    expect(container.textContent).toContain('不支持的 op "frobnicate"');
  });

  it('切换模式时保留各自已输入的内容', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const render = makeRenderer(container);
    render(<InputStage onMerge={() => {}} onImportSnapshot={() => {}} />);

    typeInto(container, 0, '{"doc":true}');
    act(() => btnByText(container, 'RFC 6902 补丁模式')!.click());
    typeInto(container, 0, '{"patchBase":1}');
    act(() => btnByText(container, '三文档模式')!.click());
    expect((all(container, 'textarea')[0] as HTMLTextAreaElement).value).toBe('{"doc":true}');
    act(() => btnByText(container, 'RFC 6902 补丁模式')!.click());
    expect((all(container, 'textarea')[0] as HTMLTextAreaElement).value).toBe('{"patchBase":1}');
  });

  it('补丁模式加载示例数据后可成功进入合并（覆盖六种操作）', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const render = makeRenderer(container);
    let called = false;
    render(<InputStage onMerge={() => (called = true)} onImportSnapshot={() => {}} />);

    act(() => btnByText(container, 'RFC 6902 补丁模式')!.click());
    act(() => btnByText(container, '加载示例数据')!.click());
    act(() => btnByText(container, '应用补丁并合并')!.click());
    expect(called).toBe(true);
  });
});
