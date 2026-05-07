import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CanvasWidgetController } from '@/agent/canvas/widget/widgetController';
import type { CanvasViewModel } from '@/agent/canvas/widget/widgetState';
import type { ProviderKind } from '@/settings/settingsStore';
import { PRESET_IDS } from '@/agent/canvas/schemas';
import type { LayoutHint } from '@/agent/canvas/schemas';
import { CANVAS_PALETTE_LIST, paletteFor } from '@/agent/canvas/layouts/colorPalette';

export interface CanvasWidgetProps {
  readonly controller: CanvasWidgetController;
}

export function CanvasWidget({ controller }: CanvasWidgetProps): JSX.Element {
  const vm = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.viewModel(),
    () => controller.viewModel(),
  );
  return <CanvasWidgetView vm={vm} controller={controller} />;
}

interface ViewProps {
  readonly vm: CanvasViewModel;
  readonly controller: CanvasWidgetController;
}

function CanvasWidgetView({ vm, controller }: ViewProps): JSX.Element {
  return (
    <section
      className={`leo-root leo-canvas-widget leo-canvas-${vm.op}`}
      data-slot="canvas-widget"
      data-phase={vm.phase}
      data-op={vm.op}
      data-runid={vm.runId}
      aria-label={`Canvas ${vm.op} run ${vm.runId} (phase: ${vm.phase})`}
    >
      <header className="leo-canvas-header">
        <span className="leo-canvas-title">
          Canvas {vm.op}
          <span className="leo-canvas-runid"> · {vm.runId}</span>
        </span>
        <ElapsedBadge vm={vm} />
        <span className="leo-canvas-phase" data-phase-label>
          {vm.phase}
        </span>
      </header>
      <p className="leo-canvas-target">
        <strong>Target:</strong> <code>{vm.targetPath}</code>
      </p>
      <PhaseBody vm={vm} controller={controller} />
      {vm.error !== null ? (
        <p className="leo-canvas-error" data-slot="canvas-error">
          <strong>Error</strong> ({vm.error.code}): {vm.error.message}
        </p>
      ) : null}
    </section>
  );
}

function ElapsedBadge({ vm }: { readonly vm: CanvasViewModel }): JSX.Element | null {
  const [, setTick] = useState(0);
  const running = vm.startedAt !== null && vm.endedAt === null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (vm.startedAt === null) return null;
  const end = vm.endedAt ?? Date.now();
  const seconds = Math.max(0, Math.floor((end - vm.startedAt) / 1000));
  return (
    <span className="leo-canvas-elapsed" data-slot="canvas-elapsed">
      {seconds}s
    </span>
  );
}

function PhaseBody({ vm, controller }: ViewProps): JSX.Element | null {
  switch (vm.phase) {
    case 'awaiting_config':
      return <ConfigBody vm={vm} controller={controller} />;
    case 'preparing':
      return <RefineBody vm={vm} controller={controller} />;
    case 'planning':
    case 'fetching':
      return <ProgressBody vm={vm} kind="fetch" />;
    case 'extracting':
      return <ProgressBody vm={vm} kind="extract" />;
    case 'reducing':
      return <ReduceBody vm={vm} />;
    case 'diffing':
      return <DiffBody vm={vm} />;
    case 'laying_out':
      return <LayoutBody vm={vm} />;
    case 'previewing':
      return <PreviewingBody vm={vm} controller={controller} />;
    case 'writing':
      return <p className="leo-canvas-status-line">Writing canvas…</p>;
    case 'done':
    case 'cancelled':
      return <TerminalSummaryBody vm={vm} />;
    case 'error':
      return null;
  }
}

