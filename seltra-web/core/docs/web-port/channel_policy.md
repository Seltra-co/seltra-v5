# Distributed machine channel policy

The web runtime permits these renderer-facing distributed machine IDs for
`distributed-machine:subscribe`, `dispatch`, and `unsubscribe`:

| Machine ID | Why it is available in the web runtime |
| --- | --- |
| `chat_stream` | Streams chat output and manages the renderer's active chat state. |
| `app_run` | Coordinates an app run and preview state initiated by the renderer. |
| `image_generation` | Drives renderer image-generation state; the runtime's web channel policy still controls its underlying IPC calls. |
| `version_preview` | Loads version and preview state shown by the renderer. |
| `plan_handoff` | Persists and presents the plan-to-build handoff used by the renderer. |

`github_ops` remains denied because it can perform GitHub operations. Unknown IDs,
test-only IDs, and future machine IDs are denied by default until their behavior
and required IPC channels are reviewed. The source constant audit in
`src/distributed_machines`, `src/chat_stream`, `src/app_run`, `src/image_generation`,
`src/version_preview`, `src/plan_handoff`, and `src/github_ops` found no other
production machine ID constants in the current source tree.

The invoke channel `version-preview:release-window-interest` is a narrow
renderer-owned cleanup exception. It lets the browser release its preview
interest and shut down the preview actor when it is the final owner. Other
release operations and every `recording:*` channel remain disabled.
