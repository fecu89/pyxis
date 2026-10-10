# PM2 error audit and stream cleanup

Goal: inspect logged failures and fix reproducible defects without changing the running release or production data.

- [x] Compare PM2 errors with current multipart, SSE, upload configuration, auth, schema and deployment code.
- [x] Reproduce truncated multipart unhandled rejection and SSE subscription/abort-listener leaks with real streams.
- [x] Fix upload pipeline error propagation and wait for file cleanup before deleting temporary files.
- [x] Fix SSE cleanup on synchronous close, cancellation and already-aborted requests; return a new 429 response for each rejected connection.
- [x] Run regression tests, existing multipart/deploy checks, lint and TypeScript checks; independently review changes.

Review focus: truncated uploads, source read errors, abort before/during upload, file size boundaries, SSE close/abort/cancel and repeated connection-limit responses. Historical errors without a reproducible cause must remain explicitly unconfirmed.

Evidence: original code failed truncated-upload rejection, synchronous SSE unsubscribe and abort-listener cleanup tests. An isolated copy of the original SSE code also failed repeated-429 and pre-aborted-request tests. All nine lifecycle checks pass with the fixes, as do existing multipart limits, seven deployment tests, targeted ESLint and full TypeScript checks. Independent review found no important defects.

Read-only production DB checks confirmed the audio column exists and concurrent Prisma transaction reads completed without the recorded pg warning. Current upload proxy configuration already raises the old 10MB limit. OAuth state-cookie loss, historic connection resets and the logged closed-controller exceptions cannot be assigned a precise cause from the timestamp-free, abbreviated stacks. No deployment or restart performed.
