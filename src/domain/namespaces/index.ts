export type NamespaceDescriptor = {
  namespace: string;
  relay: boolean;
};

// Flows and drops per namespace among the cluster's `counted` newest flows.
export type NamespaceActivity = {
  counted: number;
  byNamespace: Map<string, { flows: number; dropped: number }>;
};