function ConfigBody({ vm, controller }: ViewProps): JSX.Element {
  const cfg = vm.config;
  if (cfg === undefined) return <p className="leo-canvas-status-line">Preparing config…</p>;
  return (
    <div className="leo-canvas-config" data-slot="canvas-config">
      <label className="leo-canvas-config-ask">
        <strong>Ask:</strong>
        <textarea data-slot="canvas-config-ask" value={cfg.originalAsk} readOnly rows={3} />
      </label>
      <div className="leo-canvas-config-row">
        <label>
          Provider
          <select
            data-slot="canvas-config-provider"
            value={cfg.draftProviderId}
            onChange={(e) => controller.onSelectProvider(e.target.value as ProviderKind)}
          >
            {cfg.providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <select
            data-slot="canvas-config-model"
            value={cfg.draftModel}
            onChange={(e) => controller.onSelectModel(e.target.value)}
            disabled={cfg.models.state !== 'ok'}
          >
            {cfg.models.state === 'ok'
              ? cfg.models.items.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))
              : null}
          </select>
        </label>
      </div>
      {cfg.models.state === 'loading' ? (
        <p className="leo-canvas-config-loading">Loading models…</p>
      ) : null}
      {cfg.models.state === 'error' ? (
        <p className="leo-canvas-config-error">
          Failed to load models: {cfg.models.error}{' '}
          <button type="button" onClick={() => controller.onRetryLoadModels()}>
            Retry
          </button>
        </p>
      ) : null}
      <div className="leo-canvas-config-row">
        <label>
          Layout preset
          <select
            data-slot="canvas-config-preset"
            value={cfg.draftPreset}
            onChange={(e) => controller.onSelectPreset(e.target.value as LayoutHint)}
          >
            <option value="auto">auto</option>
            {PRESET_IDS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Palette
          <select
            data-slot="canvas-config-palette"
            value={cfg.draftPaletteId}
            onChange={(e) => controller.onSelectPalette(e.target.value)}
          >
            {CANVAS_PALETTE_LIST.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <PaletteSwatches paletteId={cfg.draftPaletteId} />
      <div className="leo-canvas-config-row">
        <label>
          Path
          <input
            type="text"
            data-slot="canvas-config-path"
            value={cfg.draftPath}
            onChange={(e) => controller.onSetPath(e.target.value)}
          />
        </label>
      </div>
      {cfg.apiKeyMissing ? (
        <p className="leo-canvas-config-apikey">API key required for this provider.</p>
      ) : null}
      {cfg.validationError !== null ? (
        <p className="leo-canvas-config-validation">{cfg.validationError}</p>
      ) : null}
      <div className="leo-canvas-config-actions">
        <button
          type="button"
          data-slot="canvas-config-start"
          onClick={() => controller.onConfirm()}
        >
          Start
        </button>
        <button type="button" onClick={() => controller.onCancel()}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function PaletteSwatches({ paletteId }: { readonly paletteId: string }): JSX.Element {
  const preset = paletteFor(paletteId as Parameters<typeof paletteFor>[0]);
  return (
    <ul
      className="leo-canvas-palette-swatches"
      data-slot="canvas-config-palette-swatches"
      aria-label={`Palette preview: ${preset.label}`}
    >
      {preset.colors.map((c, i) => (
        <li
          key={i}
          className="leo-canvas-palette-swatch"
          style={{ backgroundColor: c }}
          data-color={c}
          aria-hidden="true"
        />
      ))}
    </ul>
  );
}

function RefineBody({ vm, controller }: ViewProps): JSX.Element {
  const transcript = vm.refineTranscript ?? [];
  const clarify = vm.clarifyingQuestion ?? null;
  return (
    <div className="leo-canvas-refine" data-slot="canvas-refine">
      {transcript.length > 0 ? (
        <ul className="leo-canvas-refine-transcript">
          {transcript.map((t, i) => (
            <li key={i} data-role={t.role}>
              <strong>{t.role}:</strong> {t.content}
            </li>
          ))}
        </ul>
      ) : (
        <p className="leo-canvas-status-line">Refining ask…</p>
      )}
      {clarify !== null ? <ClarifyForm question={clarify} controller={controller} /> : null}
    </div>
  );
}

function ClarifyForm({
  question,
  controller,
}: {
  readonly question: string;
  readonly controller: CanvasWidgetController;
}): JSX.Element {
  const [text, setText] = useState('');
  return (
    <form
      className="leo-canvas-clarify"
      data-slot="canvas-clarify"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim().length === 0) return;
        controller.answerClarification(text);
        setText('');
      }}
    >
      <p>
        <strong>Question:</strong> {question}
      </p>
      <textarea
        data-slot="canvas-clarify-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />
      <button type="submit">Send</button>
    </form>
  );
}

