import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import type { z } from 'zod';
import type { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import type { ExternalAgentAdapter } from '@/agent/externalAgent/adapters/base';
import { kindRequiresApiKey } from '@/providers/registry';
import type { ProviderKind } from './settingsStore';
import type { SafeStorage } from '@/storage/safeStorage';
import {
  describeConfigSchema,
  SAFE_STORAGE_PREFIX,
  type ZodFieldDescriptor,
} from './externalAgentResolver';
import type { ExternalAgentInstanceSettings, ExternalAgentsSettings } from './settingsStore';

const PROVIDER_KIND_SET: ReadonlySet<ProviderKind> = new Set([
  'lmstudio',
  'openai',
  'anthropic',
  'ollama',
  'custom',
]);

export interface ProviderOption {
  readonly id: string;
  readonly label: string;
}

export interface ExternalAgentsSectionProps {
  readonly registry: AdapterRegistry;
  readonly settings: ExternalAgentsSettings;
  readonly onChange: (next: ExternalAgentsSettings) => void;
  readonly safeStorage?: SafeStorage;
  readonly readSecret?: (key: string) => Promise<string>;
  readonly writeSecret?: (key: string, value: string) => Promise<void>;
  readonly providerOptions?: readonly ProviderOption[];
  readonly discoveredModels?: readonly { readonly id: string }[];
  readonly onProviderApiKeyChanged?: () => Promise<void> | void;
}

const EMPTY_NOTE =
  'No external-agent adapters are registered. Concrete adapters (Claude Code, OpenAI-compatible, …) ship in a follow-up phase. The contract and plumbing are in place — register an adapter at plugin load to surface its config here.';

function ExternalAgentsSectionImpl(props: ExternalAgentsSectionProps): JSX.Element {
  const { registry, settings, onChange } = props;
  const adapters = useMemo(() => registry.list(), [registry]);
  const enabledIds = adapters
    .filter((a) => settings.adapters[a.id]?.enabled !== false)
    .map((a) => a.id);

  const updateDefault = (next: string | null): void => {
    onChange({ ...settings, defaultAdapterId: next });
  };
  const updateAdapter = (id: string, patch: Partial<ExternalAgentInstanceSettings>): void => {
    const prev = settings.adapters[id] ?? { enabled: true, config: {} };
    const nextAdapter: ExternalAgentInstanceSettings = { ...prev, ...patch };
    onChange({
      ...settings,
      adapters: { ...settings.adapters, [id]: nextAdapter },
    });
  };

  return (
    <section
      className="leo-root leo-external-agents-section"
      data-slot="external-agents-section"
      aria-label="External agent settings"
    >
      <header className="leo-eas-header">
        <h3 className="leo-eas-title">External Agents</h3>
        <p className="leo-eas-desc">
          Configure adapters Leo can delegate to via the <code>delegate_external</code> tool. The
          widget picker shows enabled adapters; secrets are stored via SafeStorage.
        </p>
      </header>

      <div className="leo-eas-default-row">
        <label className="leo-eas-field">
          <span>Default adapter</span>
          <select
            className="leo-eas-select"
            aria-label="Default external adapter"
            value={settings.defaultAdapterId ?? ''}
            disabled={enabledIds.length === 0}
            onChange={(e) => updateDefault(e.target.value === '' ? null : e.target.value)}
          >
            {enabledIds.length === 0 ? (
              <option value="">No adapters registered</option>
            ) : (
              <>
                <option value="">(none)</option>
                {adapters
                  .filter((a) => settings.adapters[a.id]?.enabled !== false)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
              </>
            )}
          </select>
        </label>
        {settings.defaultAdapterId !== null &&
        adapters.find((a) => a.id === settings.defaultAdapterId) !== undefined &&
        settings.adapters[settings.defaultAdapterId]?.enabled === false ? (
          <p className="leo-eas-warning" role="alert" data-slot="external-agents-default-disabled">
            Configured default <code>{settings.defaultAdapterId}</code> is disabled. The runtime
            will fall back to the first enabled adapter (alphabetical).
          </p>
        ) : null}
      </div>

      {adapters.length === 0 ? (
        <p className="leo-eas-empty" data-slot="external-agents-empty">
          {EMPTY_NOTE}
        </p>
      ) : (
        <ul className="leo-eas-adapter-list">
          {adapters.map((adapter) => (
            <AdapterBlock
              key={adapter.id}
              adapter={adapter}
              instance={settings.adapters[adapter.id] ?? { enabled: true, config: {} }}
              onChange={(patch) => updateAdapter(adapter.id, patch)}
              {...(props.readSecret !== undefined ? { readSecret: props.readSecret } : {})}
              {...(props.writeSecret !== undefined ? { writeSecret: props.writeSecret } : {})}
              {...(props.providerOptions !== undefined
                ? { providerOptions: props.providerOptions }
                : {})}
              {...(props.discoveredModels !== undefined
                ? { discoveredModels: props.discoveredModels }
                : {})}
              {...(props.onProviderApiKeyChanged !== undefined
                ? { onProviderApiKeyChanged: props.onProviderApiKeyChanged }
                : {})}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export const ExternalAgentsSection = memo(ExternalAgentsSectionImpl);

interface AdapterBlockProps {
  readonly adapter: ExternalAgentAdapter;
  readonly instance: ExternalAgentInstanceSettings;
  readonly onChange: (patch: Partial<ExternalAgentInstanceSettings>) => void;
  readonly readSecret?: (key: string) => Promise<string>;
  readonly writeSecret?: (key: string, value: string) => Promise<void>;
  readonly providerOptions?: readonly ProviderOption[];
  readonly discoveredModels?: readonly { readonly id: string }[];
  readonly onProviderApiKeyChanged?: () => Promise<void> | void;
}

function AdapterBlock(props: AdapterBlockProps): JSX.Element {
  const { adapter, instance, onChange } = props;
  const fields = useMemo(() => describeConfigSchema(adapter.configSchema), [adapter.configSchema]);

  const setConfigPath = (path: readonly string[], next: unknown): void => {
    const config = setIn(instance.config, path, next);
    onChange({ config: config as Record<string, unknown> });
  };

  const inlineProviderId =
    adapter.id === 'inline-agent'
      ? typeof (instance.config as { providerId?: unknown }).providerId === 'string'
        ? ((instance.config as { providerId: string }).providerId as string)
        : 'lmstudio'
      : null;
  const inlineProviderKind: ProviderKind | null =
    inlineProviderId !== null && PROVIDER_KIND_SET.has(inlineProviderId as ProviderKind)
      ? (inlineProviderId as ProviderKind)
      : null;
  const showInlineApiKey = inlineProviderKind !== null && kindRequiresApiKey(inlineProviderKind);

  return (
    <li
      className="leo-eas-adapter-block"
      data-slot="external-agents-adapter"
      data-adapter-id={adapter.id}
    >
      <header className="leo-eas-adapter-head">
        <label className="leo-eas-toggle">
          <input
            type="checkbox"
            aria-label={`Enable ${adapter.label}`}
            checked={instance.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          <span>{adapter.label}</span>
        </label>
      </header>
      <div className="leo-eas-adapter-body">
        {fields.length === 0 ? (
          <p className="leo-eas-no-fields">No configurable fields.</p>
        ) : (
          fields.map((f) => {
            const isProviderIdField =
              adapter.id === 'inline-agent' && f.path.length === 1 && f.path[0] === 'providerId';
            return (
              <Fragment key={f.path.join('.')}>
                <FieldRow
                  field={f}
                  value={getIn(instance.config, f.path)}
                  schema={adapter.configSchema}
                  adapterId={adapter.id}
                  onChange={(v) => setConfigPath(f.path, v)}
                  {...(props.readSecret !== undefined ? { readSecret: props.readSecret } : {})}
                  {...(props.writeSecret !== undefined ? { writeSecret: props.writeSecret } : {})}
                  {...(props.providerOptions !== undefined
                    ? { providerOptions: props.providerOptions }
                    : {})}
                  {...(props.discoveredModels !== undefined
                    ? { discoveredModels: props.discoveredModels }
                    : {})}
                />
                {isProviderIdField && showInlineApiKey && inlineProviderKind !== null ? (
                  <ProviderApiKeyField
                    providerKind={inlineProviderKind}
                    adapterId={adapter.id}
                    {...(props.readSecret !== undefined ? { readSecret: props.readSecret } : {})}
                    {...(props.writeSecret !== undefined ? { writeSecret: props.writeSecret } : {})}
                    {...(props.onProviderApiKeyChanged !== undefined
                      ? { onProviderApiKeyChanged: props.onProviderApiKeyChanged }
                      : {})}
                  />
                ) : null}
              </Fragment>
            );
          })
        )}
      </div>
    </li>
  );
}

interface ProviderApiKeyFieldProps {
  readonly providerKind: ProviderKind;
  readonly adapterId: string;
  readonly readSecret?: (key: string) => Promise<string>;
  readonly writeSecret?: (key: string, value: string) => Promise<void>;
  readonly onProviderApiKeyChanged?: () => Promise<void> | void;
}

function ProviderApiKeyField(props: ProviderApiKeyFieldProps): JSX.Element {
  const storageKey = `provider.${props.providerKind}.apiKey`;
  const [draft, setDraft] = useState<string>('');
  const [stored, setStored] = useState<boolean>(false);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    setDraft('');
    let cancelled = false;
    if (props.readSecret !== undefined) {
      void props.readSecret(storageKey).then((v) => {
        if (!cancelled) setStored(v.length > 0);
      });
    } else {
      setStored(false);
    }
    return () => {
      cancelled = true;
    };
  }, [storageKey, props.readSecret]);

  const save = async (): Promise<void> => {
    if (props.writeSecret === undefined) return;
    await props.writeSecret(storageKey, draft);
    setStored(draft.length > 0);
    setDraft('');
    if (props.onProviderApiKeyChanged !== undefined) {
      await props.onProviderApiKeyChanged();
    }
  };

  const labelText = `apiKey (provider: ${props.providerKind})`;
  return (
    <label
      className="leo-eas-field leo-eas-field-secret"
      data-slot="external-agents-provider-apikey"
      data-provider-kind={props.providerKind}
    >
      <span>{labelText}</span>
      <input
        type={reveal ? 'text' : 'password'}
        className="leo-eas-input"
        aria-label={`${props.adapterId}.${labelText}`}
        placeholder={stored ? '(stored — leave blank to keep)' : ''}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.length > 0) void save();
        }}
      />
      <button
        type="button"
        className="leo-eas-reveal"
        aria-label={`Toggle reveal for ${labelText}`}
        onClick={() => setReveal((v) => !v)}
      >
        {reveal ? 'Hide' : 'Reveal'}
      </button>
      <small className="leo-eas-help">
        Shared with the main provider settings. Stored via SafeStorage.
      </small>
    </label>
  );
}

interface FieldRowProps {
  readonly field: ZodFieldDescriptor;
  readonly value: unknown;
  readonly schema: z.ZodType;
  readonly adapterId: string;
  readonly onChange: (next: unknown) => void;
  readonly readSecret?: (key: string) => Promise<string>;
  readonly writeSecret?: (key: string, value: string) => Promise<void>;
  readonly providerOptions?: readonly ProviderOption[];
  readonly discoveredModels?: readonly { readonly id: string }[];
}

function FieldRow(props: FieldRowProps): JSX.Element {
  const label = props.field.path.join('.');
  const isInlineProviderId =
    props.adapterId === 'inline-agent' &&
    props.field.path.length === 1 &&
    props.field.path[0] === 'providerId';
  const isInlineModel =
    props.adapterId === 'inline-agent' &&
    props.field.path.length === 1 &&
    props.field.path[0] === 'model';
  if (isInlineProviderId && (props.providerOptions?.length ?? 0) > 0) {
    const opts = props.providerOptions ?? [];
    return (
      <label className="leo-eas-field" key={label}>
        <span>{label}</span>
        <select
          className="leo-eas-select"
          aria-label={`${props.adapterId}.${label}`}
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={(e) => props.onChange(e.target.value)}
        >
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {props.field.description !== undefined ? (
          <small className="leo-eas-help">{props.field.description}</small>
        ) : null}
      </label>
    );
  }
  if (isInlineModel && (props.discoveredModels?.length ?? 0) > 0) {
    const models = props.discoveredModels ?? [];
    const current = typeof props.value === 'string' ? props.value : '';
    const known = models.some((m) => m.id === current);
    return (
      <label className="leo-eas-field" key={label}>
        <span>{label}</span>
        <select
          className="leo-eas-select"
          aria-label={`${props.adapterId}.${label}`}
          value={current}
          onChange={(e) => props.onChange(e.target.value)}
        >
          <option value="">(use default)</option>
          {!known && current.length > 0 ? (
            <option value={current}>{current} (not in list)</option>
          ) : null}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </select>
        {props.field.description !== undefined ? (
          <small className="leo-eas-help">{props.field.description}</small>
        ) : null}
      </label>
    );
  }
  switch (props.field.kind) {
    case 'string':
      return (
        <label className="leo-eas-field" key={label}>
          <span>{label}</span>
          <input
            type="text"
            className="leo-eas-input"
            aria-label={`${props.adapterId}.${label}`}
            value={typeof props.value === 'string' ? props.value : ''}
            onChange={(e) => props.onChange(e.target.value)}
          />
          {props.field.description !== undefined && props.field.description !== 'secret' ? (
            <small className="leo-eas-help">{props.field.description}</small>
          ) : null}
        </label>
      );
    case 'secret':
      return <SecretField {...props} label={label} />;
    case 'number':
      return (
        <label className="leo-eas-field" key={label}>
          <span>{label}</span>
          <input
            type="number"
            className="leo-eas-input"
            aria-label={`${props.adapterId}.${label}`}
            value={typeof props.value === 'number' ? props.value : 0}
            onChange={(e) => props.onChange(Number(e.target.value))}
          />
          {props.field.description !== undefined ? (
            <small className="leo-eas-help">{props.field.description}</small>
          ) : null}
        </label>
      );
    case 'boolean':
      return (
        <label className="leo-eas-field leo-eas-field-checkbox" key={label}>
          <input
            type="checkbox"
            aria-label={`${props.adapterId}.${label}`}
            checked={Boolean(props.value)}
            onChange={(e) => props.onChange(e.target.checked)}
          />
          <span>{label}</span>
          {props.field.description !== undefined ? (
            <small className="leo-eas-help">{props.field.description}</small>
          ) : null}
        </label>
      );
    case 'string-array':
      return (
        <label className="leo-eas-field" key={label}>
          <span>{label} (comma-separated)</span>
          <input
            type="text"
            className="leo-eas-input"
            aria-label={`${props.adapterId}.${label}`}
            value={Array.isArray(props.value) ? (props.value as string[]).join(', ') : ''}
            onChange={(e) =>
              props.onChange(
                e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0),
              )
            }
          />
          {props.field.description !== undefined ? (
            <small className="leo-eas-help">{props.field.description}</small>
          ) : null}
        </label>
      );
    case 'object':
      return (
        <fieldset className="leo-eas-fieldset" key={label}>
          <legend>{label}</legend>
          {(props.field.children ?? []).map((child) => (
            <FieldRow
              key={child.path.join('.')}
              field={child}
              value={getIn(props.value, child.path.slice(props.field.path.length))}
              schema={props.schema}
              adapterId={props.adapterId}
              onChange={(v) =>
                props.onChange(setIn(props.value, child.path.slice(props.field.path.length), v))
              }
              {...(props.readSecret !== undefined ? { readSecret: props.readSecret } : {})}
              {...(props.writeSecret !== undefined ? { writeSecret: props.writeSecret } : {})}
            />
          ))}
        </fieldset>
      );
    case 'unknown':
    default:
      return (
        <div className="leo-eas-unknown" key={label} role="note">
          <span>{label}</span>
          <pre className="leo-eas-mono">{JSON.stringify(props.value)}</pre>
          <small>(unsupported field type — edit data.json directly)</small>
        </div>
      );
  }
}

function SecretField(props: FieldRowProps & { label: string }): JSX.Element {
  const [draft, setDraft] = useState<string>('');
  const [reveal, setReveal] = useState(false);
  const indirection = `${SAFE_STORAGE_PREFIX}externalAgents.${props.adapterId}.${props.label}`;
  const isStored = typeof props.value === 'string' && props.value.startsWith(SAFE_STORAGE_PREFIX);

  useEffect(() => {
    setDraft('');
  }, [props.adapterId, props.label]);

  const save = async (): Promise<void> => {
    if (props.writeSecret !== undefined) {
      await props.writeSecret(`externalAgents.${props.adapterId}.${props.label}`, draft);
    }
    props.onChange(indirection);
    setDraft('');
  };

  return (
    <label className="leo-eas-field leo-eas-field-secret" data-slot="external-agents-secret">
      <span>{props.label} (secret)</span>
      <input
        type={reveal ? 'text' : 'password'}
        className="leo-eas-input"
        aria-label={`${props.adapterId}.${props.label}`}
        placeholder={isStored ? '(stored — leave blank to keep)' : ''}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.length > 0) void save();
        }}
      />
      <button
        type="button"
        className="leo-eas-reveal"
        aria-label={`Toggle reveal for ${props.label}`}
        onClick={() => setReveal((v) => !v)}
      >
        {reveal ? 'Hide' : 'Reveal'}
      </button>
    </label>
  );
}

function getIn(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function setIn(obj: unknown, path: readonly string[], next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...tail] = path;
  const headKey = head as string;
  const base = obj !== null && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
  return { ...base, [headKey]: setIn(base[headKey], tail, next) };
}
