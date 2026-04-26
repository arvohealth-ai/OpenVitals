export const flutterCollectorBlueprint = {
  packageName: "@openvitals/collector-flutter",
  capabilities: [
    "method-channel wrapper",
    "session-aware sync",
    "background sync queue",
    "source ignore list",
    "battery backoff policy",
    "provider-mediated data labels"
  ],
  dataSemantics: {
    healthConnect: "Permissioned on-device samples/episodes uploaded in batches; not a continuous cloud raw stream."
  },
  dartSnippet: `final collector = OpenVitalsCollector(apiBaseUrl: 'http://localhost:3000');`
};
