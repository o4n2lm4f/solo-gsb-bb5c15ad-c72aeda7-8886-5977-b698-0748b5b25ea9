import { describe, expect, it } from 'vitest';
import {
  applyPatchToBase,
  PatchFormatError,
  validatePatchShape,
  type PatchFailure,
} from './patchMode';
import type { JsonValue } from './types';

const base: JsonValue = {
  name: 'svc',
  version: 1,
  tags: ['a', 'b'],
  nested: { keep: true, num: 10 },
};

// 直接传操作数组的便捷封装（先过 shape 校验再顺序应用）
function ops(patch: unknown[], side: 'ours' | 'theirs' = 'ours') {
  return applyPatchToBase(base, validatePatchShape(patch as JsonValue), side);
}

describe('validatePatchShape', () => {
  it('接受全部六种操作的合法补丁', () => {
    const doc: JsonValue = [
      { op: 'add', path: '/new', value: 1 },
      { op: 'remove', path: '/version' },
      { op: 'replace', path: '/name', value: 'x' },
      { op: 'move', from: '/nested/num', path: '/moved' },
      { op: 'copy', from: '/name', path: '/copied' },
      { op: 'test', path: '/name', value: 'svc' },
    ];
    expect(validatePatchShape(doc)).toHaveLength(6);
  });

  it('拒绝非数组补丁', () => {
    expect(() => validatePatchShape({} as JsonValue)).toThrow(PatchFormatError);
    expect(() => validatePatchShape({} as JsonValue)).toThrow('操作对象组成的 JSON 数组');
  });

  it.each([
    [{ op: 'add', path: '/x' }, 'add 操作缺少 "value"'],
    [{ op: 'replace', path: '/x' }, 'replace 操作缺少 "value"'],
    [{ op: 'test', path: '/x' }, 'test 操作缺少 "value"'],
    [{ op: 'remove', path: '/x' }, null],
    [{ op: 'move', path: '/x', value: 1 }, 'move 操作缺少字符串类型的 "from"'],
    [{ op: 'copy', path: '/x' }, 'copy 操作缺少字符串类型的 "from"'],
  ])('校验操作字段 %#', (opDoc, msg) => {
    if (msg === null) {
      expect(() => validatePatchShape([opDoc] as JsonValue)).not.toThrow();
    } else {
      expect(() => validatePatchShape([opDoc] as JsonValue)).toThrow(msg);
    }
  });

  it('拒绝非法 op 并给出操作序号', () => {
    expect(() => validatePatchShape([{ op: 'frobnicate', path: '/a' }] as JsonValue)).toThrow(
      '第 1 个操作：不支持的 op "frobnicate"',
    );
  });

  it('拒绝畸形 JSON Pointer', () => {
    expect(() => validatePatchShape([{ op: 'remove', path: 'a' }] as JsonValue)).toThrow(
      '必须以 / 开头',
    );
    expect(() => validatePatchShape([{ op: 'remove', path: '/a~2' }] as JsonValue)).toThrow(
      '转义符 ~ 后只能是 0 或 1',
    );
    expect(() => validatePatchShape([{ op: 'remove', path: '/tags/01' }] as JsonValue)).toThrow(
      '不允许前导 0',
    );
  });

  it('接受 RFC 6901 转义与根指针 /- 追加段', () => {
    expect(() =>
      validatePatchShape([
        { op: 'add', path: '/a~1b/c~0d', value: 1 },
        { op: 'add', path: '/tags/-', value: 'c' },
        { op: 'replace', path: '', value: {} },
      ] as JsonValue),
    ).not.toThrow();
  });

  it('拒绝非对象的数组元素', () => {
    expect(() => validatePatchShape([1, null] as JsonValue)).toThrow('第 1 个操作：必须是 JSON 对象');
  });
});

describe('applyPatchToBase', () => {
  it('顺序应用 add/replace/remove 得到正确文档', () => {
    const r = ops([
      { op: 'replace', path: '/version', value: 2 },
      { op: 'remove', path: '/nested/keep' },
      { op: 'add', path: '/extra', value: [1, 2] },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        name: 'svc',
        version: 2,
        tags: ['a', 'b'],
        nested: { num: 10 },
        extra: [1, 2],
      });
    }
  });

  it('数组 add /- 追加与按索引插入语义正确', () => {
    const r = ops([
      { op: 'add', path: '/tags/-', value: 'c' },
      { op: 'add', path: '/tags/0', value: 'z' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as { tags: string[] }).tags).toEqual(['z', 'a', 'b', 'c']);
  });

  it('数组 remove 后后续操作按位移后的索引生效', () => {
    const r = ops([{ op: 'remove', path: '/tags/0' }, { op: 'test', path: '/tags/0', value: 'b' }]);
    expect(r.ok).toBe(true);
  });

  it('move 跨节点搬移并保留原位置删除语义', () => {
    const r = ops([{ op: 'move', from: '/nested/num', path: '/nested/movedNum' }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        name: 'svc',
        version: 1,
        tags: ['a', 'b'],
        nested: { keep: true, movedNum: 10 },
      });
    }
  });

  it('copy 不删除源位置', () => {
    const r = ops([{ op: 'copy', from: '/nested', path: '/nestedCopy' }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { nested: unknown; nestedCopy: unknown };
      expect(v.nested).toEqual({ keep: true, num: 10 });
      expect(v.nestedCopy).toEqual({ keep: true, num: 10 });
    }
  });

  it('test 成功时文档不变', () => {
    const r = ops([{ op: 'test', path: '/nested', value: { keep: true, num: 10 } }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(base);
  });

  it('remove 不存在路径时在对应操作处失败并标明序号（1 起）', () => {
    const r = ops([
      { op: 'add', path: '/ok', value: 1 },
      { op: 'remove', path: '/missing' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.index).toBe(2);
      expect(r.failure.side).toBe('ours');
      expect(r.failure.reason).toContain('不存在');
    }
  });

  it('test 不相等时失败并说明是断言失败', () => {
    const r = ops([{ op: 'test', path: '/name', value: 'other' }], 'theirs');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const f: PatchFailure = r.failure;
      expect(f.side).toBe('theirs');
      expect(f.index).toBe(1);
      expect(f.reason).toContain('test 断言失败');
    }
  });

  it('move 到自身子路径时失败', () => {
    const r = ops([{ op: 'move', from: '/nested', path: '/nested/child' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.index).toBe(1);
  });

  it('copy 的 from 不存在时失败', () => {
    const r = ops([{ op: 'copy', from: '/nope', path: '/x' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.reason).toContain('不存在');
  });

  it('失败时不修改原始基线，且两次应用基于同一副本相互独立', () => {
    const snapshot = structuredClone(base);
    const r1 = ops([{ op: 'remove', path: '/missing' }]);
    const r2 = ops([{ op: 'replace', path: '/name', value: 'changed' }]);
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(true);
    expect(base).toEqual(snapshot); // 原基线未被任何一次应用污染
    if (r2.ok) expect((r2.value as { name: string }).name).toBe('changed');
    expect((base as { name: string }).name).toBe('svc');
  });

  it('空补丁原样返回基线的拷贝', () => {
    const r = applyPatchToBase(base, [], 'ours');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(base);
      expect(r.value).not.toBe(base);
    }
  });

  it('空数组元素 add 到对象会产生 null 元素（库语义保持透传）', () => {
    // 占位：确保 value 允许任意 JSON（含 null）
    const r = ops([{ op: 'add', path: '/x', value: null }]);
    expect(r.ok).toBe(true);
  });
});