function ProgressBody({
  vm,
  kind,
}: {
  readonly vm: CanvasViewModel;
  readonly kind: 'fetch' | 'extract';
}): JSX.Element {
  const p = kind === 'fetch' ? vm.fetchProgress : vm.extractProgress;
  if (p === undefined) {
    return (
      <p className="leo-canvas-status-line">{kind === 'fetch' ? 'Fetching…' : 'Extracting…'}</p>
    );
  }
  return (
    <div className="leo-canvas-progress" data-slot={`canvas-${kind}-progress`}>
      <p>
        {p.completed} / {p.total} {kind === 'fetch' ? 'fetched' : 'extracted'}
        {p.failed !== undefined && p.failed > 0 ? ` (${p.failed} failed)` : ''}
      </p>
      {p.current !== undefined ? <p className="leo-canvas-progress-current">{p.current}</p> : null}
    </div>
  );
}

function ReduceBody({ vm }: { readonly vm: CanvasViewModel }): JSX.Element {
  const insights = vm.insights;
  if (insights === undefined) {
    return <p className="leo-canvas-status-line">Reducing…</p>;
  }
  return (
    <div className="leo-canvas-insights" data-slot="canvas-insights">
      <p>
        Hubs: {insights.hubs.length} · Components: {insights.components.count}
      </p>
    </div>
  );
}

function DiffBody({ vm }: { readonly vm: CanvasViewModel }): JSX.Element {
  const d = vm.diffSummary;
  if (d === undefined) return <p className="leo-canvas-status-line">Diffing…</p>;
  return (
    <div className="leo-canvas-diff" data-slot="canvas-diff">
      <p>
        Kept {d.kept} · Added {d.added} · Removed {d.removed} · Locked {d.locked}
      </p>
      {vm.tombstoneSummary !== undefined ? (
        <p className="leo-canvas-tombstones">{vm.tombstoneSummary}</p>
      ) : null}
    </div>
  );
}

function LayoutBody({ vm }: { readonly vm: CanvasViewModel }): JSX.Element {
  return (
    <div className="leo-canvas-layout" data-slot="canvas-layout">
      <p>
        Layout: <code>{vm.preset ?? 'auto'}</code>
        {vm.fellBackTo !== undefined ? ` (fell back to ${vm.fellBackTo})` : ''}
      </p>
    </div>
  );
}

function PreviewingBody({ vm, controller }: ViewProps): JSX.Element {
  const previewPath = vm.previewPath;
  return (
    <div className="leo-canvas-previewing" data-slot="canvas-previewing">
      {previewPath !== undefined ? (
        <p>
          <strong>Preview:</strong> <code>{previewPath}</code>{' '}
          <button
            type="button"
            data-slot="canvas-preview-open"
            onClick={() => controller.openPreview()}
          >
            Open preview
          </button>
        </p>
      ) : null}
      <textarea
        data-slot="canvas-edit-instruction"
        placeholder="Optional edit instruction"
        rows={3}
        value={vm.editInstruction ?? ''}
        onChange={(e) => controller.setEditInstruction(e.target.value)}
      />
      <div className="leo-canvas-previewing-actions">
        <button type="button" data-slot="canvas-approve" onClick={() => controller.approve()}>
          Approve
        </button>
        <button
          type="button"
          data-slot="canvas-edit"
          onClick={() => controller.edit()}
          disabled={(vm.editInstruction ?? '').trim().length === 0}
        >
          Edit
        </button>
        <button type="button" data-slot="canvas-cancel" onClick={() => controller.cancel()}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function TerminalSummaryBody({ vm }: { readonly vm: CanvasViewModel }): JSX.Element {
  return (
    <div className="leo-canvas-terminal" data-slot="canvas-terminal">
      <p>
        Phase: <code>{vm.phase}</code>
      </p>
      {vm.insights !== undefined ? (
        <p>
          Hubs: {vm.insights.hubs.length} · Components: {vm.insights.components.count}
        </p>
      ) : null}
      {vm.failedSources !== undefined && vm.failedSources.length > 0 ? (
        <p>{vm.failedSources.length} source(s) failed</p>
      ) : null}
    </div>
  );
}
