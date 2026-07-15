/**
 * Workflow Registry & Versioning — Roadmap Phase 1 #3.
 *
 * A DECLARATIVE, versioned manifest of the QA workflow, derived from the
 * existing LIFECYCLE_GRAPH + GATE_SOURCE + NODE_REQUIREMENTS. It describes and
 * versions the workflow (node sequence, node types, required approvals, required
 * credentials, required integrations, and the prompt/knowledge/framework/
 * platform versions in play) so every run can be stamped and reproduced.
 *
 * It does NOT drive execution — the runner still executes LIFECYCLE_GRAPH.
 * Making the registry a mutable, execution-driving store is intentionally
 * deferred (would be a genuine architectural change).
 *
 * Lives in @qa/shared so both the API (stamping runs) and the worker/web
 * (display) read one source of truth.
 */
import {
  LIFECYCLE_GRAPH,
  GATE_SOURCE,
  NODE_REQUIREMENTS,
  LIFECYCLE_VERSION,
  PLATFORM_VERSION,
  type LifecycleNode,
  type StepType,
} from './domain.js';
import { PROMPT_REGISTRY_VERSION } from './prompts.js';

export interface WorkflowNodeManifest {
  name: LifecycleNode;
  type: StepType;
  label: string;
  enabled: boolean;
  requiresApproval: boolean; // gate-type nodes
  gateSource?: LifecycleNode; // for gates that review an upstream node
  requiresCredentials: string[];
  requiresIntegrations: string[];
}

export interface WorkflowDefinition {
  workflowVersion: string;
  promptVersion: string;
  platformVersion: string;
  nodeCount: number;
  enabledCount: number;
  requiredApprovals: LifecycleNode[];
  requiredIntegrations: string[];
  requiredCredentials: string[];
  nodes: WorkflowNodeManifest[];
}

const uniqSorted = (a: string[]): string[] => [...new Set(a)].sort();

/**
 * Build the workflow manifest for a run. `enabledNodes` = the story's phase
 * selection (null/empty ⇒ every node runs).
 */
export function buildWorkflowDefinition(enabledNodes?: readonly string[] | null): WorkflowDefinition {
  const enabled = enabledNodes && enabledNodes.length ? new Set(enabledNodes) : null;
  const nodes: WorkflowNodeManifest[] = LIFECYCLE_GRAPH.map((n) => {
    const req = NODE_REQUIREMENTS[n.name] ?? {};
    return {
      name: n.name,
      type: n.type,
      label: n.label,
      enabled: !enabled || enabled.has(n.name),
      requiresApproval: n.type === 'gate',
      gateSource: GATE_SOURCE[n.name],
      requiresCredentials: req.credentials ?? [],
      requiresIntegrations: req.integrations ?? [],
    };
  });
  const active = nodes.filter((n) => n.enabled);
  return {
    workflowVersion: LIFECYCLE_VERSION,
    promptVersion: PROMPT_REGISTRY_VERSION,
    platformVersion: PLATFORM_VERSION,
    nodeCount: nodes.length,
    enabledCount: active.length,
    requiredApprovals: active.filter((n) => n.requiresApproval).map((n) => n.name),
    requiredIntegrations: uniqSorted(active.flatMap((n) => n.requiresIntegrations)),
    requiredCredentials: uniqSorted(active.flatMap((n) => n.requiresCredentials)),
    nodes,
  };
}

/** The version bundle stamped onto every Run for reproducibility. */
export interface RunVersions {
  workflowVersion: string;
  promptVersion: string;
  platformVersion: string;
  /** Hash/commit of docs/ai/** — filled by a later increment (null placeholder now). */
  knowledgeVersion: string | null;
  /** Resolved framework git commit/version — filled when available (null placeholder now). */
  frameworkVersion: string | null;
}

export function resolveRunVersions(extra?: {
  knowledgeVersion?: string | null;
  frameworkVersion?: string | null;
}): RunVersions {
  return {
    workflowVersion: LIFECYCLE_VERSION,
    promptVersion: PROMPT_REGISTRY_VERSION,
    platformVersion: PLATFORM_VERSION,
    knowledgeVersion: extra?.knowledgeVersion ?? null,
    frameworkVersion: extra?.frameworkVersion ?? null,
  };
}
