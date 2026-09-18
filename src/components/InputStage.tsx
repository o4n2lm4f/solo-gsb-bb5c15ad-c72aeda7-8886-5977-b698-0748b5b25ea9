import { useRef, useState } from 'react';
import JsonInputPanel from './JsonInputPanel';
import type { JsonValue } from '../merge/types';
import { parseSnapshot, type SessionSnapshot } from '../merge/snapshot';
import {
  SAMPLE_BASE,
  SAMPLE_OURS,
  SAMPLE_THEIRS,
  SAMPLE_PATCH_BASE,
  SAMPLE_OURS_PATCH,
  SAMPLE_THEIRS_PATCH,
} from '../sampleData';
import {
  applyPatchToBase,
  PatchFormatError,
  validatePatchShape,
  type PatchFailure,
} from '../merge/patchMode';

interface Props {
  onMerge: (base: JsonValue, ours: JsonValue, theirs: JsonValue) => void;
  onImportSnapshot: (snapshot: SessionSnapshot) => void;
}

type Field = 'base' | 'ours' | 'theirs';
type InputMode = 'docs' | 'patch';

const DOC_PANELS: { field: Field; title: string; hint: string }[] = [
  { field: 'base', title: '基线 (Base)', hint: '三方共同的祖先版本' },
  { field: 'ours', title: '当前分支 (Ours)', hint: '当前分支上的修改版本' },
  { field: 'theirs', title: '目标分支 (Theirs)', hint: '需要合入的目标分支版本' },
];

const empty3 = (): Record<Field, string> => ({ base: '', ours: '', theirs: '' });
const empty3Errors = (): Record<Field, string | null> => ({ base: null, ours: null, theirs: null });

