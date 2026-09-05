# Agent Note: Explicit built-in model capability references

Status: implemented

English | [中文](2026-09-05-explicit-model-capability-references.zh.md)

## Problem

pi-ai model entries combine request identity with capability metadata. A custom gateway can expose a model under a different id while supporting the same context capacity, modalities, reasoning levels, and protocol compatibility as an installed model. Requiring every capability field to be copied into the gateway profile duplicates catalog data and prevents settings users from selecting the existing thinking-level options. Inferring a source from equal model ids is unsafe because an id does not establish provider, protocol, endpoint, or capability equivalence.

## Decision

`PiAiModelProfile.capabilitiesFrom` explicitly names one built-in pi-ai provider and model. Route resolution uses that catalog entry for the model's display name, input modalities, context capacity, output capacity, reasoning flag, and thinking-level map. Its compatibility metadata is eligible only when the referenced API matches the resolved route model API. Explicit fields on the configured entry take precedence over the reference, and an unknown built-in provider/model pair fails profile resolution.

The reference is metadata-only. The configured route keeps its provider key, model id, API, endpoint, cost, credentials, and provider authentication. Capability resolution never copies the source provider identity or endpoint into a custom route. A route or model `compat` setting remains the explicit way to describe protocol differences.

The Models settings editor exposes two cascading selects for this reference. The provider select lists built-in pi-ai providers, the model select lists that provider's installed models, changing the provider clears the old model, and no model-id auto-detection runs. The editor serializes `capabilitiesFrom` only after both selections are present.

## Testing

Catalog tests cover explicit capability inheritance, explicit-field precedence, route-identity preservation, API-sensitive compatibility inheritance, unknown references, and unchanged behavior for profiles without references. Client tests cover the built-in-provider filter, no automatic matching, provider-change clearing, complete serialization, and saving the reference from both an existing provider editor and the custom-provider card. The full repository typecheck and the focused LLM/client Vitest set pass.

## Alternatives considered

**Infer the source from a matching model id.** Rejected because equal ids do not prove that two providers expose the same capabilities or protocol, and a silent match makes a typo indistinguishable from an intentional route.

**Copy the source provider, API, endpoint, or authentication settings.** Rejected because the custom gateway's request identity belongs to its configured route. Copying those fields would send requests to or authenticate against the built-in provider instead of the gateway the user selected.

**Require users to duplicate every capability field.** Rejected because it recreates installed catalog data in user settings, makes reasoning-level choices unavailable until copied correctly, and drifts when the pi-ai catalog changes.

## Consequences

Custom routes can reuse built-in capability metadata without changing the provider or model identity sent to pi-ai. References are versioned by the installed pi-ai catalog: a removed or renamed built-in provider/model makes the configuration unserviceable until the explicit reference changes. Gateway-specific protocol behavior still requires explicit route or model compatibility settings, and the UI intentionally offers no custom-source or automatic-matching path.
