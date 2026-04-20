import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Agent,
  MemoryBinding,
  MemoryBindingTarget,
  MemoryProviderDescriptor,
  Project,
} from "@paperclipai/shared";
import { Bot, FolderKanban, GitBranch, Plus, Star } from "lucide-react";
import { agentsApi } from "../api/agents";
import { memoryApi } from "../api/memory";
import { projectsApi } from "../api/projects";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { Link, useBeforeUnload } from "@/lib/router";
import { getSuggestedMemoryConfig, prettyMemoryConfig, validateMemoryProviderConfig } from "../lib/memory-config-schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MemoryProviderConfigForm } from "./MemoryProviderConfigForm";

const DEFAULT_LOCAL_BASIC_CONFIG = {
  enablePreRunHydrate: true,
  enablePostRunCapture: true,
  enableIssueCommentCapture: false,
  enableIssueDocumentCapture: true,
  maxHydrateSnippets: 5,
};

const BINDING_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function providerLabel(provider: MemoryProviderDescriptor | undefined, binding: MemoryBinding) {
  return provider?.displayName ?? binding.providerKey;
}

function providerDescription(provider: MemoryProviderDescriptor | undefined) {
  return provider?.description ?? "Memory provider";
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function formatConfigValue(value: unknown) {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (value === null || value === undefined || value === "") return "unset";
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return "configured";
  return String(value);
}

function bindingConfigSummary(binding: MemoryBinding) {
  if (binding.providerKey === "local_basic") {
    const config = { ...DEFAULT_LOCAL_BASIC_CONFIG, ...binding.config };
    return [
      { label: "Pre-run", value: formatConfigValue(config.enablePreRunHydrate) },
      { label: "Post-run", value: formatConfigValue(config.enablePostRunCapture) },
      { label: "Top N", value: formatConfigValue(config.maxHydrateSnippets) },
      { label: "Issue docs", value: formatConfigValue(config.enableIssueDocumentCapture) },
    ];
  }

  const entries = Object.entries(binding.config ?? {});
  if (entries.length === 0) return [{ label: "Config", value: "default" }];
  return entries.slice(0, 4).map(([label, value]) => ({
    label,
    value: formatConfigValue(value),
  }));
}

function bindingKeyError(key: string) {
  const trimmed = key.trim();
  if (!trimmed) return "Binding key is required.";
  if (!BINDING_KEY_PATTERN.test(trimmed)) {
    return "Use kebab-case: lowercase letters, numbers, and single hyphens.";
  }
  return null;
}

function ProviderSelect({
  value,
  providers,
  provider,
  disabled = false,
  onValueChange,
}: {
  value: string;
  providers: MemoryProviderDescriptor[];
  provider?: MemoryProviderDescriptor;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
}) {
  const availableProviders = providers.some((candidate) => candidate.key === value)
    ? providers
    : [
      ...providers,
      {
        key: value,
        displayName: value,
        description: "Memory provider",
        kind: "builtin",
        pluginId: null,
        capabilities: {
          browse: false,
          correction: false,
          asyncIngestion: false,
          providerManagedExtraction: false,
        },
        configSchema: null,
        configMetadata: null,
      } satisfies MemoryProviderDescriptor,
    ];

  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableProviders.map((candidate) => (
            <SelectItem key={candidate.key} value={candidate.key}>
              {candidate.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {providerDescription(provider)}
      </p>
    </div>
  );
}

function BindingRowsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="rounded-md border border-border px-4 py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="w-full space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-12 w-full" />
            </div>
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfigSummary({ binding }: { binding: MemoryBinding }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-4">
      {bindingConfigSummary(binding).map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="truncate text-xs text-muted-foreground">{item.label}</dt>
          <dd className="truncate text-xs font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MemoryBindingCard({
  binding,
  isDefault,
  overrideCount,
  providers,
  provider,
  onSetDefault,
}: {
  binding: MemoryBinding;
  isDefault: boolean;
  overrideCount: number;
  providers: MemoryProviderDescriptor[];
  provider?: MemoryProviderDescriptor;
  onSetDefault: (bindingId: string) => void;
}) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(binding.name ?? "");
  const [enabled, setEnabled] = useState(binding.enabled);
  const [config, setConfig] = useState<Record<string, unknown>>(binding.config ?? {});
  const [configValid, setConfigValid] = useState(true);

  useEffect(() => {
    setName(binding.name ?? "");
    setEnabled(binding.enabled);
    setConfig(binding.config ?? {});
    setConfigValid(true);
  }, [binding]);

  const dirty =
    name !== (binding.name ?? "")
    || enabled !== binding.enabled
    || prettyMemoryConfig(config) !== prettyMemoryConfig(binding.config ?? {});

  useBeforeUnload(
    useCallback((event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }, [dirty]),
  );

  const updateBinding = useMutation({
    mutationFn: async () => {
      const validation = validateMemoryProviderConfig(provider, config);
      if (!validation.valid) throw new Error("Provider config has invalid fields");
      return memoryApi.updateBinding(binding.id, {
        name: name.trim() || null,
        enabled,
        config,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.memory.all });
      pushToast({
        title: "Memory binding updated",
        body: `${binding.key} saved successfully.`,
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to update memory binding",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  return (
    <div className="rounded-md border border-border px-4 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">{binding.name ?? binding.key}</h3>
            <StatusBadge status={enabled ? "active" : "paused"} />
            {isDefault && (
              <Badge variant="secondary">
                <Star className="h-3 w-3" />
                Company default
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">Key: {binding.key}</div>
          <ConfigSummary binding={{ ...binding, config }} />
          <div className="text-xs text-muted-foreground">
            {overrideCount > 0 ? `${overrideCount} override${overrideCount === 1 ? "" : "s"}` : "No project or agent overrides"}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isDefault}
          onClick={() => onSetDefault(binding.id)}
        >
          {isDefault ? "Default" : "Make default"}
        </Button>
      </div>

      <div className="mt-4 grid gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`binding-name-${binding.id}`} className="text-xs font-medium text-muted-foreground">
              Display name
            </Label>
            <Input
              id={`binding-name-${binding.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Optional label"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground">Provider</Label>
            <ProviderSelect
              value={binding.providerKey}
              providers={providers}
              provider={provider}
              disabled
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id={`binding-enabled-${binding.id}`}
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked === true)}
          />
          <Label htmlFor={`binding-enabled-${binding.id}`}>Enabled</Label>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Provider config</div>
          <MemoryProviderConfigForm
            provider={provider}
            value={config}
            onChange={setConfig}
            onValidationChange={setConfigValid}
          />
          {updateBinding.isError ? (
            <p className="text-xs text-destructive">
              {updateBinding.error instanceof Error ? updateBinding.error.message : "Failed to update binding"}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {dirty ? <div className="text-xs text-muted-foreground">Unsaved changes will prompt before leaving.</div> : null}
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty || !configValid || updateBinding.isPending}
            onClick={() => updateBinding.mutate()}
          >
            {updateBinding.isPending ? "Saving..." : "Save binding"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreateBindingDialog({
  open,
  onOpenChange,
  companyId,
  providers,
  providersByKey,
  selectedProvider,
  providerKey,
  setProviderKey,
  config,
  setConfig,
  configValid,
  setConfigValid,
  setCompanyDefault,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  providers: MemoryProviderDescriptor[];
  providersByKey: Map<string, MemoryProviderDescriptor>;
  selectedProvider?: MemoryProviderDescriptor;
  providerKey: string;
  setProviderKey: (providerKey: string) => void;
  config: Record<string, unknown>;
  setConfig: (config: Record<string, unknown>) => void;
  configValid: boolean;
  setConfigValid: (valid: boolean) => void;
  setCompanyDefault: ReturnType<typeof useMutation<MemoryBindingTarget, Error, string>>;
}) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [key, setKey] = useState("default-memory");
  const [name, setName] = useState("Default memory");
  const [enabled, setEnabled] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdBinding, setCreatedBinding] = useState<MemoryBinding | null>(null);
  const keyError = bindingKeyError(key);

  const createBinding = useMutation<MemoryBinding, Error, void>({
    mutationFn: async () => {
      const validation = validateMemoryProviderConfig(selectedProvider, config);
      if (!validation.valid) throw new Error("Provider config has invalid fields");
      return memoryApi.createBinding(companyId, {
        key: key.trim(),
        name: name.trim() || null,
        providerKey,
        config,
        enabled,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.memory.all });
      pushToast({
        title: "Memory binding created",
        body: "Choose whether to make it the company default.",
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to create memory binding",
        body: error.message,
        tone: "error",
      });
    },
  });

  const resetForm = useCallback(() => {
    setKey("default-memory");
    setName("Default memory");
    setEnabled(true);
    setCreateError(null);
    setCreatedBinding(null);
    setProviderKey(providersByKey.has("local_basic") ? "local_basic" : providers[0]?.key ?? "local_basic");
    setConfig(getSuggestedMemoryConfig(providersByKey.get("local_basic") ?? providers[0]) ?? DEFAULT_LOCAL_BASIC_CONFIG);
    setConfigValid(true);
  }, [providers, providersByKey, setConfig, setConfigValid, setProviderKey]);

  function closeDialog() {
    onOpenChange(false);
    resetForm();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (createBinding.isPending || setCompanyDefault.isPending) return;
        if (!next) {
          closeDialog();
          return;
        }
        onOpenChange(true);
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        {createdBinding ? (
          <>
            <DialogHeader>
              <DialogTitle>Binding created</DialogTitle>
              <DialogDescription>
                Make {createdBinding.name ?? createdBinding.key} the company default for new runs?
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-border px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium">{createdBinding.name ?? createdBinding.key}</div>
                <StatusBadge status={createdBinding.enabled ? "active" : "paused"} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Provider: {providerLabel(providersByKey.get(createdBinding.providerKey), createdBinding)}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>
                Keep current default
              </Button>
              <Button
                disabled={setCompanyDefault.isPending}
                onClick={() => {
                  setCompanyDefault.mutate(createdBinding.id, {
                    onSuccess: () => closeDialog(),
                  });
                }}
              >
                {setCompanyDefault.isPending ? "Saving..." : "Make default"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add binding</DialogTitle>
              <DialogDescription>
                Create a memory provider binding, then choose whether it should become the company default.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="memory-binding-key" className="text-xs font-medium text-muted-foreground">
                    Binding key
                  </Label>
                  <Input
                    id="memory-binding-key"
                    value={key}
                    onChange={(event) => {
                      setKey(event.target.value);
                      setCreateError(null);
                    }}
                    placeholder="default-memory"
                    aria-invalid={keyError ? true : undefined}
                  />
                  {keyError ? <p className="text-xs text-destructive">{keyError}</p> : null}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="memory-binding-name" className="text-xs font-medium text-muted-foreground">
                    Display name
                  </Label>
                  <Input
                    id="memory-binding-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Default memory"
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Provider</Label>
                  <ProviderSelect
                    value={providerKey}
                    providers={providers}
                    provider={selectedProvider}
                    onValueChange={(nextKey) => {
                      const nextProvider = providersByKey.get(nextKey);
                      setProviderKey(nextKey);
                      setConfig(getSuggestedMemoryConfig(nextProvider));
                      setConfigValid(true);
                      setCreateError(null);
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 pt-7">
                  <Checkbox
                    id="memory-binding-enabled"
                    checked={enabled}
                    onCheckedChange={(checked) => setEnabled(checked === true)}
                  />
                  <Label htmlFor="memory-binding-enabled">Enabled</Label>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Provider config</div>
                <MemoryProviderConfigForm
                  provider={selectedProvider}
                  value={config}
                  onChange={(nextConfig) => {
                    setConfig(nextConfig);
                    setCreateError(null);
                  }}
                  onValidationChange={setConfigValid}
                />
                {createError ? <p className="text-xs text-destructive">{createError}</p> : null}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                disabled={Boolean(keyError) || !providerKey || !configValid || createBinding.isPending}
                onClick={() => {
                  setCreateError(null);
                  createBinding.mutate(undefined, {
                    onSuccess: (created) => {
                      setCreatedBinding(created);
                    },
                    onError: (error) => {
                      setCreateError(error.message);
                    },
                  });
                }}
              >
                {createBinding.isPending ? "Creating..." : "Create binding"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InheritanceBindingSummary({
  binding,
  provider,
}: {
  binding: MemoryBinding | null;
  provider?: MemoryProviderDescriptor;
}) {
  if (!binding) {
    return <span className="text-sm text-muted-foreground">No binding configured</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{binding.name ?? binding.key}</span>
      <span className="text-xs text-muted-foreground">{providerLabel(provider, binding)}</span>
      <StatusBadge status={binding.enabled ? "active" : "paused"} />
    </div>
  );
}

function OverrideRows({
  targets,
  bindingsById,
  providersByKey,
  agentsById,
  projectsById,
}: {
  targets: MemoryBindingTarget[];
  bindingsById: Map<string, MemoryBinding>;
  providersByKey: Map<string, MemoryProviderDescriptor>;
  agentsById: Map<string, Agent>;
  projectsById: Map<string, Project>;
}) {
  if (targets.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
        No overrides configured.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {targets.map((target) => {
        const binding = bindingsById.get(target.bindingId) ?? null;
        const provider = binding ? providersByKey.get(binding.providerKey) : undefined;
        const project = target.targetType === "project" ? projectsById.get(target.targetId) : null;
        const agent = target.targetType === "agent" ? agentsById.get(target.targetId) : null;
        const label = project?.name ?? agent?.name ?? `${target.targetType} ${shortId(target.targetId)}`;
        const href = target.targetType === "project"
          ? `/projects/${target.targetId}/memory`
          : `/agents/${target.targetId}/memory`;

        return (
          <div key={target.id} className="rounded-md border border-border px-4 py-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <Link to={href} className="text-sm font-medium text-primary hover:underline">
                {label}
              </Link>
              <InheritanceBindingSummary binding={binding} provider={provider} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CompanyMemorySettings({ companyId }: { companyId: string }) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [providerKey, setProviderKey] = useState("local_basic");
  const [config, setConfig] = useState<Record<string, unknown>>(DEFAULT_LOCAL_BASIC_CONFIG);
  const [configValid, setConfigValid] = useState(true);

  const providersQuery = useQuery({
    queryKey: queryKeys.memory.providers(companyId),
    queryFn: () => memoryApi.providers(companyId),
  });

  const bindingsQuery = useQuery({
    queryKey: queryKeys.memory.bindings(companyId),
    queryFn: () => memoryApi.listBindings(companyId),
  });

  const targetsQuery = useQuery({
    queryKey: queryKeys.memory.targets(companyId),
    queryFn: () => memoryApi.listTargets(companyId),
  });

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(companyId),
    queryFn: () => projectsApi.list(companyId),
  });

  const providers = providersQuery.data ?? [];
  const providersByKey = useMemo(
    () => new Map(providers.map((provider) => [provider.key, provider])),
    [providers],
  );
  const selectedProvider = providersByKey.get(providerKey);

  const bindings = bindingsQuery.data ?? [];
  const bindingsById = useMemo(
    () => new Map(bindings.map((binding) => [binding.id, binding])),
    [bindings],
  );

  const targets = targetsQuery.data ?? [];
  const companyDefaultTarget = targets.find((target) => target.targetType === "company" && target.targetId === companyId) ?? null;
  const defaultBindingId = companyDefaultTarget?.bindingId ?? null;
  const defaultBinding = defaultBindingId ? bindingsById.get(defaultBindingId) ?? null : null;
  const projectTargets = targets.filter((target) => target.targetType === "project");
  const agentTargets = targets.filter((target) => target.targetType === "agent");

  const agentsById = useMemo(
    () => new Map((agentsQuery.data ?? []).map((agent) => [agent.id, agent])),
    [agentsQuery.data],
  );
  const projectsById = useMemo(
    () => new Map((projectsQuery.data ?? []).map((project) => [project.id, project])),
    [projectsQuery.data],
  );

  const overrideCountByBindingId = useMemo(() => {
    const result = new Map<string, number>();
    for (const target of targets) {
      if (target.targetType !== "agent" && target.targetType !== "project") continue;
      result.set(target.bindingId, (result.get(target.bindingId) ?? 0) + 1);
    }
    return result;
  }, [targets]);

  useEffect(() => {
    if (!providers.length) return;
    if (providers.some((provider) => provider.key === providerKey)) return;
    const nextProvider = providers[0]!;
    setProviderKey(nextProvider.key);
    setConfig(getSuggestedMemoryConfig(nextProvider));
    setConfigValid(true);
  }, [providerKey, providers]);

  const setCompanyDefault = useMutation<MemoryBindingTarget, Error, string>({
    mutationFn: (bindingId: string) => memoryApi.setCompanyDefault(companyId, bindingId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.memory.all });
      pushToast({
        title: "Company default updated",
        body: "New runs will resolve memory through the selected binding.",
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Failed to update company memory default",
        body: error.message,
        tone: "error",
      });
    },
  });

  const isLoading = providersQuery.isLoading || bindingsQuery.isLoading || targetsQuery.isLoading;
  const error = providersQuery.error ?? bindingsQuery.error ?? targetsQuery.error ?? null;
  const labelError = agentsQuery.error ?? projectsQuery.error ?? null;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Memory</div>
        <h2 className="text-lg font-semibold">Company memory settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure provider bindings and inspect how company defaults resolve into project and agent overrides.
        </p>
      </div>

      <Tabs defaultValue="bindings" className="space-y-4">
        <TabsList>
          <TabsTrigger value="bindings">Bindings</TabsTrigger>
          <TabsTrigger value="inheritance">Inheritance</TabsTrigger>
        </TabsList>

        <TabsContent value="bindings" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">Bindings</h3>
              <p className="text-sm text-muted-foreground">
                Bindings determine where agent memory is hydrated from and where captured context is written.
              </p>
            </div>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Add binding
            </Button>
          </div>

          {isLoading ? (
            <BindingRowsSkeleton />
          ) : error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : bindings.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              message="No memory bindings are configured for this company."
              action="Add your first binding"
              onAction={() => setCreateDialogOpen(true)}
            />
          ) : (
            <div className="space-y-3">
              {bindings.map((binding) => (
                <MemoryBindingCard
                  key={binding.id}
                  binding={binding}
                  isDefault={binding.id === defaultBindingId}
                  overrideCount={overrideCountByBindingId.get(binding.id) ?? 0}
                  providers={providers}
                  provider={providersByKey.get(binding.providerKey)}
                  onSetDefault={(bindingId) => setCompanyDefault.mutate(bindingId)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="inheritance" className="space-y-5">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">Inheritance</h3>
            <p className="text-sm text-muted-foreground">
              Resolution starts at the company default, then project and agent overrides take precedence when present.
            </p>
          </div>

          {isLoading ? (
            <BindingRowsSkeleton />
          ) : error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : (
            <>
              {labelError ? (
                <p className="text-xs text-destructive">
                  Override labels could not be fully loaded: {labelError.message}
                </p>
              ) : null}

              <div className="space-y-3">
                <div className="rounded-md border border-border px-4 py-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Company default</div>
                      <div className="mt-1 text-xs text-muted-foreground">Applies when no narrower override exists.</div>
                    </div>
                    <InheritanceBindingSummary
                      binding={defaultBinding}
                      provider={defaultBinding ? providersByKey.get(defaultBinding.providerKey) : undefined}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <FolderKanban className="h-4 w-4 text-muted-foreground" />
                      <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Project overrides</div>
                    </div>
                    <Badge variant="secondary">{projectTargets.length}</Badge>
                  </div>
                  <OverrideRows
                    targets={projectTargets}
                    bindingsById={bindingsById}
                    providersByKey={providersByKey}
                    agentsById={agentsById}
                    projectsById={projectsById}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Agent overrides</div>
                    </div>
                    <Badge variant="secondary">{agentTargets.length}</Badge>
                  </div>
                  <OverrideRows
                    targets={agentTargets}
                    bindingsById={bindingsById}
                    providersByKey={providersByKey}
                    agentsById={agentsById}
                    projectsById={projectsById}
                  />
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <CreateBindingDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        companyId={companyId}
        providers={providers}
        providersByKey={providersByKey}
        selectedProvider={selectedProvider}
        providerKey={providerKey}
        setProviderKey={setProviderKey}
        config={config}
        setConfig={setConfig}
        configValid={configValid}
        setConfigValid={setConfigValid}
        setCompanyDefault={setCompanyDefault}
      />
    </div>
  );
}