export default function InputStage({ onMerge, onImportSnapshot }: Props) {
  const [mode, setMode] = useState<InputMode>('docs');

  // 两种模式各自保留输入文本，切换模式互不丢失
  const [docTexts, setDocTexts] = useState<Record<Field, string>>(empty3());
  const [patchTexts, setPatchTexts] = useState<Record<Field, string>>(empty3());
  const [docErrors, setDocErrors] = useState<Record<Field, string | null>>(empty3Errors());
  const [patchErrors, setPatchErrors] = useState<Record<Field, string | null>>(empty3Errors());
  // 补丁应用失败的结构化信息（用于顶部汇总：失败侧 + 操作序号）
  const [patchFailure, setPatchFailure] = useState<PatchFailure | null>(null);

  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const snapshotFileRef = useRef<HTMLInputElement>(null);

  const setTexts = mode === 'docs' ? setDocTexts : setPatchTexts;
  const setErrors = mode === 'docs' ? setDocErrors : setPatchErrors;

  const setText = (field: Field) => (v: string) => {
    setTexts((t) => ({ ...t, [field]: v }));
    setErrors((e) => ({ ...e, [field]: null }));
    if (mode === 'patch') setPatchFailure(null);
  };

  const switchMode = (next: InputMode) => {
    if (next === mode) return;
    setMode(next);
    setSnapshotError(null);
    setPatchFailure(null);
  };

  // ── 三文档模式：解析三份 JSON 后直接进入现有三方合并 ─────────────────────
  const handleDocsStart = () => {
    const parsed: Partial<Record<Field, JsonValue>> = {};
    const newErrors = empty3Errors();
    let ok = true;
    for (const { field } of DOC_PANELS) {
      try {
        parsed[field] = JSON.parse(docTexts[field]) as JsonValue;
      } catch (err) {
        newErrors[field] = err instanceof Error ? err.message : String(err);
        ok = false;
      }
    }
    setDocErrors(newErrors);
    if (ok) {
      setSnapshotError(null);
      onMerge(parsed.base!, parsed.ours!, parsed.theirs!);
    }
  };

  // ── 补丁模式：基线各取一份独立副本，分别顺序应用两侧补丁 ──────────────────
  const handlePatchStart = () => {
    const newErrors = empty3Errors();
    let base: JsonValue | null = null;
    const parsedPatch: Partial<Record<'ours' | 'theirs', ReturnType<typeof validatePatchShape>>> = {};
    let ok = true;

    try {
      base = JSON.parse(patchTexts.base) as JsonValue;
    } catch (err) {
      newErrors.base = err instanceof Error ? err.message : String(err);
      ok = false;
    }

    for (const side of ['ours', 'theirs'] as const) {
      let patchDoc: JsonValue;
      try {
        patchDoc = JSON.parse(patchTexts[side]) as JsonValue;
      } catch (err) {
        newErrors[side] = err instanceof Error ? err.message : String(err);
        ok = false;
        continue;
      }
      try {
        parsedPatch[side] = validatePatchShape(patchDoc);
      } catch (err) {
        if (err instanceof PatchFormatError) {
          newErrors[side] = err.message;
        } else {
          newErrors[side] = err instanceof Error ? err.message : String(err);
        }
        ok = false;
      }
    }

    // 补丁形状或 JSON 解析已失败时不再应用，保持输入并就地报错（阻止进入合并流程）
    if (!ok || base === null) {
      setPatchErrors(newErrors);
      setPatchFailure(null);
      return;
    }

    // 两侧各自从同一基线的独立副本顺序应用；任一操作失败立即阻止
    const results: Partial<Record<'ours' | 'theirs', JsonValue>> = {};
    let firstFailure: PatchFailure | null = null;
    for (const side of ['ours', 'theirs'] as const) {
      const r = applyPatchToBase(base, parsedPatch[side]!, side);
      if (!r.ok) {
        newErrors[side] = `第 ${r.failure.index} 个操作应用失败：${r.failure.reason}`;
        if (!firstFailure) firstFailure = r.failure;
      } else {
        results[side] = r.value;
      }
    }

    if (firstFailure) {
      setPatchErrors(newErrors);
      setPatchFailure(firstFailure);
      return;
    }

    // 全部成功：把两个结果交给现有三方合并流程
    setPatchErrors(empty3Errors());
    setPatchFailure(null);
    setSnapshotError(null);
    onMerge(base, results.ours!, results.theirs!);
  };

  const loadDocSample = () => {
    setDocTexts({ base: SAMPLE_BASE, ours: SAMPLE_OURS, theirs: SAMPLE_THEIRS });
    setDocErrors(empty3Errors());
    setSnapshotError(null);
  };

  const loadPatchSample = () => {
    setPatchTexts({
      base: SAMPLE_PATCH_BASE,
      ours: SAMPLE_OURS_PATCH,
      theirs: SAMPLE_THEIRS_PATCH,
    });
    setPatchErrors(empty3Errors());
    setPatchFailure(null);
  };

  // 快照非法时仅提示错误，不影响当前输入内容
  const handleSnapshotFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const snapshot = parseSnapshot(await file.text());
      setSnapshotError(null);
      onImportSnapshot(snapshot);
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : String(err));
    }
  };

  const startDisabled =
    mode === 'docs'
      ? !docTexts.base.trim() || !docTexts.ours.trim() || !docTexts.theirs.trim()
      : !patchTexts.base.trim() || !patchTexts.ours.trim() || !patchTexts.theirs.trim();

  return (
    <>
      <div className="input-mode-switch" role="tablist" aria-label="输入模式">
        <button
          role="tab"
          aria-selected={mode === 'docs'}
          className={mode === 'docs' ? 'active' : ''}
          onClick={() => switchMode('docs')}
        >
          三文档模式
        </button>
        <button
          role="tab"
          aria-selected={mode === 'patch'}
          className={mode === 'patch' ? 'active' : ''}
          onClick={() => switchMode('patch')}
        >
          RFC 6902 补丁模式
        </button>
      </div>

      {mode === 'docs' ? (
        <div className="input-grid">
          {DOC_PANELS.map(({ field, title, hint }) => (
            <JsonInputPanel
              key={field}
              title={title}
              hint={hint}
              value={docTexts[field]}
              error={docErrors[field]}
              onChange={setText(field)}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="patch-mode-hint">
            提供一份<strong>基线 JSON</strong>，以及当前分支、目标分支各一份
            <strong> RFC 6902 JSON Patch</strong>。两份补丁分别从同一基线的独立副本按顺序应用（
            <code>add</code> / <code>remove</code> / <code>replace</code> / <code>move</code> /{' '}
            <code>copy</code> / <code>test</code>）；任一操作失败将阻止进入合并流程，全部成功后把两个结果交给三方合并。
          </div>
          <div className="input-grid">
            <JsonInputPanel
              title="基线 JSON (Base)"
              hint="两份补丁共同的起点；应用前会为两侧各创建独立深拷贝"
              value={patchTexts.base}
              error={patchErrors.base}
              onChange={setText('base')}
            />
            <JsonInputPanel
              title="当前分支补丁 (Ours Patch)"
              hint="application/json-patch+json：从基线得到当前分支版本的操作数组"
              value={patchTexts.ours}
              error={patchErrors.ours}
              errorLabel="当前分支补丁错误"
              onChange={setText('ours')}
            />
            <JsonInputPanel
              title="目标分支补丁 (Theirs Patch)"
              hint="application/json-patch+json：从基线得到目标分支版本的操作数组"
              value={patchTexts.theirs}
              error={patchErrors.theirs}
              errorLabel="目标分支补丁错误"
              onChange={setText('theirs')}
            />
          </div>
        </>
      )}

      <div className="input-actions">
        <button onClick={mode === 'docs' ? loadDocSample : loadPatchSample}>加载示例数据</button>
        {mode === 'docs' && (
          <>
            <button onClick={() => snapshotFileRef.current?.click()}>导入会话快照</button>
            <input
              ref={snapshotFileRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                void handleSnapshotFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </>
        )}
        <div className="spacer" />
        <button
          className="primary"
          onClick={mode === 'docs' ? handleDocsStart : handlePatchStart}
          disabled={startDisabled}
        >
          {mode === 'docs' ? '开始合并 →' : '应用补丁并合并 →'}
        </button>
      </div>

      {patchFailure && (
        <div className="error-text patch-failure-banner" role="alert">
          补丁应用失败，已阻止进入合并流程（输入内容保持不变）：
          <strong>{patchFailure.side === 'ours' ? '当前分支' : '目标分支'}</strong>侧第
          <strong> {patchFailure.index} </strong>个操作 —— {patchFailure.reason}
        </div>
      )}
      {snapshotError && <div className="error-text snapshot-error">快照导入失败：{snapshotError}</div>}
    </>
  );
}
