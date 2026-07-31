export type RuntimeControlStatus = {
  authentication: {
    authenticated: true;
    provider: "sign_in_with_chatgpt" | "cloudflare_access" | "development_demo";
    productionIdentity: boolean;
  };
  scheduler: {
    state: "active" | "stale" | "not_started";
    lastCompletedAt: string | null;
    lastStatus: "healthy" | "degraded" | null;
    recoveredLeases: number;
  };
  queue: {
    pending: number;
    leased: number;
    retryWait: number;
    succeeded: number;
    quarantined: number;
  };
  secretBroker: {
    ready: boolean;
    missing: string[];
    plaintextStorageAllowed: false;
  };
  exchangeReconciliation: {
    activeConnections: number;
    pendingConnections: number;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastEvidenceHash: string | null;
  };
  auditChain: {
    valid: boolean;
    checked: number;
    brokenSequence: number | null;
  };
  liveTrading: {
    allowed: false;
    reason: "institutional_foundation_validation";
  };
  recentJobs: Array<{
    id: string;
    kind: "shadow_cycle" | "exchange_reconciliation";
    status: string;
    attemptCount: number;
    maxAttempts: number;
    scheduledFor: string;
    completedAt: string | null;
    errorCode: string | null;
  }>;
  serverTime: string;
};

export type RuntimeCommandInput =
  | {
      action: "register_read_only_exchange";
      accountLabel: string;
      accountFingerprint: string;
      secretReference: string;
    }
  | {
      action: "enqueue_shadow_cycle";
      deploymentId: string;
    }
  | {
      action: "decide_read_only_exchange";
      connectionId: string;
      decision: "approve" | "reject";
      note: string;
    };
