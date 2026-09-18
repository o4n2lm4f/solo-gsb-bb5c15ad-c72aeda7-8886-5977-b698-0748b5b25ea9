import { apply } from 'rfc6902/patch';
import type { Operation } from 'rfc6902';
import type { JsonValue } from './types';

/** 补丁模式中的两侧：当前分支 / 目标分支 */
export type PatchSide = 'ours' | 'theirs';

/** 支持的 RFC 6902 操作（与需求一致：add/remove/replace/move/copy/test） */
export const SUPPORTED_OPS = ['add', 'remove', 'replace', 'move', 'copy', 'test'] as const;

/** 单个操作失败的结构化信息（序号从 1 开始计） */
export interface PatchFailure {
  /** 失败侧：当前分支 / 目标分支 */
  side: PatchSide;
  /** 失败操作在补丁数组中的序号（1 起） */
  index: number;
  /** 人类可读的中文原因 */
  reason: string;
}

/** 补丁本身（JSON 解析后）结构不合法时抛出；applyPatch 失败用 PatchFailure */
export class PatchFormatError extends Error {}

/**
 * 校验补丁文档的整体结构与每个操作对象的形状。
 * 通过则返回可交给 rfc6902 库的 Operation[]；不通过抛 PatchFormatError。
 *
 * 这里只做“静态形状”校验（数组、op 合法、path/from/value 字段齐备且类型正确、
 * JSON Pointer 转义合法）；目标路径是否存在、test 是否相等这类“运行期”语义
 * 由 rfc6902 库在顺序应用时判定。
 */
export function validatePatchShape(doc: JsonValue): Operation[] {
  if (!Array.isArray(doc)) {
    throw new PatchFormatError('补丁必须是操作对象组成的 JSON 数组');
  }

  doc.forEach((raw, i) => {
    const where = `第 ${i + 1} 个操作`;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new PatchFormatError(`${where}：必须是 JSON 对象`);
    }
    const op = (raw as Record<string, unknown>).op;
    if (typeof op !== 'string') {
      throw new PatchFormatError(`${where}：缺少字符串类型的 "op" 字段`);
    }
    if (!(SUPPORTED_OPS as readonly string[]).includes(op)) {
      throw new PatchFormatError(
        `${where}：不支持的 op "${op}"，仅支持 ${SUPPORTED_OPS.join(' / ')}`,
      );
    }
    const path = (raw as Record<string, unknown>).path;
    if (typeof path !== 'string') {
      throw new PatchFormatError(`${where}：缺少字符串类型的 "path" 字段（JSON Pointer）`);
    }
    assertPointer(path, `${where} 的 path`);

    if (op === 'move' || op === 'copy') {
      const from = (raw as Record<string, unknown>).from;
      if (typeof from !== 'string') {
        throw new PatchFormatError(`${where}：${op} 操作缺少字符串类型的 "from" 字段`);
      }
      assertPointer(from, `${where} 的 from`);
    }
    if (op === 'add' || op === 'replace' || op === 'test') {
      if (!('value' in (raw as object))) {
        throw new PatchFormatError(`${where}：${op} 操作缺少 "value" 字段`);
      }
    }
  });

  return doc as unknown as Operation[];
}

/** RFC 6901 指针合法性检查（rfc6902 库对部分畸形指针较宽容，这里按 RFC 严格校验） */
function assertPointer(pointer: string, label: string): void {
  if (pointer === '') return; // 整个文档
  if (!pointer.startsWith('/')) {
    throw new PatchFormatError(`${label} "${pointer}" 不是合法 JSON Pointer：非根路径必须以 / 开头`);
  }
  for (const token of pointer.slice(1).split('/')) {
    // ~ 后只能跟 0 或 1，且每个 ~ 只消费一位（~01 合法 -> /1，~2/~x 非法）
    for (let i = 0; i < token.length; i++) {
      if (token[i] === '~' && (i + 1 >= token.length || (token[i + 1] !== '0' && token[i + 1] !== '1'))) {
        throw new PatchFormatError(
          `${label} "${pointer}" 不是合法 JSON Pointer：转义符 ~ 后只能是 0 或 1`,
        );
      }
    }
    // 数组索引段：0 或以非零数字开头的纯数字；-（仅用于 add 末尾追加）也放行，
    // 具体能否使用由库在应用时按操作判定。
    if (/^0\d+$/.test(token)) {
      throw new PatchFormatError(
        `${label} "${pointer}" 不是合法 JSON Pointer：数组索引 "${token}" 不允许前导 0`,
      );
    }
  }
}

/**
 * 将 rfc6902 库返回的错误转成中文原因。
 *
 * 注意：rfc6902 5.3.0 的 CJS 产物里自定义错误类经 ES5 __extends 转译后，
 * 其 instanceof 判定在 Node 下失效（原型链被重建），因此这里按可靠的 name 判别。
 */
function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const named = err as { name: string; message?: string; path?: string };
    if (named.name === 'TestError') {
      return 'test 断言失败：目标位置当前值与给定 value 不相等';
    }
    if (named.name === 'MissingError') {
      return `目标位置不存在${named.path ? `（${named.path}）` : ''}，无法完成该操作`;
    }
    if (named.name === 'InvalidOperationError') {
      return `非法操作：${named.message ?? ''}`;
    }
    if (named.message && named.message.startsWith('Invalid JSON Pointer')) {
      return `非法 JSON Pointer：${named.message.replace(/^Invalid JSON Pointer:?\s*/, '')}`;
    }
    return named.message ?? String(err);
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * 按 RFC 6902 将一份补丁**顺序**应用到基线文档的独立深拷贝上。
 *
 * - 两个调用方各自得到同一基线的独立副本，互不影响（rfc6902 原地修改，故先深拷贝）；
 * - 任一操作失败立即停止（RFC 6902 §5：补丁原子执行），返回失败操作序号（1 起）与原因；
 * - 成功时返回应用后的完整文档。
 */
export function applyPatchToBase(
  base: JsonValue,
  patch: Operation[],
  side: PatchSide,
): { ok: true; value: JsonValue } | { ok: false; failure: PatchFailure } {
  const doc: JsonValue = structuredClone(base);
  for (let i = 0; i < patch.length; i++) {
    let err: unknown = null;
    try {
      err = apply(doc, patch[i]);
    } catch (thrown) {
      err = thrown;
    }
    if (err !== null) {
      return { ok: false, failure: { side, index: i + 1, reason: describeError(err) } };
    }
  }
  return { ok: true, value: doc };
}
